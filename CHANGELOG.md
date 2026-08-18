# Changelog

## [0.2.0] - 2026-08-18

### Added
- 四模式锚定气泡：approval（授权）/ question（提问，单选即答/多选确认）/ plan-review（计划确认）/ goal-blocked（目标阻断通知 + 去会话查看）。
- 归档会话过滤：订阅 `ctx.workspaces.list` 的 `archivedSessionIds`，已归档会话不弹任何通知，归档/取消归档即时生效。

### Fixed
- 授权应答绑定展示时的 `approvalId`：审批被替换/处理后拒绝发送，杜绝「所见非所批」。
- 多会话气泡互相重叠问题（垂直/水平错开锚定）。

### Security
- 走官方 `PendingWait.respond()` 通道，与会话内面板同协议、同审计。

### Verified
- jsdom 端到端测试 16/16 全绿。
- `npm pack` 产物完整（9 文件，194KB unpacked）。
- 真实 DSH Web 界面截图验证（assets/）。

### Install
- profile `package.json` 添加依赖 + `dsh.profile.bundles` 注册，重启 `dsh web` 生效（详见 README）。