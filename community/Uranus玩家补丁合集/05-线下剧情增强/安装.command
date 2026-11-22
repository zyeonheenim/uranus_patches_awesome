#!/bin/bash
# ============================================================
#  Uranus「线下剧情增强」· 一键安装（macOS 双击即可）
# ------------------------------------------------------------
#  一次装四个线下剧情功能：
#    02 版本留底  —— 重roll/手改/删除都留底，气泡上能翻能恢复
#    03 气泡样式  —— 两侧气泡配色单独调，存服务端，手机电脑同一份
#    04 模型与token —— 气泡标题写清哪个模型、用了多少 token
#    05 四钮跳转  —— 右缘四个圆钮，跳顶/跳底/上一条/下一条自己的发言
#
#  可单独装其中一个（见下方 node 命令），默认四个全装。
#  装前自动备份、装坏自动回滚；随时可用「卸载还原.command」撤销。
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

echo ""
echo "=========================================="
echo " Uranus 线下剧情增强 · 安装"
echo "=========================================="
echo ""

# ---- 找 Uranus 根目录（两种环境变量都认）----
if [ -n "${URANUS_ROOT:-}" ]; then export URANUS_DIR="$URANUS_ROOT";
elif [ -n "${URANUS_DIR:-}" ]; then :;
elif [ -d "$HOME/Uranus_Imessage" ]; then export URANUS_DIR="$HOME/Uranus_Imessage";
else
  echo "✗ 没找到 Uranus_Imessage（找过 ~/Uranus_Imessage）"
  echo "  装在别处请设 URANUS_ROOT 后重试。"; read -r -p "按回车退出…"; exit 1
fi
echo "· Uranus 目录：${URANUS_DIR}"

node -v >/dev/null 2>&1 || { echo "✗ 找不到 node"; read -r -p "按回车退出…"; exit 1; }

cd "$HERE/files" || exit 1
node 安装器.mjs --only 02,03,04,05 --run

echo ""
echo "· 装完想看界面：浏览器 Cmd+R 强刷一次"
echo "· 想只装某一个：cd files && node 安装器.mjs --only 05 --run"
read -r -p "按回车退出…"
