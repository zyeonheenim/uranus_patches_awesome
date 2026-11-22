#!/bin/bash
#
# Uranus 入站订阅看门狗（补丁㉓ 配套）
# ---------------------------------------------------------------
# 要防的那个坑：
#   Photon 的 gRPC `SubscribeMessageEvents`（唯一负责「收消息」的长连接）
#   断了之后，SDK 的重试次数是有限的。1876 次失败后它直接退出循环，
#   再也不重建订阅。于是进程进入「半死」：
#     · 发消息正常（另一条路）→ 对方看到「已送达」
#     · 收消息彻底断 → 控制台一条都进不来
#     · /api/health 依然 200，界面全绿，看不出来
#
# 判据（只看日志，不需要登录态）：
#   日志里「最后一次桥接已连接」和「最后一次 SubscribeMessageEvents UNAVAILABLE」
#   谁在后。失败在后 = 连上之后又崩了。连续 BAD_LIMIT 次巡检都这样 → 动手。
#
# 动作：
#   1) 先 POST /api/imessage/restart（只重启桥接，代价小）
#   2) 25 秒后复查，还不行 → launchctl kickstart 整个进程
#   3) 结果推到控制台日志抽屉（POST /api/watchdog/notice）
#

set -u
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin"

ROOT="__URANUS_ROOT__"
LOG="$ROOT/uranus.log"
WLOG="$ROOT/watchdog.log"
STATE_DIR="$HOME/Library/Caches/uranus-watchdog"
STATE="$STATE_DIR/state"
mkdir -p "$STATE_DIR"

PORT=8787
API="http://127.0.0.1:$PORT"
LABEL="com.uranus.imessage"

BAD_LIMIT=3      # 连续几次巡检异常才动手（≈ 3 分钟）
COOLDOWN=600     # 两次动手之间至少隔 10 分钟，防抖
WIN=2097152      # 只在日志最后 2MB 里找标记，避免扫 100MB 的大文件

say() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$WLOG"; }

# 往控制台日志抽屉推一条（消息里不要带双引号和换行）
notify() {
  /usr/bin/curl -s -m 6 -X POST "$API/api/watchdog/notice" \
    -H 'Content-Type: application/json' \
    --data "{\"message\":\"$1\",\"level\":\"$2\"}" >/dev/null 2>&1
}

# 在日志尾部窗口里找最后一个标记的绝对字节偏移（找不到输出 0）
marker_abs() {
  local pat="$1" size="$2" start rel
  start=$(( size > WIN ? size - WIN + 1 : 1 ))
  rel=$(/usr/bin/tail -c +"$start" "$LOG" 2>/dev/null \
        | /usr/bin/grep -abo "$pat" 2>/dev/null \
        | /usr/bin/tail -1 | /usr/bin/cut -d: -f1)
  [ -z "${rel:-}" ] && { echo 0; return; }
  echo $(( start - 1 + rel ))
}

# 当前状态：成功连接的位置 与 订阅失败的位置
probe() {
  local size
  size=$(/usr/bin/stat -f%z "$LOG" 2>/dev/null || echo 0)
  if [ "$size" -le 0 ]; then echo "0 0"; return; fi
  echo "$(marker_abs "已连接，等消息中" "$size") $(marker_abs "SubscribeMessageEvents UNAVAILABLE" "$size")"
}

read -r CONN ERR <<<"$(probe)"

bad=0
last_fix=0
[ -f "$STATE" ] && read -r bad last_fix <"$STATE" 2>/dev/null
case "$bad" in ''|*[!0-9]*) bad=0 ;; esac
case "$last_fix" in ''|*[!0-9]*) last_fix=0 ;; esac

now=$(date +%s)

# 失败在最后一次成功连接之后 = 订阅已死（或正在死）
if [ "$ERR" -gt 0 ] && [ "$ERR" -gt "$CONN" ]; then
  bad=$(( bad + 1 ))
else
  bad=0
fi

if [ "$bad" -ge "$BAD_LIMIT" ] && [ $(( now - last_fix )) -ge "$COOLDOWN" ]; then
  say "检测到入站订阅异常（连续 $bad 次），开始自救"
  notify "收到消息的通道断了（能发不能收），正在自动重连…" warn

  /usr/bin/curl -s -m 40 -X POST "$API/api/imessage/restart" \
    -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1
  say "已请求重启桥接，等 25 秒复查"
  sleep 25

  read -r C2 E2 <<<"$(probe)"
  if [ "$E2" -gt 0 ] && [ "$E2" -gt "$C2" ]; then
    say "桥接重启无效，改为重启 Uranus 进程"
    notify "桥接重启没修好，正在重启整个 Uranus 进程…" error
    /bin/launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1
    sleep 22
    read -r C2 E2 <<<"$(probe)"
  fi

  if [ "$E2" -gt 0 ] && [ "$E2" -gt "$C2" ]; then
    say "自救失败：订阅仍异常，需要人工检查"
    notify "自动重连失败，收消息通道仍未恢复，需要手动排查" error
  else
    say "自救成功：入站订阅已恢复"
    notify "已自动重连成功，收消息恢复正常" info
  fi

  bad=0
  last_fix=$(date +%s)
fi

printf '%s %s\n' "$bad" "$last_fix" >"$STATE"
exit 0
