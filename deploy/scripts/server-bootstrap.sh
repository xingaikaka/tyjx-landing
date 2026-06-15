#!/usr/bin/env bash
# 一次性服务器初始化:install nginx / node / pnpm / pm2 / acme.sh + 建目录
#
# 用法(在 43.128.4.201 上,以 root 跑):
#   bash server-bootstrap.sh ops@example.com

set -e

EMAIL="${1:-ops@example.com}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERR: please run as root (sudo)"
  exit 1
fi

echo ">>> apt update + base packages"
apt-get update -y
# ffmpeg: admin-server 把 mp4 转 HLS + 截首帧用
apt-get install -y curl git nginx ufw unzip rsync ffmpeg

echo ">>> Install Node 20 + pnpm + pm2"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pnpm pm2

echo ">>> Install acme.sh ($EMAIL)"
if [[ ! -d "$HOME/.acme.sh" ]]; then
  curl https://get.acme.sh | sh -s "email=$EMAIL"
fi

echo ">>> Mkdirs"
mkdir -p \
  /opt/sites/luodiye_video/out \
  /opt/sites/admin-portal-web/dist \
  /opt/tyjx-data/admin/db \
  /opt/tyjx-data/admin/uploads \
  /etc/nginx/ssl \
  /var/log/pm2

# nginx 限速 zone
if [[ ! -f /etc/nginx/conf.d/limit_zones.conf ]]; then
  cat > /etc/nginx/conf.d/limit_zones.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=admin_login:10m rate=5r/m;
EOF
fi

echo ">>> UFW(可选,默认不开。手动开请删 # 注释)"
# ufw allow 22/tcp
# ufw allow 80/tcp
# ufw allow 443/tcp
# ufw --force enable

echo ">>> Done. Next:"
cat <<EOF

  1. 在本机:
       export CF_Token=...
       export CF_Account_ID=...
       bash deploy/scripts/issue-cert.sh tyjxhotpzixm.cc      # 每个 finalLanding 跑一遍

  2. cp deploy/nginx/luodiye-final-landing.conf /etc/nginx/sites-available/
     cp deploy/nginx/admin-portal.conf          /etc/nginx/sites-available/
     ln -sf ... /etc/nginx/sites-enabled/
     nginx -t && systemctl reload nginx

  3. clone repo to /opt/tyjx-landing,创建 packages/admin-server/.env:
       cp packages/admin-server/.env.example packages/admin-server/.env
       # 改 DB_PATH=/opt/tyjx-data/admin/db/tyjx-admin.db
       #   UPLOAD_DIR=/opt/tyjx-data/admin/uploads
       #   PORTAL_API_SECRET / JWT_SECRET / DEFAULT_ADMIN_*

  4. pnpm install && pm2 start deploy/pm2/ecosystem.config.cjs
     pm2 save && pm2 startup systemd

  5. 本地: bash deploy/scripts/deploy-luodiye.sh /path/to/luodiye_video
            bash deploy/scripts/deploy-admin.sh

  6. Relay-server(中转层):
       rsync -avz --exclude node_modules --exclude .cache --exclude .env \
         packages/relay-server/  root@<vps>:/opt/tyjx-portal-server/
       ssh <vps> 'cd /opt/tyjx-portal-server && npm install --omit=dev'
       从 admin-server .env 同步 PORTAL_API_SECRET 到 /opt/tyjx-portal-server/.env
       pm2 start /opt/tyjx-portal-server/deploy/pm2/ecosystem.config.cjs
       cp deploy/nginx/relay.conf.example /etc/nginx/conf.d/tyjx-portal.conf
       nginx -t && nginx -s reload

EOF
