# Dockyard Desktop

Windows 桌面预览，使用 Electron + React + TypeScript，所有资源管理均调用同一 Core。
当前没有公开发行版；依赖版本以锁文件为准。

## 界面语言

支持简体中文和 English。首次启动跟随系统语言，中文系统使用简体中文，其他系统使用英文。
在“更多 → 设置 → 语言 / Language”选择跟随系统、简体中文或 English，立即生效，重启后保留。
偏好单独保存在数据目录的 `desktop/language.json`，独立于工作区与资源配置；切换不会改写已有资源、规则和笔记。
AI 复制指令使用当前界面语言，仍然只包含使用意图与准确资源名称或 ID。

`npm run desktop:language-smoke` 使用隔离数据与合成屏幕像素，验证中英切换、重启持久化、用户内容保留、AI 剪贴板、原生对话框、截图覆盖层和英文布局。

## 使用

在仓库根目录运行：

```powershell
npm run desktop
```

默认数据目录为 `%LOCALAPPDATA%/Dockyard`，首次打开建立空的默认工作区。开发时可隔离数据：

```powershell
npm run desktop:build
node scripts/dockyard.mjs demo --data-dir .local/desktop-demo
npx electron apps/desktop --data-dir .local/desktop-demo
```

演示目标须为不存在的目录。界面支持五种资源的添加/编辑、文件选择、工作区创建/重命名/切换、组件组合、启停、移除及手动刷新。新增资源自动加入当前工作区并默认启用。组件面板的勾选用于启停，取消勾选后保留卡片和数量，状态按工作区保存并影响 MCP 查询；“预设工作区 → 管理资源”管理完整资源库和工作区成员。

“检查连接”分别显示 Codex 注册的数据目录、本地独立 stdio 自检结果和检查时间，不修改宿主配置，也不声称 Codex 当前会话已连接。

“更多 → 重启软件”会等待已提交的保存、扫描等操作完成，再退出并重新启动整个 Dockyard。开发版会先重新编译 Shared/Core/MCP 和桌面代码，因此修改源代码后点此按钮即可加载最新版本；构建失败时保留当前窗口，并在启动终端输出错误，修复后可重试。重启保留同一个数据目录、工作区、资源和主题。安装版直接重新启动。

整应用重启验证：先运行 `npm run desktop:build`，再运行 `node scripts/restart-smoke.mjs`。测试会创建隔离开发副本，修改该副本的源文件并点击重启，确认新窗口加载最新构建及原数据。

## 网页设计设置

工具条中的记事本位于字体右侧。“更多 → 工具栏组件”可分别显示或隐藏素材、文件、规则、字体、记事本、颜色、吸色和截图；隐藏时工具条及收起后的原生窗口同步收短，空分组不留分隔线。设置入口与工作区始终保留，可一键全部显示。显隐偏好保存在本机，独立于工作区资源的启用状态，不删除资源或笔记。

字体预览上方增加字号、加粗和文字颜色图标控件，修改可即时预览并保存；颜色可恢复为跟随配色。设置保存在字体资源中，CSS 与 AI 查询读取同一份数据，复制给 AI 仍是一句使用指令。可运行 `node scripts/toolbar-font-smoke.mjs` 验证显隐持久化、窗口收缩、字体预览与保存。

工具条的 **当前色与色盘** 统一管理选色、色彩组合和普通色板；**字体** 保留独立入口。更多也提供“颜色”和“字体”。每个面板将内置选项、已有资源和添加组合在同一列表，单击预览、双击只切换选择，不重排卡片；字体使用更小的三列卡片并隐藏双击提示；新增后保存即用。默认使用单款字体，可展开分别设置标题/正文。提供组合预览与 CSS 复制，当前使用项自动加入工作区组合。颜色组合可增删为 1–9 个颜色，用途可选；单色、组合和字体的默认复制只给出使用意图与名称或 ID，供 AI 按需查询。配色保留普通色板兼容；字体加载来源可为系统字体、本地文件或网页 CSS 链接。预览使用本机可用字体，不加载外部来源。详情见 [网页设计资源](../../docs/design-resources.md)。

验证命令：npm run desktop:design-smoke。

## 安装和连接

完整步骤见 [版本与打包](../../docs/releasing.md)。运行 `npm run desktop:installer` 生成 `.local/releases/<version>/Dockyard-Setup-<version>-x64.exe`。它包含运行时与打包依赖，安装时无需 Node/npm 或下载；当前是未签名预览。安装和数据目录分离，卸载保留资源数据。

点击“连接 Agent”选择 Codex、Claude Code、Claude Desktop、Antigravity 或 Cursor。Codex 展示实际 command/args/env 的比较结果，确认添加或替换后使用正式 CLI 注册，备份原配置，并做独立 stdio 自检；相同配置不重复写入，无 CLI 时可复制配置。其他客户端提供对应 JSON 配置、复制按钮与手动合并指引。连接之后需要在宿主重新发现工具。详见 [Agent 连接](../../docs/agent-connections.md)。

备份位于 Codex 配置目录的 dockyard-backups。只有连接后配置未被其他操作更改时才能自动恢复；否则保留备份供手动合并。备份内容不发给 Renderer。IPC 不接受任意 CLI、配置文件路径或 shell 命令。

`npm run desktop:connect-smoke` 在隔离 Codex 配置中跑真实 UI 与 CLI 测试，默认使用源码构建后的桌面；可用 `DOCKYARD_DESKTOP_EXE` 指定本机测试安装副本。`node scripts/agent-settings-smoke.mjs` 检查开关状态、精简设置页、多 Agent 配置复制与独立 MCP 自检。

## 进程与权限

- Main 管理窗口、原生文件选择器和固定命令 IPC；Worker 串行调用 Core，扫描计数发送给 Renderer。
- Renderer 只有受限的 `window.dockyard` 方法，不暴露原始 IPC、Node、文件读取或 shell。
- Context Isolation、sandbox、禁用 Node integration，验证 IPC 来源与参数；只允许加载三个固定的本地界面文件，拒绝外部导航、弹窗和权限请求。
- 新增 Folder 时自动索引，手动刷新报告进度；局部失败展示不完整状态，根目录失败保留旧索引。关闭窗口时等待已提交的写入完成。
- 独立 MCP 进程不依赖桌面窗口；打包后的 Electron 可通过 `ELECTRON_RUN_AS_NODE=1` 承载同目录 `mcp.mjs`。

隔离方式参考 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)。具体实现见 `src/main.ts`、`src/preload.ts`、`src/security.ts` 和 `src/worker.ts`。

## 验证和目录包

```powershell
npm test
npm run desktop:smoke
npm run desktop:pack
node scripts/desktop-smoke.mjs --packaged
```

`desktop:build` 先构建 Shared/Core/MCP，再做桌面 TypeScript 检查与 esbuild 打包。`desktop:pack` 创建 `.local/desktop-package/Dockyard-win32-x64`，拒绝覆盖已有包；首次需要下载 Electron 运行时。已下载官方 ZIP 时可设置 `DOCKYARD_ELECTRON_ZIP_DIR` 指向所在目录。

开发版、目录版的真实 Electron 流程已通过。目录版在只有 Windows 系统目录的 PATH 和仓库外工作目录运行，证明此试验不依赖全局 Node 搜索路径。该命令仍只生成目录包；离线 NSIS 安装、升级和卸载已另行通过本机验收，尚未完成干净 Windows 验收。

在独立数据目录运行上述烟测，不将开发机测试替代干净系统验收。

安装生命周期和宿主连接需在正式发行前单独验收，见 [开源候选检查清单](../../docs/open-source-preparation.md)。

## 单行小组件（2026-09-25）

桌面界面已改为约 636 × 64 DIP 的无边框置顶小组件，其中工具条高度为 48px。左侧点阵和品牌区域可以拖动；素材、文件、规则是纯图标入口，悬停显示名称。

- 工作区按钮：切换预设、新建、重命名、管理资源。
- 素材 / 文件 / 规则：打开对应资源列表；添加、编辑、筛选、组合勾选、启停、移除和文件夹刷新仍可使用。
- 素材文件夹 / 文件：添加和编辑只保留名称、来源路径；浏览选择来源时自动填入名称。文件引用名自动生成，编辑时保留已有简介、引用名、别名和标签。
- 规则：添加和编辑只需填写名称、正文；每条规则右侧的复制按钮可复制完整正文，保留换行。引用名自动生成，已有规则的引用名、别名和标签在编辑时保留。
- 当前色：点击色块打开连续色盘，支持 HEX、色相、饱和度、亮度及已保存色板。当前色按工作区保存在本地；保存到色板并勾选该组件后可供 AI 查询。
- 吸色器：隐藏小组件后从屏幕点击取色，Esc 或右键取消。
- 截图：隐藏小组件后拖动框选；完成后自动复制真实图片到系统剪贴板，并将 PNG 缓存到数据目录的 `captures` 文件夹、登记到当前工作区。点击聊天框按 Ctrl+V 即可粘贴；AI 可通过资源查询取得图片路径并读取。完成后自动弹出预览，可拖动绘制红框和箭头，支持撤销、清空；点击复制图片会复制标注后的 PNG 并同步更新缓存。更多 → 最近截图可继续标注、另存或重新复制；同一张截图重复加入不会生成重复缓存。完整屏幕快照只用于临时选区，不保存整屏。跨屏合并选区暂不支持。
- 设置（更多）：语言、工具栏开关、重启软件、Agent 连接与本地自检、Codex 配置备份恢复、退出。开关关闭时使用原有中性色，开启时为绿色；资源管理位于预设工作区面板，颜色与字体从工具栏打开。
- Esc 收起展开面板；切换到其他应用时收起非编辑面板。

验证命令：`npm run desktop:widget-smoke`。完整验收见项目根目录 `design-qa.md`。

### 屏幕工具性能修复

已修正 Windows 125% 缩放下覆盖层被任务栏工作区和隐形边框影响的问题，并增加隐藏窗口复用、像素直传和绘制完成后显示。预热不会抓取屏幕。详见 [屏幕工具优化记录](../../docs/screen-capture-optimization.md)。屏幕/DPI 回归：`node scripts/screen-capture-regression.mjs`（需先构建）。
# 毛玻璃界面

内容和玻璃由同一个窗口承载，不创建额外玻璃背板，也不调用 setShape。Windows 10 1809（Build 17763）及以上，包括 Windows 11，统一使用主进程中的 Windows.UI.Composition HostBackdropBrush，并用 CompositionGeometricClip 按 14 DIP 圆角裁剪玻璃层，并开启透明窗口以保留接口失败时的半透明回退。较旧系统使用普通半透明。系统要求降低透明度或开启高对比度时使用实色回退。

Windows 10 兼容模块使用 Koffi N-API 预编译二进制，随桌面构建复制到 dist/node_modules，并包含在目录包和离线安装器中；无需用户安装编译工具。HostBackdropBrush 和几何裁剪使用 Windows Runtime 接口；启用宿主背景的 SetWindowCompositionAttribute 属于未公开的 Windows API，加载或调用失败会降级，并在主进程输出诊断。Win11 原生 Acrylic 在当前无边框窗口上会染色圆角外的像素，因此主窗口同样使用经过几何裁剪的玻璃层。

验证：运行 desktop:build、scripts/desktop-smoke.mjs、scripts/glass-smoke.mjs、scripts/windows-glass-smoke.mjs 和 tests/window-material.test.mjs。windows-glass-smoke 使用自建背景和系统合成截图，检查真实背景模糊、背景颜色变化、四角完全透出背景、展开编辑、移动与失焦、原生材质关闭和恢复；只保存应用窗口区域，不保存完整桌面。可设置 DOCKYARD_DESKTOP_EXE 检查打包版本。验证记录见 [Windows 10 玻璃兼容修复](../../docs/windows-glass-compatibility.md)。独立旧参照面板 scripts/glass-standalone.cjs 仍只测试 Windows 11 的 Electron 材质。

资源面板统一使用“预览”标题，管理按钮位于选中卡片右下角；文件夹还提供刷新索引。底部仅统计当前面板的资源项，包括暂停项，搜索不改变总数。字体和颜色卡片同样支持启停，编辑和删除按钮只在点选卡片后显示。
