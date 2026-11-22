#!/usr/bin/env node
/**
 * Uranus「常驻运行日志 + 模型快切」· 跨平台安装器
 *
 * Windows：双击同目录「安装.bat」（它跑的就是这个文件）
 * macOS  ：双击「安装.command」（bash 版，步骤一样）
 * 手动   ：node 安装.mjs        装在别处先设 URANUS_ROOT
 *
 * 步骤：找目录 → 备份 → 打补丁 → 语法检查 → 构建前端 → 重启。
 * 另写一份 Node 版的原因：.command 是 bash，Windows 上双击不了。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findRoot, isUranusDir, buildClient, checkJs, restart, say, WIN } from "./platform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 补丁改到的文件。卸载要按这份名单还原。 */
const PATCHED_FILES = ["client/src/shell.jsx", "server/src/index.js", "client/src/logdrawer.jsx"];
/** 判断「这份文件已经打过补丁」的标记 —— 打过的不当原版备份。 */
const MARKERS = {
  "client/src/shell.jsx": "LiveLogDrawer",
  "server/src/index.js": '"/api/role-model"',
};

function die(msg) {
  say("");
  say("✗ " + msg);
  if (WIN) say("（窗口不会自己关，看完按任意键）");
  process.exit(1);
}

function backup(root, box) {
  for (const rel of PATCHED_FILES) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) continue;
    const mark = MARKERS[rel];
    if (mark && fs.readFileSync(src, "utf8").includes(mark)) continue;
    const dst = path.join(box, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    say("  · 已备份 " + rel);
  }
}

function rollback(root, box) {
  say("↩ 出错，回滚…");
  for (const rel of ["client/src/shell.jsx", "server/src/index.js"]) {
    const src = path.join(box, rel);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(root, rel));
  }
  const comp = path.join(root, "client/src/logdrawer.jsx");
  if (fs.existsSync(comp)) fs.rmSync(comp, { force: true });
}

/* ------------------------------------------------------------------ 主流程 */

say("");
say("==========================================");
say(" Uranus 运行日志抽屉 · 安装");
say("==========================================");
say("");

const root = findRoot(HERE, isUranusDir);
if (!root) {
  die(
    "没找到 Uranus 目录。找过：URANUS_ROOT、本补丁的上级目录、当前目录、" +
      path.join(os.homedir(), "Uranus_Imessage")
  );
}
say("· Uranus 目录：" + root);
say("· 系统：" + (WIN ? "Windows" : process.platform));

try {
  execFileSync(process.execPath, ["-v"], { stdio: "ignore" });
} catch {
  die("找不到 node。先装 Node.js 20+ 再来。");
}

const d = new Date();
const p = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const box = path.join(HERE, "_备份", stamp);
fs.mkdirSync(box, { recursive: true });

say("");
say("→ 备份原文件");
backup(root, box);
say("✓ 备份到 " + box);

say("");
say("→ 安装补丁");
try {
  execFileSync(process.execPath, [path.join(HERE, "apply.js"), root], { stdio: "inherit" });
} catch {
  rollback(root, box);
  die("安装脚本失败，已回滚。");
}

say("");
say("→ 语法校验");
const bad = checkJs(root, ["server/src/index.js"]);
if (bad.length) {
  rollback(root, box);
  die("语法错误：" + bad.join("、") + "，已回滚。");
}
say("✓ 服务端语法通过");
say(
  fs.readFileSync(path.join(root, "server/src/index.js"), "utf8").includes('"/api/role-model"')
    ? "✓ 模型快切接口已就位"
    : "⚠ 模型快切接口没插上（日志抽屉仍可用，只有「模型」按钮不生效）"
);

say("");
say("→ 重新构建前端（约几秒到一分钟）");
if (!buildClient(root)) {
  say("✗ 构建失败，正在回滚");
  rollback(root, box);
  buildClient(root);
  die("前端构建失败。");
}
say("✓ 构建完成");

say("");
say("→ 重启 Uranus");
await restart(root);

say("");
say("==========================================");
say("✓ 安装完成！");
say("==========================================");
say("");
say("接下来：");
say("  1. 浏览器强刷一次（Cmd+R / Ctrl+F5）");
say("  2. 角落会出现「运行日志」胶囊；点开看实时日志");
say("  3. 抽屉右上角「模型」按钮：给一个或全部角色切 聊天 / 线下 / 兜底 模型");
say("");
say("备份：" + box);
say("撤销：双击「卸载还原.command」（macOS）/「卸载还原.bat」（Windows）");
say("");
