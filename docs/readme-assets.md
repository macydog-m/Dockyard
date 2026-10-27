# README 展示素材

中英文各四张 PNG 均为当前 Windows 应用的白天模式实拍，窗口后使用不同的合成彩色渐变和细线背景，展示原生 Acrylic 毛玻璃的透色与模糊效果。界面没有重新绘制或修改主题样式。

仅使用隔离的演示数据和内置预设，不载入日常工作区。画面不包含个人路径、账号、密钥或其他桌面窗口；PNG 不含文本或 EXIF 元数据。
英文截图中的示例规则在隔离演示数据中使用英文正文；应用切换语言不会改写用户保存的规则。

## 工具栏

![白天模式悬浮工具栏](images/light-toolbar.png)

## 规则

![规则列表与演示规则预览](images/light-rules.png)

## 配色

![内置色彩组合与选色面板](images/light-colors.png)

## 字体

![内置字体与网页排版预览](images/light-fonts.png)

## Skill 对话示意图

`images/dock-skill-ocean.png` 为中文版本，`images/dock-skill-ocean-en.png` 为英文版本。
中文 README 引用中文图，英文、日文和韩文 README 引用英文图。英文图通过 imagegen 翻译图中文字，
保留原图的九项色值与布局，并将展示名称“海岸蓝”写作“Ocean blue”。
两张图都是依据实际 MCP 查询数据制作的对话示意图，并非真实聊天截图或运行中的页面。

## 在根目录 README 中引用

```markdown
![Dockyard 白天模式工具栏](docs/images/light-toolbar.png)
![Dockyard 规则管理](docs/images/light-rules.png)
![Dockyard 配色面板](docs/images/light-colors.png)
![Dockyard 字体预览](docs/images/light-fonts.png)
```

## 重新拍摄

在启用系统透明效果的 Windows 桌面会话中运行：

```powershell
npm run desktop:build
node scripts/readme-screenshots.mjs
node scripts/readme-screenshots.mjs --english
```

脚本临时显示合成背景与演示窗口，完成后自动关闭。中文图片沿用原文件名，英文版本加 `-en` 后缀，更新到 `docs/images/`；英文、日文和韩文 README 引用英文版本。隔离演示数据及检查报告保留在被 Git 忽略的 `.local/readme-*` 中。每张图使用固定的不同色相，便于复现。重新拍摄后仍需检查画面，避免其他置顶窗口或通知进入截图。
