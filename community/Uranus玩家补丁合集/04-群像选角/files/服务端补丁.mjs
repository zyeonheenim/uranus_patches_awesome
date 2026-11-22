#!/usr/bin/env node
/**
 * [群像选角补丁] 服务端 4 处精准替换 —— 可重复运行（幂等）
 *
 * 做了什么：
 *  1. offlinestore.js normalizeStory：白名单加 castRoleIds 字段（否则存档一读就丢）
 *  2. offlinestore.js newStory：接收 castRoleIds 并存进新剧情
 *  3. index.js POST /story：从请求体读 castRoleIds 传给 newStory
 *  4. prompt.js case "char"：有 castRoleIds 时把 Character 段换成
 *     「导演卡说明 + 现场读每张勾选单人卡的 description + 人称转换声明」
 *
 *  defensive：每处替换前校验锚点唯一；已打过则跳过；任何一处失败 → 抛错退出，
 *  安装脚本据此回滚。不整文件覆盖，绝不碰无关代码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.URANUS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = path.join(ROOT, "server", "src");
const MARK = "castpatch";
const DRY = process.argv.includes("--dry");

function edit(file, pairs) {
  const full = path.join(SRC, file);
  let raw = fs.readFileSync(full, "utf8");
  let changed = 0;
  for (const { name, from, to, already, variants } of pairs) {
    if (already && raw.includes(already)) {
      console.log(`  跳过 ${file} :: ${name}（已打过）`);
      continue;
    }
    // variants: [[from, to], ...] —— 多版本兼容，取第一个「恰好命中一次」的
    if (variants) {
      let done = false;
      for (const [vf, vt] of variants) {
        if (raw.split(vf).length - 1 === 1) {
          raw = raw.replace(vf, vt);
          done = true;
          break;
        }
      }
      if (!done) throw new Error(`${file} :: ${name} 所有候选锚点都没唯一命中，中止。文件版本可能不认识。`);
      changed++;
      console.log(`  ✓ ${file} :: ${name}（多版本兼容）`);
      continue;
    }
    const count = raw.split(from).length - 1;
    if (count !== 1) {
      throw new Error(`${file} :: ${name} 锚点命中 ${count} 次（应为 1），中止以免改错。文件可能被升级过。`);
    }
    raw = raw.replace(from, to);
    changed++;
    console.log(`  ✓ ${file} :: ${name}`);
  }
  if (changed && !DRY) fs.writeFileSync(full, raw, "utf8");
  return changed;
}

let total = 0;

// ── 1+2. offlinestore.js ──────────────────────────────────
total += edit("offlinestore.js", [
  {
    name: "normalizeStory 保留 castRoleIds",
    already: `/* ${MARK}:normalize-story */`,
    from: `    roleId: str(raw?.roleId),
    name: str(raw?.name),
    presetRef: str(raw?.presetRef),`,
    to: `    roleId: str(raw?.roleId),
    name: str(raw?.name),
    presetRef: str(raw?.presetRef),
    castRoleIds: (Array.isArray(raw?.castRoleIds) ? raw.castRoleIds : []).map((x) => str(x)).filter(Boolean), /* ${MARK}:normalize-story */`,
  },
  {
    name: "newStory 接收并存储 castRoleIds",
    already: `/* ${MARK}:newstory-cast */`,
    from: `export function newStory(roleKey, { roleId = "", presetRef = "", name = "" } = {}) {`,
    to: `export function newStory(roleKey, { roleId = "", presetRef = "", name = "", castRoleIds = [] } = {}) { /* ${MARK}:newstory-cast */`,
  },
  {
    name: "newStory 把 castRoleIds 写进 story 对象",
    already: `/* ${MARK}:story-cast-write */`,
    from: `      presetRef,
      startedAt: new Date().toISOString(),
    },
    id
  );
  if (!writeStory(story)) return null;`,
    to: `      presetRef,
      startedAt: new Date().toISOString(),
      castRoleIds: (Array.isArray(castRoleIds) ? castRoleIds : []).map((x) => str(x)).filter(Boolean), /* ${MARK}:story-cast-write */
    },
    id
  );
  if (!writeStory(story)) return null;`,
  },
]);

// ── 3. index.js /story 接口读请求体 ───────────────────────
total += edit("index.js", [
  {
    name: "POST /story 传 castRoleIds",
    already: `/* ${MARK}:story-route-cast */`,
    from: `  const story = newStory(ctx.roleKey, {
    roleId: ctx.role.id,
    presetRef: ctx.role.offline?.presetRef ?? "",
    name: String(req.body?.name ?? ""),
  });`,
    to: `  const castRaw = req.body?.castRoleIds; /* ${MARK}:story-route-cast */
  const story = newStory(ctx.roleKey, {
    roleId: ctx.role.id,
    presetRef: ctx.role.offline?.presetRef ?? "",
    name: String(req.body?.name ?? ""),
    castRoleIds: Array.isArray(castRaw) ? castRaw : [],
  });`,
  },
]);

// ── 4. prompt.js case "char" 动态注入 ─────────────────────
total += edit("prompt.js", [
  {
    name: "buildPrompt 从 opts 接 castRoleIds",
    already: `/* ${MARK}:buildprompt-cast-opts */`,
    from: `  const offline = opts?.mode === "offline";`,
    to: `  const offline = opts?.mode === "offline";
  const castRoleIds = (Array.isArray(opts?.castRoleIds) ? opts.castRoleIds : []).map((x) => String(x)); /* ${MARK}:buildprompt-cast-opts */`,
  },
  {
    name: "case char 动态拼装 Character 段",
    already: `/* ${MARK}:char-cast-inject */`,
    from: `      case "char":
        // 人设原文直接注入。角色名要出现在提示词里就在正文里写 {{char}}
        parts.push({ role: "system", content: wrap("Character", fill(role?.description)) });
        break;`,
    to: `      case "char": {
        // 人设原文直接注入。角色名要出现在提示词里就在正文里写 {{char}}
        /* ${MARK}:char-cast-inject */
        let charText = fill(role?.description);
        if (offline && castRoleIds.length) {
          const picked = castRoleIds
            .map((id) => config?.roles?.find((r) => r.id === id))
            .filter(Boolean);
          if (picked.length) {
            const blocks = picked.map((r) =>
              \`\\n\\n### 【\${r.name}】的人设原文 —— 其中「你」＝\${r.name} 本人\\n\${fill(r.description || "")}\`
            ).join("");
            charText =
              charText +
              "\\n\\n## 本场出场者（下面每段人设里的「你」＝那个人本人，输出一律换成名字或「他」）" +
              blocks +
              "\\n\\n## 人称转换（本场）\\n本段每个人设里的「你」都指那个人本人，不是 {{user}}。正文里提到出场者一律用名字或「他」；提到 {{user}} 一律用「你」。";
          }
        }
        parts.push({ role: "system", content: wrap("Character", charText) });
        break;
      }`,
  },
]);

// ── 5. offlinestore.js 导出 setCast（指令兜底用） ──────────
total += edit("offlinestore.js", [
  {
    name: "导出 setCast",
    already: `/* ${MARK}:setcast */`,
    from: `/** 切到另一条剧情（网页上换剧情看/接着演）。那条不存在就不动。 */`,
    to: `/* ${MARK}:setcast */
/** [群像选角] 设置一条剧情的出场名单（id 数组）。 */
export function setCast(storyId, castRoleIds) {
  return patchStory(storyId, (s) => ({
    ...s,
    castRoleIds: (Array.isArray(castRoleIds) ? castRoleIds : []).map((x) => str(x)).filter(Boolean),
  }));
}

/** 切到另一条剧情（网页上换剧情看/接着演）。那条不存在就不动。 */`,
  },
]);

// ── 6. offline.js import setCast ──────────────────────────
total += edit("offline.js", [
  {
    name: "import setCast",
    already: `/* ${MARK}:import-setcast */`,
    from: `  setCurrent,
} from "./offlinestore.js";`,
    to: `  setCurrent,
  setCast, /* ${MARK}:import-setcast */
} from "./offlinestore.js";`,
  },
]);

// ── 7. offline.js 指令兜底：解析【出场：…】并剥掉 ──────────
total += edit("offline.js", [
  {
    name: "落盘前解析出场指令",
    already: `/* ${MARK}:parse-cast-cmd */`,
    from: `    if (!said.trim()) throw new Error("这一轮没有内容可发");

    const filtered = applyAndLog(`,
    to: `    if (!said.trim()) throw new Error("这一轮没有内容可发");

    /* ${MARK}:parse-cast-cmd */
    const castCmd = said.match(/\\u3010\\u51fa\\u573a\\uff1a([^\\u3011]+)\\u3011/);
    if (castCmd) {
      const wanted = castCmd[1].split(/[\\u3001,,\\s]+/).map((s) => s.trim()).filter(Boolean);
      const ids = wanted
        .map((nm) => (config?.roles ?? []).find((r) => r.name === nm || String(r.name).toLowerCase() === nm.toLowerCase()))
        .filter(Boolean)
        .map((r) => r.id);
      if (ids.length) setCast(story.id, ids);
      said = said.replace(castCmd[0], "").trim();
      if (!said) said = "\\u7ee7\\u7eed"; // 只发了指令没别的，给个占位免得空消息
    }

    const filtered = applyAndLog(`,
  },
]);

// ── 8. offline.js 把 story.castRoleIds 传给 buildPrompt ───
total += edit("offline.js", [
  {
    name: "runOfflineTurn 传 castRoleIds 给 buildPrompt",
    already: `/* ${MARK}:offline-pass-cast */`,
    // 兼容两代写法：1.22.2 的 historyOf(story, role) 和 1.22.7+ 的 historyOf(story, role, config)
    variants: [
      [
        `    built = await buildPrompt(config, role, user, historyOf(story, role, config), weatherNote, {
      mode: "offline",
    });`,
        `    built = await buildPrompt(config, role, user, historyOf(story, role, config), weatherNote, {
      mode: "offline",
      castRoleIds: story?.castRoleIds ?? [], /* ${MARK}:offline-pass-cast */
    });`,
      ],
      [
        `    built = await buildPrompt(config, role, user, historyOf(story, role), weatherNote, {
      mode: "offline",
    });`,
        `    built = await buildPrompt(config, role, user, historyOf(story, role), weatherNote, {
      mode: "offline",
      castRoleIds: story?.castRoleIds ?? [], /* ${MARK}:offline-pass-cast */
    });`,
      ],
    ],
  },
]);

// ── 9+10. index.js：PATCH 接口支持改当前剧情的出场名单 ─────
total += edit("index.js", [
  {
    name: "导入 setCast",
    already: `/* ${MARK}:import-setcast-api */`,
    from: `  saveMedia as saveOfflineMedia,
  setCurrent,
  updateSummary,`,
    to: `  saveMedia as saveOfflineMedia,
  setCast, /* ${MARK}:import-setcast-api */
  setCurrent,
  updateSummary,`,
  },
  {
    name: "PATCH /story 支持 castRoleIds",
    already: `/* ${MARK}:patch-cast-api */`,
    from: `  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "剧情名不能是空的" });
  renameStory(ctx.roleKey, storyId, name);
  res.json({ ok: true, ...offlineState(ctx.config, ctx.role, ctx.roleKey) });
});`,
    to: `  const name = String(req.body?.name ?? "").trim();
  /* ${MARK}:patch-cast-api */
  // 群像选角：前端主面板的点选用这条随时改「本场出场」。name 空=只改出场；castRoleIds 不给=只改名。
  const hasCast = Object.prototype.hasOwnProperty.call(req.body ?? {}, "castRoleIds");
  if (!name && !hasCast) return res.status(400).json({ ok: false, error: "剧情名不能是空的" });
  if (name) renameStory(ctx.roleKey, storyId, name);
  if (hasCast) {
    const raw = req.body.castRoleIds;
    setCast(storyId, Array.isArray(raw) ? raw : []);
  }
  res.json({ ok: true, ...offlineState(ctx.config, ctx.role, ctx.roleKey) });
});`,
  },
]);

// ── 11. offline.js endOffline：群像舞台卡结束时后台触发收工 ────
total += edit("offline.js", [
  {
    name: "endOffline 触发群像收工",
    already: `castpatch:closeout-stage`,
    variants: [
      [
        `  endStory(roleKey, storyId);\n  /*`,
        `  endStory(roleKey, storyId);
  /* ${MARK}:closeout-trigger */
  // 群像舞台卡结束、按天合并落库后，后台补「群像大总结 + 在场者 POV」（脚本自带幂等）
  if (roleKey === "role-r-cast-stage" && storyId) {
    try {
      const [{ spawn }, fsNode, { fileURLToPath }] = await Promise.all([
        import("node:child_process"), import("node:fs"), import("node:url"),
      ]);
      const script = fileURLToPath(new URL("../../patches/uranus群像收工.mjs", import.meta.url));
      const logPath = fileURLToPath(new URL("../../群像收工.log", import.meta.url));
      const out = fsNode.openSync(logPath, "a");
      const child = spawn(process.execPath, [script, "--story", storyId], {
        detached: true, stdio: ["ignore", out, out], env: process.env,
      });
      child.unref(); fsNode.closeSync(out);
    } catch (e) { logWarn(SCOPE, "群像收工后台启动失败（不影响结束流程）", e); }
  }
  /*`,
      ],
    ],
  },
]);

console.log(total ? `\n✓ 服务端补丁完成，共 ${total} 处${DRY ? "（预演，未写盘）" : ""}` : "\n＝ 无需改动，已全部打过");
