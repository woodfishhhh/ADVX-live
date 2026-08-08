# 真实管线联调

> 当前支持环境：Windows x64、Bun 1.3.14

本流程启动真实 Electron、受监督 Bun 后端、StepFun ASR 和用户配置的
OpenAI-compatible model。它不是 mock、静态页面或 Python oracle 流程。

## 1. 准备

```powershell
bun --version
bun install --frozen-lockfile --ignore-scripts
bun run contracts:bun-openapi:check
```

确认 Bun 输出 `1.3.14`。不要把 Provider key 写入 `.env`、命令行、普通
配置、截图或日志；凭据应在桌面端“设置”中保存到 Electron `safeStorage`。

## 2. 启动

```powershell
bun run dev
```

`bun run dev` 启动 Electron，Electron 生成一次性本地 token 并监督 Bun
backend child。后端只监听 `127.0.0.1:8765`，认证 `/health` 和版本握手通过
后界面才显示已连接。

不要并行运行另一个占用 8765 的开发实例。若只调试一侧：

```powershell
bun run dev:desktop
bun run dev:backend
```

独立启动后端只适用于后端调试；完整产品链路必须由 Electron 持有 token、
进程和 shutdown 生命周期。

## 3. 首次配置

在“设置”中配置：

- OpenAI-compatible base URL、model 和 API key；
- StepFun ASR API key 与当前支持模型；
- 画面来源、麦克风；
- Windows 系统声音开关。

保存后按界面提示重启后端。凭据不会出现在 public contract、SQLite、诊断
bundle 或 trace 中。

## 4. 端到端验证

1. 选择一个真实窗口或屏幕和麦克风。
2. 点击开始，确认 Session 进入 running，Bun backend 状态为 connected。
3. 发送一条文字，确认出现与内容相关的 AI 弹幕。
4. 说一段话，确认麦克风 final transcript 影响随后弹幕。
5. 播放一段系统声音，确认它使用独立 ASR source，不与麦克风混音。
6. 改变画面，确认后续 Viewer request 的 frame evidence/hash 更新。
7. 打开 Overlay，确认真实 barrage 可见且窗口保持点击穿透。
8. 暂停并恢复，确认媒体轨道和输入状态同步变化。
9. 停止 Session，确认不再采集、不再补发旧结果。
10. 退出应用，确认端口 8765 释放且无 Electron/Bun orphan。

观众可能合法返回 silence。验收要求是输入、Viewer decision、Provider
request、最终围栏和公开输出可追踪，不是每个输入都强制生成固定数量弹幕。

## 5. Recorded Windows 验证

无需外部 Provider 的决定性产品链路：

```powershell
bun run test:tst-008
```

它验证 Bun source full pipeline 和 compiled Bun lifecycle，包括文字、帧、
麦克风、系统声音、真实 Overlay、清理、端口释放和无孤儿进程。Recorded
证据不能替代 credentialed live Provider 证据。

## 6. 常见问题

- **一直显示“正在启动本地服务”**：检查 8765 是否被其他实例占用，查看
  Electron Main 脱敏日志和 backend ready/version failure。
- **401 或协议错误**：不要手工复用 token；由 Electron 重新启动 backend。
  确认桌面端与后端都使用 HTTP v3、realtime v4/v3 compatibility。
- **保存 Provider 后仍使用旧配置**：按界面提示重启受监督 backend；当前
  进程不会用不同 credential profile 无保护热切换。
- **没有麦克风结果**：检查 Windows 权限、输入电平、StepFun credential 和
  ASR normalized error。
- **没有系统声音结果**：确认 Windows 系统声音开关启用且内容经过当前输出
  设备。macOS 当前不在支持范围。
- **画面不更新**：确认 Session running、capture track active，并查看
  `ingest.rejected`、WebSocket 连接和 frame evidence。
- **停止后仍有端口或进程**：这是生命周期失败，不是正常现象。保存脱敏
  diagnostics，停止重复启动，并运行 TST-008 定位 cleanup 边界。

打包、诊断和发布前检查见[运维与发布](./OPERATIONS.md)。
