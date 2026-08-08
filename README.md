# AI Audience（众声）

> 同一幕，众声不同。

AI Audience 是面向创作者的本地 AI 虚拟观众席。它读取用户主动选择的
画面、文字、麦克风和 Windows 系统声音，让具有稳定身份和性格的 AI
观众通过桌面弹幕参与现场。它不向公网推流，不创建真人房间，也不把 AI
观众包装成真实流量。

当前发布与支持范围仅为 **Windows x64**。macOS 保留架构边界，但没有
当前安装、原生媒体、签名或公证声明。

## 当前系统

```text
Control / Capture / Overlay Renderer
                 |
          Electron Main
       process + auth owner
                 |
     loopback HTTP v3 / realtime v4
                 |
     supervised Bun 1.3.14 child
   Elysia + TypeScript + bun:sqlite
        |                    |
  StepFun ASR       OpenAI-compatible model
```

- Electron Main 创建一次性本地令牌，启动并监督 Bun 后端，验证就绪版本，
  在退出时清理子进程。
- Bun 后端只监听 `127.0.0.1:8765`，包括 `/health` 在内的控制面请求都
  需要本地 Bearer token 和 HTTP protocol v3。
- WebSocket 使用 realtime protocol v4，并保留 v3 读取兼容；当前二进制
  writer 为 `ADVX-BIN/3`。
- `@advx/contracts` 是框架无关的 TypeScript runtime-schema 权威，Bun
  OpenAPI 快照用于生成和漂移检查。
- SQLite、日志和诊断数据位于 Electron `userData` 下；原始音频、画面、
  Provider 凭据和原始响应不写入数据库。
- AI 观众各自决定是否发言；不存在替观众统一选人或统一回答的中心 Director。

## 仓库结构

```text
apps/desktop         Electron + React 桌面端
apps/backend-bun     当前 Bun/Elysia 本地后端
apps/backend         历史 Python parity oracle，不是支持的产品运行时
packages/contracts   runtime schemas、协议注册表和生成的 Bun OpenAPI 类型
resources            随应用分发的观众预设
tests                跨进程、录制场景和 parity 夹具
docs                 当前产品、架构、协议、运维和决策文档
```

## 开发环境

- Windows x64
- Bun `1.3.14`
- Node.js `24.18.0`，仅用于 Electron/Playwright/Vitest Browser Mode/
  electron-builder

## 开始开发

```powershell
bun install --frozen-lockfile --ignore-scripts
bun run contracts:bun-openapi:check
bun run dev
```

`bun run dev` 启动 Electron；Electron 再监督 Bun 后端。首次真实联调在
桌面端“设置”中保存模型和 StepFun 凭据，然后选择画面与麦克风并开始直播。
凭据通过 Electron `safeStorage` 保存，不进入仓库或普通日志。

常用命令：

```powershell
bun run typecheck
bun run test
bun run build
bun run replay
bun run eval
bun run evidence
bun run audit
bun run package:desktop
```

`bun run package:desktop` 产生 Windows x64 unpacked 包，不签名、不发布、
不部署。发布边界、故障排查和安全要求见[运维与发布](./docs/OPERATIONS.md)。

## 文档

- [产品说明](./docs/PRODUCT.md)
- [AI 观众发言规格](./docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md)
- [系统架构](./docs/ARCHITECTURE.md)
- [Bun 后端设计](./docs/BACKEND_DESIGN.md)
- [实时 Ingest 协议](./docs/INGEST_PROTOCOL.md)
- [真实管线联调](./docs/REAL_PIPELINE.md)
- [运维、安全与发布](./docs/OPERATIONS.md)
- [决策与开放问题](./docs/DECISIONS.md)

TypeScript + Bun 迁移仍保留 Python parity oracle，直到后续人工删除门禁
明确允许移除；当前开发、测试、打包和产品启动均以 Bun 路径为准。
