# @tyjx/relay-server  →  线上名 `tyjx-portal-server`

VPS 上跑的 **品牌门户 / 入口 / 发布** Node 服务,**替代** Cloudflare Worker `tyjx-portal`。

> 角色记忆:这是 **tyjx.app**(分享/品牌门户,用户手动复制粘贴)体系的中转层。
> 不要和 `dp/tyjx-relay-server`(tyapp.app 广告投放体系,二跳自动 302)搞混。

## 链路

```
用户 → cdn666(TLS 终结,国内边缘)→ VPS Nginx :80 → 本服务 :3020
                                                       │
                                                       ├─ host = tyjx.app(brandDomain)
                                                       │       → 302 到随机 *.entryPages
                                                       │
                                                       ├─ host ∈ entryPages 池
                                                       │       → SSR 入口页 HTML(图 1)
                                                       │
                                                       ├─ host ∈ publishPages 池
                                                       │       → SSR 发布页 HTML(图 2)
                                                       │
                                                       └─ /api/health|r|jump|_debug|_reload
```

落地页(`*.tyjx7k2m9pqs4.cc / *.tyjxlh2wyxr9.cc / *.tyjxhotpzixm.cc`)继续走 luodiye_video 静态托管,**不在本服务范围内**。

## 与 admin 的关系

线上 admin = PM2 进程 `tyjxapp-admin`(命名易混,实际是 tyjx.app 的)
- cwd:`/opt/tyjxapp/packages/admin-server/`
- 监听:`*:3010`
- 接口:`GET /api/portal/runtime`
- 协议:AES-256-CBC,响应体格式 `<iv hex>:<ciphertext hex>`,key = SHA256(`PORTAL_API_SECRET` + `app-landing-salt`)
- 返回字段(解密后):`{ ts, domains: { brandDomains, entryPages, publishPages, finalLandings, entryButtonsCount, publishLinksCount }, portalUI: {...} }`

`PORTAL_API_SECRET` 必须与 admin `.env` 完全一致(64 字符)。部署脚本会从 admin 同步过来。

## 与原 CF Worker 的关系

业务逻辑、URL、HTML 模板 **100% 1:1 移植**。差异只有运行时:

| 维度 | CF Worker(`@tyjx/worker`) | 本包 |
|---|---|---|
| 配置缓存 | Cloudflare KV | 本地文件 `.cache/runtime.json` + 内存 |
| 拉 admin | `fetch()` | 同 |
| 解密协议 | 同 | 同 |
| HTML 模板 | `templates/{entry,publish,layout}.js` | 字节相同 |
| 入口 | `export default { fetch }` | Express + Web Request shim |
| 部署 | wrangler | rsync + PM2 + Nginx |

## 运行

### 本地开发

```bash
cp .env.example .env
# 把 PORTAL_API_SECRET 改为本地 admin .env 的同字段值

pnpm install                                          # 在 monorepo 根
pnpm --filter @tyjx/relay-server dev

# 健康
curl http://127.0.0.1:3020/__health
curl http://127.0.0.1:3020/api/health

# 模拟 brandDomain
curl -i -H 'Host: tyjx.app' -H 'X-Forwarded-Proto: https' http://127.0.0.1:3020/
# → 302 Location: https://<10字符>.tyjxn3k8m2p7vc.cc/   或随机另一个 entry zone

# 模拟 entryPage
curl -H 'Host: x.tyjxn3k8m2p7vc.cc' http://127.0.0.1:3020/ | head -40
# → 入口页 HTML(图 1)

# 模拟 publishPage
curl -H 'Host: x.tyjxbn4w8fgh3.cc' http://127.0.0.1:3020/ | head -40
# → 发布页 HTML(图 2)

# 调试缓存
curl 'http://127.0.0.1:3020/api/_debug?token=<RUNTIME_PROBE_TOKEN>'
curl 'http://127.0.0.1:3020/api/_reload?token=<RUNTIME_PROBE_TOKEN>'
```

### 生产部署(VPS)

```bash
# 1. 同步代码
rsync -avz --delete \
  --exclude node_modules --exclude .cache --exclude .env \
  packages/relay-server/  root@43.128.4.201:/opt/tyjx-portal-server/

# 2. 在服务器
ssh root@43.128.4.201
cd /opt/tyjx-portal-server
npm install --omit=dev

# 3. 写 .env(从 admin 同步 PORTAL_API_SECRET)
cp .env.example .env
SECRET=$(grep -E '^PORTAL_API_SECRET=' /opt/tyjxapp/packages/admin-server/.env | cut -d= -f2-)
sed -i "s|^PORTAL_API_SECRET=.*|PORTAL_API_SECRET=${SECRET}|" .env

# 4. 启 PM2
pm2 start /opt/tyjx-portal-server/deploy/pm2/ecosystem.config.cjs
pm2 save

# 5. 加 Nginx vhost
sudo cp deploy/nginx/relay.conf.example /etc/nginx/conf.d/tyjx-portal.conf
sudo nginx -t && sudo nginx -s reload
```

### 升级

```bash
# 本地改完代码
rsync -avz --delete \
  --exclude node_modules --exclude .cache --exclude .env \
  packages/relay-server/  root@43.128.4.201:/opt/tyjx-portal-server/
ssh root@43.128.4.201 'cd /opt/tyjx-portal-server && pm2 reload tyjx-portal-server'
```

## 端口约定(避免混淆)

| 端口 | 用途 |
|---|---|
| 3010 | `tyjxapp-admin`(tyjx.app 的 admin)|
| **3020** | **`tyjx-portal-server`(本包,tyjx.app 的中转)** |
| 3030 | `tyjx-relay-server`(tyapp.app 的中转,在 dp/tyjx-relay-server)|
| 80/443 | Nginx(对外) |

## 三层缓存策略

```
请求 → memCache 新鲜?       → 直接返回(0 ms)
        ↓ miss / 过期
       memCache 有 stale 值? → 立即返回 stale + 后台 refresh()(0 ms)
        ↓ 完全冷启
       admin /api/portal/runtime(4s 硬超时,inflight-dedup)
        ↓ 失败
       本地 .cache/runtime.json 旧值
        ↓ 失败
       FALLBACK_POOL env(可选)
        ↓ 失败
       DEFAULT_RUNTIME(空池,服务不挂)
```

99%+ 请求 0 ms 内存命中。admin 挂 5 分钟不影响线上。

## 与 CF Worker 的并存(灰度期间)

切换期间双跑:
- Worker `tyjx-portal` 仍接 CF Workers route 上的流量
- 本服务接 cdn666 → VPS 的流量
- 两者读同一个 admin,配置一致

完全切干净 24h 后,删 `packages/worker` 整个目录,Worker route / KV 也下线。
