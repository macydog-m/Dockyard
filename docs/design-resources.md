# 网页设计资源

通过工具条的 **当前色与色盘** 与 **字体** 管理网页设计资源。“更多”提供“颜色”和“字体”入口。颜色面板将选色器、色彩组合和普通色板合在同一界面，使用组合时同步选取其主色（未指定主色时取第一个颜色），组合中的其他色块也可直接取到选色器；保存单色写入普通色板。两类资源分别保存，可以自由搭配，使用 UTF-8 JSON 存储。

每个面板都把已有资源、内置选项和“添加”放在同一列表中。单击预览，双击使用；键盘 Enter 或空格也能使用。当前使用项显示勾选标记，并在面板顶部显示“使用中”。双击只切换选择状态，不重新排列卡片，也不重置列表滚动位置。字体卡片采用紧凑三列布局，保留双击操作但不显示操作提示。添加后“保存并使用”直接应用到当前工作区，颜色组合、单色和字体的复制均生成一句给 AI 的使用指令。字体面板保留网页预览；颜色面板的组合列表下方直接显示选色器与保存区，不显示网页样例。

## 配色方案

配色方案沿用 palette 组件，新增可选 mode: "design"。普通色板无需迁移，仍使用原来的编辑器和单色查询。

颜色组合包含 **1–9 个颜色**，每个颜色可命名、添加和移除。用途 role 可选，支持主色、辅助色、背景、文字等；不要求固定用途，已选用途不能重复。普通色板继续支持原有单色集合。“已保存色板”存放可重复选取的单个颜色；下拉框旁的垃圾桶点击即删除整块色板，不弹出确认，铅笔可编辑或移除其中的单色，操作后仍留在颜色面板。

组合支持新建、编辑、移除、复制给 AI 及复制 CSS。默认新建两个颜色，全部颜色都能移除，至少保留一个。

## 字体方案

新增 type: "font" 组件。默认 mode: "single"，entries 只有一条 body，标题和正文共用该字体族，CSS 自动补充标题的字重、字号和行高。显示名称留空时使用字体名称。

开启“分别设置标题、正文”后使用 mode: "pairing"，entries 包含 heading 和 body，可增加 code。未设置 mode 的已有字体搭配仍按 heading/body 读取，无需迁移。每条字体包含：

- key、name、role、family、fallbacks、weight，以及可选 size、lineHeight 和 color（六位 HEX 文字颜色）。
- source: { type: "system" } 使用系统字体。
- source: { type: "file", path: "…" } 记录本地字体路径；管理服务将相对路径转换为从 dataDir 解析的绝对路径。
- source: { type: "web", url: "https://…/fonts.css" } 记录字体提供方的 HTTP(S) CSS 样式链接。

编辑器支持备用字体、字重、字号、行高和原生文件选择。字体名称与备用字体是字体族名称，不能填写任意 CSS 声明。网页来源链接不允许 file:、javascript: 或携带用户名和密码。

字体面板预览上方提供图标式字号（8–96 px）、加粗与文字颜色控件；搭配字体可以选择标题、正文或代码用途。修改立即预览，点击“保存设置”写入字体资源，也可还原未保存的修改。双击使用或复制给 AI 时先保存该字体的待存修改。文字颜色可以一键恢复为跟随配色，CSS 输出对应的 `--font-用途-color` 变量，AI 查询也能取得颜色、字号和字重。

组合预览使用本机可用字体；不会读取本地字体文件或加载外部字体样式。未安装的字体使用备用字体。字体面板按设置字号显示，大字号会换行并可滚动查看。

## 复制给 AI

默认复制只包含使用意图与名称，例如：

> 请使用 Dockyard 中的颜色 "森林绿"。
>
> 请使用 Dockyard 中的颜色组合 "森林绿"。
>
> 请使用 Dockyard 中的字体 "Microsoft YaHei"。

颜色或组合重名时使用唯一 ID 或单色完整引用。AI 按名称或 ID 查询 Dockyard，按需取得色值、字体文件路径和 CSS。顶部“复制 CSS”和 HEX 旁的“复制色值”保留直接复制样式或色值的操作。

复制会将资源加入当前工作区以便查询；尚未保存的单色或内置组合会先登记，当前使用项保持不变。

## 工作区默认方案

Workspace 新增可选字段：
```json
{
  "schemaVersion": 1,
  "id": "website",
  "name": "公司官网",
  "componentIds": ["brand", "reading"],
  "design": { "paletteId": "brand", "fontId": "reading" }
}
```

设置默认方案会在同一写锁中将其加入该工作区的组件组合。只可指定已注册且启用的网页配色或字体组件。其他工作区不受影响。

取消组合中的对应组件、停用组件、变更为不适用的组件类型或移除资源，会清除对应默认项。点击“取消使用”仅清除默认项，方案仍可留在组合内查询。

Core API: manager.setWorkspaceDesign(workspaceId, { paletteId?, fontId? })。

## AI 查询

仍只提供 context、search、get 三个只读工具。

- context.workspace.design 返回默认的 paletteRef/fontRef；组件摘要中的 schemeRef 可用于读取整套方案。context 不返回颜色条目、字体加载路径或 CSS。
- get({ ref: "brand::$scheme" }) 返回 type: "palette"，包含 entries 和 CSS。也可以按该组件 ID 或准确名称查询。
- get({ ref: "reading::$scheme" }) 返回 type: "font-scheme"，包含字体 entries、加载来源和 CSS。
- get({ ref: "brand::primary" }) 返回单色及其 role。
- get({ ref: "reading::body" }) 返回单条字体，含 family/fallbacks/weight/size/lineHeight/source。本地字体附带 availability，检查文件存在性但不读取文件内容。
- search 返回方案和单条资源的候选引用，也能按字体名称查找；继续遵守当前工作区与启用状态。

新方案保留 $scheme 作为整套查询引用，条目 key 不允许使用该名字。重名仍返回候选，完整 ref 消歧。

## CSS 与验证

“复制 CSS”输出 :root 颜色与字体变量，以及所需的 @import / @font-face。网页代码需引用这些变量；本地字体文件需从记录的路径复制到 CSS 所列的相对 fonts 路径（文件名带 heading/body/code 前缀，避免同名文件冲突）。复制 CSS 本身不会复制或安装字体。
```powershell
npm test
npm run desktop:design-smoke
```

桌面验证使用隔离的临时数据，涵盖独立面板、内置选项、单击预览/双击使用、新增保存即用、单字体与可选搭配、1–9 个颜色与可选用途、字体加载来源、输入校验、复制 CSS、单色及组合简短复制、重名 ID 查询、编辑/移除、工作区切换及重启恢复。截图保存在 output/playwright。
