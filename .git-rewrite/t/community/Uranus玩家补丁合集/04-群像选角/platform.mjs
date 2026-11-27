/**
 * 跨平台小工具：找 Uranus 目录、构建前端、重启服务。
 *
 * 这个文件在每个模块里各放一份（模块要保持「单独拿走就能装」），内容一致。
 * 只在 Node 里做事，不依赖 bash / PowerShell —— Windows 和 macOS 是同一条路。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync, spawn } from "node:child_process";

export const WIN = process.platform === "win32";
export const MAC = process.platform === "darwin";
export const PORT = Number(process.env.PORT) || 8787;

export const say = (s = "") => console.log(s);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 找 Uranus 根目录。按顺序试：URANUS_ROOT → 补丁的上级 → 当前目录 → 家目录。
 * @param {string} here 补丁自己所在的目录
 * @param {(dir: string) => boolean} ok 怎么判断「这就是 Uranus」
 */
export function findRoot(here, ok) {
  const candidates = [
    process.env.URANUS_ROOT,
    process.env.URANUS_DIR,
    path.resolve(here, "..", ".."),
    process.cwd(),
    path.join(os.homedir(), "Uranus_Imessage"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (ok(dir)) return path.resolve(dir);
    } catch {
      /* 没权限之类，换下一个 */
    }
  }
  return "";
}

export function isUranusDir(dir) {
  return (
    fs.existsSync(path.join(dir, "package.json")) &&
    fs.existsSync(path.join(dir, "server", "src", "index.js"))
  );
}

/** 重新构建前端。Windows 上 npm 是 npm.cmd，新版 Node 不许直接 spawn，得走 shell。 */
export function buildClient(root) {
  const clientDir = path.join(root, "client");
  if (!fs.existsSync(path.join(root, "node_modules"))) {
    say("⚠ 没找到 node_modules，跳过前端构建。先 npm install，再 cd client && npm run build");
    return false;
  }
  const npm = WIN ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["run", "build"], { cwd: clientDir, stdio: "inherit", shell: WIN });
  return r.status === 0;
}

/** 语法检查：返回出问题的文件列表。 */
export function checkJs(root, rels) {
  const bad = [];
  for (const rel of rels) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      execFileSync(process.execPath, ["--check", abs], { stdio: "ignore" });
    } catch {
      bad.push(rel);
    }
  }
  return bad;
}

/* --------------------------------------------------------------- 重启 */

/** Windows：从 netstat 里找出监听某个端口的 PID。 */
function pidsOnPort(port) {
  if (!WIN) return [];
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] || "";
      if (!local.endsWith(":" + port)) continue;
      const pid = cols[cols.length - 1];
      if (/^\d+$/.test(pid) && pid !== "0") pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

/** 端口上跑的是不是 Uranus（同一个 /api/health 认出来，别人的端口不碰）。 */
export async function isUranus(port = PORT) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const j = await r.json();
    return j && j.service === "uranus-imessage";
  } catch {
    return false;
  }
}

/**
 * 重启 Uranus。
 * - macOS：launchctl kickstart（带 KeepAlive，一秒就回来）
 * - Windows：taskkill 掉监听端口的那个 node，再按「更新.bat」的办法新开窗口拉起启动器
 * - 其它：只提示手动重启
 */
export async function restart(root, { quiet = false } = {}) {
  if (MAC) {
    try {
      execFileSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/com.uranus.imessage`], {
        stdio: "ignore",
      });
      say("✓ 已重启");
      return true;
    } catch {
      say("⚠ 请手动重启 Uranus（服务端改动要重启才生效）");
      return false;
    }
  }

  if (WIN) {
    if (!(await isUranus(PORT))) {
      if (!quiet) say("· Uranus 现在没在跑（或端口不是它），跳过自动重启：双击「启动.bat」即可");
      return false;
    }
    const pids = pidsOnPort(PORT);
    if (!pids.length) {
      if (!quiet) say("· 没找到监听 " + PORT + " 的进程：双击「启动.bat」即可");
      return false;
    }
    for (const pid of pids) {
      try {
        execFileSync("taskkill", ["/f", "/pid", pid], { stdio: "ignore" });
      } catch {
        /* 已经没了，或者权限不够 —— 下面探一次就知道 */
      }
    }
    await sleep(1800);
    if (await isUranus(PORT)) {
      say("⚠ 没停下来，请手动关掉 Uranus 窗口再双击「启动.bat」");
      return false;
    }
    // 和「更新.bat」用的是同一套：新开一个窗口跑启动器
    spawn(
      "cmd",
      ["/c", "start", "Uranus iMessage", "cmd", "/k", "node", "scripts\\launch.mjs", "start"],
      { cwd: root, detached: true, stdio: "ignore" }
    ).unref();
    say("✓ 已重启（会开一个新窗口；前端要重建，慢一两分钟属正常）");
    say("  原来那个黑窗口如果停在「请按任意键继续」，关掉就行");
    return true;
  }

  say("⚠ 请手动重启 Uranus（systemctl restart uranus 之类）");
  return false;
}
