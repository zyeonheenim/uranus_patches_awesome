#!/bin/bash
# ============================================================
#  Uranus「运行日志抽屉 + 模型快切」· 卸载还原（macOS 双击即可）
# ------------------------------------------------------------
#  有安装备份时：用 _备份/<最近一次>/ 里的原文件还原；
#  没有备份时：按锚点删掉插入的内容（前端 2 行 + 后端 1 个接口）。
#  文件操作用 node 完成（避免个别环境对 shell 通配/删除的限制）。
#  最后重新构建并重启 Uranus。
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

echo ""
echo "=========================================="
echo " Uranus 运行日志抽屉 · 卸载"
echo "=========================================="
echo ""

if [ -n "${URANUS_ROOT:-}" ]; then ROOT="$URANUS_ROOT";
elif [ -d "$HOME/Uranus_Imessage" ]; then ROOT="$HOME/Uranus_Imessage";
else
  echo "✗ 没找到 Uranus_Imessage（找过 ~/Uranus_Imessage）"
  read -r -p "按回车退出…"; exit 1
fi
echo "· Uranus 目录：$ROOT"
node -v >/dev/null 2>&1 || { echo "✗ 找不到 node"; read -r -p "按回车退出…"; exit 1; }

echo ""
node - "$HERE" "$ROOT" <<'EOF'
const fs = require("fs");
const path = require("path");
const here = process.argv[2];
const root = process.argv[3];

const shellFile = path.join(root, "client/src/shell.jsx");
const indexFile = path.join(root, "server/src/index.js");
const compFile = path.join(root, "client/src/logdrawer.jsx");

/** 找最近一次备份目录 */
function latestBackup() {
  const bkRoot = path.join(here, "_备份");
  if (!fs.existsSync(bkRoot)) return null;
  const dirs = fs
    .readdirSync(bkRoot)
    .filter((d) => {
      try { return fs.statSync(path.join(bkRoot, d)).isDirectory(); } catch { return false; }
    })
    .sort();
  return dirs.length ? path.join(bkRoot, dirs[dirs.length - 1]) : null;
}

const bk = latestBackup();
if (bk) {
  console.log("→ 从备份还原：" + bk);
  for (const f of ["client/src/shell.jsx", "server/src/index.js"]) {
    const src = path.join(bk, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(root, f));
      console.log("  ✓ 还原 " + f);
    }
  }
} else {
  console.log("→ 没有 _备份，直接按锚点删除");
}

/*
 * 无论有没有备份，都再跑一遍锚点清理 —— 幂等操作。
 * 原因：连着装两次时，后一次的备份可能已经是「打过补丁」的样子，
 * 只靠还原会残留。多这一步保证一定干净。
 */
{
  // 1) shell.jsx：删 import + <LiveLogDrawer /> 及上面的注释
  if (fs.existsSync(shellFile)) {
    let s = fs.readFileSync(shellFile, "utf8");
    const before = s;
    s = s.replace(/\nimport \{ LiveLogDrawer \} from "\.\/logdrawer\.jsx";/g, "");
    s = s.replace(/\n\n\s*\{\/\* 常驻运行日志抽屉[^\n]*\*\/\}\n\s*<LiveLogDrawer \/>/g, "");
    s = s.replace(/\n\s*<LiveLogDrawer \/>/g, "");
    if (s !== before) {
      fs.writeFileSync(shellFile, s);
      console.log("  ✓ 清理 client/src/shell.jsx");
    }
  }

  // 2) index.js：删掉 /api/role-model 整段（连同它上面的注释块）
  if (fs.existsSync(indexFile)) {
    let s = fs.readFileSync(indexFile, "utf8");
    const at = s.indexOf('app.post("/api/role-model"');
    if (at >= 0) {
      let start = at;
      const c = s.lastIndexOf("/**", at);
      if (c >= 0 && at - c < 900) start = c;
      const endMark = s.indexOf("\n});", at);
      const end = endMark >= 0 ? endMark + 5 : s.length;
      s = (s.slice(0, start) + s.slice(end)).replace(/^\n+/, "\n");
      fs.writeFileSync(indexFile, s);
      console.log("  ✓ 移除 server/src/index.js 里的 /api/role-model");
    }
  }
}

// 3) 删除抽屉组件
if (fs.existsSync(compFile)) {
  fs.rmSync(compFile, { force: true });
  console.log("  ✓ 删除 client/src/logdrawer.jsx");
}
EOF

echo ""
echo "→ 语法自检"
node --check "$ROOT/server/src/index.js" >/dev/null 2>&1 && echo "✓ 服务端语法通过" || echo "⚠ 服务端语法异常，请用 _备份 或 git 还原 index.js"

echo ""
echo "→ 重新构建前端"
( cd "$ROOT/client" && npm run build ) || { echo "✗ 构建失败，请手动处理"; read -r -p "按回车退出…"; exit 1; }
echo "✓ 构建完成"

echo ""
echo "→ 重启 Uranus"
launchctl kickstart -k "gui/$(id -u)/com.uranus.imessage" 2>/dev/null && echo "✓ 已重启" || echo "⚠ 请手动重启 Uranus"

echo ""
echo "✓ 卸载完成。浏览器 Cmd+R 强刷即可。"
echo ""
read -r -p "按回车关闭…"
