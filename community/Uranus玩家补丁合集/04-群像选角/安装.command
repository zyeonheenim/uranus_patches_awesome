#!/bin/bash
# ============================================================
#  Uranus「群像舞台 · 勾选出场」· 一键安装（macOS 双击即可）
# ------------------------------------------------------------
#  做什么：线下剧情开局时勾选「本场谁出场」，现场读那些单人卡的人设，
#          结束时只给在场者写记忆。改任何单人卡，下一场群像自动读新版。
#
#  前置：一个能正常启动的 Uranus（1.22.x）。本包自带全部所需改动，
#        不依赖任何其他补丁。原版可直接装。
#
#  安全：装前备份所有改动文件到 _备份/<时间>/；任何一步失败自动回滚；
#        随时可双击「卸载还原.command」撤销。
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

echo ""
echo "=========================================="
echo " Uranus 群像舞台 · 安装"
echo "=========================================="
echo ""

# ---- 0. 找 Uranus 根目录 ----
if [ -n "${URANUS_ROOT:-}" ]; then ROOT="$URANUS_ROOT";
elif [ -d "$HOME/Uranus_Imessage" ]; then ROOT="$HOME/Uranus_Imessage";
else
  echo "✗ 没找到 Uranus_Imessage（找过 ~/Uranus_Imessage）"
  echo "  装在别处请设 URANUS_ROOT 环境变量后重试。"
  read -r -p "按回车退出…"; exit 1
fi
echo "· Uranus 目录：$ROOT"
if [ ! -d "$ROOT/server/src" ] || [ ! -d "$ROOT/client/src" ]; then
  echo "✗ 这个目录不像 Uranus 源码（缺 server/src 或 client/src）"
  read -r -p "按回车退出…"; exit 1
fi
node -v >/dev/null 2>&1 || { echo "✗ 找不到 node"; read -r -p "按回车退出…"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
BK="$HERE/_备份/$STAMP"
mkdir -p "$BK"

# ---- 1. 备份要改的文件 ----
echo "→ 备份原文件"
FILES=(
  "server/src/offlinestore.js"
  "server/src/prompt.js"
  "server/src/index.js"
  "server/src/offline.js"
  "client/src/panels/offline.jsx"
)
for f in "${FILES[@]}"; do
  if [ -f "$ROOT/$f" ]; then
    mkdir -p "$BK/$(dirname "$f")"
    cp "$ROOT/$f" "$BK/$f"
  fi
done
# 若已有旧卡/预设也备份
[ -f "$ROOT/data/characters/06-群像舞台.json" ] && cp "$ROOT/data/characters/06-群像舞台.json" "$BK/06-群像舞台.json"
[ -f "$ROOT/data/presets/03-群像默认预设.json" ] && cp "$ROOT/data/presets/03-群像默认预设.json" "$BK/03-群像默认预设.json"
echo "✓ 备份到 $BK"

rollback() {
  echo "↩ 出错，回滚…"
  for f in "${FILES[@]}"; do [ -f "$BK/$f" ] && cp "$BK/$f" "$ROOT/$f"; done
}
export URANUS_ROOT="$ROOT"

# ---- 2. 打补丁 ----
echo ""
echo "→ 服务端补丁（选角逻辑 + 收工触发）"
node "$HERE/files/服务端补丁.mjs" || { echo "✗ 失败"; rollback; read -r -p "按回车退出…"; exit 1; }

echo ""
echo "→ 前端补丁（勾选 UI + 主面板出场选择器）"
node "$HERE/files/前端补丁.mjs" || { echo "✗ 失败"; rollback; read -r -p "按回车退出…"; exit 1; }

# ---- 3. 语法校验 ----
echo ""
echo "→ 语法校验"
for f in server/src/offlinestore.js server/src/prompt.js server/src/index.js server/src/offline.js; do
  node --check "$ROOT/$f" >/dev/null 2>&1 || { echo "✗ 语法错误：$f"; rollback; read -r -p "按回车退出…"; exit 1; }
done
echo "✓ 语法通过"

# ---- 4. 安装群像预设 ----
echo ""
echo "→ 安装群像预设 ps-3（基于 Uranus 原版出厂预设，通用无隐私）"
[ -f "$HERE/files/03-群像预设成品.json" ] || { echo "✗ 找不到群像预设成品"; rollback; read -r -p "按回车退出…"; exit 1; }
mkdir -p "$ROOT/data/presets"
cp "$HERE/files/03-群像预设成品.json" "$ROOT/data/presets/03-群像默认预设.json"
echo "✓ 群像预设就位（61 条，第二人称，状态栏按出场者动态）"

# ---- 5. 装舞台卡 + 收工脚本 ----
echo ""
echo "→ 安装群像舞台卡 + 收工脚本"
mkdir -p "$ROOT/data/characters" "$ROOT/patches"
cp "$HERE/files/群像舞台卡模板.json" "$ROOT/data/characters/06-群像舞台.json"
cp "$HERE/files/uranus群像收工.mjs" "$ROOT/patches/uranus群像收工.mjs"
cp "$HERE/files/uranus群像记忆扇出.mjs" "$ROOT/patches/uranus群像记忆扇出.mjs"
echo "✓ 舞台卡与脚本就位"

# ---- 6. 构建前端 ----
echo ""
echo "→ 重新构建前端（约几秒）"
( cd "$ROOT/client" && npm run build ) || { echo "✗ 构建失败，正在回滚"; rollback; ( cd "$ROOT/client" && npm run build ); read -r -p "按回车退出…"; exit 1; }
echo "✓ 构建完成"

# ---- 7. 重启 ----
echo ""
echo "→ 重启 Uranus"
launchctl kickstart -k "gui/$(id -u)/com.uranus.imessage" 2>/dev/null && echo "✓ 已重启" || echo "⚠ 请手动重启 Uranus（服务端改动要重启才生效）"

echo ""
echo "=========================================="
echo "✓ 安装完成！"
echo "=========================================="
echo ""
echo "重要：请做两件事"
echo "  1. 控制台按 Cmd+R 强刷浏览器"
echo "  2. 进「角色」→「群像舞台」→ 给这张卡选一个聊天模型（模板里模型槽位是空的）"
echo "     并在 offline 设置里选一个线下模型；跨库记忆 sources 想启用就勾你要读的角色库"
echo ""
echo "用法：角色「群像舞台」→ 开启线下 → 开启新剧情 → 勾选本场出场角色"
echo "      也可在剧情第一句写：【出场：角色A、角色B】"
echo "      结束 → 自动写群像大总结 + 在场者 POV（日志见 群像收工.log）"
echo "备份：$BK"
echo "撤销：双击「卸载还原.command」"
echo ""
read -r -p "按回车关闭…"
