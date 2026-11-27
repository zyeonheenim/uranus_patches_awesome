#!/bin/bash
# 卸载「群像舞台」补丁：还原服务端/前端改动，移除舞台卡、群像预设、收工脚本。
# 不动你的角色卡、记忆库、剧情存档（历史数据一律保留）。
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

if [ -n "${URANUS_ROOT:-}" ]; then ROOT="$URANUS_ROOT";
elif [ -d "$HOME/Uranus_Imessage" ]; then ROOT="$HOME/Uranus_Imessage";
else echo "✗ 找不到 Uranus 目录，请设 URANUS_ROOT"; read -r -p "按回车退出…"; exit 1; fi

echo "=== 卸载群像舞台 ==="
BK="$(ls -dt "$HERE/_备份"/* 2>/dev/null | head -1)"
if [ -z "$BK" ]; then
  echo "✗ 找不到备份，无法安全还原。请手动撤销（搜 castpatch 标记）。"
  read -r -p "按回车退出…"; exit 1
fi
echo "用备份：$BK"

FILES=(
  "server/src/offlinestore.js"
  "server/src/prompt.js"
  "server/src/index.js"
  "server/src/offline.js"
  "client/src/panels/offline.jsx"
)
for f in "${FILES[@]}"; do
  [ -f "$BK/$f" ] && cp "$BK/$f" "$ROOT/$f" && echo "  还原 $f"
done

# 舞台卡 / 预设：备份过就还原，没备份就移到 .removed
CARD="$ROOT/data/characters/06-群像舞台.json"
PRESET="$ROOT/data/presets/03-群像默认预设.json"
for pair in "$BK/06-群像舞台.json|$CARD" "$BK/03-群像默认预设.json|$PRESET"; do
  b="${pair%%|*}"; t="${pair##*|}"
  if [ -f "$b" ]; then cp "$b" "$t"; echo "  还原 $(basename "$t")";
  elif [ -f "$t" ]; then mv "$t" "$t.removed-$(date +%Y%m%d-%H%M%S)"; echo "  移走 $(basename "$t")（已留备份）"; fi
done

# 收工/扇出脚本：本包安装的，直接移走（若原来就有同名文件则保留）
for s in uranus群像收工.mjs uranus群像记忆扇出.mjs; do
  if [ -f "$ROOT/patches/$s" ]; then mv "$ROOT/patches/$s" "$ROOT/patches/$s.removed-$(date +%Y%m%d-%H%M%S)"; echo "  移走 $s"; fi
done

echo "→ 重建前端"
( cd "$ROOT/client" && npm run build ) && echo "✓ 构建完成"
launchctl kickstart -k "gui/$(id -u)/com.uranus.imessage" 2>/dev/null && echo "✓ Uranus 已重启"
echo "✓ 卸载完成（你的角色卡/记忆/剧情数据一字未删）"
read -r -p "按回车关闭…"
