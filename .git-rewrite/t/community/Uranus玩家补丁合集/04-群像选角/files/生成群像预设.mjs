#!/usr/bin/env node
/**
 * 群像预设生成器 · 基于 Uranus 原版出厂预设
 *
 * 基线固定为「原版基线-线下预设.json」（Uranus 1.22.x 出厂的 60 条线下预设），
 * 不读玩家自己的预设 —— 保证任何原版玩家装出来的群像预设完全一致、零隐私。
 *
 * 只做群像必需的通用改动，全部不写死任何角色名/称呼/模型/key：
 *   1. ① 身份定义：单人 → 多人（出场者从舞台卡的 <Character> 段读，不点名）
 *   2. ③ 角色资料前置：单数「他」→ 出场者们；原文「你」指本人 → 换成名字
 *   3. ㉑ 叙事规范：主观视角 → 摄影机视角（群像头号铁律）
 *   4. ㉓ 对话增加：{{char}} 每段四次 → 出场者们轮流开口
 *   5. 人称：保持第二人称 ON / 第三人称 OFF（「你」只指用户，出场者用名字）
 *   6. ㊸ 状态栏：{{char}}/{{user}} 两行 → 本场出场者各自一行（动态名单）
 *   7. 追加一条通用「群像纪律」（不点名任何人）
 *   8. 状态栏正则：写死 {{char}}/{{user}} 的四条 → 一条通用「成员」匹配
 *
 * 设计原则：条目名找不到就跳过（兼容原版各小版本），绝不因此中止。
 *
 * 用法：
 *   node 生成群像预设.mjs            # 生成（已存在则报错）
 *   node 生成群像预设.mjs --force    # 覆盖重装
 *   node 生成群像预设.mjs --dry      # 只算不写
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(HERE, "原版基线-线下预设.json");
const OUT = path.join(HERE, "03-群像预设成品.json");
const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry");

const fail = (m) => { console.error("✗ " + m); process.exit(1); };
if (!fs.existsSync(BASE)) fail("找不到原版基线-线下预设.json");

const base = JSON.parse(fs.readFileSync(BASE, "utf8"));
const p = JSON.parse(JSON.stringify(base));
p.id = "ps-3";
p.name = "群像默认预设";

const notes = [];
const entries = Array.isArray(p.entries) ? p.entries : [];
const find = (frag) => entries.find((e) => String(e?.name ?? "").includes(frag));
const swap = (e, from, to, tag) => {
  if (!e || typeof e.content !== "string" || !e.content.includes(from)) return false;
  e.content = e.content.replace(from, to);
  notes.push("· " + tag);
  return true;
};

// 1. 身份定义：单人 → 多人（不写死名字，名单由舞台卡的 <Character> 段给出）
{
  const e = find("身份定义") || find("身份确认");
  if (e) swap(e,
    "{{char}} 是你要在这个世界里演活的人。",
    "这一次你要同时写活本场出场的几个人 —— 名单和各自的完整人设在下方 <Character> 段逐个列出，每段以「【名字】」开头。他们各有各的声音，谁也不能被写成另一个人的影子。名单里没有的人＝不在场，一个字都不许写他。",
    "身份措辞→多人（不点名）");
}

// 2. 角色资料前置：单数 → 多人 + 「你」指本人要换名
{
  const e = find("角色资料前置");
  if (e) {
    swap(e,
      "以下是 {{char}} 这个人的全部资料。你要把它当成一个活人来读 —— 记住他的说话习惯、脾气、身体的小动作，而不是记住一串标签。\n\n演他的时候，你从他的眼睛往外看：他知道的你才知道，他不知道的你不能替他知道。",
      "以下是本场出场者各自的完整资料，每人一段，以「【名字】」开头。把每一份都当成一个活人来读 —— 记住他自己的说话习惯、脾气、身体的小动作，绝不把 A 的特征安到 B 身上。\n\n演的时候，你是一台摄影机：只写看得见的动作、听得见的话，不写任何人的内心。特别记住 —— 每份资料里凡是出现「你」，指的都是那一份资料的主人本人，不是 {{user}}；写进正文一律换成名字或「他」。",
      "角色资料前置→多人+摄影机+「你」换名");
  }
}

// 3. 叙事规范：主观视角 → 摄影机（群像头号铁律）
{
  const e = find("叙事规范");
  if (e) {
    swap(e,
      "每一段里 {{char}} 至少要说一次话，而且要像真人说话",
      "每一段里在场的出场者至少要有一个人开口，说话的人不必是上一段那个，而且要像真人说话",
      "叙事规范·台词人→在场者");
    swap(e,
      "你从 {{char}} 的主观视角推进故事，叙述里的信息只限于他知道的范围。他不知道的事、{{user}} 心里想的东西，你都不能写。这是悬念的来源。",
      "你是一台摄影机。只写看得见的动作、听得见的话、闻得到的气味，不写任何人的内心。谁心里想什么，从表情、停顿、手上的动作里让读者自己看出来。这条也管住了每个人的知情范围：不在场的人不该知道的事，不许出现在任何人的嘴里。",
      "主观视角→摄影机");
  }
}

// 4. 对话增加：{{char}} 每段开口四次 → 出场者们轮流开口
{
  const e = find("对话增加");
  if (e) swap(e,
    "- {{char}} 每一段至少开口四次。其中至少有一次是连着说两句以上（他一口气说完一件事）。\n- 不要让 {{char}} 只用一个「嗯」「哦」就过掉一整段。",
    "- 本场出场的角色每一段合起来至少开口四次，且轮流说 —— 别让同一个人承包整段的台词。其中至少有一次是连着说两句以上（一口气说完一件事）。\n- 不要让整段只有「嗯」「哦」就过掉；但也不是人人都得开口 —— 沉默的人照样要在场、有动作。",
    "对话增加→出场者轮流");
}

// 5. 人称：保持第二人称 ON / 第三人称 OFF（原版即如此，「你」只指用户，出场者用名字）
{
  const second = find("第二人称限制");
  const third = find("第三人称限制");
  if (second) {
    second.enabled = true;
    swap(second,
      "{{user}} 第二人称 —— 正文里提到 {{user}} 一律用「你」来代替。",
      "{{user}} 第二人称 —— 正文里提到 {{user}} 一律用「你」，不要写名字、不要写「她」、不要写「他」。\n\n本场有多个人同场，也照样用「你」：这个「你」只指 {{user}} 一个人；其他出场者一律用各自的名字或「他」，不用「你」指代他们中的任何一个。人多不是改回第三人称的理由。\n\n- 可以写「你」眼前所见、所在的位置、被怎样对待，但不许替「你」写新的动作、决定、台词或心理。\n- 出场者开口称呼 {{user}} 时仍按各自原文里的称呼设定，这一条只管叙述人称，不管台词里的称呼。\n- 状态栏、人物名单等非正文部分照原格式写名字，不受这一条约束。",
      "第二人称→加固（多人也用「你」）");
  }
  if (third) { third.enabled = false; notes.push("· 第三人称保持关闭"); }
}

// 6. ㊸ 状态栏：{{char}}/{{user}} 两行 → 本场出场者各自一行（动态名单，不点名）
{
  const e = find("状态栏（固定格式）") || find("状态栏");
  if (e) {
    const from = "<status>\n时间：<具体到几时几分>\n天气：<晴/阴/雨/雪……气温与体感>\n地点：<具体到房间或街角>\n{{char}}衣着：<从上到下，写清颜色与状态>\n{{user}}衣着：<从上到下，写清颜色与状态>\n{{char}}姿势：<身体此刻的位置与姿态>\n{{user}}姿势：<身体此刻的位置与姿态>\n</status>";
    const to = "<status>\n时间：<具体到几时几分>\n天气：<晴/阴/雨/雪……气温与体感>\n地点：<具体到房间或街角>\n<本场每一位出场者各两行，用他自己的名字，名字不带任何前缀后缀；顺序照提示词里 <StatusFormat> 段，没有这一段就照 <Character> 段的名单：>\n<名字>衣着：<从上到下，写清颜色与状态>\n<名字>姿势：<身体此刻的位置与姿态>\n</status>";
    if (swap(e, from, to, "状态栏名单→本场出场者动态")) {
      // 同步替换状态栏规矩里写死 {{user}} 两行的那句
      swap(e,
        "- {{user}} 的那两行只写他已经写出来的样子。他没穿什么、没做什么，你不许替他填 —— 宁可这一项写「维持上一段的状态」，也不许替他换一身衣服。",
        "- {{user}} 若本场出场，他那两行只写他已经写出来的样子，不许替他填 —— 宁可写「维持上一段的状态」，也不许替他换衣服。",
        "状态栏规矩→通用");
      swap(e,
        "- 中间这七行一个字都不能改 —— 行首的标签、冒号都用上面写好的。",
        "- 时间/天气/地点三行的标签固定；出场者各行用他自己的名字做行首，名字＋「衣着」或「姿势」＋冒号，冒号后填内容。\n- 提示词里有 <StatusFormat> 段时，行的名字与顺序一律照它（那一段是按本场出场者现场生成的）；**它里面没有的人，一行都不许出现**，哪怕上一轮状态栏里写过他，也不沿用、不补写、不留空行占位。",
        "状态栏格式说明→通用");
      swap(e,
        "另起一段输出状态栏。**格式固定，一行一项，一项都不能少、不能换位置：**",
        "另起一段输出状态栏。**一行一项，顺序照下面的格式；出场者有几个人就写几组，名单和顺序照 <Character> 段：**",
        "状态栏开头说明→通用");
    }
  }
}

// 7. 追加通用群像纪律（不点名任何人，插在「角色资料前置」之后）
{
  const disc = {
    id: "e-group-ensemble",
    kind: "custom",
    name: "㉗-0 群像纪律（多人同场专用）",
    enabled: true,
    role: "",
    content: `<群像纪律>
本场有多个人同时在场。下面是硬规矩：

一、**每轮只让一到两个人真正推动。** 其余人在场但不发言 —— 有动作、被拍进画面、在听。所有人轮流发表意见＝开会，这是群像最难看的样子。

二、**台词一律写成「名字：『台词』」。** 用名字，不用「他」「那个人」代替；名字不加任何前缀后缀。

三、**沉默必须写出来。** 谁不接话、谁在听、谁走开了，都要交代 —— 不许让一个人凭空消失几段再冒出来。

四、**每个人对同一件事有不同理解。** 不许所有人都同意 {{user}}，也不许都站同一边。有人护、有人冷眼、有人和稀泥、有人只想回家 —— 分歧本身就是戏。

五、**称呼绝不串。** 每个人叫 {{user}} 的方式不同，严格照各自人设原文，错了就是人写错了。

六、**不许有人变成解说员。** 没有人会说「你们应该好好谈谈」「我觉得她需要空间」。他们只会做、会说、会走开。

七、**物理位置要清楚。** 谁站着谁坐着、谁在谁旁边、谁挡在谁前面 —— 读完一段要能画出现场图。

八、**镜头只拍看得见的。** 不写任何人的内心独白，心里的事从手上、从停顿、从呼吸里透出来。

九、**正文里不写键盘符号。** ㅋㅋ、ㅡㅡ、ㅗ、ㅠㅠ、^^ 这类是打字时才有的，写进正文要化成动作或神情。
</群像纪律>`,
  };
  if (!entries.some((e) => e.id === "e-group-ensemble")) {
    const at = entries.findIndex((e) => String(e?.name ?? "").includes("角色资料前置"));
    entries.splice(at < 0 ? entries.length : at + 1, 0, disc);
    notes.push("· 追加通用「群像纪律」一条");
  }
}

// 8. 状态栏正则：删掉写死 {{char}}/{{user}} 的四条，换成一条通用「成员」匹配
{
  const rx = Array.isArray(p.regex) ? p.regex : [];
  const isMemberLine = (r) => /状态栏 · \{\{(char|user)\}\}(衣着|姿势)/.test(String(r?.name ?? ""));
  const removed = rx.filter(isMemberLine).length;
  if (removed && !rx.some((r) => r?.id === "rx-group-member")) {
    const generic = {
      id: "rx-group-member",
      name: "状态栏 · 成员衣着/姿势",
      enabled: true,
      find: "^([^：\\n]{1,12})(衣着|姿势)：\\s*(.*)$",
      flags: "gm",
      replace: '<div style="display:flex;gap:8px;padding:2px 0;line-height:1.5"><div style="flex:0 0 5.2em;opacity:.55">$1$2</div><div style="flex:1;min-width:0">$3</div></div>',
      targets: ["aiOutput"],
      toUser: true,
      toHistory: false,
    };
    p.regex = rx.filter((r) => !isMemberLine(r));
    p.regex.push(generic);
    notes.push(`· 状态栏正则：${removed} 条写死角色 → 1 条通用匹配`);
  }
}

// —— 落地 ——
console.log("=".repeat(10) + " 群像预设生成（基于原版出厂预设） " + "=".repeat(10));
console.log("基线：" + BASE);
console.log("输出：" + OUT + "（id=ps-3）");
console.log("条目 " + entries.length + " 条，正则 " + (p.regex?.length ?? 0) + " 条");
console.log("改动：");
notes.forEach((n) => console.log("  " + n));
if (!notes.length) console.log("  （本版本预设已符合群像要求，无需改动）");
if (DRY) { console.log("（--dry：未写盘）"); process.exit(0); }
if (fs.existsSync(OUT) && !FORCE) fail("成品已存在，要覆盖加 --force");
if (fs.existsSync(OUT)) fs.copyFileSync(OUT, OUT + ".bak-" + Date.now());
fs.writeFileSync(OUT, JSON.stringify(p, null, 2) + "\n", "utf8");
console.log("✓ 群像预设成品已生成：" + OUT);
