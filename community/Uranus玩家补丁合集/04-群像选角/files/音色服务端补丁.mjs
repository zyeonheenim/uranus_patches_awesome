#!/usr/bin/env node
/**
 * [群像音色补丁] server/src/index.js —— /api/offline/:roleKey/voice 认 speaker
 *
 * 原版的线下语音一律用「当前角色」的音色。群像里一句台词是谁说的由前端带在
 * speaker 字段里（只是名字，不带音色编号/密钥）；这里按名字在配置里查那个人
 * 的角色卡，用他自己的 voiceSend 音色念。认不出来就退回当前角色，和从前一样。
 *
 * 那个人没填音色 = 用 TTS 服务默认音色，不占别人的声音。
 * 幂等：改动带 voicecast 标记，重复跑自动跳过。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.URANUS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILE = path.join(ROOT, "server", "src", "index.js");
const M = "voicecast";
const DRY = process.argv.includes("--dry");
let raw = fs.readFileSync(FILE, "utf8");

if (raw.includes(`/* ${M}:server */`)) {
  console.log("  跳过 voice 路由（已打过）");
} else {
  const from = `  const voiceId = ctx.role.voiceSend?.voiceId ?? "";
  try {
    const out = await synthesizeVoice(ctx.config.ttsApi, voiceId, text, "线下语音", {
      language: ctx.role.voiceSend?.language,
      accent: ctx.role.voiceSend?.accent,
    });`;
  const c = raw.split(from).length - 1;
  if (c !== 1) throw new Error(`voice 路由锚点命中 ${c} 次，中止（服务端版本不同，别硬打）`);
  const to = `  const voiceId = ctx.role.voiceSend?.voiceId ?? "";
  /*
   * 群像：一句台词是谁说的，就用那个人自己角色卡的音色念。
   * 请求只带名字 speaker，音色和凭据一律从已保存配置读；名字认不出来就退回
   * 当前角色。没填音色的人用 TTS 默认音色，不占别人的声音。
   */
  const speaker = String(req.body?.speaker ?? "").trim(); /* ${M}:server */
  let voice = { voiceId, language: ctx.role.voiceSend?.language, accent: ctx.role.voiceSend?.accent };
  if (speaker) {
    const sp = (ctx.config?.roles ?? []).find((r) => r?.name === speaker);
    if (sp) {
      voice = {
        voiceId: sp.voiceSend?.voiceId ?? "",
        language: sp.voiceSend?.language ?? voice.language,
        accent: sp.voiceSend?.accent ?? voice.accent,
      };
    }
  }
  try {
    const out = await synthesizeVoice(ctx.config.ttsApi, voice.voiceId, text, "线下语音", {
      language: voice.language,
      accent: voice.accent,
    });`;
  raw = raw.replace(from, to);
  if (!DRY) fs.writeFileSync(FILE, raw, "utf8");
  console.log(`  ✓ voice 路由认 speaker${DRY ? "（预演）" : ""}`);
}
console.log(DRY ? "\n（预演完成）" : "\n✓ 音色服务端补丁完成");
