#!/usr/bin/env node
/**
 * [群像选角补丁] client/src/panels/offline.jsx —— 新建剧情时勾选出场角色（幂等）
 * 勾选只出现在「开启新剧情」，默认全不选＝老行为（单角色，和以前一样）；
 * 勾了人 → castRoleIds 一起 POST，服务端据此现场读那些单人卡的人设。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.URANUS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILE = path.join(ROOT, "client", "src", "panels", "offline.jsx");
const MARK = "castpatch";
const DRY = process.argv.includes("--dry");
let raw = fs.readFileSync(FILE, "utf8");
let n = 0;
function rep(name, from, to, already) {
  if (already && raw.includes(already)) { console.log(`  跳过 ${name}（已打过）`); return; }
  const c = raw.split(from).length - 1;
  if (c !== 1) throw new Error(`${name} 锚点命中 ${c} 次，中止（前端版本可能不同，别硬打）`);
  raw = raw.replace(from, to); n++;
  console.log(`  ✓ ${name}`);
}

// ① state
rep("加 castDraft state",
`  const [naming, setNaming] = useState(""); // "" | "new" | "rename"
  const [nameDraft, setNameDraft] = useState("");`,
`  const [naming, setNaming] = useState(""); // "" | "new" | "rename"
  const [nameDraft, setNameDraft] = useState("");
  const [castDraft, setCastDraft] = useState([]); /* ${MARK}:cast-draft */`,
`/* ${MARK}:cast-draft */`);

// ② newStory 传 castRoleIds
rep("newStory 带上 castRoleIds",
`    const r = await run("/story", { method: "POST", body: { name } });
    if (r?.ok) setNote("新剧情开好了，上一条还在左边的列表里。");`,
`    const r = await run("/story", { method: "POST", body: { name, castRoleIds: castDraft } }); /* ${MARK}:newstory-post */
    if (r?.ok) setNote(castDraft.length ? \`新剧情开好了，本场 \${castDraft.length} 人出场。\` : "新剧情开好了，上一条还在左边的列表里。");`,
`/* ${MARK}:newstory-post */`);

// ③ 新建按钮点开时清空勾选
rep("新建时重置勾选",
`                      onClick={() => {
                        setNameDraft("");
                        setNaming("new");
                      }}`,
`                      onClick={() => {
                        setNameDraft("");
                        setCastDraft([]); /* ${MARK}:reset-cast */
                        setNaming("new");
                      }}`,
`/* ${MARK}:reset-cast */`);

// ④ NameDialog 组件签名加 cast props + 渲染勾选列表
rep("NameDialog 支持勾选列表",
`function NameDialog({ title, desc, label, value, onValue, busy, onClose, onConfirm }) {
  return (`,
`function NameDialog({ title, desc, label, value, onValue, busy, onClose, onConfirm, castRoles, castIds, onToggleCast }) { /* ${MARK}:namedialog-props */
  return (`,
`/* ${MARK}:namedialog-props */`);

rep("NameDialog 渲染勾选框",
`      <Field label={label} hint="留空就用「剧情 N」">
        <input
          autoFocus
          className={inputCls}
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm();
          }}
          placeholder="例如：雨夜的便利店"
        />
      </Field>
    </Modal>`,
`      <Field label={label} hint="留空就用「剧情 N」">
        <input
          autoFocus
          className={inputCls}
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm();
          }}
          placeholder="例如：雨夜的便利店"
        />
      </Field>
      {Array.isArray(castRoles) && castRoles.length > 0 && ( /* ${MARK}:cast-checkboxes */
        <Field label="本场出场" hint="不勾＝按单人演；勾了＝这几个人的台词同时写">
          <div className="flex flex-wrap gap-2">
            {castRoles.map((r) => {
              const on = castIds.includes(r.id);
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => onToggleCast(r.id)}
                  className={\`rounded-full border px-3 py-1 text-xs transition-colors \${on ? "border-ink bg-ink text-paper" : "border-line bg-paper/55 text-ink-soft hover:border-ink-soft"}\`}
                >
                  {on ? "✓ " : ""}{r.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
    </Modal>`,
`/* ${MARK}:cast-checkboxes */`);

// ⑤ 调用处传 props
rep("调用处传 cast props",
`          onClose={() => setNaming("")}
          onConfirm={naming === "new" ? newStory : renameStory}
        />`,
`          onClose={() => setNaming("")}
          onConfirm={naming === "new" ? newStory : renameStory}
          castRoles={naming === "new" ? (config?.roles ?? []).filter((r) => r.id !== state?.roleId) : []} /* ${MARK}:call-cast-roles */
          castIds={castDraft}
          onToggleCast={(id) => setCastDraft((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])}
        />`,
`/* ${MARK}:call-cast-roles */`);

// ⑦ 常驻出场 UI：castToggle 回调（读/改当前剧情 castRoleIds）
rep("加 castToggle 回调",
`  const hasStory = Boolean(story);
  const turns = story?.turns ?? [];
  const roleName = state?.roleName?.trim() || (role ? roleLabel(role) : "未命名角色");`,
`  const hasStory = Boolean(story);
  const turns = story?.turns ?? [];
  /* ${MARK}:cast-toggle */
  // 群像选角：当前剧情的出场名单（主面板常驻选择器用）。只有舞台卡显示那一条。
  const isCastStage = state?.roleId === "r-cast-stage";
  const castIds = Array.isArray(story?.castRoleIds) ? story.castRoleIds : [];
  // 不能包 useCallback：run 在下面才用 const 声明，依赖数组此刻读它会触发 TDZ → 整页白屏。
  // 普通函数体内引用 run 延迟到点击时求值，那时已初始化，安全。
  const castToggle = async (id) => {
    if (!sid || busy) return;
    const next = castIds.includes(id) ? castIds.filter((x) => x !== id) : [...castIds, id];
    await run(\`/story/\${encodeURIComponent(sid)}\`, { method: "PATCH", body: { castRoleIds: next } });
  };
  const roleName = state?.roleName?.trim() || (role ? roleLabel(role) : "未命名角色");`,
`/* ${MARK}:cast-toggle */`);

// ⑧ 剧情下拉下方插入常驻「本场出场」面板
rep("主面板常驻出场选择器",
`                    <Button
                      variant="ghost"
                      disabled={busy || !sid}
                      onClick={() =>
                        run(\`/story/\${encodeURIComponent(sid)}\`, { method: "DELETE" })
                      }
                      className="text-warn hover:bg-warn/[0.08]"
                    >
                      <Trash2 size={14} /> 删掉这条剧情
                    </Button>
                  </div>
                )}
              </div>`,
`                    <Button
                      variant="ghost"
                      disabled={busy || !sid}
                      onClick={() =>
                        run(\`/story/\${encodeURIComponent(sid)}\`, { method: "DELETE" })
                      }
                      className="text-warn hover:bg-warn/[0.08]"
                    >
                      <Trash2 size={14} /> 删掉这条剧情
                    </Button>
                  </div>
                )}

                {/* ${MARK}:cast-panel —— 群像舞台：常驻「本场出场」选择器，开没开戏都在，一眼可见 */}
                {isCastStage && sid && (
                  <div className="rounded-xl border border-line/70 bg-paper/55 p-3 backdrop-blur-sm">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-body font-medium text-ink">本场出场</p>
                      <p className="text-meta text-ink-soft">
                        {castIds.length
                          ? \`已选 \${castIds.length} 人 · 点名字可增减，下一轮生效\`
                          : "未选＝按单人演 · 点下面的名字选出场"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(config?.roles ?? [])
                        .filter((r) => r.id !== state?.roleId)
                        .map((r) => {
                          const on = castIds.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              disabled={busy}
                              onClick={() => castToggle(r.id)}
                              className={\`rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 \${
                                on
                                  ? "border-ink bg-ink text-paper"
                                  : "border-line bg-paper/70 text-ink-soft hover:border-ink-soft hover:text-ink"
                              }\`}
                            >
                              {on ? <Check size={12} className="mr-1 inline" /> : null}{r.name}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>`,
`/* ${MARK}:cast-panel */`);

if (n && !DRY) fs.writeFileSync(FILE, raw, "utf8");
console.log(n ? `\n✓ 前端补丁完成，共 ${n} 处${DRY ? "（预演）" : ""}；记得 npm run build` : "\n＝ 已全部打过");
