# Windows 10 玻璃和透明圆角修复（2026-09-29）

## Win11 圆角外灰边修复（2026-10-08）

在 Windows 11 Build 26200、Electron 44.4.5 上，原先的系统 Acrylic 路径会给圆角外的像素着色。红色测试背景为 RGB (228,89,85)，四角实际为 (198,59,55)。仅设置透明窗口、原生圆角或窗口区域未解决此问题。

主窗口现统一使用 Windows 10 已有的 HostBackdropBrush 几何裁剪路径，14 DIP 圆角外完全透明，内部灰色底色、日夜主题和实时模糊保留。系统 Acrylic 后端仅保留供显式探针调用。以下 9 月记录描述此前的实现和验收。

本次在 Win11 开发版通过构建、9 项材质测试和真实 DWM 回归：收起、展开、编辑、移动失焦、红蓝背景、实色回退、恢复与黑夜共 9 个状态的四角均与测试背景完全一致；条纹模糊标准差约 1.32，背景变化仍实时影响玻璃像素。测试同步适配选中资源后编辑、默认黑夜主题及颜色过渡等待。本次未重新验证 Win10 实机或安装包。

## 此前的 Win10 验收

本机为 Windows 10 22H2 / 10.0.19045，系统透明度已开启，缩放为 125%。最初实现将 Build < 22621 全部标记为 solid，并创建非透明窗口，因此显示实色。首次兼容修复使用 ACCENT_ENABLE_ACRYLICBLURBEHIND 后能够模糊，但 Windows 将材质铺满矩形 HWND，CSS 圆角之外仍露出灰色硬角。

## 实现

- Windows 11 22H2 及以上继续使用 Electron 的 backgroundMaterial: acrylic。
- Windows 10 1809（Build 17763）至 Windows 11 21H2，通过 Koffi 在主进程创建 Windows.UI.Composition.Compositor、DesktopWindowTarget 和 HostBackdropBrush，在内容下方绘制实时背景模糊。
- SetWindowCompositionAttribute 仅设置 WCA_ACCENT_POLICY / ACCENT_ENABLE_HOSTBACKDROP（5），启用宿主背景采样；不再用状态 4 铺满矩形 Acrylic。
- CompositionRoundedRectangleGeometry + CompositionGeometricClip 裁剪玻璃视觉本身。圆角与 CSS 的 14 DIP 一致，GetClientRect / GetDpiForWindow 提供真实客户区像素和缩放；窗口尺寸、DPI、显示恢复及 DWM 变更会同步。圆角外不绘制玻璃，直接透出桌面。
- 系统降低透明度或高对比度时移除合成根视觉并使用实色；恢复后重新启用原生玻璃。接口或几何更新失败时清除玻璃并降级到半透明。更旧系统直接使用半透明。
- 由同一个窗口承载玻璃和内容，不添加背板窗口，不调用 setShape，不对整个窗口应用 opacity。普通 HWND region 在本机不能裁掉状态 4 的 Acrylic 背景，未采用该无效方案。
- Windows Runtime 接口先 QueryInterface，再调用 SDK 定义的接口方法。DispatcherQueue 在主线程保留至进程结束，各窗口关闭时释放其 COM 引用和合成目标。Renderer 不能传入句柄、接口标识或 DLL 路径。
- Koffi 及当前平台的 N-API 二进制随 dist/node_modules 打包，安装器包含运行时依赖；无需安装编译工具或额外系统组件。

宿主背景启用使用未公开的 Windows 合成接口，因此保留诊断和失败回退。Windows Runtime 的 [HostBackdropBrush](https://learn.microsoft.com/en-us/uwp/api/windows.ui.composition.compositor.createhostbackdropbrush) 和 [CompositionGeometricClip](https://learn.microsoft.com/en-us/uwp/api/windows.ui.composition.compositiongeometricclip) 是公开接口。

## 验证

原生回归使用隔离演示数据和自建背景，通过 desktopCapturer 获取真实 DWM 合成结果，只保存测试应用窗口区域。以红色 #e45955 和蓝色 #619bd7 作为实际背景时，四角采样分别与 RGB (228,89,85)、(97,155,215) 完全一致；覆盖收起、展开、编辑、移动失焦、原生材质关闭与恢复。该验证直接检查角外真实透色，可发现矩形灰底。

本机 125% DPI 下，细条纹模糊后的灰度标准差约 1.21；改变真实背景颜色时，中间材质红通道均值约 176→82，蓝通道约 75→169，证明透明圆角之外仍有实时背景模糊。

- npm test：89 项，包含平台路径、几何与 IPC 验证、材质失败和尺寸更新失败回退、主题/DPI/窗口变更与资源清理。
- npm run build -w @dockyard/desktop：TypeScript 检查和打包。
- node scripts/windows-glass-smoke.mjs：真实模糊、透色、四角、展开编辑、失焦和材质恢复。
- node scripts/glass-smoke.mjs：编辑弹窗、色盘、列表、反馈、收起和单窗口结构。
- node scripts/desktop-smoke.mjs：资源编辑、组合、文件选择、刷新、安全隔离和独立 MCP。
- node scripts/widget-smoke.mjs：取色、截图、剪贴板、标注和恢复。

上述检查已在本机通过。离线安装器重新生成后，最新 .local/releases/win-unpacked/Dockyard.exe 的原生四角验证和桌面功能回归也通过；Koffi 从发布程序自身 resources/app/node_modules 加载，模糊与八种状态的四角像素结果均与开发版一致。

Windows 11 原生系统材质分支由单元测试覆盖，本次未在真实 Windows 11 设备上复验。

## 复现

```powershell
npm ci
npm run desktop:build
node scripts/windows-glass-smoke.mjs
```

检查离线目录包：运行 npm run desktop:installer，设置 DOCKYARD_DESKTOP_EXE 指向 .local/releases/win-unpacked/Dockyard.exe，再运行原生玻璃脚本。完成后关闭测试窗口。
