# Dockyard Phase 3 数据格式与 Core API

所有 JSON 使用 UTF-8，读取兼容 BOM，schemaVersion 当前为 1。Core 拒绝未知字段、错误版本及超出边界的配置。

## 目录与清单

```text
DockyardData/
  config.json
  workspaces/default.json
  components/demo.json
  components/palette.json
  components/fx-rules.json
  index/fx-library.json
```

config.json：

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "activeWorkspaceId": "default",
  "workspaceIds": ["default"],
  "componentIds": ["demo", "palette", "fx-rules"]
}
```

workspaceIds 与 componentIds 是已注册配置的清单。磁盘上的未引用 JSON 不自动生效。清单最多包含 128 个 Workspace、512 个 Component；单个 Workspace 最多选中 128 个 Component。配置 ID 为小写英数、下划线/连字符，最多 64 字符，拒绝 Windows 保留文件名。

workspaces/default.json：

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "id": "default",
  "name": "Default",
  "componentIds": ["demo", "palette", "fx-rules"]
}
```

Workspace 的可选 `disabledComponentIds` 保存暂停使用的组件 ID，必须是 `componentIds` 的子集；省略时全部默认启用。取消勾选只更新暂停状态，资源仍留在组合中，且不同工作区互不影响。

只有所选 Workspace（启动参数固定绑定或全局 Active Workspace）的 componentIds 与全局 enabled 为 true 的交集，排除 disabledComponentIds 后可查询。未知引用、缺失记录、记录 ID 与文件名不一致都会报错，不回退到全局资源。

## Component

六类组件均有 schemaVersion、revision、id、type、name、可选 description、enabled。revision 由管理服务递增；文件路径和名称原样保留，匹配忽略首尾空白及大小写。

File：

```json
{
  "schemaVersion": 1,
  "id": "demo",
  "type": "file",
  "name": "Soft Smoke",
  "key": "002511",
  "source": { "path": "files/002511.png" },
  "aliases": ["轻烟雾"],
  "tags": ["smoke"],
  "metadata": {},
  "enabled": true
}
```

直接 JSON 中的相对路径从 dataDir 解析；管理服务保存 File/Folder 时转换为绝对路径。source 可以位于 dataDir 外；配置文件自身不能通过链接逃离 dataDir。

Palette：

```json
{
  "schemaVersion": 1,
  "id": "palette",
  "type": "palette",
  "name": "My Palette",
  "entries": [
    {
      "key": "warm-orange",
      "name": "Warm Orange",
      "value": "#E98C3A",
      "aliases": ["暖橙色"]
    }
  ]
}
```

普通色板最多 1024 个颜色；`mode: "design"` 的颜色组合包含 1–9 个颜色，每项 `role` 可选，已指定的用途不能重复。组内 key 不允许大小写重复。颜色格式为 #RRGGBB，返回时统一大写。资源级别的 aliases/tags/metadata 默认分别为 []/[]/{}。

Instruction：

```json
{
  "schemaVersion": 1,
  "id": "fx-rules",
  "type": "instruction",
  "name": "FX Design Rules",
  "key": "fx-rules",
  "aliases": ["FX 规则"],
  "content": "保持轮廓清晰，优先使用轻量效果。"
}
```

content 是显式 get 时返回的纯文本，UTF-8 最多 16 KiB。它属于资源数据，不自动成为宿主系统指令。外部规则文件使用 File Component。

Folder：

```json
{
  "schemaVersion": 1,
  "id": "fx-library",
  "type": "folder",
  "name": "FX Library",
  "source": { "path": "D:/Assets/FX" }
}
```

添加 Folder 或修改其来源时，saveComponent 会保存配置后执行首次扫描。根目录失败会抛出 INDEX_REFRESH_FAILED，配置仍保留，修复来源后调用 refresh。编辑同来源的名称、启用状态或 overrides 不会重扫。

可选 overrides 数组最多 1024 项，每项包含 relativePath 和可选 name、description、aliases、tags。relativePath 必须与实际索引路径一致，使用斜杠；没有 override 的文件自动使用文件名。metadata 更新在下次查询生效，无需逐个登记素材。例子见 [Folder 配置](../examples/folder-component.json)。

## 网页配色和字体

Palette 支持可选 mode: "design" 和每条颜色的 role，Font 为新增 type: "font" 组件。Workspace 可选 design 记录默认配色和字体。整套方案使用 componentId::$scheme 引用。旧数据无需迁移。完整字段、校验、CSS 与 Core API 见 [网页设计资源](design-resources.md)。

## Folder 索引

index/<componentId>.json 结构：

```ts
{
  schemaVersion: 1,
  componentId: 'fx-library',
  snapshot: { // 没有任何成功扫描时为 null
    indexVersion: 1,
    generation: 'UUID',
    sourceFingerprint: 'SHA-256',
    sourceRoot: '绝对规范根路径',
    builtAt: 'ISO UTC',
    status: 'ready' | 'partial',
    entries: [{ relativePath, key, name, extension }]
  },
  lastRefresh: {
    status: 'ready' | 'partial' | 'failed',
    attemptedAt: 'ISO UTC',
    files: 0, skipped: 0, errors: 0,
    issues: [{ path: '相对目录/文件', code: 'EACCES' }]
  }
}
```

key 从文件名主体的起始数字提取，后面需接下划线、连字符、空格或主体结束，保留前导零。无数字 ID 时 key 使用相对路径；canonical ref 始终为 componentId::relativePath，包含扩展名。

来源指纹覆盖绝对配置路径与扫描器版本。索引 schema、索引版本、来源指纹或内部 ID 不匹配时不能复用旧记录。sourceRoot 保存扫描时解析的实际根目录，get 会重新检查配置根路径与目标文件 realpath 的范围。

索引最多 64 MiB / 100,000 个文件；扫描最多进入 100,000 个目录，同时处理最多 8 个目录。超限作为失败保留旧快照。跳过 symlink/junction、数据目录自身及其子目录、.git、node_modules；普通隐藏素材不一概跳过。不能表示为安全引用的文件名计入跳过和错误。

完整扫描或 partial 扫描完成后，以同目录临时文件原子替换索引；根目录失败保留上一次快照并更新 lastRefresh，绝不发布“成功空索引”。partial/failed 状态通过 diagnostics 报告，最多保存 20 条具体 issue，计数保留全部错误。

刷新持有独立 .refresh-<componentId>.lock；不会占用整个扫描期间的配置 .write-lock。运行中的 MCP 继续读取旧快照；发布后通过文件身份（实际路径、设备/inode、大小和高精度修改时间）失效缓存。MCP 查询不扫描来源目录、不刷新、不写数据。

配置来源在扫描中改变时丢弃该次发布并返回 INDEX_STALE；直接编辑来源 JSON 但未 refresh 时，查询也返回 INDEX_STALE。

## search

输入 `{ query: string }`，去除首尾空白后最多 256 字符且需含文字或数字。只含空白/分隔符时返回 INVALID_QUERY；无匹配返回空 items。

```ts
{
  items: [{ ref, key, name, type, componentId, componentName, reasons, value? }],
  total: 0,
  truncated: false,
  diagnostics: [{ componentId, code, message, builtAt?, errors?, skipped? }]
}
```

最多 10 项；total 是裁剪前匹配数，条数或序列化字节超限时 truncated 为 true。颜色附 value，文件不附完整目录树，规则不附正文，metadata 不进入列表。

排序优先精确 ref、key、alias；其后比较去重 token 的覆盖数、匹配字段强度，最后以 ref 的代码点顺序固定排序。字段包括名称/文件名、别名、标签、相对路径、扩展名、组件名称/ID 和描述。大小写、空白、下划线、连字符、点与斜杠会规范化；匹配为子串，无语义翻译、向量或文件内容索引。

诊断代码包括 INDEX_NOT_READY、INDEX_STALE、INDEX_INVALID、INDEX_PARTIAL、INDEX_REFRESH_FAILED。search 可返回健康组件结果；刷新失败且来源未变时可检索保留快照，并附失败诊断。无法校验或来源陈旧的快照不参与搜索。

## get 与引用

- 非 Folder 完整引用：componentId::key，例如 demo::002511、palette::warm-orange、fx-rules::fx-rules。
- 普通引用依次匹配 key → alias → 精确名称/文件名。
- id: 前缀只匹配 key，不向别名或名称回退。
- 同一级出现多个结果，返回 AMBIGUOUS_REF 和最多 10 个候选；不自动择一。
- 不接受绝对路径、父目录跳转或控制字符作为引用，也不根据 ref 拼接路径访问文件。
- 未启用或不在当前 Workspace 的资源统一返回 NOT_FOUND，不包含其 metadata。
- Folder 索引缺失、陈旧、损坏、partial 或刷新失败时，普通引用不能断言全范围唯一性，会报告索引问题。精确指定健康组件的 ref 仍可解析；partial/保留快照中的完整 ref 可查询已知条目，缺失条目返回对应索引诊断。
- 完整 ref 先按原始规范值精确比较，再忽略大小写查找；这样大小写敏感磁盘上的碰撞也可通过返回的 ref 消歧。

Resource 公共字段为 ref、key、name、componentId、aliases、tags、metadata 和可选 description；判别字段 type 对应：

| type | 载荷 |
| --- | --- |
| file | source.path、availability、kind |
| color | value |
| instruction | content |

文件存在状态在 get 时实时检查，新增/删除配置在下一次调用读取；没有文件内容读取或后台监听。

## context

输入为严格的空对象 `{}`；不接受 workspaceId、limit 或其他参数。三个只读工具均通过相同的 Active Workspace 快照与索引状态加载逻辑确定范围，context 不创建逐资源投影、不扫描目录、不检查素材可用性。

```ts
{
  workspace: { id, name, revision },
  components: [{
    id, type, name, description?, descriptionTruncated,
    resourceCount, // number | null
    index?: {
      status: 'ready' | 'partial' | 'refresh_failed' | 'not_ready' | 'stale' | 'invalid',
      builtAt?, lastRefreshAt?, snapshotStatus?: 'ready' | 'partial'
    }
  }],
  total: 0,
  truncated: false,
  diagnostics: [{ componentId, code, message, builtAt?, errors?, skipped? }],
  diagnosticTotal: 0
}
```

- workspace 不返回完整 componentIds，components 仅包含当前选中且启用的组件，按 Workspace 中的配置顺序排列。
- 组件与诊断列表分别最多 50 项；total / diagnosticTotal 保留完整范围的数量。实际序列化响应超过 60 KiB 时进一步裁剪列表，truncated 为 true。
- description 最多 256 个 Unicode 码点，超出部分由 descriptionTruncated 明示；不截断到半个代理对。descriptionTruncated 与列表截断标记独立。
- File / Instruction 的 resourceCount 为 1，Palette 为配置条目数；Folder 为可用索引快照中的条目数，不能查询的索引为 null。0 仅代表确知为空。
- Folder index 状态复用 search 的诊断；refresh_failed 可附保留快照的 builtAt / snapshotStatus。首次失败可显示 lastRefreshAt，缺失或损坏索引不会虚构时间。
- 不返回 source、文件名清单、aliases、tags、metadata、Palette entries 或 Instruction content。需要具体资源时使用 search/get。
- 无效配置仍报错而不退回全局资源；Folder 索引问题以诊断返回，便于宿主发现需刷新或修复的组件。

## Core API

```ts
import { DockyardManager, ResourceRegistry } from '@dockyard/core';

const manager = new DockyardManager(dataDir);
await manager.initialize();
await manager.saveComponent(component);
await manager.setWorkspaceComponents('default', ['demo', 'palette']);

const registry = new ResourceRegistry(dataDir);
const resource = await registry.get('暖橙色');
const results = await registry.search('暖橙色');
const environment = await registry.context();
// 对已注册的 Folder：
const index = await manager.refresh('fx-library');
```

Workspace 管理方法：

| 方法 | 行为 |
| --- | --- |
| createWorkspace(input) | 创建新 ID；已存在时返回 CONFIG_INVALID，保留已有组合 |
| saveWorkspace(input) | 完整保存/更新；适合显式提交完整表单 |
| renameWorkspace(id, name) | 在写锁内读取现有组合，只更新名称与 revision |
| listWorkspaces() | 只读一致性列表，返回 activeWorkspaceId 和全部 Workspace；不公开为 MCP 工具 |
| setWorkspaceComponents(id, ids) | 更新指定组合，可清空；拒绝未知或重复组件 ID |
| setActiveWorkspaceComponents(ids) | 在同一写锁内选择当前 Workspace 并更新组合 |
| setActiveWorkspace(id) | 校验目标 Workspace 及其组件记录后切换；同一 ID 幂等 |
| removeComponent(id) | 从所有 Workspace 撤销组件引用，保留素材与未引用配置 |

这些方法供开发 CLI 与后续 Desktop 调用。MCP 仅公开 get/search/context；创建 Workspace 不自动切换，新组件不自动加入组合。所有会话共享一个 Active Workspace。

管理服务按写锁中的最新状态执行 rename / selection，避免并发覆盖其他字段；完整 saveWorkspace 仍以调用方提交的完整表单为准。切换目标记录损坏时保留当前 Workspace。listWorkspaces 和 MCP 读取进行有限一致性重试，仍忙则返回 DATA_BUSY。

JsonStore 是底层存储；业务写入应经 DockyardManager，使用同目录临时文件、校验、同步、原子替换。管理器在进程内按 dataDir 串行写入，.write-lock 避免其他写入者并发覆盖；MCP 读取会检查锁和各记录内容标记，有限重试后报 DATA_BUSY。

跨文件操作先写依赖再发布清单，先撤引用再移除注册。不提供跨文件事务；失败可能留下未注册的配置文件，查询不会自动加载它们。配置 revision 和单条记录 revision 分开递增，不能只检查 config.json revision 来判断所有组件是否变化。

## 迁移

旧 assets/*.json 不再由 Core 读取。开发命令 migrate 会先校验源记录，再独占创建新目标目录，保留素材路径与 key，并报告新的完整引用。每条旧记录变成一个 File Component；最多 128 条以适应默认 Workspace 上限。目标存在时拒绝写入。

示例：

```powershell
node scripts/dockyard.mjs migrate --source "C:\OldDockyardData" --data-dir .local/migrated
```

迁移成功后可先用开发命令 get 验证，再选择是否让宿主使用新 dataDir。命令不修改 Codex 注册或源目录。

## 统一配置组件

`configuration` 组件的 `items` 统一描述资源开关、资源选择、数值、布尔、文本和普通选择参数。底层 File / Folder / Instruction / Palette / Font 保持原有结构。Workspace 的可选 `configurations` 字段按组件 ID 保存各自的预设和值，缺省使用组件默认值。查询会合并有效引用并过滤关闭的资源；旧 `componentIds` 不会绕过配置。结构、生效规则与管理 API 见 [Workspace 绑定与统一配置组件](workspace-configuration.md)。
