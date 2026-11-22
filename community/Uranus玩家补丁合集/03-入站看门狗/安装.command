#!/bin/bash
# ============================================================
#  Uranus「入站看门狗」· 一键安装（macOS 双击即可）
# ------------------------------------------------------------
#  做什么：每 60 秒检查一次「收消息」的长连接是否还活着；断了自动重连，
#          并把结果写进 Uranus 日志（可在网页左下角日志抽屉看到 [看门狗] 行）。
#
#  解决：睡醒/网络抖动后 Uranus「能发不能收」——对方看到已送达，
#        但控制台一条消息都进不来，界面却全绿。
#
#  安全：安装前备份改动的 server/src/index.js；随时可双击「卸载还原.command」撤销。
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

echo ""
echo "=========================================="
echo " Uranus 入站看门狗 · 安装"
echo "=========================================="
echo ""

# ---- 0. 找 Uranus 根目录 ----
if [ -n "${URANUS_ROOT:-}" ]; then
  ROOT="$URANUS_ROOT"
elif [ -d "$HOME/Uranus_Imessage" ]; then
  ROOT="$HOME/Uranus_Imessage"
else
  echo "✗ 没找到 Uranus_Imessage（找过 ~/Uranus_Imessage）"
  echo "  如果装在别处，请设置 URANUS_ROOT 环境变量后重试。"
  read -r -p "按回车退出…"; exit 1
fi
echo "· Uranus 目录：$ROOT"

if [ ! -d "$ROOT/server/src" ]; then
  echo "✗ 这个目录不像 Uranus 源码（缺 server/src）"
  read -r -p "按回车退出…"; exit 1
fi
node -v >/dev/null 2>&1 || { echo "✗ 找不到 node"; read -r -p "按回车退出…"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
BK="$HERE/_备份/$STAMP"
mkdir -p "$BK"
cp "$ROOT/server/src/index.js" "$BK/index.js"
echo "· 已备份 server/src/index.js → $BK/"

# ---- 1. 打服务端小补丁（加日志通知端点）----
echo ""
echo "→ 给服务端加日志通知端点（让看门狗能把结果写进日志）"
export URANUS_ROOT="$ROOT"
node "$HERE/files/服务端补丁.mjs" || { echo "✗ 补丁失败，正在回滚"; cp "$BK/index.js" "$ROOT/server/src/index.js"; read -r -p "按回车退出…"; exit 1; }

# ---- 2. 写看门狗脚本（路径自动替换成实际安装位置）----
echo ""
echo "→ 安装定时巡检脚本"
mkdir -p "$ROOT/patches/watchdog"
sed "s|__URANUS_ROOT__|$ROOT|g" "$HERE/files/看门狗脚本.sh" > "$ROOT/patches/watchdog/uranus-watchdog.sh"
chmod +x "$ROOT/patches/watchdog/uranus-watchdog.sh"

# plist 路径同样替换
sed "s|__URANUS_ROOT__|$ROOT|g" "$HERE/files/com.uranus.watchdog.plist" > "$ROOT/patches/watchdog/com.uranus.watchdog.plist"

# ---- 3. 装进 launchd ----
echo ""
echo "→ 注册定时任务（每 60 秒）"
LABEL="com.uranus.watchdog"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$ROOT/patches/watchdog/com.uranus.watchdog.plist" "$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$LABEL.plist" 2>/dev/null || launchctl load -w "$HOME/Library/LaunchAgents/$LABEL.plist" 2>/dev/null
sleep 2
if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -q "state = running"; then
  echo "✓ 看门狗已加载"
else
  echo "⚠ 状态不是 running，请手动检查：$LABEL"
fi

echo ""
echo "→ 重启 Uranus 让服务端补丁生效"
launchctl kickstart -k "gui/$(id -u)/com.uranus.imessage" 2>/dev/null && echo "✓ 已重启" || echo "⚠ 自动重启失败，请手动重启 Uranus"

echo ""
echo "=========================================="
echo "✓ 安装完成！"
echo "=========================================="
echo "日志：$ROOT/watchdog.log"
echo "备份：$BK"
echo "撤销：双击「卸载还原.command」"
echo ""
read -r -p "按回车关闭…"
