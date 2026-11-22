#!/usr/bin/env node
/**
 * 入站看门狗 · 服务端补丁（幂等）
 *
 * 给 Uranus 加一个「只收本机回环、只写一行日志」的通知端点：
 *   POST /api/watchdog/notice  { message, level, scope }
 * 看门狗 shell 脚本靠它把巡检结果写进 Uranus 日志（网页日志抽屉可见）。
 *
 * 只动 server/src/index.js 两处，锚点用官方原版一定存在的文本：
 *   ① OPEN_PATHS 列表里 "/api/health" 后面加一条 "/api/watchdog/notice"
 *   ② 路由区加一个 app.post("/api/watchdog/notice", ...)
 *
 * 不碰任何用户数据、不写任何角色/人设/密钥。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.URANUS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = path.join(ROOT, "server", "src", "index.js");
const MARK = "watchdogpatch";
let raw = fs.readFileSync(FILE, "utf8");
let n = 0;

function rep(name, from, to, already) {
  if (already && raw.includes(already)) { console.log(`  跳过 ${name}（已打过）`); return; }
  const c = raw.split(from).length - 1;
  if (c !== 1) throw new Error(`${name} 锚点命中 ${c} 次，中止（文件可能被改过或已装）`);
  raw = raw.replace(from, to);
  n++;
  console.log(`  ✓ ${name}`);
}

// ① OPEN_PATHS：在 "/api/health", 后面的注释块之前插入
rep("开放免登录路径",
`  "/api/health",`,
`  "/api/health",
  "/api/watchdog/notice", /* ${MARK}:open-path */`,
`/* ${MARK}:open-path */`);

// ② 路由：在 iMessage 桥接状态路由前插入通知端点
const ROUTE = `/* ${MARK}:route */
app.post("/api/watchdog/notice", (req, res) => {
  const ip = String(req.socket?.remoteAddress ?? "");
  const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!loopback) return res.status(403).json({ ok: false, error: "loopback only" });
  const msg = String(req.body?.message ?? "").slice(0, 600).trim();
  const level = String(req.body?.level ?? "warn");
  const scope = String(req.body?.scope ?? "看门狗").replace(/[^\\w\\u4e00-\\u9fa5· ]/g, "").slice(0, 20) || "看门狗";
  if (!msg) return res.status(400).json({ ok: false, error: "empty message" });
  if (level === "info") logInfo(scope, msg);
  else if (level === "error") logError(scope, msg);
  else logWarn(scope, msg);
  res.json({ ok: true });
});

`;
rep("加通知路由",
`// ---- iMessage 桥接状态 ----`,
`${ROUTE}// ---- iMessage 桥接状态 ----`,
`/* ${MARK}:route */`);

if (n) fs.writeFileSync(FILE, raw, "utf8");
console.log(n ? `\n✓ 服务端补丁完成，共 ${n} 处` : "\n＝ 已全部打过，无需改动");
