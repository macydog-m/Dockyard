# 版本与本地打包

当前源码版本为 `0.1.0-beta.3`，目标平台为 Windows x64。
本仓库尚未发布安装包。先制作并验证安装包，再准备 GitHub Release 草稿；是否已公开以 GitHub Releases 为准。

## 版本来源

根目录 `package.json` 是版本来源。以下命令同步所有工作区、内部依赖、锁文件
和 Shared 导出的运行时版本。MCP 服务、自检客户端、安装器和桌面包使用同一版本。

```powershell
npm run version:check
# 准备下一版时才执行，例如：
npm run version:set -- 0.1.0-beta.2
```

不再支持 `DOCKYARD_BUILD_VERSION` 的临时覆盖，避免文件名与运行时版本不同。
修复发布后缺陷增加补丁版本，新增兼容功能增加次版本；不兼容变更在变更记录中
明确说明。数据 `schemaVersion` 与应用版本分开管理，不随每次发版机械增加。

## 本地成品包

使用干净检出的 Windows x64 工作区和 Node.js 24，先运行：

```powershell
npm ci
npm test
npm run privacy:check
npm audit --audit-level=high
npm run desktop:installer
```

输出在 `.local/releases/<version>/`：

- `Dockyard-Setup-<version>-x64.exe`：离线安装器。
- `Dockyard-<version>-x64.zip`：目录版；解压后运行 `Dockyard.exe`。
- `SHA256SUMS.txt`：本次 EXE、ZIP 与构建器返回的 blockmap 附件的 SHA-256。
- `win-unpacked/`：用于检查的未压缩应用目录。

目录版的数据仍默认保存到 `%LOCALAPPDATA%/Dockyard`，不是把数据放在 EXE
旁边的完全便携模式。当前包未签名，Windows 可能显示未知发布者提示。

构建使用新建的 `.local/builds/desktop-*` 目录，不复用开发用 `dist`，不复制
个人工作区。构建时收集实际打包依赖的许可文本；Electron 自带许可文件也会保留。
每个输出版本目录必须不存在，避免覆盖已经验收的附件。失败后保留诊断目录；
检查后将失败目录移走，再重试相同版本。不要把旧版本的 SHA256 文件复制到新目录。

只需要调试目录包时运行 `npm run desktop:pack`，输出位于
`.local/directory-packages/<version>/Dockyard-win32-x64/`，不生成安装器。

打包后的测试通过环境变量选择准确的 EXE，避免误测旧包：

```powershell
$version = node -p "require('./package.json').version"
$env:DOCKYARD_DESKTOP_EXE = (Resolve-Path ".local/releases/$version/win-unpacked/Dockyard.exe").Path
node scripts/desktop-smoke.mjs --packaged
node scripts/desktop-connect-smoke.mjs
Remove-Item Env:DOCKYARD_DESKTOP_EXE
```

连接测试需要本机 Codex CLI，并使用隔离配置。干净 Windows 中还应验证安装、
升级、卸载保留数据、文件选择和宿主重新发现 MCP。真实模型测试需要另行确认
数据发送与账户额度，普通 CI 不执行它。

## 绿色免安装版

在同版本安装器构建完成后运行：

```powershell
npm run desktop:portable
npm run desktop:portable-smoke
```

也可以通过 `npm run desktop:portable -- --source <win-unpacked目录>` 指定已核验的同版本目录包。
不重新编译应用；打包器检查源版本，复制成品并新增绿色版启动器。输出在
`.local/portable-releases/<version>/`，包含 `Dockyard-Portable-<version>-x64.zip`
和独立的 `SHA256SUMS-Portable.txt`，不会覆盖安装包及其校验文件。

完整解压后双击根目录的 **Dockyard.exe**，不要单独运行 `App/Dockyard.exe`。
程序和 Electron 运行时位于 `App`；工作区、索引、笔记、截图和界面偏好保存在
旁边的 `Data` 文件夹。绿色版使用 Windows 自带的 .NET Framework 4.x 启动器，
无需安装、管理员权限或另装 Node.js；当前同样未签名。请放在可写目录，不要直接
在 ZIP 内或 Program Files 中运行。

升级时先退出程序，将新版解压到新目录，再复制旧版的整个 `Data` 文件夹。
移动时退出后带走整个目录；外部素材使用绝对路径，素材移动后需重新选择或刷新。
移动后重新生成 Agent 连接配置。删除整个绿色包也会删除其中的数据，应先备份 Data。
`portable-smoke` 从真实 ZIP 解压，以中文、空格和 & 路径启动，验证空数据初始化、
笔记和规则保存、整包移动、语言持久化、Agent 新路径和独立 MCP；使用隔离宿主配置。

## 发布到 GitHub

先完成 [开源准备清单](open-source-preparation.md)，再选择固定提交，更新版本
和 CHANGELOG，通过 CI 后创建对应 `v<version>` 标签。先创建 Release 草稿，
上传并核对所有附件、校验和、更新说明与已知限制，再确认发布。
不要覆盖已发行版本的附件。启用不可变 Release 后，发布前更要完成附件审阅。
当前 CI 只有检查权限，不会打标签、上传附件或自动发布。
