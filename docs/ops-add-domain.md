# 运维手册:加新域

按域池类型选对应章节。

> ⚠️ **2026-05 架构变更**:中转层不再是 Cloudflare Worker,而是 VPS Node (relay-server :3020)。
> 加 brand / entry / publish 域的"绑 Worker route"步骤已**全部作废**,改为:
> 1. 在 admin 后台域池里加上新域(写库)
> 2. 在 cdn666 把新域指向 VPS(回源 IP:80)
> 3. 在 VPS Nginx `/etc/nginx/conf.d/tyjx-portal.conf` 的 `server_name` 列表里追加新域
>    (`<root>` + `~^.+\.<root>$`),`nginx -s reload`
> 4. relay-server 内存缓存 30s 自动刷新(或调 `POST /api/internal/_reload`)
> 加 finalLanding 域的步骤不变(独立 Nginx 静态服务)。

---

## 加 finalLanding 域(真落地泛域)

**用例**:某个旧 `*.tyjxhotpzixm.cc` 被封,要换新的 `tyjxNEW.cc`。

### 手动步骤

```bash
# 1. 域名注册(略,自己买)

# 2. CF DNS(本域加进 CF,然后):
#    A     tyjxNEW.cc       → 43.128.4.201   仅 DNS(灰云)
#    A     *.tyjxNEW.cc     → 43.128.4.201   仅 DNS(灰云)

# 3. 通配符 SSL
acme.sh --issue --dns dns_cf -d "tyjxNEW.cc" -d "*.tyjxNEW.cc"
acme.sh --install-cert -d "tyjxNEW.cc" \
  --key-file       /etc/nginx/ssl/tyjxNEW.cc.key \
  --fullchain-file /etc/nginx/ssl/tyjxNEW.cc.crt \
  --reloadcmd      "systemctl reload nginx"

# 4. nginx 加 server block(独立 SNI 证书)
sudo cat >> /etc/nginx/sites-available/luodiye-video <<'EOF'

server {
  listen 443 ssl http2;
  server_name *.tyjxNEW.cc tyjxNEW.cc;
  ssl_certificate     /etc/nginx/ssl/tyjxNEW.cc.crt;
  ssl_certificate_key /etc/nginx/ssl/tyjxNEW.cc.key;
  root /www/luodiye-video/out;
  index index.html;
  try_files $uri $uri/ $uri/index.html =404;
}
EOF
sudo nginx -t && sudo systemctl reload nginx

# 5. admin 后台 → 域池管理 → 真落地池 → 添加 "tyjxNEW.cc" → 保存
#    (Worker 30 秒内自动拉到新池,生效)
```

### 自动化(可选,Phase 7)

admin-server 可以集成 1 个"加域"流程,把上面 1~5 全部自动化(需要 CF API token + SSH 私钥)。

---

## 加 entryPages / publishPages 域(Worker 路由)

**用例**:扩充入口/发布泛域池。

```bash
# 1. 域名注册

# 2. CF DNS:
#    把整个 zone 加进 CF
#    DNS 默认就有 *.<域>.cc 解析(因为我们要 Worker route 接管,具体不需要 A 记录)
#    实际只要 zone 加到 CF + Worker route 配上即可

# 3. CF Worker route(在 CF Dashboard 或 wrangler.toml):
#    *.tyjxNEW.cc/*                   → tyjx-portal Worker
#    tyjxNEW.cc/*                     → tyjx-portal Worker

# 4. admin 后台 → 域池管理 → 入口/发布池 → 添加 → 保存

# 不需要服务器操作(因为这层全在 CF Worker)
```

---

## 加 brandDomain 备用(永久门户备份域)

**用例**:`tyjx.app` 被运营商干扰时切到备用 `tyjx.vip`。

```bash
# 1. 注册备用域

# 2. CF 加 zone

# 3. CF Worker route:
#    tyjx.vip/*  → tyjx-portal Worker

# 4. admin 后台 → 暂不放主品牌域字段(只 1 个 brandDomain)
#    需要切换时,改 brandDomain 字段
```

---

## 故障应急

### 真落地域被封

```bash
# 1. admin 后台 → 域池管理 → 真落地池 → 删除被封域 → 保存
# 2. 30 秒内 Worker 不再返回这个域,新用户复制粘贴拿到的是其他域
# 3. 已经粘贴打开旧域的用户:旧域被封 → 用户刷新 → 看到错误,转告 tyjx.app 重来
```

### 入口/发布域被封

```bash
# 1. admin 后台 → 域池管理 → 删除被封域 → 保存
# 2. 30 秒内 Worker 不再 302 到这个域
# 3. 注:CF Worker route 即使 DNS 仍通,Worker 不再处理这个 host 也可以删 route
```

### tyjx.app 主域被风控

```bash
# 1. 切换 admin 配置 brandDomain → 备用域(如 tyjx.vip)
# 2. 通知运营在 APP / 推广物料里把 tyjx.app 改成 tyjx.vip
# 3. tyjx.app 老链接仍然能用(只要 CF Worker 还在,就还会跳 entry pool)
#    只是不再作为推荐永久域
```
