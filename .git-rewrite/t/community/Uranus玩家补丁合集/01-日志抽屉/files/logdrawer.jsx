/*
 * 常驻「运行日志」抽屉。
 *
 * 痛点：线下模式等 API 出字时，页面一片空白干等，分不清是「在慢慢生成」还是
 * 「API 已经断了」，只能切去「控制台」面板看日志。这个抽屉把同一份实时日志流
 * （全局 LogProvider 的 SSE，控制台面板也在用）钉在页面角落，任何分区都能看到，
 * 不用切 tab。气泡支持拖到任意位置，落点会记忆到 localStorage，避免挡住视野。
 *
 * 两个状态：
 *  - `open`：展开 / 收成胶囊。收起时只剩一个胶囊，显示连接状态和问题条数角标。
 *  - `defaultOpen`：默认展开偏好（footer 可勾选，localStorage 记忆）。
 *    开启后每次进入页面都自动展开；临时收起只影响本次会话，下次仍以偏好为准。
 *    未开启时保留旧习惯：手动展开一次后会记住，刷新仍展开。
 *
 * 和「控制台」面板的区别：那个是完整版（搜索、复制、清空、账号、服务控制…），
 * 这个是它的「随身缩略」——只取实时日志 + 链路状态，主打「不切页面也能盯着」。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Cpu, Loader2, Pause, Play, Radio, Search, Terminal, Trash2, X } from "lucide-react";
import { api, useConfig, useLogs } from "./store.jsx";
import {
  modelLabel,
  modelOptions,
  parseRefValue,
  providerLabel,
  refValue,
  roleLabel,
} from "./labels.js";
import { inputCls } from "./ui.jsx";
import { LEVEL_FILTERS, LEVEL_META, LEVEL_ORDER, LogRow } from "./panels/console.jsx";

const DRAWER_OPEN_KEY = "uranus.logdrawer.open.v1";
const DRAWER_DEFAULT_OPEN_KEY = "uranus.logdrawer.defaultOpen.v1";
const DRAWER_POS_KEY = "uranus.logdrawer.pos.v1";
const DRAWER_W = 440; // 面板估算宽度，用于展开时越界修正
const DRAWER_EST_H = 430; // 面板估算高度（日志区 300 + 头/工具条/底栏）

/*
 * 模型快切的三档，顺序固定 —— 界面上的排布、切换后的日志文案都按它走。
 *
 * `fallback` 就是角色页里原来那个「副 API」：主模型报错时顶上，**线上和线下
 * 共用同一份**（imessage.js / offline.js 两条路都是主挂退它）。所以它既不是
 * 「聊天」也不是「线下」，必须单独一档，不然用户以为切了聊天模型就把它也换了。
 */
const TARGET_ORDER = ["chat", "offline", "fallback"];
const TARGET_LABEL = { chat: "聊天", offline: "线下", fallback: "兜底" };

/** 读 localStorage 的布尔偏好，读不到返回 fallback。 */
function readBool(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1";
  } catch {
    return fallback;
  }
}

/** 读气泡位置，读不到/非法则默认落在右下角（不再死磕左下）。 */
function readPos() {
  try {
    const raw = window.localStorage.getItem(DRAWER_POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.x === "number" && typeof p.y === "number") return p;
    }
  } catch {
    /* ignore */
  }
  const w = typeof window !== "undefined" ? window.innerWidth : 1280;
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  return { x: Math.max(8, w - 140), y: Math.max(8, h - 64) };
}

export function LiveLogDrawer() {
  const { logs, connected, paused, setPaused, pendingCount, clear } = useLogs();
  const { config, updateConfig } = useConfig();
  const [defaultOpen, setDefaultOpen] = useState(() =>
    readBool(DRAWER_DEFAULT_OPEN_KEY, false)
  );
  const [open, setOpen] = useState(() => {
    // 开了「默认展开」就每次都展开；否则沿用「上次是否展开」的记忆（首次则为关）
    if (defaultOpen) return true;
    return readBool(DRAWER_OPEN_KEY, false);
  });
  const [level, setLevel] = useState("info");
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef(null);

  /* ---------- 模型快切 ---------- */

  const [switcher, setSwitcher] = useState(false);
  const [rolePick, setRolePick] = useState("all");
  const [modelPick, setModelPick] = useState("");
  // 切哪一档：聊天 / 线下 / 兜底，单选。一次只动一套引用，不容易改错
  const [target, setTarget] = useState("chat");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { ok, text }

  const roles = config?.roles ?? [];
  const groups = useMemo(() => (config ? modelOptions(config, "chat") : []), [config]);
  const single = rolePick === "all" ? null : roles.find((r) => r.id === rolePick);

  /** 一条模型引用现在什么状态：能不能用、界面上怎么写。 */
  function refState(ref) {
    if (!ref?.provider || !ref?.modelId) return { text: "", ok: false, empty: true };
    const p = (config?.providers ?? []).find((x) => x.id === ref.provider);
    const m = (p?.models ?? []).find((x) => x.id === ref.modelId);
    if (!p || !m) return { text: "引用已失效", ok: false };
    return { text: `${providerLabel(p)} · ${modelLabel(m)}`, ok: true, off: m.enabled === false };
  }

  /**
   * 某个角色在某一档上现在用的是什么。
   *
   * 返回的 `tag` 是那行右边的小红字，专治两种「看着配了其实没生效」的情况：
   *  - 线下没单独配 → 标「跟着聊天」，值显示它实际会用的聊天模型；
   *  - 兜底没启用 → 明确写「未启用」，因为这时候主模型一挂整轮就失败。
   */
  function targetValue(role, kind) {
    if (kind === "offline") {
      const own = refState(role.offline?.model);
      if (!own.empty) {
        return { text: own.text, tone: own.ok && !own.off ? "normal" : "warn", tag: own.ok ? (own.off ? "已关闭" : "") : "失效" };
      }
      const c = refState(role.chatModel);
      return { text: c.text || "未配", tone: c.ok ? "muted" : "warn", tag: "跟着聊天" };
    }
    if (kind === "fallback") {
      const fb = role.fallbackModel;
      const st = refState(fb);
      if (st.empty) return { text: "未配置", tone: "warn", tag: "没有兜底" };
      if (!fb?.enabled) return { text: st.text, tone: "warn", tag: "未启用" };
      if (!st.ok) return { text: st.text, tone: "warn", tag: "失效" };
      return { text: st.text, tone: st.off ? "warn" : "normal", tag: st.off ? "已关闭" : "" };
    }
    const st = refState(role.chatModel);
    if (!st.ok) return { text: st.text || "未配", tone: "warn", tag: st.empty ? "" : "失效" };
    return { text: st.text, tone: st.off ? "warn" : "normal", tag: st.off ? "已关闭" : "" };
  }

  /** 全部角色时：大家都一样就显示那一个，不一样就说「各人不同」（悬停看明细）。 */
  function summarize(kind) {
    if (!roles.length) return { text: "还没有角色", tone: "warn", tag: "" };
    const list = roles.map((r) => ({ name: roleLabel(r), ...targetValue(r, kind) }));
    const uniq = [...new Set(list.map((x) => `${x.text}|${x.tag}`))];
    if (uniq.length === 1) return list[0];
    return {
      text: `各人不同（${uniq.length} 种）`,
      tone: "muted",
      tag: "",
      detail: list
        .map((x) => `${x.name}：${x.text}${x.tag ? `（${x.tag}）` : ""}`)
        .join("\n"),
    };
  }

  // 「当前」：只显示选中的那一档，值随档位和角色变
  const current = {
    kind: target,
    label: TARGET_LABEL[target],
    ...(single ? targetValue(single, target) : summarize(target)),
  };

  function pickTarget(kind) {
    setTarget(kind);
    setNote(null);
  }

  // 换角色 / 换档位时，把模型下拉预填成它现在用的那个 —— 只看不改也能一眼对上
  useEffect(() => {
    if (!switcher) return;
    setNote(null);
    if (!single) {
      setModelPick("");
      return;
    }
    const ref =
      target === "offline"
        ? single.offline?.model ?? single.chatModel
        : target === "fallback"
          ? single.fallbackModel
          : single.chatModel;
    setModelPick(refValue(ref));
  }, [switcher, rolePick, target]);

  async function applyModel() {
    const ref = parseRefValue(modelPick);
    if (!ref.provider || !ref.modelId) {
      setNote({ ok: false, text: "先在下拉里挑一个模型" });
      return;
    }
    const ids = rolePick === "all" ? roles.map((r) => r.id) : [rolePick];
    if (!ids.length) {
      setNote({ ok: false, text: "没有可切的角色" });
      return;
    }

    setBusy(true);
    setNote(null);
    try {
      const r = await api("/api/role-model", {
        method: "POST",
        body: { roleIds: ids, provider: ref.provider, modelId: ref.modelId, target },
      });
      /*
       * 只改本地草稿里这几个角色的引用 —— 不 reload、不整包替换。
       * reload 会把用户在别的面板里没保存的改动一并冲掉，而这只是切个模型。
       */
      updateConfig((c) => ({
        ...c,
        roles: (c?.roles ?? []).map((x) => {
          if (!ids.includes(x.id)) return x;
          const next = { ...x };
          if (target === "chat") next.chatModel = { ...ref };
          if (target === "offline") {
            next.offline = { ...(x.offline ?? {}), model: { ...ref } };
          }
          if (target === "fallback") {
            // 后端会顺手打开开关，本地草稿跟着对齐，不然界面还显示「未启用」
            next.fallbackModel = { ...(x.fallbackModel ?? {}), ...ref, enabled: true };
          }
          return next;
        }),
      }));
      setNote({ ok: true, text: `${r.where}模型已切到 ${r.model}` });
    } catch (e) {
      setNote({ ok: false, text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  // 右下角那行小字：只报选中那一档当前用的模型
  const currentLine = `${current.label} ${current.text}${current.tag ? `（${current.tag}）` : ""}`;
  const currentTitle = [
    rolePick === "all" ? `全部 ${roles.length} 个角色` : undefined,
    current.detail || `${current.label}：${current.text}${current.tag ? `（${current.tag}）` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  // 气泡位置：可拖动，落点记忆到 localStorage（默认右下角，不再死磕左下）
  const [pos, setPos] = useState(readPos);
  const posRef = useRef(pos);
  posRef.current = pos;
  const [dragging, setDragging] = useState(false);

  /** 生成拖拽手柄：onPointerDown 启动；松手时若几乎没动则当作点击（onTap）。 */
  const makeDrag = (onTap) => (e) => {
    if (e.button != null && e.button !== 0) return; // 只响应左键 / 触摸
    if (e.cancelable) e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseX = posRef.current.x;
    const baseY = posRef.current.y;
    let moved = false;
    setDragging(true);
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) moved = true;
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 48;
      const nx = Math.max(8, Math.min(baseX + dx, maxX));
      const ny = Math.max(8, Math.min(baseY + dy, maxY));
      const next = { x: nx, y: ny };
      posRef.current = next;
      setPos(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      if (!moved && onTap) onTap();
      try {
        window.localStorage.setItem(DRAWER_POS_KEY, JSON.stringify(posRef.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAWER_OPEN_KEY, open ? "1" : "0");
    } catch {
      /* 隐身模式：本次照样展开，只是刷新后记不住 */
    }
  }, [open]);
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAWER_DEFAULT_OPEN_KEY, defaultOpen ? "1" : "0");
    } catch {
      /* 同上 */
    }
  }, [defaultOpen]);

  const minRank = LEVEL_ORDER.indexOf(level);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((e) => {
      if (LEVEL_ORDER.indexOf(e.level) < minRank) return false;
      if (!q) return true;
      return (
        e.message.toLowerCase().includes(q) ||
        e.scope.toLowerCase().includes(q) ||
        (e.detail ?? "").toLowerCase().includes(q)
      );
    });
  }, [logs, minRank, query]);

  // 警告以上条数：收起时当角标，一眼看出「有没有出问题」
  const problemCount = useMemo(
    () =>
      logs.filter(
        (e) => LEVEL_ORDER.indexOf(e.level) >= LEVEL_ORDER.indexOf("warn")
      ).length,
    [logs]
  );

  // 新日志进来贴到底（用户往上翻时不抢滚动条）
  useEffect(() => {
    if (!autoScroll || !open) return;
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [filtered, autoScroll, open]);

  function onScroll() {
    const box = boxRef.current;
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  function collapse() {
    setOpen(false);
  }
  function toggleDefaultOpen() {
    setDefaultOpen((v) => {
      const next = !v;
      if (next) setOpen(true); // 开启默认展开时立刻展开当前会话
      return next;
    });
  }

  if (!open) {
    const capStyle = {
      left: pos.x,
      top: pos.y,
      right: "auto",
      bottom: "auto",
      touchAction: "none",
    };
    return (
      <button
        type="button"
        onPointerDown={makeDrag(() => setOpen(true))}
        title="展开实时日志（可拖动到任意位置）"
        style={capStyle}
        className={`fixed z-40 inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-2 text-ui shadow-lg transition-colors duration-150 hover:bg-sunken ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <Radio size={13} className={connected ? "text-good animate-pulse" : "text-warn"} />
        <span className="text-ink">实时日志</span>
        {!connected && <span className="text-eyebrow uppercase text-warn">· 断开</span>}
        {problemCount > 0 && (
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warn px-1.5 text-[11px] font-medium text-white">
            {problemCount}
          </span>
        )}
      </button>
    );
  }

  // 展开面板：跟随气泡位置，但自动避让屏幕右/下边缘，保证完整可见。
  // 模型快切展开时整块会高一截，估算高度要跟着加，否则贴着屏幕底部时会被裁掉。
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let panelLeft = pos.x;
  let panelTop = pos.y;
  const estH = DRAWER_EST_H + (switcher ? 70 : 0);
  if (panelLeft + DRAWER_W > vw - 8) panelLeft = Math.max(8, vw - DRAWER_W - 8);
  if (panelTop + estH > vh - 8) panelTop = Math.max(8, vh - estH - 8);
  const panelStyle = {
    left: panelLeft,
    top: panelTop,
    right: "auto",
    bottom: "auto",
  };

  return (
    <div
      style={panelStyle}
      className="fixed z-40 flex w-[min(440px,calc(100vw-2rem))] flex-col rounded-2xl border border-line bg-paper shadow-xl"
    >
      {/* 头部：标题 + 链路状态 + 收起（整条头部可拖动） */}
      <div
        onPointerDown={makeDrag(null)}
        style={{ touchAction: "none" }}
        className={`flex items-center justify-between gap-2 border-b border-line px-3 py-2 select-none ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Terminal size={15} className="shrink-0 text-ink-meta" />
          <span className="truncate text-ui text-ink">运行日志</span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 text-eyebrow uppercase ${
              connected ? "text-good" : "text-warn"
            }`}
          >
            <Radio size={11} className={connected ? "animate-pulse" : ""} />
            {connected ? "实时连接中" : "已断开，重连中…"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setSwitcher((v) => !v)}
            aria-label="快速切换模型"
            title="快速切换模型"
            className={`flex h-8 items-center gap-1 rounded-item px-2 text-meta transition-colors duration-150 ${
              switcher
                ? "bg-sunken text-ink"
                : "text-ink-faint hover:bg-sunken hover:text-ink"
            }`}
          >
            <Cpu size={14} />
            <span className="hidden sm:inline">模型</span>
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={collapse}
            aria-label="收起日志"
            title="收起日志"
            className="flex h-8 w-8 items-center justify-center rounded-item text-ink-faint transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/*
        模型快切。常驻在这里是用户要的：「盯着日志的时候顺手换模型，不用切去角色页」。
        只改一个人或者一次改四个都走同一个后端接口（/api/role-model），那条路是
        后端自己读盘改一个字段再写回 —— 不像「保存」那样把整份草稿盖下去。

        两行就够，别再往上堆：第一行「谁 + 换成什么 + 切」，第二行「改哪一档」+
        一眼看的当前值。这块常开在日志上面，每多一行都在挤日志区。
      */}
      {switcher && (
        <div className="border-b border-line px-3 py-2">
          {/* 谁 → 换成什么 → 切 */}
          <div className="flex items-center gap-2">
            <select
              value={rolePick}
              onChange={(e) => setRolePick(e.target.value)}
              className={`${inputCls} !w-[92px] shrink-0 !py-1 text-meta`}
            >
              <option value="all">全部角色</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <select
              value={modelPick}
              onChange={(e) => {
                setModelPick(e.target.value);
                setNote(null);
              }}
              className={`${inputCls} min-w-0 flex-1 !py-1 text-meta`}
            >
              <option value="">选一个模型…</option>
              {groups.map((g) => (
                <optgroup key={g.provider.id} label={providerLabel(g.provider)}>
                  {g.models.map((m) => (
                    <option key={m.id} value={`${g.provider.id}::${m.id}`}>
                      {modelLabel(m)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={applyModel}
              disabled={busy}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-ink px-2.5 text-meta text-paper-invert transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              切换
            </button>
          </div>

          {/* 改哪一档 + 当前用的是谁：一行装完，超了省略号，悬停看全 */}
          <div className="mt-1 flex items-center gap-2">
            <div className="flex shrink-0 items-center gap-0.5">
              {TARGET_ORDER.map((t) => {
                const on = target === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => pickTarget(t)}
                    title={
                      t === "fallback"
                        ? "兜底＝原「副 API」，聊天和线下共用同一份"
                        : `只切${TARGET_LABEL[t]}模型`
                    }
                    className={`rounded-item px-1.5 py-0.5 text-meta transition-colors duration-150 ${
                      on ? "bg-sunken text-ink" : "text-ink-meta hover:bg-sunken hover:text-ink"
                    }`}
                  >
                    {TARGET_LABEL[t]}
                  </button>
                );
              })}
            </div>
            <p
              className={`min-w-0 flex-1 truncate text-meta leading-relaxed ${
                note ? (note.ok ? "text-good" : "text-warn") : "text-ink-faint"
              }`}
              title={note ? note.text : currentTitle}
            >
              {note ? note.text : currentLine}
            </p>
          </div>
        </div>
      )}

      {/* 工具条：级别筛选 + 搜索 + 暂停/清空 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-0.5">
          {LEVEL_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setLevel(f.id)}
              className={`rounded-item px-2 py-1 text-meta transition-colors duration-150 ${
                level === f.id
                  ? "bg-sunken text-ink"
                  : "text-ink-meta hover:bg-sunken hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-[120px] flex-1 items-center gap-1.5 border-b border-line pb-1 focus-within:border-ink">
          <Search size={13} className="shrink-0 text-ink-meta" />
          <input
            className="w-full bg-transparent text-meta text-ink outline-none placeholder:text-ink-meta"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索关键词…"
          />
        </div>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className="inline-flex h-7 items-center gap-1 rounded-item px-2 text-meta text-ink-meta transition-colors duration-150 hover:bg-sunken hover:text-ink"
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
          {paused ? `继续${pendingCount ? `（+${pendingCount}）` : ""}` : "暂停"}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={!logs.length}
          className="inline-flex h-7 items-center gap-1 rounded-item px-2 text-meta text-ink-meta transition-colors duration-150 hover:bg-sunken hover:text-ink disabled:opacity-40"
        >
          <Trash2 size={13} /> 清空
        </button>
      </div>

      {/* 日志列表 */}
      <div className="relative">
        <div
          ref={boxRef}
          onScroll={onScroll}
          className="h-[300px] overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6">
              <p className="max-w-[40ch] text-center text-meta leading-relaxed text-ink-faint">
                {logs.length === 0
                  ? "还没有日志。给线路号码发条 iMessage，或去「连接」点一下测试。"
                  : "当前筛选条件下没有日志。"}
              </p>
            </div>
          ) : (
            filtered.map((e) => <LogRow key={e.id} entry={e} />)
          )}
        </div>
        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              const box = boxRef.current;
              if (box) box.scrollTop = box.scrollHeight;
            }}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-meta text-ink-soft shadow transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            回到最新
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
        <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-meta text-ink-faint">
          <input
            type="checkbox"
            checked={defaultOpen}
            onChange={toggleDefaultOpen}
            className="h-3.5 w-3.5 accent-blue-500"
          />
          默认展开
        </label>
        <p className="text-meta leading-relaxed text-ink-faint">
          后端实时日志。盯着这里：链路断了先变红「已断开」，报错实时冒出 —— 不用切控制台。拖动标题栏可挪到任意位置。
        </p>
      </div>
    </div>
  );
}
