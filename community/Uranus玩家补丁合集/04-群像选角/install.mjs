#!/usr/bin/env node
/**
 * Uranus「群像舞台 · 勾选出场」· 跨平台安装器
 *
 * Windows：双击「安装.bat」；macOS：双击「安装.command」（bash 版，步骤一样）。
 * 手动：node install.mjs        装在别处先设 URANUS_ROOT
 *
 * 步骤：找目录 → 备份 → 服务端补丁 → 前端补丁 → 语法检查 → 装预设/舞台卡/脚本
 *       → 构建前端 → 重启。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findRoot, buildClient, checkJs, restart, say, WIN } from "./platform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = path.join(HERE, "files");

/** 补丁改到的文件 —— 卸载按这份名单还原。 */
const PATCHED = [
  "server/src/offlinestore.js",
  "server/src/prompt.js",
  "server/src/index.js",
  "server/src/offline.js",
  "client/src/panels/offline.jsx",
];
const CARD = "data/characters/06-群像舞台.json";
const PRESET = "data/presets/03-群像默认预设.json";

function isUranus(dir) {
  return fs.existsSync(path.join(dir, "server", "src")) && fs.existsSync(path.join(dir, "client", "src"));
}

function die(msg) {
  say("");
  say("✗ " + msg);
  if (WIN) say("（窗口不会自己关，看完按任意键）");
  process.exit(1);
}

function backup(root, box) {
  for (const rel of PATCHED) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(box, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    say("  · 已备份 " + rel);
  }
  // 旧卡 / 旧预设也留一份，卸载时才知道原来长什么样
  for (const rel of [CARD, PRESET]) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(box, path.basename(rel)));
    say("  · 已备份 " + rel);
  }
}

function rollback(root, box) {
  say("↩ 出错，回滚…");
  for (const rel of PATCHED) {
    const src = path.join(box, rel);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(root, rel));
  }
}

const d = new Date();
const p = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;

say("");
say("==========================================");
say(" Uranus 群像舞台 · 安装");
say("==========================================");
say("");

const root = findRoot(HERE, isUranus);
if (!root) die("没找到 Uranus 目录。找过：URANUS_ROOT、本补丁上级、当前目录、" + path.join(os.homedir(), "Uranus_Imessage"));
say("· Uranus 目录：" + root);
say("· 系统：" + (WIN ? "Windows" : process.platform));

const box = path.join(HERE, "_备份", stamp);
fs.mkdirSync(box, { recursive: true });

say("");
say("→ 备份原文件");
backup(root, box);
say("✓ 备份到 " + box);

const env = { ...process.env, URANUS_ROOT: root };

say("");
say("→ 服务端补丁（选角逻辑 + 收工触发）");
try {
  execFileSync(process.execPath, [path.join(FILES_DIR, "服务端补丁.mjs")], { stdio: "inherit", env });
} catch {
  rollback(root, box);
  die("服务端补丁失败，已回滚。");
}

say("");
say("→ 前端补丁（勾选 UI + 主面板出场选择器）");
try {
  execFileSync(process.execPath, [path.join(FILES_DIR, "前端补丁.mjs")], { stdio: "inherit", env });
} catch {
  rollback(root, box);
  die("前端补丁失败，已回滚。");
}

say("");
say("→ 音色补丁（台词按说话人用各自角色卡音色念）");
try {
  execFileSync(process.execPath, [path.join(FILES_DIR, "音色服务端补丁.mjs")], { stdio: "inherit", env });
  execFileSync(process.execPath, [path.join(FILES_DIR, "音色补丁.mjs")], { stdio: "inherit", env });
} catch {
  rollback(root, box);
  die("音色补丁失败，已回滚。");
}

say("");
say("→ 语法校验");
const bad = checkJs(root, PATCHED.filter((f) => f.startsWith("server/")));
if (bad.length) {
  rollback(root, box);
  die("语法错误：" + bad.join("、") + "，已回滚。");
}
say("✓ 语法通过");

say("");
say("→ 安装群像预设 ps-3（基于原版出厂预设，通用无隐私）");
const presetSrc = path.join(FILES_DIR, "03-群像预设成品.json");
if (!fs.existsSync(presetSrc)) {
  rollback(root, box);
  die("找不到群像预设成品。");
}
fs.mkdirSync(path.join(root, "data", "presets"), { recursive: true });
fs.copyFileSync(presetSrc, path.join(root, PRESET));
say("✓ 群像预设就位（第二人称，状态栏按出场者动态）");

say("");
say("→ 安装群像舞台卡 + 收工脚本");
fs.mkdirSync(path.join(root, "data", "characters"), { recursive: true });
fs.mkdirSync(path.join(root, "patches"), { recursive: true });
fs.copyFileSync(path.join(FILES_DIR, "群像舞台卡模板.json"), path.join(root, CARD));
fs.copyFileSync(path.join(FILES_DIR, "uranus群像收工.mjs"), path.join(root, "patches", "uranus群像收工.mjs"));
fs.copyFileSync(path.join(FILES_DIR, "uranus群像记忆扇出.mjs"), path.join(root, "patches", "uranus群像记忆扇出.mjs"));
say("✓ 舞台卡与脚本就位");

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
say("重要：请做两件事");
say("  1. 浏览器强刷一次（Cmd+R / Ctrl+F5）");
say("  2. 进「角色」→「群像舞台」→ 给这张卡选一个聊天模型（模板里模型槽位是空的）");
say("     并在 offline 设置里选一个线下模型；跨库记忆 sources 想启用就勾你要读的角色库");
say("");
say("用法：角色「群像舞台」→ 开启线下 → 开启新剧情 → 勾选本场出场角色");
say("      也可在剧情第一句写：【出场：角色A、角色B】");
say("      结束 → 按自然日写群像大总结 + 一份共享记忆原样写进每个在场者库（日志见 群像收工.log）");
say("备份：" + box);
say("撤销：双击「卸载还原.command」（macOS）/「卸载还原.bat」（Windows）");
say("");
