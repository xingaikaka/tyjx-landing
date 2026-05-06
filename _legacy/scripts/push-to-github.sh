#!/usr/bin/env bash
# 将落地页推送到 GitHub
# 使用前请先在 https://github.com/new 创建仓库 tyjx-landing

set -e

cd "$(dirname "$0")/.."

REPO="https://github.com/xingaikaka/tyjx-landing.git"

echo "检查 git 状态..."
git status

echo ""
echo "推送到 GitHub: $REPO"
echo "若仓库不存在，请先访问 https://github.com/new 创建 tyjx-landing"
echo ""

git push -u origin master

echo ""
echo "推送完成: https://github.com/xingaikaka/tyjx-landing"
