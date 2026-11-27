/**
 * 日志抽屉里的「模型快切」：只改角色的模型引用，一次可以改一批角色。
 *
 * 为什么不复用 PUT /api/config：那条路要求前端先把**整份配置** GET 下来、改一个
 * 字段再整包写回。而日志抽屉是常驻的，手里那份 config 可能是几小时前拉的 ——
 * 拿它整包写回，会把别处（控制台其他页面、手机端 /model 指令）改过的东西全盖掉。
 * 这里让后端自己读盘、只动这一处，永远是「读最新的、只改这一块」。
 *
 * 不调 syncBridges：模型引用是每轮现读的，刷桥接只会把正在回话的那条连接掐掉。
 *
 * 返回里不带整份 config —— 前端自己按 roleIds 更新本地草稿就行，同样是为了
 * 不冲掉用户在别的面板里没保存的改动。
 */
app.post("/api/role-model", (req, res) => {
  const { roleIds, provider, modelId, target, targets } = req.body ?? {};
  const ids = (Array.isArray(roleIds) ? roleIds : []).map(String).filter(Boolean);
  if (!ids.length) return res.status(400).json({ ok: false, error: "没指定要改哪个角色" });

  /*
   * 切哪几档，可多选：
   *  - chat      线上聊天（role.chatModel）
   *  - offline   线下剧情（role.offline.model；没单独配时线下跟着聊天走）
   *  - fallback  兜底，也就是界面上原来叫「副 API」的那个（role.fallbackModel）。
   *              线上和线下共用同一份，所以单列一档。
   * 旧前端只传单个 target（chat|offline|both），这里兼容着收，"both" 当作
   * 聊天 + 线下（那时候还没有兜底这一档，语义不能变）。
   */
  const rawList = Array.isArray(targets) ? targets : [target ?? "chat"];
  const picked = new Set(
    rawList
      .flatMap((t) => String(t ?? "").split("+"))
      .map((t) => (t === "both" ? "chat" : t))
      .filter((t) => ["chat", "offline", "fallback"].includes(t))
  );
  // 谁都没认出来就当改聊天，和以前的默认一致
  if (!picked.size) picked.add("chat");
  const pickedOrder = ["chat", "offline", "fallback"];
  const pickedText = { chat: "聊天", offline: "线下", fallback: "兜底" };
  const where = pickedOrder.filter((t) => picked.has(t));

  const config = loadConfig();
  const source = (config.providers ?? []).find((p) => p.id === provider);
  if (!source) {
    return res.status(404).json({ ok: false, error: "这个服务商不存在（可能刚被删掉），刷新页面再试" });
  }

  const model = (source.models ?? []).find((m) => m.id === modelId);
  if (!model) {
    return res.status(404).json({ ok: false, error: "这个服务商下面没有这个模型，刷新页面再试" });
  }
  if (!model.enabled) {
    return res.status(400).json({ ok: false, error: "这个模型是关着的，先去「连接」里打开它" });
  }

  const known = new Set((config.roles ?? []).map((r) => r.id));
  const hit = ids.filter((id) => known.has(id));
  if (!hit.length) {
    return res.status(404).json({ ok: false, error: "角色不存在（可能刚被删掉），刷新页面再试" });
  }

  const ref = { provider: source.id, modelId: model.id };
  const names = [];
  saveConfig({
    ...config,
    roles: (config.roles ?? []).map((r) => {
      if (!hit.includes(r.id)) return r;
      names.push(r.name || r.id);
      const next = { ...r };
      if (picked.has("chat")) next.chatModel = { ...ref };
      if (picked.has("offline")) {
        next.offline = { ...(r.offline ?? {}), model: { ...ref } };
      }
      if (picked.has("fallback")) {
        // 顺手把开关打开：只写模型引用却没启用，等于什么都没改
        next.fallbackModel = { ...(r.fallbackModel ?? {}), ...ref, enabled: true };
      }
      return next;
    }),
  });

  // 显示名和前端 labels.js:modelLabel 同一条规则（alias 优先），日志里才对得上界面
  const label = `${source.name || source.id} · ${model.alias?.trim() || model.model || model.id}`;
  const whereText = where.map((t) => pickedText[t]).join("、");
  logInfo("模型", `${names.join("、")} 的${whereText}模型切成 ${label}`);
  res.json({ ok: true, roleIds: hit, roles: names, model: label, targets: where, where: whereText });
});
