# 参与 Dockyard

使用 Node.js 24、npm 和 UTF-8 文本。桌面功能与打包当前以 Windows x64 为目标。

```powershell
npm ci
npm test
npm run desktop:build
npm run privacy:check
```

每个 PR 集中解决一个问题，说明改动前后的行为与验证结果。修改桌面交互时，
请用隔离数据运行对应的 smoke 脚本；不要用自己的工作区制作测试截图。
不要提交 `.local`、构建产物、个人配置、密钥、证书、真实资源索引或私人路径。

遵循 [AGENTS.md](AGENTS.md) 的产品原则：默认复制给 AI 的文本只保留使用意图
和资源名称或 ID，其余信息按需查询。避免为简单操作增加不必要的选项。

使用 GitHub 提供的 noreply 邮箱提交可以保护个人邮箱；仅更改未来提交配置
不会修改历史。不要为了贡献代码改写公共主分支历史。

提交贡献表示你有权提供这些内容，并同意将原创贡献按项目的 MIT 许可证提供。
第三方代码和素材必须保留原有许可与署名。安全问题参见 [SECURITY.md](SECURITY.md)。
