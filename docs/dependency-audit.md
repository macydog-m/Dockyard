# 依赖审计记录

## 2026-10-27 · 新仓库源码基线

Electron 更新为 44.9.3，fast-uri 更新为 3.1.9，undici 的两条依赖链分别更新为 6.29.1 和 7.30.1。修复本次审计发现的 2 项高危、1 项中危告警；全依赖 npm audit 结果为 0 告警。保留原有主版本范围，不使用强制跨主版本升级。

此结果针对当前源码锁文件，不代表历史安装包已修复。本仓库不迁入旧安装包，未来发行须从审核后的源码重新构建并验收。以下为历史审计记录。

## 2026-10-23 · beta.2

对当前锁文件执行 npm audit，全依赖结果为 0 告警（包含开发依赖）。
此前记录的 8 项中危不再出现在本次审计结果中；以下内容保留为历史记录。
这只代表 npm 已知公告检查结果，不替代 Electron、原生二进制和干净机器验收。

## 2026-10-18 · beta.1

日期：2026-10-18。审计经维护者授权，向 npm 审计服务提交依赖名称与版本。
独立开源副本已重新审计，结果与下表一致。完整机器报告由维护者留存，不随源码提交。

## 结果与修复

| 范围 | 修复前 | 修复后 |
| --- | --- | --- |
| 全部依赖 | 2 高危、8 中危、0 严重 | 0 高危、8 中危、0 严重 |
| 生产依赖（`--omit=dev`） | 本轮未单独记录修复前结果 | 0 告警 |

- MCP SDK client/server/core 从 2.1.0 同步更新为 2.3.1，修复 OAuth 客户端可能
  向 MCP 服务指定的授权服务器发送凭据的问题。Dockyard 当前使用本地 stdio，
  但仍更新受影响依赖，避免依赖已知漏洞版本。
  公告：[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)。
- `http-cache-semantics` 更新到 4.3.0，修复缓存 max-stale 处理可能导致跨用户响应泄露的问题。
  公告：[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)。

SDK 更新后的 Apache-2.0 许可由打包时生成的第三方许可文件保留，不以项目 MIT
许可替代它。锁文件包含固定的解析版本与完整性信息。

## 尚未修复的构建依赖链

剩余 8 个受影响包是 `sprintf-js` 一项根因及其影响链，不是 8 个独立根因：

`electron-builder → app-builder-lib → @electron/get → global-agent → roarr → sprintf-js`

其他关联包为 `dmg-builder` 和 `electron-builder-squirrel-windows`。
问题是可控格式字符串中的无界精度值可能触发异常，导致操作中断。
截至本次审计，npm 最新 `sprintf-js` 为 1.1.3，公告未给出修复版本。
公告：[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)。

这条链属于开发/打包依赖，不是 Dockyard 应用运行时依赖。它仍属于构建供应链风险，
不能因为生产依赖报告为零就视为已经解决。npm 建议将 electron-builder 从 26.15.3
降到 26.5.0；本次未采用该大范围降级，也未使用 `npm audit fix --force` 或隐藏告警。
公开发行前应复查上游修复，或在验证替代构建方案后处理；如决定接受剩余风险，
需要维护者明确记录依据。

CI 使用 `npm audit --audit-level=high` 阻止高危及严重告警；中危仍会显示。
该门槛不代表中危获准忽略，也不替代发布前的风险决定。

## 验证边界

`npm audit --omit=dev` 的零告警只描述 npm 对所选依赖图的已知公告结果。
Electron 虽在开发依赖中声明，却随桌面包分发；Chromium、原生二进制、系统组件和
未公开漏洞也需要单独关注。此报告不宣称整个安装包不存在漏洞。
