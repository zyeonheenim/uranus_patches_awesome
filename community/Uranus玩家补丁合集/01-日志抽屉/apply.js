#!/usr/bin/env node
/*
 * 常驻运行日志抽屉 · 跨平台安装脚本（Mac / Windows 通用）
 *
 * 作用：
 *   1. 把 files/logdrawer.jsx 复制到 <Uranus>/client/src/logdrawer.jsx
 *   2. 在 <Uranus>/client/src/shell.jsx 的两处「官方原版锚点」后插入日志抽屉：
 *        - import { LiveLogDrawer } from "./logdrawer.jsx";   （在 store 导入后）
 *        - <LiveLogDrawer />                                  （在 <AssistantBubble /> 后）
 *   3. 在 <Uranus>/server/src/index.js 插入「模型快切」接口 POST /api/role-model
 *      （files/role-model-route.js）。抽屉头部的「模型」按钮靠它切模型；
 *      没有这一步，按钮能点但没有效果。
 *
 * 三步都幂等：重复运行不会重复插入；找不到锚点会明确报错而不是写坏文件。
 *
 * 为什么用这个而不是整文件 diff：
 *   shell.jsx 在不少人的仓库里已经被各种本地补丁改过。整文件 diff 会因为缺失的
 *   组件直接 git apply 失败。本脚本只往「官方原版一定有的两行锚点」后面插 2 行，
 *   跟其他补丁不冲突，任何 Uranus 干净仓库都能用。
 *
 * 用法：
 *   node apply.js            （自动向上查找 Uranus 根目录）
 *   node apply.js /path/to/Uranus
 *
 * 依赖：本补丁只用到 Uranus 上游已有的 API（useLogs、console.jsx 的 LEVEL_* 导出、
 *       lucide-react 图标、Tailwind 主题 token），不需要任何新依赖。
 */

const fs = require("fs");
const path = require("path");

/** 从 start 目录向上找包含 client/src/shell.jsx 的 Uranus 根目录 */
function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "client", "src", "shell.jsx"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const scriptDir = __dirname;
const argRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const root =
  (argRoot && fs.existsSync(path.join(argRoot, "client", "src", "shell.jsx")) ? argRoot : null) ||
  findRoot(scriptDir) ||
  findRoot(process.cwd());

if (!root) {
  console.error("❌ 找不到 client/src/shell.jsx。");
  console.error("   请把本补丁放在 Uranus 目录内，或这样指定根目录：");
  console.error("   node apply.js /path/to/Uranus");
  process.exit(1);
}
console.log("📂 Uranus 根目录:", root);

const clientSrc = path.join(root, "client", "src");
const targetFile = path.join(clientSrc, "logdrawer.jsx");
const shellFile = path.join(clientSrc, "shell.jsx");
const sourceFile = path.join(scriptDir, "files", "logdrawer.jsx");

// ---- 1. 复制组件 ----
if (!fs.existsSync(sourceFile)) {
  console.error("❌ 找不到 files/logdrawer.jsx（补丁包不完整）");
  process.exit(1);
}
fs.copyFileSync(sourceFile, targetFile);
console.log("✅ 已写入 client/src/logdrawer.jsx");

// ---- 2. 修改 shell.jsx ----
if (!fs.existsSync(shellFile)) {
  console.error("❌ 找不到 client/src/shell.jsx");
  process.exit(1);
}
let s = fs.readFileSync(shellFile, "utf8");

const importAnchor = 'import { useConfig, useLogs } from "./store.jsx";';
const renderAnchor = "<AssistantBubble />";

if (!s.includes(importAnchor)) {
  console.error("❌ 在 shell.jsx 找不到 import 锚点：" + importAnchor);
  console.error("   你的 shell.jsx 可能已被大幅改动，请改用手动方式（见 README）。");
  process.exit(1);
}
if (!s.includes(renderAnchor)) {
  console.error("❌ 在 shell.jsx 找不到渲染锚点：" + renderAnchor);
  process.exit(1);
}

let changed = false;
if (s.includes('import { LiveLogDrawer }')) {
  console.log("ℹ️  import 已存在，跳过（可能已经装过）");
} else {
  s = s.replace(
    importAnchor,
    importAnchor + '\nimport { LiveLogDrawer } from "./logdrawer.jsx";'
  );
  changed = true;
}

if (s.includes("<LiveLogDrawer />")) {
  console.log("ℹ️  <LiveLogDrawer /> 已存在，跳过（可能已经装过）");
} else {
  s = s.replace(
    renderAnchor,
    renderAnchor +
      "\n\n        {/* 常驻运行日志抽屉：线下等生成时不用切去控制台就能盯着实时日志 */}\n        <LiveLogDrawer />"
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(shellFile, s);
  console.log("✅ 已修改 client/src/shell.jsx（插入 2 处）");
} else {
  console.log("ℹ️  shell.jsx 无需改动（补丁已存在）");
}

// ---- 3. 服务端：模型快切接口 ----
const serverFile = path.join(root, "server", "src", "index.js");
const routeFile = path.join(scriptDir, "files", "role-model-route.js");
const routeAnchor = 'app.get("/api/config/path"';
let serverOk = false;

if (!fs.existsSync(serverFile)) {
  console.log("⚠️  找不到 server/src/index.js —— 跳过模型快切接口（抽屉能看日志，但「模型」按钮不起作用）");
} else if (!fs.existsSync(routeFile)) {
  console.log("⚠️  找不到 files/role-model-route.js（补丁包不完整）—— 跳过模型快切接口");
} else {
  let idx = fs.readFileSync(serverFile, "utf8");
  if (idx.includes('"/api/role-model"')) {
    console.log("ℹ️  模型快切接口已存在，跳过");
    serverOk = true;
  } else {
    const at = idx.indexOf(routeAnchor);
    if (at < 0) {
      console.log("⚠️  在 index.js 找不到接口插入锚点：" + routeAnchor);
      console.log("   你的 index.js 可能已被大幅改动。请在 app.get(\"/api/config/path\") 之前");
      console.log("   手动粘贴 files/role-model-route.js 的内容（不影响日志抽屉本身使用）。");
    } else {
      const route = fs.readFileSync(routeFile, "utf8").trim();
      fs.writeFileSync(
        serverFile + ".bak-logdrawer",
        idx,
        "utf8"
      );
      idx = idx.slice(0, at) + route + "\n\n" + idx.slice(at);
      fs.writeFileSync(serverFile, idx);
      console.log("✅ 已修改 server/src/index.js（插入 POST /api/role-model）");
      console.log("   原文件备份：server/src/index.js.bak-logdrawer");
      serverOk = true;
    }
  }
}

console.log("");
console.log("🎉 源代码改动完成。下一步：");
console.log("   1) 构建前端： 在 Uranus 根目录执行  npm run build");
console.log("   2) 重启 Uranus 服务 / 应用（见 README 的 Mac / Windows 章节）");
console.log("   3) 浏览器硬刷新（Mac: Cmd+Shift+R ／ Windows: Ctrl+Shift+R）");
console.log("角落会出现「运行日志」胶囊；展开后右上角有「模型」按钮，可给一个或全部角色切聊天/线下/兜底模型。");
if (!serverOk) {
  console.log("");
  console.log("⚠️  注意：模型快切接口未装上，右下角「模型」按钮点了不会生效。");
}
