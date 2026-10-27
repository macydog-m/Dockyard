# Workspace 绑定与统一配置组件

Workspace 决定工作环境，Configuration Component 组织资源和参数，ConfigItem 是最小配置单位，MCP 提供只读查询。File、Folder、Instruction、Palette、Font 的底层存储和解析继续复用。

## 固定查询工作区

MCP 启动入口接受以下可选参数，顺序不限：

```text
node packages/mcp/dist/index.js --data-dir <data-directory> --workspace-id <workspace-id>
```

省略 `--workspace-id` 时，三个工具跟随全局 Active Workspace。指定后，该 MCP 进程只查询指定 Workspace，桌面切换全局空间不会影响它。多个进程可以绑定同一个 Workspace。

明确绑定的空间不存在、文件丢失、JSON 损坏或引用无效时返回错误，不回退到全局空间。绑定只影响后续查询，不清除 Agent 历史，也不改变宿主文件访问权限。MCP 工具参数不接受 Workspace 覆盖或绑定修改。

桌面入口：**预设工作区 → 工作区绑定 → 生成项目绑定配置**。复制完整 TOML 片段，手动合并到目标项目 `.codex/config.toml`，替换同名 `[mcp_servers.dockyard]` 表并保留其他服务。Dockyard 不自动写入用户的 Codex 配置或 Hooks。

受信任项目的 Codex 配置优先于用户配置，CLI `-c` 优先于项目配置。嵌套表合并，`args` 数组整体替换。在项目目录执行 `codex mcp get dockyard --json` 检查合并结果，重新启动 MCP 后调用 `context` 核对 Workspace ID；不能假定已有会话自动重新加载启动参数。

手动单次 CLI 覆盖示例：

```powershell
codex -C C:\Projects\lion -c 'mcp_servers.dockyard.args=["C:/Apps/Dockyard/mcp/index.js","--data-dir","C:/DockyardData","--workspace-id","spine-animation"]'
```

入口和数据目录需替换为桌面生成的实际值；`command`、`env` 继承已配置的 MCP 条目。恢复会话时重新提供覆盖并检查 `context`，不会持久保存会话映射。

本版本不提供任务自动识别、会话 ID 绑定或任务列表。真实 CLI 探针与桌面并发、恢复路径的未验证范围见 [Codex 绑定验证](codex-binding-validation.md)。

## 配置面板

点击工具栏中工作区右侧的 **配置** 图标打开面板。界面只有一层“当前预设”，预设由组件组合而成，组件承载信息。旧数据中的配置与预设会平铺显示，不再要求用户先选择“配置组件”。

预设栏提供新增、删除图标和“复制给 AI”。新增默认创建空白预设，也可以勾选“复制当前预设”，复制结构和已保存的值。删除需要确认；删除最后一个预设会把对应旧配置容器移出当前工作区，保留可恢复数据，不删除其他工作区的配置或源文件。

“添加组件”可创建开关、滑块、颜色选取、复选框、数值输入、下拉选择、文本输入，也可添加文件夹、文件、文本规则或已有资源。每个组件具有名称、可选说明和给 AI 的说明；数值可设置范围、步长和默认值，下拉框可逐行输入选项。组件通过“编辑组件”修改或删除。资源正文仍是共享资源，组件结构和参数按预设独立保存。

面板采用两列布局，调整参数后自动保存。切换预设不会丢失等待保存的值。保存失败或无效的草稿保留，可重试或撤销；复制、删除或修改结构前先处理未保存的修改。不同字段的并发修改会合并，同一字段或结构冲突不会覆盖外部更新。面板不显示 JSON 定义或生效配置明细，AI 通过现有只读 MCP 获取内容。

## ConfigItem 数据结构

配置组件保存在 `components/<id>.json`。下例假设资源库已注册 `spine-assets`、`animation-rules`、`export-file-01`、`export-file-02`：

```json
{
  "schemaVersion": 1,
  "id": "animation-config",
  "name": "动画制作",
  "type": "configuration",
  "aiInstructions": "仅在用户要求制作动画时使用这些配置。",
  "items": [
    { "key": "assets", "label": "素材资源", "kind": "resource",
      "target": "spine-assets", "control": "toggle", "default": true },
    { "key": "rules", "label": "制作规则", "kind": "resource",
      "target": "animation-rules", "default": true },
    { "key": "export", "label": "导出配置", "kind": "resource-select", "default": "01",
      "options": [
        { "value": "01", "label": "导出 01", "target": "export-file-01" },
        { "value": "02", "label": "导出 02", "target": "export-file-02" }
      ] },
    { "key": "bounce", "label": "弹动感强度", "kind": "number", "control": "slider",
      "default": 50, "min": 0, "max": 100, "step": 5, "description": "0 为无弹动，100 为最强弹动。" },
    { "key": "reuseBones", "label": "复用骨骼", "kind": "boolean", "default": true },
    { "key": "animation", "label": "动画类型", "kind": "select", "default": "idle",
      "options": [{ "value": "idle", "label": "待机" }, { "value": "walk", "label": "行走" }] },
    { "key": "output", "label": "输出路径", "kind": "text", "default": "./output" }
  ]
}
```

| kind | control | 当前值与含义 |
| --- | --- | --- |
| `resource` | `toggle`（默认） | boolean；启用一个稳定资源引用 |
| `resource-select` | `select`（默认） | 一个 option.value，或 `null` 表示不使用；选项各有 target |
| `number` | `number`（默认）或 `slider` | 有限数值；slider 必须有 min/max/step |
| `boolean` | `toggle`（默认）或 `checkbox` | boolean；由使用资源的 AI 或程序解释 |
| `select` | `select`（默认） | 一个 option.value；普通参数，不改变资源可见性 |
| `text` | `text`（默认） | 最多 4096 字符的文本 |

`target` 接受稳定 Component ID（整个组件）或精确返回的 `componentId::localRef`（单个资源），不接受模糊名称或绝对路径。大小写必须与正式 Ref 一致。配置引用的资源无需另外加入 Workspace 的 `componentIds`，但必须在资源库注册。V1 不允许引用另一个 configuration，包括自引用和循环引用。

非文件夹的精确 Ref 在写入时校验是否存在；文件夹 Ref 按索引查询，索引缺失、过期或资源不存在仍返回原有诊断，不触发自动扫描。资源定义中被引用的 key 不能直接改名，删除被引用的资源也会被拒绝；先编辑引用它的配置。

`key` 使用英文字母开头，允许字母、数字、下划线、连字符，最多 64 字符；拒绝重复和对象原型保留键。每项必需 `label`，可选 `description` 和 `aiInstructions`。这些说明保持资源数据身份，不提升指令权限。所有定义严格校验，不执行 JavaScript，不加载动态渲染器；文本中的路径不会触发文件操作。

数值步长从 min（缺省为 0）起算，允许浮点计算微小误差。选项值必须唯一，最多 100 个。每个预设最多 64 个组件，允许空白面板；每个底层配置容器在每个 Workspace 最多 32 个唯一 ID 和名称的预设。导入文件最多 1 MiB，存储和 MCP 继续受既有大小限制。

## Workspace 状态与有效资源

实际值保存在 `workspaces/<id>.json` 的可选 `configurations` 字段：

```json
{
  "configurations": {
    "animation-config": {
      "activePresetId": "default",
      "presets": [
        { "id": "default", "name": "Default", "values": { "rules": false, "export": "02", "bounce": 80 } }
      ]
    }
  }
}
```

预设可另存 `items`，表示该预设独立的组件结构；省略时兼容旧数据，沿用底层配置定义的 `items`。`items: []` 表示空白预设。`saveItems` 管理操作只修改指定预设的结构，删除组件同时清理它的值；复制预设会完整复制结构和值。颜色组件使用 `kind: "text"`、`control: "color"`，值为六位十六进制颜色（如 `#336699`），MCP 按文本值返回。

这是 Workspace 的局部字段。未保存时使用虚拟 default 预设，省略的值取组件默认值。共享资源的全局 `enabled` 不会因配置开关而改变。暂时从工作区移除配置会保留预设，重新加入可恢复；显式删除配置会清理各工作区引用和预设，原配置文件按已有策略保留为未注册数据。

查询按以下规则计算可见资源：

1. Workspace 中选中的配置，其基础定义和各预设中的所有资源项、资源选项声明管理范围。即使配置或其中的项目关闭，旧 `componentIds` 也不能绕过开关。
2. 一旦引用某个组件（包括只引用其中一个 Ref），该组件的可见内容由配置决定。只选择一个 Ref 就只开放该 Ref，不顺带开放整个组件或 `$scheme`。
3. 启用的完整组件引用开放全部资源；精确 Ref 引用开放对应资源。多个配置的启用项取并集，没有隐含顺序或“最后一个覆盖”。一个开关关闭后，另一个启用引用仍可使同一资源可见。
4. 资源全局停用或 Workspace 的 `disabledComponentIds` 是上限，配置值不能绕过它。面板会提示暂停，并可取消当前工作区的资源暂停；不会修改共享资源的全局 `enabled`。引用失效、JSON 损坏等错误不回退到旧列表。
5. 没有被任何选中配置引用的资源，继续按原 Workspace 组件列表生效。移除配置容器会解除其管理范围，直接列出的资源重新遵循旧规则；仅停用容器则保留管理范围。

已有五类资源和无 `configurations` 字段的 schemaVersion 1 数据无需迁移。此功能取代开发中的独立 Parameters 方案；对外数据格式只有 `configuration`，不新增第二套参数组件。旧版本不能编辑带有新类型或新字段的数据。

## MCP 与管理边界

| 工具 | 行为 |
| --- | --- |
| `context` | 当前作用域、有效组件摘要与索引诊断；配置包含 `currentRef`，不返回配置项和值；资源数量和设计默认 Ref 遵循过滤结果 |
| `search` | 只搜索有效资源；按名称、ID、简介发现配置，不展开其内容 |
| `get` | `animation-config::$current` 返回预设信息与当前生效 items：启用资源的 target、选中资源选项以及参数的值、约束与含义 |

配置的 `get` 不展开资源内容，不返回未启用的资源项或未选择的选项。普通 boolean 参数为 false 时仍返回。整体 Component ID 的 target 可用 `context`/`search` 找到具体资源 Ref；精确 target 可直接 `get`。文件内容仍由宿主按自身权限按需读取。

缓存包含 Workspace 状态、组件定义、索引版本和可见 Ref 集合；下一次查询即可看到保存、切换预设或停用后的结果。三个工具统一使用同一过滤路径。

写入经过受限 Desktop IPC → Worker → Core → JsonStore 写锁与原子文件写入。`importConfiguration`、`updateConfiguration` 和定义编辑是管理 API，不是 MCP 工具。MCP 仍只提供 get/search/context。“复制给 AI”只包含使用意图和配置 Ref。

## 验证

```powershell
npm test
npm run desktop:build
node scripts/configuration-smoke.mjs
node scripts/desktop-smoke.mjs
node scripts/design-smoke.mjs
node scripts/screenshot-resource-smoke.mjs
node scripts/codex-binding-probe.mjs
```

最后一项需要 Codex CLI，使用隔离配置、合成 MCP 与本机 Responses 测试端点，不加载用户凭据或调用真实模型，不能替代真实桌面并发或恢复会话验收。

系统剪贴板不可用时，可给 Electron 烟测显式添加 `--capture-clipboard`，日志会标记只检查实际 IPC 写入文本。该模式不代表操作系统剪贴板回读验证通过。

截图登记烟测使用临时数据和合成图片，检查缓存、工作区登记、重复登记、标注更新与资源查询，以及复制失败后仍可登记。它不读取屏幕或操作系统剪贴板。

核心回归包括工作区隔离、预设、并发冲突、旧列表绕过防护、多个配置合并、完整组件和精确 Ref 过滤、文件夹索引、失效或嵌套引用、被引用资源删除保护和定义变更。桌面烟测涵盖单层预设选择、全部组件类型、独立结构、复制与删除、资源和 AI 说明、自动保存冲突、空白面板、窄窗口布局和重启恢复。

### 本地验收记录（2026-10-22）

- Node.js 24.19.0：`npm test` 138 项通过，无失败或跳过。
- `npm run desktop:build` 通过；最后的面板调整另行完成桌面构建与配置烟测。
- `configuration-smoke`、`desktop-smoke`、`design-smoke` 均通过，使用显式 `--capture-clipboard` 模式。系统剪贴板回读未通过验收，不计入这些结果。
- 配置烟测另外验证取消工作区资源暂停，以及旧列表中的配色资源仍受配置开关限制，关闭时复制入口提示先启用。
- 工具栏提供独立配置入口；配置烟测验证两列开关、右侧说明和窄视口两列布局。工具栏隐藏/恢复、记事本与画布切换回归通过，配置面板与记事本使用独立的渲染标识。
- `screenshot-resource-smoke` 通过，验证统一配置组件存在时截图缓存与登记正常，以及复制失败不阻断登记。
- `npm run privacy:check` 无发现，`git diff --check` 通过。未执行发布或真实桌面会话自动绑定验收。
