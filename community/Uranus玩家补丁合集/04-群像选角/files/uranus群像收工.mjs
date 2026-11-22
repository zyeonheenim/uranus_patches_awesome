#!/usr/bin/env node
/**
 * 群像收工：剧情结束后自动补「群像库大总结 + 在场者 POV」。
 *
 * 背景：endOffline 的按天合并只写群像库（「线下合并:<日期>」），各人
 * 各自的库和大总结从来没人写 —— 以前靠收工后手动跑扇出脚本，YYYY-MM-DD 就
 * 因此漏了 11-10 一整天。现在由 offline.js 的 endOffline 在落库完毕后 spawn
 * 本脚本（detached 后台），把最后一步补上。
 *
 * 用法：
 *   node 群像收工.mjs --story st-xxxx            # 处理该剧情覆盖的每一天
 *   node uranus群像收工.mjs --story st-aaaa,st-bbbb    # 多场戏同天合并收（11-12 补）
 *   node uranus群像收工.mjs --story st-xxxx --only-day YYYY-MM-DD
 *   可选 --model <prov>/<id>（默认取第一个在场角色的线下模型；空回多就换一个稳定的模型）
 *
 * 幂等（重复跑安全）：
 *   - 大总结：群像库 keywords 里有「大总结:<日期>」就跳过；
 *   - POV：各自的库都有该日期的 pov 条目就跳过；只写了一部分时重跑，
 *     扇出脚本自己按 pov:<指纹> 逐人去重（素材文件名固定 → 指纹稳定）。
 *   - 并发：/tmp/uranus-closeout/.lock-<剧情hash> 互斥；点两次结束也只跑一份。
 *
 * 失败策略：模型连吃 3 次失败只记日志不重试烧钱；任何一步失败不影响其余天。
 * 完成/失败会 POST /api/watchdog/notice（scope=群像收工）回报到控制台日志抽屉。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // ~/Uranus_Imessage/patches
const ROOT = path.resolve(HERE, "..");                     // ~/Uranus_Imessage
const DATA = process.env.URANUS_DATA_DIR || path.join(ROOT, "data");
const SERVER_SRC = path.join(ROOT, "server", "src");
const FANOUT = path.join(HERE, "uranus群像记忆扇出.mjs");
const MATERIAL_DIR = path.join(os.tmpdir(), "uranus-closeout"); // Windows 上没有 /tmp

// —— 参数 ——
const argv = process.argv.slice(2);
const arg = (k, dflt = "") => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const STORIES = arg("--story").split(",").map((s) => s.trim()).filter(Boolean);
const ONLY_DAY = arg("--only-day");
const MODEL = arg("--model", ""); // 不给就从第一个在场角色的线下模型取

if (!STORIES.length) {
  console.error("缺 --story <id>[,<id2>…]");
  process.exit(2);
}

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// —— 完成后回报控制台（index.js 的看门狗通知口，loopback only）——
async function notice(message, level = "info") {
  try {
    await fetch("http://127.0.0.1:8787/api/watchdog/notice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "群像收工", message, level }),
    });
  } catch {}
}

// —— 并发锁：同一组剧情同时只跑一份 ——
fs.mkdirSync(MATERIAL_DIR, { recursive: true });
const { createHash } = await import("node:crypto");
const LOCK = path.join(MATERIAL_DIR, `.lock-${createHash("md5").update([...STORIES].sort().join(",")).digest("hex").slice(0, 10)}`);
function acquire(p, depth = 0) {
  try {
    const fd = fs.openSync(p, "wx");
    fs.writeSync(fd, String(process.pid));
    return fd;
  } catch {
    if (depth > 1) return null;
    try {
      const st = fs.statSync(p);
      if (Date.now() - st.mtimeMs < 30 * 60 * 1000) return null; // 30 分钟内的锁算有人在跑
    } catch {}
    try { fs.unlinkSync(p); } catch {}
    return acquire(p, depth + 1);
  }
}
const lockFd = acquire(LOCK);
if (lockFd == null) {
  log(`已有同组收工任务在跑（${LOCK}），本份退出。`);
  process.exit(0);
}
process.on("exit", () => {
  try { fs.closeSync(lockFd); } catch {}
  try { fs.unlinkSync(LOCK); } catch {}
});
// 信号退出也要清锁（默认 SIGTERM 不触发 exit 钩子）
for (const sig of ["SIGTERM", "SIGINT"]) {
  try { process.on(sig, () => process.exit(143)); } catch {}
}

// 四个单人库的 memory key（写死：卡上字段会被控制台整包保存抹掉，这里不放卡上）
// 通用版：群像里的候选角色＝除舞台卡外的所有人，key 用服务端同款算法现算（不写死）
const memoryKeyForLocal = (r) => {
  const n = String(r?.name ?? "").replace(/[^A-Za-z0-9]/g, "");
  return n || `role-${String(r?.id ?? "").replace(/[^A-Za-z0-9_-]/g, "")}`;
};
const ALL_ROLES_INIT = (loadConfig().roles ?? []);
const ROLE_KEYS = {}; // name -> memoryKey
for (const r of ALL_ROLES_INIT) {
  if (r?.id === "r-cast-stage" || !r?.name) continue;
  ROLE_KEYS[r.name] = memoryKeyForLocal(r);
}
const FOUR_KEYS = ROLE_KEYS; // 兼容下文变量名（现在是"所有在场角色"）
const GROUP_KEY = "role-r-cast-stage"; // 群像集体记忆库 key，与舞台卡 id 对应（通用约定）

// 首尔时区日期（扇出脚本同口径；存档里的 ts 是 UTC）
const SEOUL_MS = 9 * 3600 * 1000;
const seoulDate = (ts) => {
  const t = new Date(ts).getTime();
  return new Date(Number.isNaN(t) ? Date.now() + SEOUL_MS : t + SEOUL_MS).toISOString().slice(0, 10);
};

// —— 服务端模块 ——
const { loadConfig, resolveEndpoint } = await import(`file://${path.join(SERVER_SRC, "config.js")}`);
const { chatCompletion, embedText } = await import(`file://${path.join(SERVER_SRC, "llm.js")}`);
const { readMemories, appendMemory } = await import(`file://${path.join(SERVER_SRC, "memorystore.js")}`);

// —— 读存档（可多场）——
const loaded = STORIES.map((sid) => {
  const f = path.join(DATA, "offline", "stories", `${sid}.json`);
  if (!fs.existsSync(f)) {
    console.error(`存档不存在：${f}`);
    process.exit(2);
  }
  return { id: sid, story: JSON.parse(fs.readFileSync(f, "utf8")) };
});

/* castpatch:present-from-cast */
// [群像选角] 从每场戏的 castRoleIds 反查在场者姓名（并集）；无字段的老戏 = 全部候选角色
const CAST_IDS = new Set();
for (const { story } of loaded) {
  if (Array.isArray(story?.castRoleIds) && story.castRoleIds.length) {
    story.castRoleIds.forEach((id) => CAST_IDS.add(String(id)));
  }
}
const ALL_ROLES = ALL_ROLES_INIT;
const presentNames = CAST_IDS.size
  ? Object.keys(FOUR_KEYS).filter((nm) => {
      const r = ALL_ROLES.find((x) => x.name === nm);
      return r && CAST_IDS.has(String(r.id));
    })
  : Object.keys(FOUR_KEYS); // 老剧情兜底：全部候选角色都算在场
log(`[群像选角] 本场在场：${presentNames.join("、") || "（无）"}`);

// —— 按天归材料：small 优先（大总结/big 不进材料，跟 endOffline 同一规矩）——
// 多场戏覆盖同一天时，材料合并进同一天（各自带【剧情名】头）
const byDay = new Map(); // day -> { smalls: [], bigs: [] }
for (const { id, story } of loaded) {
  const turns = Array.isArray(story.turns) ? story.turns : [];
  const label = STORIES.length > 1 ? `【${story.name || id}】` : "";
  for (const s of story.summaries ?? []) {
    if (!s || !String(s.text ?? "").trim()) continue;
    const day = seoulDate(turns[s.from]?.ts ?? s.ts);
    if (!byDay.has(day)) byDay.set(day, { smalls: [], bigs: [] });
    const bucket = s.kind === "big" ? byDay.get(day).bigs : byDay.get(day).smalls;
    bucket.push(label + String(s.text).trim());
  }
}
let days = [...byDay.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([day, v]) => {
    const list = v.smalls.length ? v.smalls : v.bigs; // 一天只有 big 的剧情拿 big 顶上
    return { day, text: list.join("\n\n") };
  })
  .filter((d) => d.text);
if (ONLY_DAY) days = days.filter((d) => d.day === ONLY_DAY);
if (!days.length) {
  log(`没有可处理的日期（story=${STORIES.join(",")}${ONLY_DAY ? `，only-day=${ONLY_DAY}` : ""}）。结束。`);
  process.exit(0);
}

// —— 模型端点 ——
const config = loadConfig();
const [provId, modelId] = MODEL.split("/");
const ep = resolveEndpoint(config, { provider: provId, modelId });
if (!ep) {
  console.error(`模型解析失败：${MODEL}`);
  process.exit(2);
}

// —— 向量：走玩家自己的配置（记忆设置里的向量模型 + resolveEndpoint + embedText）——
// 不写死任何 provider id / key / 接口地址，换一台机器也按其自身配置工作。
function embedRef() {
  for (const section of ["memory", "memo"]) {
    const ref = config?.memories?.[section]?.embedModel;
    if (ref?.provider && ref?.modelId) return ref;
  }
  return null;
}

async function embed(text) {
  const ref = embedRef();
  if (!ref) return null;
  try {
    const ep = resolveEndpoint(config, ref);
    if (!ep) return null;
    const out = await embedText(ep, String(text).slice(0, 6000), { retries: 1 });
    return Array.isArray(out) && out.length ? out : null;
  } catch {
    return null;
  }
}

async function callModel(messages, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const out = (await chatCompletion(ep, messages, { temperature: 0.4 }))?.trim() ?? "";
      if (out) return out;
      log(`  模型第 ${i} 次空回`);
    } catch (e) {
      log(`  模型第 ${i} 次失败：${String(e?.message ?? e).slice(0, 140)}`);
    }
  }
  return "";
}

const groupMems = () => readMemories(GROUP_KEY);
// 指纹 = 首个剧情id-日期.md-材料长度。只认本次收工口径（pov:<STORIES[0]>-<day>.md-<len>）的指纹做长度比对：
// 材料比上次收工长了=有新剧情没收，要补；更短或同长=已收过。旧口径/手工写的 POV（别的指纹）一律视为已收，绝不重生成。
const fpOf = (day, textLen) => `${STORIES[0]}-${day}.md-${textLen}`;
const kwLen = (kw, prefix) => {
  const s = String(kw);
  if (!s.startsWith(prefix)) return 0;
  const n = parseInt(s.slice(prefix.length).match(/(\d+)$/)?.[1] ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
};
const hasDaz = (day, textLen) => {
  const hits = groupMems().filter(
    (m) => Array.isArray(m?.keywords) && m.keywords.includes(`大总结:${day}`)
  );
  if (!hits.length) return false;
  const own = hits.flatMap((m) =>
    m.keywords.filter((k) => String(k).startsWith(`大总结指纹:${STORIES[0]}-${day}.md-`))
  );
  if (!own.length) return true; // 只有旧式/手工条目 → 已收
  return own.some((k) => kwLen(k, "大总结指纹:") >= textLen);
};
const povDone = (day, textLen) => {
  const stem = `pov:${STORIES[0]}-${day}.md-`;
  for (const nm of presentNames) { /* castpatch:pov-present */
    const key = FOUR_KEYS[nm];
    const hits = readMemories(key).filter(
      (m) =>
        m?.date === day &&
        Array.isArray(m?.keywords) &&
        m.keywords.some((k) => String(k).startsWith("pov:"))
    );
    if (!hits.length) return false;
    const lens = hits.flatMap((m) =>
      m.keywords.filter((k) => String(k).startsWith(stem)).map((k) => kwLen(k, "pov:"))
    );
    if (!lens.length) continue; // 该库的 POV 是旧口径/手工写的 → 视为已收
    if (Math.max(...lens) < textLen) return false; // 本次材料更长 → 有新剧情没收
  }
  return true;
};

let failed = 0;
const details = [];

for (const { day, text } of days) {
  log(`—— ${day}（材料 ${text.length} 字）——`);

  // ① 群像库大总结
  if (hasDaz(day, text.length)) {
    log(`  大总结：已存在，跳过`);
    details.push(`${day} 大总结已有`);
  } else {
    const sys = `你是剧情记忆整理员。把给出的剧情材料压缩成一条「大总结」记忆，要求：
1. 第三人称时间线叙事，按时间顺序；主角一律写本名（就写在下面材料里出现的人名），叙述里禁止出现「我」（引号内的原话除外）。
2. 只准使用材料里出现的信息：时间、地点、事件、情绪、原话都以材料为准，禁止补写材料里没有的情节、对话或心理描写；材料没提的就略过。
3. 长度不超过材料字数，目标 1500-2000 个汉字。只输出正文，不要标题、不要解释。`;
    let content = await callModel([
      { role: "system", content: sys },
      { role: "user", content: text },
    ]);
    // gemini 压不住字数还爱扩写：超长就再压一遍（第二遍压草稿通常听指令）
    if (content && content.length > 2600) {
      log(`  大总结 ${content.length} 字超长，二次压缩…`);
      const again = await callModel([
        {
          role: "system",
          content:
            "把这段剧情记忆压缩到 1700-2000 个汉字。保留时间、地点、人物、事件顺序和关键原话（韩语保留韩文），禁止新增任何原文没有的内容。只输出正文。",
        },
        { role: "user", content },
      ]);
      if (again && again.length < content.length) content = again;
    }
    if (!content) {
      log(`  ✗ 大总结：模型没出稿，跳过（不重试）`);
      failed++;
      details.push(`${day} 大总结失败`);
    } else {
      const embedding = await embed(content);
      const item = appendMemory(GROUP_KEY, {
        date: day,
        content,
        keywords: ["群像", "大总结", `大总结:${day}`, `大总结指纹:${fpOf(day, text.length)}`, ...STORIES],
        embedding,
      });
      log(`  ✓ 大总结：${content.length} 字，向量 ${embedding ? embedding.length + " 维" : "无"} → ${item?.id ?? "写入失败"}`);
      if (!item) failed++;
      details.push(`${day} 大总结${item ? "入库 " + content.length + "字" : "写入失败"}`);
    }
  }

  // ② 在场者 POV（扇出脚本自带逐人幂等）
  if (povDone(day, text.length)) {
    log(`  在场者POV：四库都已有，跳过`);
    details.push(`${day} 在场者POV已有`);
    continue;
  }
  // 文件名固定 = 扇出指纹稳定（pov:<文件名>-<长度>），部分失败重跑不会写重
  const matFile = path.join(MATERIAL_DIR, `${STORIES[0]}-${day}.md`);
  fs.writeFileSync(matFile, text);
  log(`  在场者POV：跑扇出（素材 ${matFile}）…`);
  const r = spawnSync(process.execPath, [FANOUT, "--file", matFile, "--date", day, "--run", "--model", MODEL,
    "--present", presentNames.join(",")], { /* castpatch:fanout-present */
    stdio: "inherit",
    timeout: 30 * 60 * 1000,
  });
  // 扇出退出码不可信（全失败也返回 0）：以四库实查为准
  if (povDone(day, text.length)) {
    details.push(`${day} 在场者POV入库`);
    log(`  ✓ 在场者POV已入库（实查四库确认）`);
  } else {
    log(`  ✗ 扇出没写全（退出码 ${r.status ?? "超时/信号"}），详情见上方输出`);
    failed++;
    details.push(`${day} 在场者POV失败`);
  }
}

const finalMsg = failed
  ? `群像收工完成，但有 ${failed} 处失败：${details.join("；")}（详见 群像收工.log，可重跑补齐）`
  : `群像收工完成：${details.join("；")}`;
await notice(finalMsg, failed ? "warn" : "info");
log(failed ? `收工完成，但有 ${failed} 处失败 —— 查上方日志，修好后重跑即可（幂等）。` : `收工完成，全部就绪。`);
process.exit(failed ? 1 : 0);
