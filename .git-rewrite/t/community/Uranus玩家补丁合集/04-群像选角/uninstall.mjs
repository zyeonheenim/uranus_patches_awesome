#!/usr/bin/env node
/**
 * Uranus「群像舞台」· 跨平台卸载
 *
 * Windows：双击「卸载还原.bat」；macOS：双击「卸载还原.command」。
 * 只还原代码、移走本包装进去的卡/预设/脚本；你的角色卡、记忆库、剧情存档一律不动。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRoot, buildClient, restart, say, WIN } from "./platform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PATCHED = [
  "server/src/offlinestore.js",
  "server/src/prompt.js",
  "server/src/index.js",
  "server/src/offline.js",
  "client/src/panels/offline.jsx",
];
const CARD = "data/characters/06-群像舞台.json";
const PRESET = "data/presets/03-群像默认预设.json";
const SCRIPTS = ["uranus群像收工.mjs", "uranus群像记忆扇出.mjs"];

const isUranus = (dir) => fs.existsSync(path.join(dir, "server", "src"));

function die(msg) {
  say("");
  say("✗ " + msg);
  if (WIN) say("（窗口不会自己关，看完按任意键）");
  process.exit(1);
}

function latestBackup() {
  const bkRoot = path.join(HERE, "_备份");
  if (!fs.existsSync(bkRoot)) return "";
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
  return dirs.length ? path.join(bkRoot, dirs[dirs.length - 1]) : "";
}

const d = new Date();
const p = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;

say("=== 卸载群像舞台 ===");

const root = findRoot(HERE, isUranus);
if (!root) die("找不到 Uranus 目录，请设 URANUS_ROOT 后重试。");

const bk = latestBackup();
if (!bk) die("找不到备份，无法安全还原。请手动撤销（搜 castpatch 标记）。");
say("用备份：" + bk);

for (const rel of PATCHED) {
  const src = path.join(bk, rel);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(root, rel));
    say("  还原 " + rel);
  }
}

// 舞台卡 / 预设：备份过就还原，没备份就移到一边（不删）
for (const [name, rel] of [
  ["06-群像舞台.json", CARD],
  ["03-群像默认预设.json", PRESET],
]) {
  const b = path.join(bk, name);
  const t = path.join(root, rel);
  if (fs.existsSync(b)) {
    fs.copyFileSync(b, t);
    say("  还原 " + name);
  } else if (fs.existsSync(t)) {
    fs.renameSync(t, `${t}.removed-${stamp}`);
    say("  移走 " + name + "（已留备份）");
  }
}

// 收工/扇出脚本：本包装的，移到一边（同名旧文件不会被动）
for (const s of SCRIPTS) {
  const t = path.join(root, "patches", s);
  if (fs.existsSync(t)) {
    fs.renameSync(t, `${t}.removed-${stamp}`);
    say("  移走 " + s);
  }
}

say("→ 重建前端");
if (!buildClient(root)) die("构建失败，请手动处理。");
say("✓ 构建完成");

await restart(root);
say("✓ 卸载完成（你的角色卡 / 记忆 / 剧情数据一字未删）");
