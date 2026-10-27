# 记事本 SVG 来源与许可核验

日期：2026-10-18。范围：`apps/desktop/src/renderer/assets/notebook/`。

**当前源码已替换为可追溯的官方开源图标或自行构造的简单几何图形，并补齐许可文本。**
这解决了当前分发文件的来源与署名缺口。不能仅凭外观认定旧导出文件的完整版权链，
也不能用新声明为旧文件追溯授权；本开源基线仅包含核验后的替代素材，不导入旧仓库历史。

## 核验依据和处理

原目录有 28 个 SVG，多数是路径展开的设计工具导出，缺少源地址和许可。
其中 20 个变体的形状与 Lucide、4 个与 Phosphor 图标吻合，但这是识别线索，
不足以证明每个旧文件的获取渠道和授权。因此直接从官方固定提交取得同名图标替换。

| 当前素材 | 来源与版权 | 授权和处理 |
| --- | --- | --- |
| 20 个 Lucide 变体、14 种设计 | Lucide Icons and Contributors；部分设计衍生自 Cole Bemis 的 Feather | ISC；衍生部分保留 MIT。完整上游合并许可原样保留 |
| 4 个 Phosphor 变体 | Phosphor Icons，`dots-three-bold` 与 regular `x` | MIT，完整版权和许可原样保留 |
| 两个连接圆点及规则点阵 | Dockyard 自行构造的简单几何图形 | 项目 MIT |
| 未使用的静态曲线 `canvasimg2.svg` | 旧文件来源不明 | 已删除；实际连接线由程序按端点绘制 |

Lucide 的 14 种设计为：`notebook-pen`、`workflow`、`plus`、`check`、`git-branch`、
`arrow-up-right`、`minimize-2`、`pencil`、`sticky-note`、`circle-dot`、
`mouse-pointer-2`、`hand`、`minus`、`scan`。

官方来源：

- [Lucide 许可说明](https://lucide.dev/license)。固定提交
  [`1ef60af944de207e0d5176905a0759ba12e6ee8d` 的完整许可](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/LICENSE)。
- [Phosphor 固定提交 `2b75f3ad12b420c9504ef05df8d2564a28f8500e` 的 MIT 许可](https://github.com/phosphor-icons/core/blob/2b75f3ad12b420c9504ef05df8d2564a28f8500e/LICENSE)。

官方文件通过 GitHub CLI 读取，并核对 API 提供的 Git blob 摘要。
逐文件 URL、提交、上游和本地 SHA-256、修改项目记录在
[`sources.json`](../apps/desktop/src/renderer/assets/notebook/sources.json)。
官方图形路径保留，只调整根属性里的大小、颜色和 Lucide 线宽以匹配现有界面。
这些许可证允许使用、修改和分发；分发时必须保留适用的版权、许可和免责文本。
项目自身的 MIT 不替代第三方许可证。

## 保留许可的方式

- 每个官方 SVG 带源地址和许可文本位置注释。
- 素材目录的 `LICENSES/lucide.txt`、`phosphor.txt` 为上游完整文本，
  `dockyard.txt` 为项目 MIT；素材 README 和清单一并保留。
- 桌面构建将这些文件复制到 `ui/assets/notebook/`，随应用资源一起打包。
- `scripts/check-notebook-assets.mjs` 校验 27 个 SVG 的清单、摘要、来源字段和许可文本存在性，
  已接入桌面构建。此检查防止未经记录的素材变更，不代替人工授权核验。

官方源文件与许可证的固定提交链接、逐文件摘要见上文清单。

构建将保留素材来源和许可文本，正式发行前还需核对实际分发包。
