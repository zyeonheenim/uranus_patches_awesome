# 常驻「运行日志」抽屉补丁（Uranus 前端）

> 解决一个很具体的痛点：**线下模式等 API 出字时，页面一片空白干等，分不清是「在慢慢生成」还是「API 断了」，只能切去「控制台」面板看日志。**
>
> 这个补丁在控制台**每个页面左下角**钉一个「实时日志」浮动抽屉——和「控制台」面板同一份实时数据流，带级别筛选、搜索、暂停、清空，以及**显眼的链路状态行**：API 链路一断立刻变红「已断开，重连中…」，超时/拒连/限流报错实时冒出来。**不用切 tab。**

---

## 一、这个补丁做了什么

- **左下角一个胶囊按钮**：显示 `● 实时连接中` / `● 已断开`，有警告/错误会冒红色角标（几条问题）。
- **点开是实时日志面板**：与「控制台」同一份 SSE 日志流，带 `DEBUG/INFO/WARNING/ERROR` 级别筛选、关键词搜索、暂停、清空。
- **可钉住（图钉）**：钉上后每次进控制台都自动展开；收起时只在左下角留胶囊，不挡内容。放在左下角特意避开右下角的客服气泡。
- **链路状态行**：一旦 API 真断了会立刻变红，报错实时冒出，线下等生成时盯着它就行。

纯前端改动，**不碰后端、不加任何新依赖**（图标用 Uranus 已有的 `lucide-react`，样式用已有的 Tailwind 主题 token，日志流用 Uranus 已有的 `/api/logs/stream`）。

---

## 二、兼容性（重要）

本补丁基于 **Uranus 上游原版代码** 制作，只往两处「官方原版一定存在的锚点」后面插入代码，**不依赖任何本地补丁**。

它用到的全部都是 Uranus 上游已有的东西：

- `useLogs()` 返回 `logs / connected / paused / setPaused / pendingCount / clear` —— 上游 `store.jsx` 的 `LogProvider` 已提供；
- `LEVEL_FILTERS / LEVEL_META / LEVEL_ORDER / LogRow` —— 上游 `console.jsx` 已导出；
- `lucide-react` 图标、`bg-paper / text-ink / text-good / text-warn` 等 Tailwind token —— 上游已有。

所以：**不管你装没装其他补丁、用 Mac 还是 Windows，都能直接用。**（已在 Uranus 1.22.x 上游 HEAD 验证锚点存在。）

---

## 三、文件清单

```
live-log-drawer/
├── apply.js              ← 跨平台一键安装脚本（Mac / Windows 都能跑）
├── files/
│   └── logdrawer.jsx     ← 要放进 client/src/ 的新组件
└── README.md             ← 本文件
```

> 安装只靠 `apply.js`（它会自动复制组件 + 在两处官方锚点后插入 2 行）。无需 git、无需其他工具。

---

## 四、安装（推荐：一键脚本）

补丁包放在 Uranus 目录里（或任意位置），在终端里：

```bash
cd <补丁包目录>
node apply.js            # 自动向上查找 Uranus 根目录
# 或显式指定：
node apply.js /path/to/Uranus
```

脚本会：

1. 复制 `files/logdrawer.jsx` → `client/src/logdrawer.jsx`；
2. 在 `client/src/shell.jsx` 的两处官方锚点后插入 `import` 和 `<LiveLogDrawer />`；
3. 已经装过会自动跳过，不会重复插入。

> 脚本找不到 Uranus 根目录时，会提示你用 `node apply.js /绝对路径/Uranus`。

---

## 五、构建（装完必须重新打包前端）

源码改完要 `npm run build`，浏览器才会拿到新界面。

### Mac

```bash
cd /path/to/Uranus
npm run build        # 等价于 npm --workspace client run build
```

> 如果提示 `npm: command not found`，先装 Node（建议 nvm 或官网 pkg），或在已装 Node 的终端里跑。

### Windows

用 **PowerShell** 或 **Git Bash** 进入 Uranus 根目录：

```powershell
cd C:\path\to\Uranus
npm run build
```

> 没装 Node 的话先装 [Node.js LTS](https://nodejs.org/)（Windows 版）。装完重开终端让 `npm` 生效。  
> 首次构建前若没有 `node_modules`，先跑一次 `npm install`（在 Uranus 根目录）。

构建成功会看到 `vite` 输出 `✓ built in ...`，产物在 `client/dist/`。

---

## 六、重启 Uranus 并刷新

构建只是更新静态文件，**Uranus 进程本身也要重启**（或让控制台重读静态资源）才能生效。

### Mac

- **用 launchd 托管（开机自启）的情况**：
  ```bash
  launchctl kickstart -k gui/501/com.uranus.imessage
  ```
- **直接双击 App / 脚本启动的情况**：关掉再重新打开即可。

### Windows

- 停止再启动 Uranus 的服务 / 应用（取决于你怎么跑的）：
  - 若是作为**服务**运行：在服务管理器里重启 `Uranus` 服务，或
    ```powershell
    # 找到并重启进程（按实际名字调整）
    Stop-Process -Name "Uranus*" -Force   # 仅示例，请按实际进程名
    # 然后重新启动 Uranus
    ```
  - 若是**双击 exe / bat** 启动：关掉窗口重新双击。

### 最后一步（两边都一样）

浏览器**硬刷新**：Mac `Cmd+Shift+R` ／ Windows `Ctrl+Shift+R`。  
左下角会出现「实时日志」胶囊按钮，点开即见实时日志 + 链路状态。

---

## 七、手动安装（不用脚本，可选）

如果你不想跑脚本，或脚本报「找不到锚点」，手动改也很快：

1. 把 `files/logdrawer.jsx` 复制到 `client/src/logdrawer.jsx`。
2. 打开 `client/src/shell.jsx`，做两处改动：
   - 在 `import { useConfig, useLogs } from "./store.jsx";` **这一行后面**加一行：
     ```jsx
     import { LiveLogDrawer } from "./logdrawer.jsx";
     ```
   - 在 `<AssistantBubble />` **这一行后面**加：
     ```jsx
     <LiveLogDrawer />
     ```
3. 回到第五节构建、第六节重启。

> 这两行锚点在官方原版里各只出现一次，搜一下就能定位。

---

## 八、卸载

1. 删除 `client/src/logdrawer.jsx`；
2. 在 `client/src/shell.jsx` 里删掉这两处：
   - `import { LiveLogDrawer } from "./logdrawer.jsx";`
   - `<LiveLogDrawer />`（及其上面的注释行）；
3. `npm run build` 重新打包。

---

## 九、常见问题

**Q：刷新后没看到胶囊按钮？**  
A：确认 `npm run build` 成功、Uranus 已重启、并且是**硬刷新**（Cmd/Ctrl+Shift+R）。若仍无，打开浏览器控制台看有没有报错（多半是构建没覆盖到旧 bundle，清一下缓存再硬刷）。

**Q：会和我已有的其他补丁冲突吗？**  
A：不会。本补丁只往两处官方原版锚点后插 2 行，跟其他补丁互不打扰（除非你手动把 `<LiveLogDrawer />` 放错地方）。

**Q：用了这个还要不要去「控制台」面板？**  
A：这个抽屉是「控制台的随身缩略版」——主打不切页面也能盯链路。完整日志（复制、账号、服务控制等）仍在「控制台」面板。

**Q：Mac 和 Windows 的包不一样吗？**  
A：**源码完全一样**。两个平台只是「构建命令」和「重启方式」不同（见第五、六节），所以一个补丁包通吃。

---

## 十、原理简介（给想改的人）

抽屉复用 Uranus 全局 `LogProvider` 的 SSE（`/api/logs/stream`）——控制台面板和顶部错误条本来就在用同一条流，所以这是「零新增后端」的纯前端增强。抽屉通过 `useLogs()` 拿 `logs/connected/paused/...`，用 `console.jsx` 导出的 `LogRow` 渲染每一行，状态/筛选/搜索全在组件内 `useState` 完成。想改样式或默认展开，改 `files/logdrawer.jsx` 即可（默认收成胶囊；想默认展开，把 `readBool(DRAWER_OPEN_KEY, false)` 的 `false` 改成 `true`）。
