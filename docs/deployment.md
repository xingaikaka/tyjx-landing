# 部署指南

> 详细部署步骤,与 [architecture.md](architecture.md) 配合阅读。

> **中转层是 VPS Node(relay-server)**,详见 [`packages/relay-server/README.md`](../packages/relay-server/README.md)。
> 中转层部署简版命令见下方「relay-server 部署」章节。

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

### 4. 入口/发布泛域 DNS(CF 橙云代理 → cdn666 → VPS)

入口/发布池(以及品牌域 tyjx.app)走 CF 橙云代理,经 cdn666 回源到 VPS:80/443,
由 VPS Nginx 反代到 relay-server :3020。

```
A     tyjx.app                   <VPS IP>   橙色云朵(代理)
A     *.tyjxn3k8m2p7vc.cc        <VPS IP>   橙色云朵(代理)
A     *.tyjxbn4w8fgh3.cc         <VPS IP>   橙色云朵(代理)
...
```

VPS Nginx(`/etc/nginx/conf.d/tyjx-portal.conf`)的 `server_name` 需包含 brand + 入口池 + 发布池
(每个根域 + `*.<根域>`),`location / → proxy_pass http://127.0.0.1:3020`。

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
rsync -av --exclude='node_modules' \
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
PORTAL_API_SECRET=<32 字节随机,跟 relay-server 一致>
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

## relay-server 部署(Phase 5)

中转层 `packages/relay-server` 部署为 VPS 上的 `tyjx-portal-server`(:3020),由 Nginx 反代。

```bash
# 1. 同步代码(本地仓根)
rsync -avz --exclude=node_modules --exclude=.cache --exclude=.env \
  packages/relay-server/ root@<VPS>:/opt/tyjx-portal-server/

# 2. 服务器装依赖
ssh root@<VPS> 'cd /opt/tyjx-portal-server && npm install --omit=dev'

# 3. 配置 .env(关键项)
#    PORT=3020
#    HOST=0.0.0.0                     # 让 Nginx(本机/容器)可达
#    ADMIN_BASE_URL=http://127.0.0.1:3010
#    PORTAL_API_SECRET=<与 admin-server .env 同值>
#    RUNTIME_CACHE_TTL=30

# 4. PM2 启动
ssh root@<VPS> 'cd /opt/tyjx-portal-server && pm2 start src/index.js --name tyjx-portal-server && pm2 save'

# 5. Nginx 反代(server_name = brand + 入口池 + 发布池 → proxy_pass :3020)
#    参考 packages/relay-server/deploy/nginx/relay.conf.example
#    nginx -t && nginx -s reload
```

验证:`curl -H 'Host: tyjx.app' http://127.0.0.1:3020/`(应 302)、`curl http://127.0.0.1:3020/api/health`。

---

## 加新域(运维手册)

详见 [`ops-add-domain.md`](ops-add-domain.md)(待编写)。
