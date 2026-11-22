#!/bin/bash
# ============================================================
#  Uranus「常驻运行日志 + 模型快切」· 一键安装（macOS 双击即可）
# ------------------------------------------------------------
#  做什么：控制台任何页面角落多一颗「运行日志」胶囊，点开是实时日志
#          （与「控制台」面板同一份流）；右上角「模型」按钮可以给一个或
#          全部角色瞬间切换 聊天 / 线下 / 兜底 模型。
#
#  改动：client/src/logdrawer.jsx（新增）
#        client/src/shell.jsx（插 2 行）
#        server/src/index.js（插 POST /api/role-model）
#
#  安全：装前备份改动文件到 _备份/<时间>/；失败自动回滚；
#        随时可双击「卸载还原.command」撤销。
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

echo ""
echo "=========================================="
echo " Uranus 运行日志抽屉 · 安装"
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
if [ ! -f "$ROOT/client/src/shell.jsx" ] || [ ! -f "$ROOT/server/src/index.js" ]; then
  echo "✗ 这个目录不像 Uranus 源码（缺 client/src/shell.jsx 或 server/src/index.js）"
  read -r -p "按回车退出…"; exit 1
fi
node -v >/dev/null 2>&1 || { echo "✗ 找不到 node"; read -r -p "按回车退出…"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
BK="$HERE/_备份/$STAMP"
mkdir -p "$BK"

# ---- 1. 备份（已打过补丁的文件不覆盖备份，保证备份里是「原版」）----
echo "→ 备份原文件"
node - "$ROOT" "$BK" <<'EOF'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const bk = process.argv[3];
const files = ["client/src/shell.jsx", "server/src/index.js", "client/src/logdrawer.jsx"];
for (const f of files) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) continue;
  const txt = fs.readFileSync(src, "utf8");
  // 已经装过补丁的文件不当作「原版」备份，否则卸载会还原成打过补丁的样子
  if (f.endsWith("shell.jsx") && txt.includes("LiveLogDrawer")) continue;
  if (f.endsWith("index.js") && txt.includes('"/api/role-model"')) continue;
  const dst = path.join(bk, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log("  · 已备份 " + f);
}
EOF
echo "✓ 备份到 $BK"

rollback() {
  echo "↩ 出错，回滚…"
  node - "$ROOT" "$BK" <<'EOF'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const bk = process.argv[3];
for (const f of ["client/src/shell.jsx", "server/src/index.js"]) {
  const src = path.join(bk, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(root, f));
}
const comp = path.join(root, "client/src/logdrawer.jsx");
if (fs.existsSync(comp)) fs.rmSync(comp, { force: true });
EOF
}

# ---- 2. 打补丁（组件 + 前端 2 处 + 服务端接口）----
echo ""
echo "→ 安装补丁"
node "$HERE/apply.js" "$ROOT" || { echo "✗ 安装脚本失败"; rollback; read -r -p "按回车退出…"; exit 1; }

# ---- 3. 语法校验 ----
echo ""
echo "→ 语法校验"
node --check "$ROOT/server/src/index.js" >/dev/null 2>&1 || { echo "✗ 语法错误：server/src/index.js"; rollback; read -r -p "按回车退出…"; exit 1; }
echo "✓ 服务端语法通过"
node - "$ROOT" <<'EOF'
const fs = require("fs"), path = require("path");
const s = fs.readFileSync(path.join(process.argv[2], "server/src/index.js"), "utf8");
console.log(s.includes('"/api/role-model"')
  ? "✓ 模型快切接口已就位"
  : "⚠ 模型快切接口没插上（日志抽屉仍可用，只有「模型」按钮不生效）");
EOF

# ---- 4. 构建前端 ----
echo ""
echo "→ 重新构建前端（约几秒）"
( cd "$ROOT/client" && npm run build ) || { echo "✗ 构建失败，正在回滚"; rollback; ( cd "$ROOT/client" && npm run build ); read -r -p "按回车退出…"; exit 1; }
echo "✓ 构建完成"

# ---- 5. 重启 ----
echo ""
echo "→ 重启 Uranus"
launchctl kickstart -k "gui/$(id -u)/com.uranus.imessage" 2>/dev/null && echo "✓ 已重启" || echo "⚠ 请手动重启 Uranus（服务端改动要重启才生效）"

echo ""
echo "=========================================="
echo "✓ 安装完成！"
echo "=========================================="
echo ""
echo "接下来："
echo "  1. 控制台按 Cmd+R 强刷浏览器"
echo "  2. 角落会出现「运行日志」胶囊；点开看实时日志"
echo "  3. 点右上角「模型」→ 选角色（或全部）→ 选模型 → 选档位（聊天/线下/兜底）→ 切换"
echo ""
echo "备份：$BK"
echo "撤销：双击「卸载还原.command」"
echo ""
read -r -p "按回车关闭…"
