# Changelog

按「一个补丁一个功能」记。版本号指这个合集，不是 Uranus。

## v1.1.0 — 2026-11-22

### 新增 Windows 支持（01 / 04 / 05）

- 三个模块各加 `安装.bat` / `卸载还原.bat`（纯 ASCII 批处理，只负责调 Node），以及跨平台的 `install.mjs` / `uninstall.mjs` / `platform.mjs`
- 走的是同一份补丁逻辑：备份 → 插锚点 → 语法检查 → `npm run build` → 重启。差别只在最后一步：macOS 用 `launchctl kickstart`，Windows 用「按端口找 PID → `taskkill` → 重开启动器」，与上游 `更新.bat` 同一套做法
- 修掉 Windows 上的几处硬伤：
  - `process.env.HOME` 在 Windows 上是空的 → 改用 `os.homedir()`
  - `execFileSync("npm")` 在 Windows 上找不到（npm 是 `npm.cmd`）→ 按平台走 `shell`
  - 群像收工/扇出脚本把临时目录写死成 `/tmp` → 改用 `os.tmpdir()`
  - 05 的安装器在非 macOS 上会去跑 `bash 01-nosleep-guard/install.command` → 按平台跳过并说明
- 05 的 `安装器.mjs` / `卸载器.mjs` 改名为 `installer.mjs` / `uninstaller.mjs`（`.bat` 里出现中文文件名会被 cmd 误解析）

### 白皮书新增「在 Windows 上装」一节

- 模块 × 平台兼容矩阵、Windows 三步安装、装完注意三件事（强刷 / 重启 / 构建）
- 写清 02 / 03 为什么没有 Windows 版：02 靠 `launchd` + `pmset` 唤醒记录，而它治的是 macOS 睡醒网络栈挂死；03 的判据是 `uranus.log` 里的连接标记，Windows 版日志只在内存和控制台窗口，不落盘
- Windows 常见问题：一闪就没、`'node' 不是内部或外部命令`、`npm run build` 失败、路径里的 `&`、杀软拦 `.bat`、旧窗口停在「请按任意键继续」

### 打包

- 发布 zip 安装包（UTF-8 文件名 + 保留 `.command` 可执行位），附在本 Release

---

## v1.0.2 — 2026-11-22

### 新增 `05 · 线下剧情 · 四钮快速跳转 jump-buttons`

- 右缘常驻四个半透明圆钮：跳顶 / 上一条自己的发言 / 下一条自己的发言 / 跳底
- 顺手修 Safari 回顶坑：平滑滚动途中被「补更早」的锚回打断、停在半路 → 加标志让回顶途中锚回钉 0
- 纯前端改动（1 个文件），不依赖其他补丁，可单独装 `node install.mjs --only 05 --run`
- patch 从原版 1.22.3 基线正向生成，叠加 02/03/04 后 17 项自检全过；与社区「群像舞台」共存已实测
- 新增 `patches/05-jump-buttons/`（patch + README），注册进统一安装器 CATALOG

### 社区合集同步

- `community/Uranus玩家补丁合集/` 新增模块 `05-线下剧情增强`，把统一安装器那套（版本留底/气泡样式/模型token/四钮跳转）整块打包，双击即装
- 合集 README 从「四个模块」更新为「五个模块」；根 README 补丁表、徽章、说明同步

---

## v1.0.1 — 2026-11-01

### 新增 `setup.mjs`：把「原项目」也一起解决

仓库不打包 Uranus 源码（上游许可是「非商业 + 原样转发须附全文」，补丁属于修改），
改成**用的时候从上游拉**：

```bash
node setup.mjs                    # 预览
node setup.mjs --run --install    # 拉 v1.22.3 → 装全部补丁
```

- 默认 `git clone --depth 1 --branch <tag>`；`--no-git` 走官方 tarball，自带 tar+gzip 解析，不依赖 `patch`/`git`/`tar` 命令
- `--use-existing` 不下载，直接对已有目录装；`--dir` 指定落点；`--tag` 换版本
- 目标目录已有非 Uranus 内容时**拒绝动手**，不会覆盖别人的东西
- 实测两条拉取路径产物一致：282 个文件、`diff -rq` 无差异；拉完 `--install` 一把过（20 项自检）

### 文档

- 新增 [docs/upstream.md](docs/upstream.md)：上游项目、版本对应表、为什么不打包源码、许可怎么算
- 新增 [NOTICE.md](NOTICE.md)：归属与许可边界（脚本 MIT / 补丁跟随上游非商业）
- README 顶部加「先看清楚这是什么」区块；新增「上游项目与版本」章节；License 章节改成分层说明
- 徽章从 `MIT` 改成 `MIT / non-commercial`

---

## v1.0.0 — 2026-11-01

仓库从 `uranus-nosleep-guard` 改名成 `uranus_patches_awesome`，从「一个补丁」变成「一组补丁」。
原有的第 01 号补丁行为不变，只是从仓库根目录搬进了 `patches/01-nosleep-guard/`。

新增三个补丁（都针对 Uranus 1.22.3，按顺序叠装）：

### 02 · 线下剧情 · 版本留底 `version-history`

- 重 roll 的旧稿、手改前的旧稿、被删掉的整轮 —— 都留底
- 气泡标题 `历史 N` 按钮 → 抽屉里逐版翻阅，`⟲` 一键写回（当前版先留底）
- 重 roll 旧稿进 `pendingAlts` 暂存，由新回复接走；挂错了会把角色旧稿写进 user 正文
- 老数据迁移：早期把重 roll 旧稿挂在 user 轮上的，读取时自动搬到助手轮
- `dropLastAssistant` → `archiveLastAssistant`（语义变了，改名让漏改的调用点直接报错）
- 上限：单轮 20 版、剧情 100 条删除存档；`alts` / `removed` 不进模型上下文

### 03 · 线下剧情 · 气泡样式 `bubble-style`

- 「样式」弹窗：用户侧 / 助手侧分别调底色、不透明度、边框、文字色、圆角，实时预览
- 样式存服务端 `data/offline-bubbles.json`（`GET/PUT /api/offline-bubbles`），
  手机和电脑终于读同一份 —— 以前只存 `localStorage`，按源站隔离，永远不同步
- 服务端白名单清洗：只留合法字段，颜色只认 6 位 hex，数值越界夹回，> 20KB 拒绝
- 「跟随主题」时一个样式都不盖

### 04 · 线下剧情 · 模型与 token `model / token`

- 气泡标题：`｜服务商 · 模型 ｜↑49.3k(46k) ↓189`，悬停看精确值
- 走兜底 API 的那轮记**兜底**的标签，「为什么这轮风格不对」一眼能看出来
- 用量归一三种形状：OpenAI / Gemini 原生（`usageMetadata`）/ Claude
- 五处全链路：新增轮次、手改留底、重 roll 暂存、恢复旧稿、PATCH 透传
- 历史版本抽屉里每一版也带自己的用量

### 工具

- `install.mjs`：统一安装器，`--list` / `--only` / `--all` / `--force` / `--no-build`
  - 纯 JS 统一 diff 引擎（不依赖 `patch` / `git`，Windows 可跑）
  - 预演 → 备份 → 写入 → `node --check` → 构建 → 自检，任一步失败自动回滚
- `uninstall.mjs`：按备份逐字节还原，`--all` / `--keep`
- `tests/smoke.mjs`：按「装了哪些补丁」决定跑哪几段自检，不联网、不碰真数据
- 01 号的 `install.command` / `uninstall.command` 支持 `--yes`（给统一安装器静默调用）

## v0.1.0 — 2026-10-23

- `uranus-nosleep-guard`：Mac 睡醒后 Uranus「假活」（端口在、出网全废）→ launchd 每 5 分钟判一次，
  进程早于最近一次真唤醒且已唤醒 90 秒以上，就 `launchctl kickstart` 重启一次
- 不禁睡眠、不 `pkill`、零依赖；附 `USAGE.md` 手把手指南
