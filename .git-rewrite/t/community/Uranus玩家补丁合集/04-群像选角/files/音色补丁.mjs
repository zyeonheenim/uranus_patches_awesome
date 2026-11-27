#!/usr/bin/env node
/**
 * [群像音色补丁] client/src/panels/offline.jsx —— 台词按「说话人」用各自角色卡的音色念
 *
 * 原版本身就有「逐句朗读」：正文里每一对「」配一个小播放键，用**当前角色**的音色念。
 * 群像舞台里一句话是谁说的写在「名字：『台词』」里，这个补丁让朗读时认出名字，
 * 请求带上 speaker；服务端据此查那个角色的音色（见 音色服务端补丁.mjs）。
 *
 * 只对**出场名单里的名字**生效；名单为空（单人剧情）＝行为和原版一模一样。
 * 不写死任何角色名 —— 名字全部来自剧情的 castRoleIds + 角色卡的 name。
 *
 * 幂等：每处改动带 voicecast 标记，重复跑自动跳过。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.URANUS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILE = path.join(ROOT, "client", "src", "panels", "offline.jsx");
const M = "voicecast";
const DRY = process.argv.includes("--dry");
let raw = fs.readFileSync(FILE, "utf8");
let n = 0;
function rep(name, from, to, already) {
  if (raw.includes(already)) { console.log(`  跳过 ${name}（已打过）`); return; }
  const c = raw.split(from).length - 1;
  if (c !== 1) throw new Error(`${name} 锚点命中 ${c} 次，中止（前端版本不同，别硬打）`);
  raw = raw.replace(from, to); n++;
  console.log(`  ✓ ${name}`);
}

// ① 加「认说话人」函数 + splitVoiceSegments 支持 speaker
rep("speakerBefore + 台词带 speaker",
`const VOICE_SEGMENT = /「([^「」]+)」/g;

/**
 * 把一段正文切成「念的」和「不念的」两种片段。
 *
 * @returns {{spoken: boolean, text: string}[]} 按出现顺序排好，空片段已经滤掉
 */
function splitVoiceSegments(text) {
  const out = [];
  const src = String(text ?? "");
  let last = 0;
  VOICE_SEGMENT.lastIndex = 0;
  for (let m = VOICE_SEGMENT.exec(src); m; m = VOICE_SEGMENT.exec(src)) {
    if (m.index > last) out.push({ spoken: false, text: src.slice(last, m.index) });
    const line = m[1].trim();
    // 空的「」不当台词，原样留着，免得凭空少一对括号
    if (line) out.push({ spoken: true, text: line });
    else out.push({ spoken: false, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ spoken: false, text: src.slice(last) });
  return out;
}`,
`const VOICE_SEGMENT = /「([^「」]+)」/g; /* ${M}:speaker */

/**
 * 「」紧前面那句「名字：」是谁说的。只在名字属于本场出场名单时才认 ——
 * 正文别处的「」（引话、歌名、设定）没说话人，照旧用当前角色音色。
 * @returns {string} 说话人名字；认不出来就是空串
 */
function speakerBefore(src, index, castNames) {
  if (!castNames || !castNames.length) return "";
  const head = src.slice(Math.max(0, index - 24), index);
  const m = /([^：:\\n「」，。！？、\\s]{1,12})[：:]\\s*$/.exec(head);
  if (!m) return "";
  const name = m[1].trim();
  return castNames.includes(name) ? name : "";
}

/**
 * 把一段正文切成「念的」和「不念的」两种片段。
 * @param {string} text 正文
 * @param {string[]} [castNames] 本场出场名字；给了才认「名字：」说话人
 * @returns {{spoken: boolean, text: string, speaker?: string}[]}
 */
function splitVoiceSegments(text, castNames) {
  const out = [];
  const src = String(text ?? "");
  let last = 0;
  VOICE_SEGMENT.lastIndex = 0;
  for (let m = VOICE_SEGMENT.exec(src); m; m = VOICE_SEGMENT.exec(src)) {
    if (m.index > last) out.push({ spoken: false, text: src.slice(last, m.index) });
    const line = m[1].trim();
    // 空的「」不当台词，原样留着，免得凭空少一对括号
    if (line) {
      out.push({ spoken: true, text: line, speaker: speakerBefore(src, m.index, castNames) });
    } else out.push({ spoken: false, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ spoken: false, text: src.slice(last) });
  return out;
}`,
`/* ${M}:speaker */`);

// ② VoiceLine 签名加 speaker
rep("VoiceLine 接 speaker",
`function VoiceLine({ roleKey, text, auto, onError }) {
  const [status, setStatus] = useState("idle");`,
`function VoiceLine({ roleKey, text, speaker, auto, onError }) { /* ${M}:line */
  const [status, setStatus] = useState("idle");`,
`/* ${M}:line */`);

// ③ VoiceLine 请求体带 speaker（用 VoiceLine 内的长上下文唯一定位）
rep("朗读请求带 speaker",
`      const r = await api(\`/api/offline/\${encodeURIComponent(roleKey)}/voice\`, {
        method: "POST",
        body: { text },
      });`,
`      const r = await api(\`/api/offline/\${encodeURIComponent(roleKey)}/voice\`, {
        method: "POST",
        body: speaker ? { text, speaker } : { text }, /* ${M}:body */
      });`,
`/* ${M}:body */`);

// ④ VoiceLine 依赖数组加 speaker
rep("VoiceLine 依赖加 speaker",
`  }, [roleKey, text, onError]);

  /* 自动朗读`,
`  }, [roleKey, text, speaker, onError]); /* ${M}:deps */

  /* 自动朗读`,
`/* ${M}:deps */`);

// ⑤ VoiceText 签名 + 拆分调用带 castNames
rep("VoiceText 传 castNames",
`function VoiceText({ roleKey, turnId, text, auto, onError }) {
  const parts = useMemo(() => splitVoiceSegments(text), [text]);`,
`function VoiceText({ roleKey, turnId, text, auto, onError, castNames }) { /* ${M}:text */
  const parts = useMemo(() => splitVoiceSegments(text, castNames), [text, castNames]);`,
`/* ${M}:text */`);

// ⑥ VoiceText 里给 VoiceLine 传 speaker
rep("VoiceLine 收到 speaker",
`          <VoiceLine
            key={\`\${turnId}-\${i}\`}
            roleKey={roleKey}
            text={p.text}
            auto={auto}
            onError={onError}
          />`,
`          <VoiceLine
            key={\`\${turnId}-\${i}\`}
            roleKey={roleKey}
            text={p.text}
            speaker={p.speaker || ""} /* ${M}:pass */
            auto={auto}
            onError={onError}
          />`,
`/* ${M}:pass */`);

// ⑦ Bubble 签名加 castNames。签名结尾随装的补丁不同而变，三种都认：
//    A=版本留底+气泡补丁都装(onRestore+bubbleStyle) B=只装版本留底(onRestore)
//    C=纯原版(直接 onVoiceError 收尾，1.22.2 等)
const bubbleVariants = [
  [`  onRestore,\n  bubbleStyle,\n}) {`, `  onRestore,\n  bubbleStyle,\n  castNames, /* ${M}:bubble */\n}) {`, "版本留底+气泡补丁版"],
  [`  onRestore,\n}) {`, `  onRestore,\n  castNames, /* ${M}:bubble */\n}) {`, "版本留底版"],
  [`  onVoiceError,\n}) {`, `  onVoiceError,\n  castNames, /* ${M}:bubble */\n}) {`, "纯原版"],
];
if (raw.includes(`/* ${M}:bubble */`)) {
  console.log(`  跳过 Bubble 签名（已打过）`);
} else {
  const hit = bubbleVariants.find(([from]) => raw.split(from).length - 1 === 1);
  if (!hit) throw new Error(`Bubble 签名锚点三个版本都没命中，中止（前端版本不同，别硬打）`);
  raw = raw.replace(hit[0], hit[1]); n++;
  console.log(`  ✓ Bubble 签名加 castNames（${hit[2]}）`);
}

// ⑧ 两处 VoiceText 调用加 castNames
rep("切块渲染的 VoiceText",
`                          text={b.text}
                          auto={auto}
                          onError={onVoiceError}`,
`                          text={b.text}
                          castNames={castNames} /* ${M}:call1 */
                          auto={auto}
                          onError={onVoiceError}`,
`/* ${M}:call1 */`);

rep("整段渲染的 VoiceText",
`                  text={text}
                  auto={auto}
                  onError={onVoiceError}`,
`                  text={text}
                  castNames={castNames} /* ${M}:call2 */
                  auto={auto}
                  onError={onVoiceError}`,
`/* ${M}:call2 */`);

// ⑨ 从 castRoleIds 算 castNames（放在 castIds 那行后面，那是 04 群像补丁加的；本补丁在其后跑）
rep("计算 castNames",
`  const castIds = Array.isArray(story?.castRoleIds) ? story.castRoleIds : [];`,
`  const castIds = Array.isArray(story?.castRoleIds) ? story.castRoleIds : [];
  // 本场出场角色的名字：朗读时用来认「这句是谁说的」。名单空＝单人剧情，行为和原版一样。
  const castNames = castIds
    .map((id) => (config?.roles ?? []).find((r) => r.id === id)?.name)
    .filter(Boolean); /* ${M}:names */`,
`/* ${M}:names */`);

if (n && !DRY) fs.writeFileSync(FILE, raw, "utf8");
console.log(n ? `\n✓ 音色补丁完成，共 ${n} 处${DRY ? "（预演）" : ""}；记得 npm run build` : "\n＝ 已全部打过");
