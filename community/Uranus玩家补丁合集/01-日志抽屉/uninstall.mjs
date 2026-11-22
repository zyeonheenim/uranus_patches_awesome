#!/usr/bin/env node
/**
 * Uranus「运行日志抽屉 + 模型快切」· 跨平台卸载
 *
 * Windows：双击「卸载还原.bat」；macOS：双击「卸载还原.command」。
 *
 * 有 _备份：先用最近一次备份还原，再按锚点清一遍（连着装两次时备份可能已经是
 * 打过补丁的样子，多这一步才保证干净）。
 * 没备份：直接按锚点删掉插入的内容。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRoot, isUranusDir, buildClient, restart, say, WIN } from "./platform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const shellFile = (root) => path.join(root, "client/src/shell.jsx");
const indexFile = (root) => path.join(root, "server/src/index.js");
const compFile = (root) => path.join(root, "client/src/logdrawer.jsx");

function die(msg) {
  say("");
  say("✗ " + msg);
  if (WIN) say("（窗口不会自己关，看完按任意键）");
  process.exit(1);
}

/** 找最近一次备份目录 */
function latestBackup() {
  const bkRoot = path.join(HERE, "_备份");
  if (!fs.existsSync(bkRoot)) return null;
  const dirs = fs
    .readdirSync(bkRoot)
    .filter((d) => {
      try {
        return fs.statSync(path.join(bkRoot, d)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
  return dirs.length ? path.join(bkRoot, dirs[dirs.length - 1]) : null;
}

say("");
say("==========================================");
say(" Uranus 运行日志抽屉 · 卸载");
say("==========================================");
say("");

const root = findRoot(HERE, isUranusDir);
if (!root) die("没找到 Uranus 目录，请设 URANUS_ROOT 后重试。");
say("· Uranus 目录：" + root);

const bk = latestBackup();
if (bk) {
  say("");
  say("→ 从备份还原：" + bk);
  for (const rel of ["client/src/shell.jsx", "server/src/index.js"]) {
    const src = path.join(bk, rel);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(root, rel));
      say("  ✓ 还原 " + rel);
    }
  }
} else {
  say("");
  say("→ 没有 _备份，直接按锚点删除");
}

/* 1) shell.jsx：删 import + <LiveLogDrawer /> 及上面的注释 */
{
  const f = shellFile(root);
  if (fs.existsSync(f)) {
    let s = fs.readFileSync(f, "utf8");
    const before = s;
    s = s.replace(/\nimport \{ LiveLogDrawer \} from "\.\/logdrawer\.jsx";/g, "");
    s = s.replace(/\n\n\s*\{\/\* 常驻运行日志抽屉[^\n]*\*\/\}\n\s*<LiveLogDrawer \/>/g, "");
    s = s.replace(/\n\s*<LiveLogDrawer \/>/g, "");
    if (s !== before) {
      fs.writeFileSync(f, s);
      say("  ✓ 清理 client/src/shell.jsx");
    }
  }
}

/* 2) index.js：删掉 /api/role-model 整段（连同上面的注释块） */
{
  const f = indexFile(root);
  if (fs.existsSync(f)) {
    let s = fs.readFileSync(f, "utf8");
    const at = s.indexOf('app.post("/api/role-model"');
    if (at >= 0) {
      let start = at;
      const c = s.lastIndexOf("/**", at);
      if (c >= 0 && at - c < 900) start = c;
      const endMark = s.indexOf("\n});", at);
      const end = endMark >= 0 ? endMark + 5 : s.length;
      s = (s.slice(0, start) + s.slice(end)).replace(/^\n+/, "\n");
      fs.writeFileSync(f, s);
      say("  ✓ 移除 server/src/index.js 里的 /api/role-model");
    }
  }
}

/* 3) 删除抽屉组件 */
{
  const f = compFile(root);
  if (fs.existsSync(f)) {
    fs.rmSync(f, { force: true });
    say("  ✓ 删除 client/src/logdrawer.jsx");
  }
}

say("");
say("→ 语法自检");
try {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["--check", indexFile(root)], { stdio: "ignore" });
  say("✓ 服务端语法通过");
} catch {
  say("⚠ 服务端语法异常，请用 _备份 或 git 还原 index.js");
}

say("");
say("→ 重新构建前端");
if (!buildClient(root)) die("构建失败，请手动处理。");
say("✓ 构建完成");

say("");
say("→ 重启 Uranus");
await restart(root);

say("");
say("✓ 卸载完成。浏览器强刷一次即可。");
say("");
