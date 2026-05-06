#!/usr/bin/env bash
# 把 admin-server / admin-web 部署到服务器
#
# 用法:
#   export REMOTE=root@43.128.4.201
#   bash deploy-admin.sh
#
# 流程:
#   1) 远端 git pull(如已 clone 过) 或 rsync 整个 packages/admin-server + admin-web
#   2) admin-server: pnpm install --prod && pm2 reload tyjx-admin-server
#   3) admin-web:    pnpm install && pnpm build,产物 rsync 到 /opt/sites/admin-portal-web/dist

set -e

if [[ -z "${REMOTE:-}" ]]; then
  echo "ERR: REMOTE env not set, e.g. export REMOTE=root@43.128.4.201"
  exit 1
fi

REPO_DIR_LOCAL="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_DIR_REMOTE="/opt/tyjx-landing"
WEB_OUT_REMOTE="/opt/sites/admin-portal-web/dist"

echo ">>> Local repo: $REPO_DIR_LOCAL"

# ── 1. 同步 admin-server 源码 ───────────────────────────────
echo ">>> rsync admin-server"
ssh "$REMOTE" "mkdir -p $REPO_DIR_REMOTE/packages/admin-server"
rsync -azv --delete \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude 'uploads' \
  --exclude '.env' \
  "$REPO_DIR_LOCAL/packages/admin-server/" \
  "$REMOTE:$REPO_DIR_REMOTE/packages/admin-server/"

# 根工作区文件(pnpm-workspace、根 package.json、pnpm-lock)
rsync -azv \
  "$REPO_DIR_LOCAL/package.json" \
  "$REPO_DIR_LOCAL/pnpm-workspace.yaml" \
  "$REPO_DIR_LOCAL/pnpm-lock.yaml" \
  "$REMOTE:$REPO_DIR_REMOTE/" || true

ssh "$REMOTE" "cd $REPO_DIR_REMOTE/packages/admin-server && pnpm install --prod && pm2 reload tyjx-admin-server || pm2 start /opt/tyjx-landing/deploy/pm2/ecosystem.config.cjs"

# ── 2. admin-web 本地构建 + 推送 ────────────────────────────
echo ">>> Build admin-web locally"
( cd "$REPO_DIR_LOCAL/packages/admin-web" && pnpm install && pnpm build )

echo ">>> rsync admin-web/dist to $WEB_OUT_REMOTE"
ssh "$REMOTE" "mkdir -p $WEB_OUT_REMOTE"
rsync -azv --delete "$REPO_DIR_LOCAL/packages/admin-web/dist/" "$REMOTE:$WEB_OUT_REMOTE/"

echo ">>> Done."
