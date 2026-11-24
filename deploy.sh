#!/usr/bin/env bash
#
# 一键部署 / 更新 zujuan-mcp 网关（从 GitHub 构建）。
#
# 用法：
#   ./deploy.sh [安装目录] [分支]
# 默认：
#   安装目录 = $HOME/zujuan-mcp
#   分支     = main
#
# 示例：
#   curl -fsSL https://raw.githubusercontent.com/ximu227/zujuan-mcp/main/deploy.sh | bash
#   ./deploy.sh $HOME/zujuan-mcp main
#
set -euo pipefail

REPO_URL="https://github.com/ximu227/zujuan-mcp.git"
INSTALL_DIR="${1:-$HOME/zujuan-mcp}"
BRANCH="${2:-main}"

echo "==> 目标目录：$INSTALL_DIR（分支：$BRANCH）"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "==> 已存在仓库，拉取最新代码"
  git -C "$INSTALL_DIR" fetch --depth=1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  echo "==> 克隆仓库"
  git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

echo "==> 安装 Node 依赖"
cd "$INSTALL_DIR"
if command -v npm >/dev/null 2>&1; then
  npm install --omit=dev --no-audit --no-fund
else
  echo "未找到 npm，请先安装 Node.js（>=18）。" >&2
  exit 1
fi

echo "==> 准备下载目录：$HOME/zujuan-downloads"
mkdir -p "$HOME/zujuan-downloads"

echo ""
echo "==> 部署完成。"
echo "   网关会在 skill 首次调用 zj.mjs 时自动启动（默认 127.0.0.1:8765）。"
echo "   也可手动运行：node $INSTALL_DIR/doubao/gateway.mjs"
