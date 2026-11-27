#!/bin/bash
# 卸载「入站看门狗」：停掉定时任务、还原服务端 index.js。不动 Uranus 主服务。
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

if [ -n "${URANUS_ROOT:-}" ]; then ROOT="$URANUS_ROOT";
elif [ -d "$HOME/Uranus_Imessage" ]; then ROOT="$HOME/Uranus_Imessage";
else echo "✗ 找不到 Uranus 目录，请设置 URANUS_ROOT"; read -r -p "按回车退出…"; exit 1; fi

LABEL="com.uranus.watchdog"
echo "=== 卸载入站看门狗 ==="
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "✓ 定时任务已停" || echo "· 定时任务本来就没在跑"
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -f "$ROOT/patches/watchdog/uranus-watchdog.sh"

# 用最近一次备份还原 index.js
BK="$(ls -dt "$HERE/_备份"/* 2>/dev/null | head -1)"
if [ -n "$BK" ] && [ -f "$BK/index.js" ]; then
  cp "$BK/index.js" "$ROOT/server/src/index.js" && echo "✓ 服务端 index.js 已还原"
else
  echo "⚠ 找不到备份，服务端补丁需手动撤销（搜 watchdogpatch 标记）"
fi

launchctl kickstart -k "gui/$(id -u)/com.uranus.imessage" 2>/dev/null && echo "✓ Uranus 已重启"
echo "✓ 卸载完成"
read -r -p "按回车关闭…"
