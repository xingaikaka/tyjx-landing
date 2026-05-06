#!/usr/bin/env bash
# 把 luodiye-video 的 next 静态产物 rsync 到 /opt/sites/luodiye_video/out
#
# 用法(在 tyjx-landing 仓根):
#   export REMOTE=root@43.128.4.201
#   bash deploy/scripts/deploy-luodiye.sh             # 默认从 packages/luodiye_video 构建
#   bash deploy/scripts/deploy-luodiye.sh path/to/dir # 也可显式指定别处的 luodiye_video 源
#
# 注意:服务器目录名仍然是 /opt/sites/luodiye_video/(跟 nginx 配置对齐),不要改。

set -e

# 1. 决定本地源目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_LOCAL="$REPO_ROOT/packages/luodiye_video"
LOCAL_DIR="${1:-$DEFAULT_LOCAL}"

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "ERR: 源目录不存在: $LOCAL_DIR"
  echo "Usage: $0 [<local luodiye-video dir>]"
  exit 1
fi

if [[ -z "${REMOTE:-}" ]]; then
  echo "ERR: REMOTE env not set, e.g. export REMOTE=root@43.128.4.201"
  exit 1
fi

cd "$LOCAL_DIR"

echo ">>> Building luodiye-video at $LOCAL_DIR"
# monorepo 子包优先用 pnpm build,fallback npm
if command -v pnpm >/dev/null 2>&1 && [[ -f "$REPO_ROOT/pnpm-workspace.yaml" ]]; then
  pnpm --filter @tyjx/luodiye-video build
else
  npm run build
fi

REMOTE_DIR="/opt/sites/luodiye_video/out"

echo ">>> Rsync $LOCAL_DIR/out/ to $REMOTE:$REMOTE_DIR"
ssh "$REMOTE" "mkdir -p $REMOTE_DIR"
rsync -azv --delete out/ "$REMOTE:$REMOTE_DIR/"

echo ">>> Done. nginx 不需要 reload(只换静态文件)"
