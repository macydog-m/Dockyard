# 开发与操作参考

面向开发者的详细命令。当前发布步骤以 [版本与打包](releasing.md) 为准；
历史测试记录不代表新构建已经通过验收。

## 开发与验证

需要 Node.js 24 和 npm，文本统一使用 UTF-8。

```powershell
npm ci
npm test
```

构建 Shared/Core/MCP 后运行 Core、开发命令、迁移及真实 stdio 测试，不消耗模型额度。

## 中英文界面与 README

桌面文案使用 `apps/desktop/src/i18n/en.ts` 中的中英文词典。中文原文是翻译键，
`t()` 提供类型检查和占位符替换；动态系统消息使用 `translateMessage()`，不要将用户资源名称、规则正文或笔记传入翻译函数。
新增提示要同时补英文；包含用户内容的完整句子优先使用 `{0}` 等占位符，保留名称和 ID 原值。
Shared/Core/MCP 的协议字段、资源 ID、文件路径和用户数据不随界面语言变化。

语言偏好在 Main 中读写，通过受限 IPC 提供给 Renderer；截图覆盖层每次接收当前语言。
词典直接打包，不发起翻译网络请求。内置方案按当前语言生成，已保存方案保留其原名称。
根 README 使用英文，其他入口为 `README.zh-CN.md`、`README.ja.md`、`README.ko.md`；
调整功能、命令和发行状态时同步四份。详细技术文档目前以中文为主。

```powershell
npm run desktop:language-smoke
node scripts/readme-screenshots.mjs --english
```

现有中文烟测使用独立数据目录的固定语言偏好，避免依赖开发机的系统语言。


## 桌面体验

```powershell
npm run desktop
```

点击工具条左侧 **D** 标志可切换白天 / 黑夜模式，左侧六点手柄用于拖动。白天沿用原有烟灰玻璃，黑夜进一步压暗背景、边框高光和氛围色。首次使用默认黑夜，主题会跨工作区保存并在重启后恢复；也支持 Tab 聚焦后按 Enter 或空格切换。

首次打开会在 `%LOCALAPPDATA%/Dockyard` 创建空工作区。“预设工作区 → 管理资源”管理总资源库；各组件面板直接展示当前工作区资源。新增资源默认启用，取消勾选会暂停使用并保存状态，资源仍保留在列表；支持 Folder/File 原生选择、Palette/Instruction 编辑和手动刷新。关闭窗口后 MCP 仍可独立运行。

工具条的 **记事本** 提供快速记事和连线画布，两种视图同步同一批笔记。输入标题与正文后自动保存；画布支持拖动卡片、连接点连线、关系说明、缩放与适应视图，双击卡片返回编辑。删除笔记后可撤销并恢复连线。笔记按工作区保存为数据目录下 `notebooks/<workspace-id>.json` 的 UTF-8 文件；保存失败会显示重试入口并保留本地恢复草稿。笔记目前属于桌面端，不加入 MCP 的资源查询。运行 `node scripts/notebook-smoke.mjs` 可在构建后使用隔离数据验证。

```powershell
npm run desktop:smoke
npm run desktop:pack
node scripts/desktop-smoke.mjs --packaged # 先按 releasing.md 设置 DOCKYARD_DESKTOP_EXE
```

安装预览包位于 `.local/releases/<version>/Dockyard-Setup-<version>-x64.exe`，可用 `npm run desktop:installer` 重建；目录版位于 `.local/releases/<version>/win-unpacked/Dockyard.exe`。当前预览未签名。安装、升级和卸载保留数据已在本机验证，干净 Windows 验收尚未完成。

点击“连接 Agent”选择客户端。Codex 相同配置复用，冲突先备份再确认替换，没有 CLI 时提供可复制配置；恢复会检查连接后是否有其他配置修改。Claude Code、Claude Desktop、Antigravity、Cursor 提供对应 JSON 配置与手动合并指引。配置启动与 MCP 查询通过隔离测试，实际宿主会话仍需在对应客户端确认。详情见 [Agent 连接](agent-connections.md)、[Desktop 说明](../apps/desktop/README.md) 和 [开源候选检查清单](open-source-preparation.md)。

## 截图标注

截图预览提供矩形框、箭头和选择工具。矩形框与箭头分别记住颜色和细／中／粗三档线宽；可使用八个预设色、自定义颜色选择器、六位 HEX 及最近六个自定义颜色。未选中标注时修改后续绘制的默认样式；选中后只修改该项，不改变工具默认值。

选择标注后可拖动移动，拖动矩形角点或箭头端点调整大小与方向。Delete 删除选中项；Ctrl+Z 撤销；Ctrl+Shift+Z 或 Ctrl+Y 重做。清空也可撤销，最多保留 100 次编辑记录；同一截图关闭并重开面板后继续保留，重新截图会重置。颜色与线宽偏好存于桌面本地存储，重启后恢复；截图和编辑历史不会因此持久化。复制、保存和加入工作区均使用原始分辨率，不导出选中边框与手柄。

构建后运行 `node scripts/annotation-smoke.mjs` 验证绘制、改色、缩放预览中的拖动、历史记录和三种导出。测试使用隔离数据、合成截图和剪贴板替身，截图检查产物位于 `output/playwright/annotation-tools-*.png`。纯逻辑测试为 `node --test tests/annotations.test.mjs`。

## 网页设计资源

工具条的 **当前色与色盘** 集成选色器、色彩组合与普通色板；**字体** 保留独立入口并使用紧凑卡片。列表内可以添加、预览与选择，单击预览，双击只切换使用项并保持卡片位置；颜色组合可自定义 1–9 个颜色，用途可选；单色、组合和字体均可复制一句使用指令给 AI，按名称或 ID 查询。内置多套配色和字体，新增后保存即用。字体默认选一款供标题与正文使用，也可分别搭配。提供网页组合预览、CSS 复制及系统/本地/网页字体来源，普通色板继续兼容。

AI 可以按默认引用读取整套方案，也能单独查询某个颜色或字体。预览使用本机可用字体，加载来源会随方案保存，供实际网页使用。数据与查询说明见 [网页设计资源](design-resources.md)。

验证命令：npm run desktop:design-smoke，使用独立临时数据。

## 无界面体验

直接读取仓库演示数据：

```powershell
node scripts/dockyard.mjs get --data-dir examples/demo-data --ref id:002511
node scripts/dockyard.mjs get --data-dir examples/demo-data --ref 暖橙色
node scripts/dockyard.mjs get --data-dir examples/demo-data --ref "FX 规则"
node scripts/dockyard.mjs search --data-dir examples/demo-data --query 常用暖橙色
node scripts/dockyard.mjs context --data-dir examples/demo-data
```

get 预期返回文件绝对路径、`#E98C3A` 或演示规则正文；search 返回候选 ref、色值和匹配原因。002511 是演示文本文件，不是用户真实烟雾素材。

创建独立演示目录（目标必须不存在，不覆盖已有数据）：

```powershell
node scripts/dockyard.mjs demo --data-dir .local/my-demo
```

初始化空目录、注册组件并选入当前 Workspace：

```powershell
node scripts/dockyard.mjs init --data-dir .local/my-dock
node scripts/dockyard.mjs put-component --data-dir .local/my-dock --file examples/demo-data/components/palette.json
node scripts/dockyard.mjs select --data-dir .local/my-dock --components palette
node scripts/dockyard.mjs get --data-dir .local/my-dock --ref 暖橙色
```

`put-component` 更新 My Dock 中的配置；`select` 设置当前 Workspace 的组件组合。新组件不会自动加入 Workspace。要清空组合可传 `--components ""`。

## Workspace 与 Context

创建一个独立组合、重命名并切换，无需手改 JSON：

```powershell
node scripts/dockyard.mjs workspace-create --data-dir .local/my-dock --id brand --name 品牌设计
node scripts/dockyard.mjs workspace-select --data-dir .local/my-dock --id brand --components palette
node scripts/dockyard.mjs workspace-rename --data-dir .local/my-dock --id brand --name 品牌配色
node scripts/dockyard.mjs workspaces --data-dir .local/my-dock
node scripts/dockyard.mjs workspace-switch --data-dir .local/my-dock --id brand
node scripts/dockyard.mjs context --data-dir .local/my-dock
```

create 拒绝覆盖已有 ID；rename 保留组件组合。workspace-select 修改指定组合，select 修改当前组合。所有 MCP 会话共享一个 Active Workspace，切换后 get/search/context 在下一次调用中一致生效。

context 只给工作区、启用组件简介、资源计数和索引状态，最多 50 项，并返回总数与截断标记。它不返回素材路径、文件清单、色板条目或规则正文；资源计数来自配置/索引，不代表文件当前可用性。

## Folder 与刷新

先编辑 [Folder 配置示例](../examples/folder-component.json) 的 source.path，指向真实素材目录；overrides 可选，用于少量常用文件的名称、中文别名或标签。不存在的 override 路径不会创建资源。

```powershell
node scripts/dockyard.mjs put-component --data-dir .local/my-dock --file examples/folder-component.json
node scripts/dockyard.mjs select --data-dir .local/my-dock --components palette,fx-library
node scripts/dockyard.mjs search --data-dir .local/my-dock --query "soft smoke"
node scripts/dockyard.mjs refresh --data-dir .local/my-dock --component fx-library
```

添加或修改 Folder 来源时自动扫描；同来源的 metadata 编辑无需重扫。新增文件在 Refresh 后出现，已删除文件在刷新前仍可能被 search 找到，但 get 会返回 missing。刷新失败保留旧快照并提供诊断；来源变更未刷新则为 INDEX_STALE。

Folder 引用示例：`fx-library::Smoke/002511_soft.png`。重复数字 ID 返回候选，用完整 ref 消歧。扫描只枚举文件名，跳过目录链接、数据目录、.git 和 node_modules。

复现性能基准（独立临时数据，结束后清理）：

```powershell
npm run bench:search
```

## 数据与旧格式迁移

数据目录包含 `config.json`、`workspaces/*.json`、`components/*.json` 和 `index/*.json`；示例见 [数据格式](data-format.md)。开发命令必须显式指定 dataDir；MCP 省略该参数时，Windows 默认目录为 `%LOCALAPPDATA%/Dockyard`，但不会自动初始化。

旧数据目录只会返回 LEGACY_DATA，不会被 MCP 自动改写。显式迁移到一个不存在的新目录：

```powershell
node scripts/dockyard.mjs migrate --source "C:\OldDockyardData" --data-dir .local/migrated
```

迁移保留原记录和素材，保留 key（含前导零），将素材路径解析成绝对路径；为每条旧记录建立 File Component 并报告新的完整 ref。首版迁移最多 128 条旧记录，目标已存在或源数据无效时拒绝覆盖。

## 连接 Codex

构建后使用 node、MCP 入口和数据目录的绝对路径。先核对已有注册再执行添加，避免覆盖其他设置：

```powershell
codex mcp get dockyard
$dockyardNode = (Get-Command node).Source
$dockyardEntry = Join-Path (Get-Location) 'packages/mcp/dist/index.js'
$dockyardData = Join-Path (Get-Location) 'examples/demo-data'
codex mcp add dockyard -- $dockyardNode $dockyardEntry --data-dir $dockyardData
```

若宿主仍显示旧工具或旧说明，需要重新启动 MCP 并重新发现工具。此次实施未修改用户级 Codex 配置。

可选真实宿主验收消耗一次当前账户模型请求，要求 dockyard 注册指向本仓库演示数据：

```powershell
node scripts/verify-codex-mcp.mjs --all
```

加 --all 时，脚本要求 context 返回 Demo 工作区的 3 个组件摘要、search 返回暖橙色、get 返回正确演示文件，全部以真实工具完成事件为准。--search 只验证搜索与获取，默认只验证 get；文字声称成功不算通过。可用 DOCKYARD_CODEX_PATH 指定可执行文件。

## 当前边界

文件资源只返回路径、metadata 与 availability，不读取内容；颜色返回 value，规则仅在 get 时返回正文。MCP 不改写配置或素材，stdout 仅输出协议。

启用 Folder 的缺失、陈旧、损坏或不完整索引会阻止普通 get 断言全范围唯一性；search 仍可返回健康组件，并附 diagnostics。保留快照中的完整 ref 可继续 get；详情见 [数据格式](data-format.md)。

配置记录最多 1 MiB、单个索引最多 64 MiB / 100,000 条、规则正文最多 16 KiB，成功 MCP 响应主体最多 60 KiB。写入期间查询会有限重试，仍忙则返回 DATA_BUSY。索引刷新使用独立锁，查询可读旧快照。进程崩溃可能留下 .write-lock 或 .refresh-ID.lock；确认没有管理进程写入后才可移除残留锁。跨文件操作按依赖顺序发布，不提供数据库事务。

移除组件会撤销所有 Workspace 中的注册关系，保留素材和未引用的配置文件。

## Workspace 绑定与统一配置组件

MCP 启动参数 `--workspace-id` 固定查询范围。桌面工具栏的独立“配置”入口统一管理资源引用、开关、选择与参数，提供单层预设选择和可视化组件搭建，预设结构及参数独立保存。Core 从配置声明的管理范围和当前值计算有效资源，get/search/context 共同遵循过滤结果；“工作区绑定”生成手动配置片段。详细说明见 [功能与数据格式](workspace-configuration.md) 和 [真实 Codex 验证及限制](codex-binding-validation.md)。

验证：`npm run desktop:configuration-smoke`、`node scripts/codex-binding-probe.mjs`。后者使用隔离配置与本机合成模型端点，不使用真实模型额度。`tests/configuration-scope.test.mjs` 覆盖资源开关、精确引用、多个配置、旧列表绕过防护、索引与失效引用。
