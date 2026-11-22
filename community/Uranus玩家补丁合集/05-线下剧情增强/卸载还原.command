#!/bin/bash
# ============================================================
#  Uranus「线下剧情增强」· 卸载还原
#  用最近一次安装前的备份，逐字节还原被改的文件。
#  不碰你的角色卡、记忆库、剧情存档。
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

if [ -n "${URANUS_ROOT:-}" ]; then export URANUS_DIR="$URANUS_ROOT";
elif [ -n "${URANUS_DIR:-}" ]; then :;
elif [ -d "$HOME/Uranus_Imessage" ]; then export URANUS_DIR="$HOME/Uranus_Imessage";
else echo "✗ 没找到 Uranus_Imessage"; read -r -p "按回车退出…"; exit 1; fi

cd "$HERE/files" || exit 1
node uninstaller.mjs --run

read -r -p "按回车退出…"
