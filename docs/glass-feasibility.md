# 玻璃材质可行性实验（2026-09-29）

## 结论与证据边界

在本机 Electron 44.4.5 上，单个非透明 BrowserWindow 使用 backgroundMaterial: acrylic、透明网页背景，可以显示背后另一测试窗口的条纹和色块，并产生真实模糊。原生窗口捕获中可见模糊条纹、红黄蓝背景、清晰文字与白色描边。此配置无需额外的玻璃背板窗口。

这证明 Electron 支持所需的基础材质，但不代表当前 Dockyard 的多窗口实现已经修复，也不证明完全匹配参考图。测试背景是程序创建的图案，没有截图采样用户桌面来伪造玻璃。

## 测试记录

| 配置 | 页面按钮与窗口生命周期 | 原生视觉确认 |
| --- | --- | --- |
| 透明窗口、18% 深灰填充 | 通过 | 未完成 |
| 单窗口深色 Acrylic | 通过 | 已看到真实背景模糊及清晰描边 |
| 单窗口浅色 Acrylic | 通过 | 未完成 |
| 透明内容窗口 + 独立 Acrylic 背板 | 通过 | 未完成；不能据此认定视觉达标 |

所有配置在背景窗口取得焦点后仍保持可见。页面自动点击不等于物理鼠标命中测试；失焦后的材质像素也尚未核验。当前系统报告 reducedTransparency=false、highContrast=false。

双窗口视觉检查时，Computer Use 捕获返回 `foreground window did not report a process id`，刷新窗口列表并重试仍失败，停止使用该捕获工具。本次没有证明双窗口就是黑底的唯一根因。深色主题本身也不能作为充分解释，因为单窗口深色 Acrylic 已显示正常模糊。

## 首选改造路线：保留 Electron / React / Core

1. 工具条和展开面板分别成为紧贴内容尺寸的 BrowserWindow；每个窗口同时承载内容与 Acrylic，不再用无内容 BaseWindow 叠在下方。
2. 两窗口之间真正留出桌面间隙，取消“大宿主窗口 + 多块原生区域”的结构；圆角由原生窗口负责，网页绘制内部高光描边。
3. 主进程统一管理数据、窗口位置、关闭与焦点。React 保留资源列表、编辑器和色盘，增加工具条/面板入口及状态通知。
4. 编辑器复用面板窗口。拖动工具条时同步面板位置；失焦逻辑区分内部窗口切换与外部应用切换。
5. 验收必须覆盖黑/白/彩色背景，激活与失焦、拖动、开关弹窗、屏幕缩放、截图取色隐藏恢复，以及原生鼠标命中。

改造范围为主进程窗口管理、渲染入口和状态同步，保留资源数据格式、Core 和 MCP。已有单窗口实验支持此方向，但整套 Dockyard 迁移尚未实施。

## 精细透明度的备选路线：Windows 原生宿主

如果 Electron 系统预设 Acrylic 仍显得过厚，使用 Windows App SDK DesktopAcrylicController，显式控制 TintColor、TintOpacity、LuminosityOpacity、FallbackColor，并管理激活状态。先用 WinUI 3 最小窗口验证目标效果，再决定是否迁移宿主。

需要保留 React 时，可评估透明 WebView2 承载现有界面；业务 Core/MCP 保留为 Node 子进程，通过受限 IPC 通信。此路线需要重做窗口/前端桥接、文件选择、屏幕工具和安装生命周期。透明 WebView2 与所选宿主的具体组合必须先验证，不能仅凭 API 存在就承诺成功。

原生模块接入现有 Electron HWND 也可研究，但 DesktopAcrylicController 需要合适的 composition target 和 DispatcherQueue，不能只传一个 HWND 就假设可用。不要把它当成简单插件替换。

官方依据：
- https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller2
- https://www.electronjs.org/docs/latest/tutorial/custom-window-styles

## 复现

使用项目 Node 24 运行 `scripts/glass-material-check.mjs`，结果保存到 `output/playwright/glass-material-check.json`。测试会创建并关闭隔离窗口，不修改业务数据。

使用 Electron 运行 `scripts/glass-material-lab.cjs` 可手动观察。测试窗口中按 1 为纯透明，2 为深色单窗口 Acrylic，3 为浅色单窗口 Acrylic，4 为双窗口叠层，Esc 退出。测试只包含自建条纹和彩色背景。
