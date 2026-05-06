#!/usr/bin/env bash
# 天涯精选 - 部署到 Cloudflare Pages
# 用法: ./deploy.sh [--create] 或 npm run deploy

set -e

PROJECT_NAME="tyjx-landing"
OUTPUT_DIR="public"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

# 解析参数
CREATE_PROJECT=false
for arg in "$@"; do
  [ "$arg" = "--create" ] && CREATE_PROJECT=true
done

echo "=========================================="
echo "  天涯精选 - 部署到 Cloudflare Pages"
echo "=========================================="
echo ""

# 检查 public 目录
if [ ! -d "$OUTPUT_DIR" ]; then
  echo "错误: 未找到 $OUTPUT_DIR 目录"
  exit 1
fi

# 检查 functions 目录
if [ ! -d "functions" ]; then
  echo "错误: 未找到 functions 目录"
  exit 1
fi

# 检查 wrangler
if ! command -v wrangler &>/dev/null; then
  echo "未检测到 wrangler，使用 npx 执行..."
  WRANGLER="npx wrangler"
else
  WRANGLER="wrangler"
fi

# 首次部署：创建项目
if [ "$CREATE_PROJECT" = true ]; then
  echo "创建 Pages 项目: $PROJECT_NAME"
  $WRANGLER pages project create "$PROJECT_NAME" || true
  echo ""
fi

# 部署
echo "正在部署到 Cloudflare Pages..."
echo "项目: $PROJECT_NAME"
echo "目录: $OUTPUT_DIR"
echo ""

$WRANGLER pages deploy "$OUTPUT_DIR" --project-name="$PROJECT_NAME"

echo ""
echo "=========================================="
echo "  部署完成"
echo "=========================================="
echo ""
echo "请确保已在 Dashboard 配置环境变量:"
echo "  - API_SECRET"
echo "  - JUMP_DOMAINS"
echo ""
echo "访问: https://$PROJECT_NAME.pages.dev"
echo ""
