# 部署指南

> 详细部署步骤,与 [architecture.md](architecture.md) 配合阅读。

> ⚠️ **2026-05 架构变更**:中转层已从 Cloudflare Worker 迁移到 VPS Node。
> 本文 "Worker / wrangler" 相关章节作废,新部署看
> [`packages/relay-server/README.md`](../packages/relay-server/README.md)。
> 简版命令:
> ```bash
> rsync -avz packages/relay-server/ root@43.128.4.201:/opt/tyjx-portal-server/
> ssh root@43.128.4.201 'cd /opt/tyjx-portal-server && npm install --omit=dev'
> # 同步 PORTAL_API_SECRET 到 /opt/tyjx-portal-server/.env (与 admin-server 一致)
> # pm2 start /opt/tyjx-portal-server/deploy/pm2/ecosystem.config.cjs
> # cp deploy/nginx/relay.conf.example /etc/nginx/conf.d/tyjx-portal.conf && nginx -s reload
> ```

---

## 服务器一次性初始化

```bash
# 在 43.128.4.201
sudo apt-get update
sudo apt-get install -y nginx curl git

# Node 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
npm install -g pnpm pm2

# acme.sh(Cloudflare DNS-01)
curl https://get.acme.sh | sh -s email=ops@example.com
```

---

## DNS / SSL 准备(Phase 1)

### 1. 注册 finalLandings 域(`.cc` 之类)

例如:

- `tyjxhotpzixm.cc`
- `tyjx7k2m9pqs4.cc`

### 2. 添加 CF DNS(每个 finalLanding 域)

```
A     tyjxhotpzixm.cc           43.128.4.201   仅 DNS(灰云)
A     *.tyjxhotpzixm.cc         43.128.4.201   仅 DNS(灰云)
```

> **不开 CF 代理**,因为我们用 acme.sh 签证书 + 自己 nginx 服务,要 CF 代理还要装 origin cert 复杂。

### 3. acme.sh 通配符证书

```bash
# 一次性导出 CF token(权限:Zone DNS:Edit + Zone Read)
export CF_Token="your-cf-api-token"
export CF_Account_ID="your-cf-account-id"

# 每个 finalLanding 域跑一遍
acme.sh --issue --dns dns_cf \
  -d "tyjxhotpzixm.cc" \
  -d "*.tyjxhotpzixm.cc"

# 安装证书到 nginx 标准目录
acme.sh --install-cert -d "tyjxhotpzixm.cc" \
  --key-file       /etc/nginx/ssl/tyjxhotpzixm.cc.key \
  --fullchain-file /etc/nginx/ssl/tyjxhotpzixm.cc.crt \
  --reloadcmd      "systemctl reload nginx"
```

### 4. 入口/发布泛域 DNS(交给 Worker,CF 代理)

```
CNAME *.tyjxn3k8m2p7vc.cc         tyjx-portal.workers.dev   橙色云朵(代理)
CNAME *.tyjxbn4w8fgh3.cc          tyjx-portal.workers.dev   橙色云朵(代理)
```

并在 Workers → Triggers → Routes 添加:

```
tyjx.app/*                        zone tyjx.app
*.tyjxn3k8m2p7vc.cc/*             zone tyjxn3k8m2p7vc.cc
*.tyjxbn4w8fgh3.cc/*              zone tyjxbn4w8fgh3.cc
...
```

---

## luodiye_video 部署(Phase 2)

luodiye_video 已并入本 monorepo,位置 `packages/luodiye_video`。

```bash
# 服务器
sudo mkdir -p /opt/sites/luodiye_video/out
sudo chown $USER:$USER /opt/sites/luodiye_video

# 本地(在 tyjx-landing 仓根)
pnpm install
export REMOTE=root@43.128.4.201
bash deploy/scripts/deploy-luodiye.sh
# 等价于:
#   pnpm build:landing
#   rsync -azv --delete packages/luodiye_video/out/ \
#     $REMOTE:/opt/sites/luodiye_video/out/
```

nginx 配置 `/etc/nginx/sites-available/luodiye-video`:

```nginx
server {
  listen 443 ssl http2;
  server_name *.tyjxhotpzixm.cc tyjxhotpzixm.cc
              *.tyjx7k2m9pqs4.cc tyjx7k2m9pqs4.cc
              ;
  ssl_certificate     /etc/nginx/ssl/tyjxhotpzixm.cc.crt;  # 第一证书,主匹配
  ssl_certificate_key /etc/nginx/ssl/tyjxhotpzixm.cc.key;
  # 多域 SNI 各自一份证书时,用 if/map 匹配,这里简化先支持 1 个

  root /www/luodiye-video/out;
  index index.html;
  try_files $uri $uri/ $uri/index.html =404;

  # 缓存静态
  location ~* \.(mp4|webm|jpg|png|webp|avif|ico|woff2)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
```

> **多 finalLanding 域多证书时**,要给每个域写独立 server block(SNI 自动选证书),或用 OpenResty 动态 SSL。

---

## admin-server 部署(Phase 3)

```bash
# 服务器
sudo mkdir -p /www/tyjx-landing
sudo chown $USER:$USER /www/tyjx-landing

# 本地或 CI
cd tyjx-landing
pnpm install
rsync -av --exclude='node_modules' --exclude='_legacy' \
  ./ root@43.128.4.201:/www/tyjx-landing/

# 服务器
cd /www/tyjx-landing
pnpm install
cd packages/admin-server
pnpm seed                        # 初始化数据库 + 默认管理员
pm2 start ecosystem.config.js
pm2 save
```

`.env`(放 `packages/admin-server/.env`):

```
PORT=3010
JWT_SECRET=<32 字节随机>
PORTAL_API_SECRET=<32 字节随机,跟 Worker 一致>
ADMIN_DEFAULT_USER=admin
ADMIN_DEFAULT_PASSWORD=<复杂密码>
UPLOAD_DIR=src/data/uploads
PUBLIC_URL=https://admin-portal.xxx
```

---

## admin-web 部署(Phase 3)

```bash
cd packages/admin-web
pnpm build                    # 生成 dist/
rsync -av dist/ root@43.128.4.201:/www/tyjx-landing/packages/admin-web/dist/
```

nginx 配置 `/etc/nginx/sites-available/admin-portal`:

```nginx
server {
  listen 443 ssl http2;
  server_name admin-portal.xxx;
  ssl_certificate     /etc/nginx/ssl/admin-portal.xxx.crt;
  ssl_certificate_key /etc/nginx/ssl/admin-portal.xxx.key;

  # 限 IP 白名单(仅办公网)
  allow <办公网 IP>;
  deny all;

  # admin API
  location /api/ {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 200M;       # 视频上传
  }

  # admin UI(静态)
  location / {
    root /www/tyjx-landing/packages/admin-web/dist;
    try_files $uri $uri/ /index.html;
  }
}
```

---

## tyjx-portal Worker 部署(Phase 5)

```bash
cd packages/worker

# 设置 secrets
wrangler secret put PORTAL_API_SECRET    # 跟 admin-server .env 一致
wrangler secret put ADMIN_BASE_URL       # https://admin-portal.xxx

# KV 命名空间(缓存域池)
wrangler kv:namespace create RUNTIME_CACHE
# 把返回的 id 写入 wrangler.toml

# 部署
wrangler deploy
```

在 CF Dashboard → Workers → `tyjx-portal` → Triggers,添加全部 routes(见上方 DNS 步骤)。

---

## 加新域(运维手册)

详见 [`ops-add-domain.md`](ops-add-domain.md)(待编写)。
