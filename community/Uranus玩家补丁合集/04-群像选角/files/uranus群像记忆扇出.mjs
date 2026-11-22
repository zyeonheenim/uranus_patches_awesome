#!/usr/bin/env node
/**
 * 群像记忆扇出 · 一条剧情 → 四份 POV 记忆
 *
 * 一条四个人同时在场的剧情，四个人各自「记住」的版本是不一样的：
 * 谁在场、谁只听到转述、谁根本不在 —— 记忆必须跟着这个走，否则以后线上
 * 聊天就会穿帮（「那天我又不在」）。
 *
 * 这个脚本干的就是那件事：读一段群像剧情，按在场矩阵给每个在场的人写一条
 * 第一人称 POV 记忆，带 3072 维向量，分别写进他自己的记忆库。
 *
 * 用法（managed node）：
 *
 *   # 预演：只生成不写盘，看四份稿子长什么样
 *   node uranus群像记忆扇出.mjs --file /tmp/剧情.md --present 角色A,角色B
 *
 *   # 真写
 *   node uranus群像记忆扇出.mjs --file /tmp/剧情.md --present 角色A,角色B --run
 *
 *   # 直接从线下存档扇出（turns 自动拼成文本，thinking/status 自动剥掉）
 *   node uranus群像记忆扇出.mjs --story st-示例剧情-1 --present 角色A,角色B,角色C --run
 *
 *   # 只扇出某一天（同一个存档演了好几天时用这个）
 *   node uranus群像记忆扇出.mjs --story st-示例剧情-1 --since YYYY-MM-DD --present ... --run
 *
 * 参数：
 *   --story <id>      读 data/offline/stories/<id>.json
 *   --since <日期>    只取这一天及之后的 turn（按 Asia/Seoul 日期比）
 *   --digest <path>   用现成的时间线纪要当底稿（不给就自动压，缓存在 /tmp）
 *   --refresh-digest  忽略 /tmp 的纪要缓存，重新压一遍
 *   --file <path>     读一份纯文本剧情
 *   --text "..."      直接给一段
 *   --present <列表>  在场的人，逗号分隔；可带时段备注：角色A:全程,角色B:04:00后
 *   --only <列表>     只写这几个人的记忆（默认 = present 里全部）
 *   --date YYYY-MM-DD 记忆日期（默认今天）
 *   --model <prov>/<id>  拆分用的模型（默认跟第一个在场角色的线下主模型）
 *   --run             真写盘（不带就是预演）
 *   --no-embed        不算向量（省一次请求，语义检索会漏这条）
 *
 * 幂等：同一份来源 + 同一个日期 + 同一个人，已经写过就跳过（看 keywords 里的
 * `pov:<来源指纹>` 标记）。要重写先自己删掉那条。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fileURLToPath } from "node:url";
const HERE_DIR = path.dirname(fileURLToPath(import.meta.url)); // <Uranus>/patches
const URANUS_ROOT = path.resolve(HERE_DIR, "..");
const SERVER_SRC = path.join(URANUS_ROOT, "server", "src");
const DATA = process.env.URANUS_DATA_DIR || path.join(URANUS_ROOT, "data");

const { loadConfig, resolveEndpoint } = await import(`${SERVER_SRC}/config.js`);
const { chatCompletion, embedText } = await import(`${SERVER_SRC}/llm.js`);
const { appendMemory, readMemories, memoryKeyFor } = await import(`${SERVER_SRC}/memorystore.js`);

/* ------------------------------------------------------------------ 参数 */

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
function arg(k, dflt = "") {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
}

const RUN = has("--run");
const NO_EMBED = has("--no-embed");
const STORY = arg("--story");
const FILE = arg("--file");
const INLINE = arg("--text");
const PRESENT_RAW = arg("--present", "");
const ONLY_RAW = arg("--only");
const MODEL_ARG = arg("--model");
const SINCE = arg("--since");
const DIGEST_FILE = arg("--digest");
const REFRESH = has("--refresh-digest");
const FROM_SUMMARIES = has("--from-summaries");
const LIMIT = Number(arg("--limit", "0")) || 0;
const TURNS_FROM = Number(arg("--turns-from", "0")) || 0;

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const DATE = arg("--date", today);

/* ------------------------------------------------------------ 角色对照 */

// 通用版：不写死任何角色名/称呼/声线。
// 别名＝角色自己的名字（找 role 时也接受英文名/罗马字，由 config.roles 里的实际名字决定）；
// 称呼与声线直接从该角色人设正文里让模型自己读（见 userPrompt），这里不再硬编码。
const ALIAS = {}; // 需要别名时在角色卡里体现，脚本不做人名映射
function callOf(role) { return role?.description ? "照他的人设原文里写的称呼" : "按他自己的习惯"; }
function voiceOf(role) { return role?.description ? "照他的人设原文里写的说话方式" : "按他人设"; }

const config = loadConfig();
const roles = (config.roles ?? []).filter((r) => r.id !== "r-cast-stage"); /* castpatch:exclude-stage */

function findRole(label) {
  const names = ALIAS[label] ?? [label];
  return roles.find((r) => names.includes(r.name) || String(r.name).toLowerCase() === String(label).toLowerCase());
}

const present = PRESENT_RAW.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [name, ...rest] = s.split(":");
    const note = rest.join(":").trim();
    return { label: name.trim(), note };
  });

const onlySet = ONLY_RAW
  ? new Set(ONLY_RAW.split(",").map((s) => s.trim()).filter(Boolean))
  : null;

/* ------------------------------------------------------------------ 原文 */

function stripTags(s) {
  return String(s ?? "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/\[incipere\]|\[finire\]/gi, "")
    .replace(/<\/?content>/gi, "")
    .replace(/<status>[\s\S]*?<\/status>/gi, "")
    .replace(/^\s+|\s+$/g, "");
}

function fromStory(id, since) {
  const p = path.join(DATA, "offline/stories", `${id}.json`);
  if (!fs.existsSync(p)) throw new Error("找不到剧情存档：" + p);
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  const lines = [];
  let skipped = 0;
  for (const t of d.turns ?? []) {
    const body = stripTags(t.content);
    if (!body.trim()) continue;
    const ts = t.ts ? new Date(t.ts) : null;
    const day = ts ? ts.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) : "";
    if (since && day && day < since) {
      skipped++;
      continue;
    }
    const stamp = ts
      ? ts.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)
      : "";
    const who = t.role === "user" ? (config?.userName || config?.user?.name || USER_NAME || "") : "";
    lines.push(`[${stamp}]${who ? " " + who + "：" : "\n"}${body}`);
  }
  if (since && skipped) console.log(`· --since ${since}：跳过 ${skipped} 个更早的 turn`);
  return { title: (d.name ?? id) + (since ? `（${since} 起）` : ""), text: lines.join("\n\n"), id };
}

/*
 * 小总结模式：线下每攒一段就写一条小总结（`story.summaries`），落盘时进的是
 * 群像自己的记忆库（`role-r-cast-stage`）。那个库只有一份集体记忆，各人的库里
 * 什么都没有 —— 所以按人再扇一遍，用**小总结**当底稿：一条小总结 = 一段戏，
 * 每人每段一条 POV。比拿整部存档压一次纪要更细，也不会漏掉后半夜。
 */
function fromSummaries(id, since) {
  const p = path.join(DATA, "offline/stories", `${id}.json`);
  if (!fs.existsSync(p)) throw new Error("找不到剧情存档：" + p);
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  const out = [];
  for (const s of d.summaries ?? []) {
    if (s.kind !== "small") continue; // big 是压过的合集，会和小总结重复
    if (TURNS_FROM && Number(s.from ?? 0) < TURNS_FROM) continue;
    const day = s.ts
      ? new Date(s.ts).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
      : "";
    if (since && day && day < since) continue;
    out.push({
      id: `sum-${s.id}`,
      title: `${id} ${s.id}（turn ${s.from}-${s.to}）`,
      text: String(s.text ?? ""),
      date: day || DATE,
    });
  }
  return out;
}

let segments;
if (FROM_SUMMARIES) {
  if (!STORY) throw new Error("--from-summaries 要配 --story <id>");
  segments = fromSummaries(STORY, SINCE);
  if (!segments.length) throw new Error("没有符合条件的小总结（--since 卡太紧了？）");
} else if (STORY) {
  segments = [{ ...fromStory(STORY, SINCE), date: DATE }];
} else if (FILE) {
  if (!fs.existsSync(FILE)) throw new Error("找不到文件：" + FILE);
  segments = [{ title: path.basename(FILE), text: fs.readFileSync(FILE, "utf8"), id: path.basename(FILE), date: DATE }];
} else if (INLINE) {
  segments = [{ title: "内联", text: INLINE, id: "inline", date: DATE }];
} else {
  console.error("给一段剧情：--story <id> / --file <path> / --text \"...\"");
  process.exit(1);
}

for (const seg of segments) {
  if (seg.text.trim().length < 150) {
    console.error(`片段 ${seg.title} 太短（<150 字），不像一段剧情`);
    process.exit(1);
  }
  // 指纹：来源 id + 内容长度 —— 同一段重跑能认出来
  seg.fingerprint = `${seg.id}-${seg.text.length}`;
}

if (LIMIT) segments = segments.slice(0, LIMIT);

/* ---------------------------------------------------------------- 模型 */

function endpoint() {
  if (MODEL_ARG) {
    const [provider, modelId] = MODEL_ARG.split("/");
    const ep = resolveEndpoint(config, { provider, modelId });
    if (!ep) throw new Error(`模型 ${MODEL_ARG} 解析不出来（没启用 / 没配 url）`);
    return ep;
  }
  const host = (present.map((p) => findRole(p.label)).find(Boolean)) ?? roles[0];
  const ref = host?.offline?.model ?? host?.chatModel;
  const ep = resolveEndpoint(config, ref ?? {});
  if (!ep) throw new Error("默认模型解析不出来，用 --model prov-x/m-y 指定一个");
  return ep;
}

const ep = endpoint();

/* ------------------------------------------------------------ 长文压缩 */

/*
 * 一整天演下来十五万字，POV 那一轮塞不进上下文，直接切片又只能看到开头。
 * 所以先按 2 万字一段压成时间线纪要（保留时间、人名、动作、原话、状态变化，
 * 不做文学修辞），再拿纪要当底稿写 POV —— 这样四个人的记忆都覆盖全天。
 *
 * 纪要落 /tmp 缓存：同一份来源重跑不重算，也方便人工改完再喂回来（--digest）。
 */
const DIGEST_SYSTEM = `你是群像剧情的时间线纪要压器。给你一段群像剧情原文，压成条目式纪要，给后面写记忆的人当底稿。

硬规矩：
1. 按时间顺序，每条以「剧情内时间 + 地点」开头，例：22:40 顶层公寓客厅。
2. 只写**发生了什么**：谁做了什么、说了哪句关键原话、伤口/身体/物品的状态变化、做出的决定、达成的约定。不写气氛、不写心理总结、不写比喻。
3. 人名一个不许省，动作的主体写在最前面。
4. 谁不在场、谁中途离开、谁被蒙在鼓里 —— 明确写出来。
5. 不许编：原文没有的不许补，拿不准的宁可不写。
6. 输出纯条目，每条一行，信息密度要高，长度约为原文的十分之一。`;

const DIGEST_CHUNK = 20000;

function splitChunks(text, limit) {
  const paras = text.split(/\n{2,}/);
  const out = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > limit) {
      out.push(buf);
      buf = "";
    }
    // 单段本身超限：硬切
    if (p.length > limit) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < p.length; i += limit) out.push(p.slice(i, i + limit));
      continue;
    }
    buf = buf ? buf + "\n\n" + p : p;
  }
  if (buf) out.push(buf);
  return out;
}

async function digestPass(text) {
  const chunks = splitChunks(text, DIGEST_CHUNK);
  const out = new Array(chunks.length);
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(4, chunks.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= chunks.length) return;
      try {
        const r = await chatCompletion(
          ep,
          [
            { role: "system", content: DIGEST_SYSTEM },
            {
              role: "user",
              content: `【第 ${i + 1}/${chunks.length} 段】原文：\n"""${chunks[i]}"""\n\n压成时间线纪要条目。`,
            },
          ],
          { temperature: 0.2 }
        );
        out[i] = String(r ?? "").trim();
      } catch (e) {
        console.log(`\n  ! 第 ${i + 1} 段压缩失败：${e?.message ?? e}`);
      }
      done++;
      process.stdout.write(`\r  压缩中 ${done}/${chunks.length}`);
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");
  return out.filter(Boolean).join("\n");
}

async function buildDigest(seg) {
  if (DIGEST_FILE) {
    if (!fs.existsSync(DIGEST_FILE)) throw new Error("找不到 --digest 文件：" + DIGEST_FILE);
    const t = fs.readFileSync(DIGEST_FILE, "utf8");
    console.log(`· 用现成纪要：${DIGEST_FILE}（${t.length} 字）`);
    return t;
  }
  if (seg.text.length <= 30000) return null;
  const cache = path.join(os.tmpdir(), `uranus-digest-${seg.fingerprint}.md`);
  if (!REFRESH && fs.existsSync(cache)) {
    const t = fs.readFileSync(cache, "utf8");
    console.log(`· 复用已算好的纪要 ${cache}（${t.length} 字）`);
    return t;
  }
  let text = seg.text;
  for (let round = 1; round <= 4 && text.length > 26000; round++) {
    const before = text.length;
    text = await digestPass(text);
    console.log(`· 第 ${round} 轮：${before} → ${text.length} 字`);
  }
  fs.writeFileSync(cache, text);
  console.log(`· 纪要稳定在 ${text.length} 字，已存 ${cache}`);
  return text;
}

/* -------------------------------------------------------------- POV 提示 */

const SYSTEM = `你是群像剧情的长记忆拆分器。

给你一段多人同时在场的剧情，以及其中一个人的名字，你要写出**这个人自己的那段记忆** —— 事后回想起来的样子。

硬规矩：
1. 第三人称过去时。**叙述主角一律直接写他自己的名字（就是下面【要写记忆的人】给的这个名字），全程不许出现叙述性的「我」**——记忆要按人名登记，混进群像时谁的就是谁的，不靠猜。只有引号里的直接引语（人物原话）可以保留「我」。用户本人写「她」即可。
2. **只写他亲眼看见、亲耳听见、亲身经历的。** 他不在场的时候发生的事、别人背着他做的决定、别人心里想的东西 —— 一个字都不许写。他只能从痕迹里推测（手背上的血痂、绷带、红肿的眼睛、桌上留下的发圈）。
3. 用他本人的称呼和说话方式（会给你）。别人怎么叫他、他怎么叫别人，一个都不能串。
4. 具体：时间、地点、动作、原话。不写「气氛很紧张」这种概括，写「他把车钥匙放在玄关台面上，没抬眼」。
5. 长度跟着材料走：材料事实充足时写 1650–1900 字、三到五段；**材料只覆盖一小段时间就写短（几百字也可以）——绝不为凑字数编造材料里没有的情节**。材料没写的清晨、白天、晚上一律当没发生；「从凌晨写到深夜」只在材料确实覆盖全天时才成立。不用小标题，不用总结句。
6. 材料里以**计划、约定、对话**形式出现的事（比如「明天公证人上门」「暗房改到下午两点」），只能写成当时被提起、说好的话，**绝不能写成已经发生的事**。
7. 只输出记忆正文。不要解释、不要前言、不要「以下是」。

语言：简体中文（人物说的韩语台词可以保留原样，后面用括注带一句中文）。`;

function userPrompt(seg, label, note) {
  const others = present
    .filter((p) => p.label !== label)
    .map((p) => `${p.label}${p.note ? `（${p.note}）` : "（全程在场）"}`)
    .join("、");

  return `【要写记忆的人】${label}
【他的称呼方式】${callOf(findRole(label))}
【他的说话方式】${voiceOf(findRole(label))}
【这场戏在场的人】${present.map((p) => `${p.label}${p.note ? `（${p.note}）` : "（全程）"}`).join("、")}
【不在场或中途才到的人】${others || "无"}
【日期】${seg.date}

${seg.digest ? "下面是这一整天从头到尾的经过（按时间排的纪要）：" : "下面是这一整天的经过（凌晨到深夜）："}

"""${seg.digest ?? seg.text.slice(0, 24000)}"""

现在写 ${label} 在 ${seg.date} 这一天留下的一条记忆：按材料实际覆盖的时段写，只写他能知道的部分，材料没写到的时段不要编。中间他不在场的那几段时间，就写他从痕迹和转述里知道的，或者干脆跳过——不用硬填。`;
}

/* ---------------------------------------------------------------- 向量 */

// 向量走玩家自己的配置：读 config.memories.memory.embedModel，用 Uranus 自带的
// resolveEndpoint + embedText 调用。不写死任何 provider id / key / 接口地址，
// 玩家用 OpenAI 兼容、Gemini 原生还是 Vertex 都能按他自己的设置工作。
function embedRef() {
  for (const section of ["memory", "memo"]) {
    const ref = config?.memories?.[section]?.embedModel;
    if (ref?.provider && ref?.modelId) return ref;
  }
  return null;
}

async function embed(text) {
  if (NO_EMBED) return null;
  const ref = embedRef();
  if (!ref) {
    console.log("  ! 没有可用的向量模型，这条不带向量（可在记忆设置里选一个）");
    return null;
  }
  try {
    const ep = resolveEndpoint(config, ref);
    if (!ep) throw new Error("向量模型引用失效（服务商或模型被删/被关）");
    const out = await embedText(ep, String(text).slice(0, 6000), { retries: 1 });
    return Array.isArray(out) && out.length ? out : null;
  } catch (e) {
    console.log("  ! 向量请求失败：", String(e?.message ?? e).slice(0, 140));
    return null;
  }
}

/* ------------------------------------------------------------------ 主流程 */

console.log("=".repeat(12) + " 群像记忆扇出 " + "=".repeat(26));
console.log(`来源：${segments.length} 段 — ${segments.map((s) => s.title).join(" ｜ ")}`);
console.log(`模型：${ep.label}　${FROM_SUMMARIES ? "底稿：小总结（群像库里那份）" : "底稿：剧情原文"}`);
console.log(`在场：${present.map((p) => p.label + (p.note ? `(${p.note})` : "")).join("、")}`);
console.log(RUN ? "模式：**真写盘**" : "模式：预演（加 --run 才写）");
console.log("");

const targets = present.filter((p) => !onlySet || onlySet.has(p.label));
if (!targets.length) {
  console.error("一个目标角色都没有 —— 检查 --present / --only");
  process.exit(1);
}

const results = [];

for (const [si, seg] of segments.entries()) {
  seg.digest = await buildDigest(seg);
  console.log(
    `\n── 第 ${si + 1}/${segments.length} 段：${seg.title}　${seg.text.length} 字` +
      (seg.digest ? ` → 纪要 ${seg.digest.length} 字` : "")
  );

  for (const who of targets) {
    const role = findRole(who.label);
    if (!role) {
      console.log(`✗ ${who.label}：config.roles 里找不到这个角色，跳过`);
      continue;
    }
    const key = memoryKeyFor(role);

    // 幂等：同一段 + 同一个人，写过就跳过
    const existing = readMemories(key);
    const dup = existing.find(
      (m) => (m.keywords ?? []).includes(`pov:${seg.fingerprint}`) && m.keywords.includes(who.label)
    );
    if (dup) {
      console.log(`· ${who.label}：这段写过了（${dup.id}，${dup.date}），跳过`);
      continue;
    }

    process.stdout.write(`→ ${who.label}（${key}）生成中… `);
    let text = "";
    try {
      text = await chatCompletion(
        ep,
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(seg, who.label, who.note) },
        ],
        { temperature: 0.5 }
      );
    } catch (e) {
      console.log("失败：" + (e?.message ?? e));
      continue;
    }
    text = String(text ?? "").trim();
    if (!text) {
      console.log("空回，跳过");
      continue;
    }
    // 偶尔会带上「以下是」之类的头，切掉
    text = text.replace(/^(以下是|这是|【?记忆】?[:：]?\s*)/, "").trim();
    console.log(`${text.length} 字`);

    const emb = await embed(text);
    const keywords = [
      "群像",
      who.label,
      `pov:${seg.fingerprint}`,
      seg.date,
      ...(emb ? [] : ["无向量"]),
    ];

    results.push({
      who: who.label,
      key,
      roleId: role.id,
      content: text,
      embedding: emb,
      keywords,
      date: seg.date,
      segment: seg.title,
    });
  }
}

console.log("");
for (const r of results) {
  console.log("─".repeat(64));
  console.log(`【${r.who}】${r.date}　${r.content.length} 字　向量 ${r.embedding ? r.embedding.length + " 维" : "无"}`);
  console.log(`（${r.segment}）`);
  console.log(r.content);
  console.log("");
}

if (!RUN) {
  console.log("─".repeat(64));
  console.log(`预演完成：${results.length} 份。加 --run 真写盘。`);
  process.exit(0);
}

let written = 0;
for (const r of results) {
  const item = appendMemory(r.key, {
    date: r.date,
    content: r.content,
    keywords: r.keywords,
    embedding: r.embedding,
  });
  if (item) {
    written++;
    console.log(`✓ ${r.who} → ${r.key}　${item.id}　${item.date}`);
  } else {
    console.log(`✗ ${r.who} 写入失败`);
  }
}
console.log("");
console.log(`写完 ${written} 条。记忆库是现读盘的，不用重启服务。`);
