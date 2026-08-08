# 系统架构

> 状态：Current Architecture Baseline
>
> 更新日期：2026-08-08
>
> 当前发布与支持范围：Windows x64

本文描述当前 Electron + TypeScript + Bun 产品系统。AI 观众发言行为以
[AI 观众发言产品规格](./AUDIENCE_SPEAKING_PRODUCT_SPEC.md) 为准。

## 1. 架构目标

- 在用户电脑上形成私有、可停止、可诊断的虚拟直播闭环。
- Electron 独占操作系统权限、密钥和后端进程所有权。
- Bun 后端独占业务编排、Provider 调用和 SQLite 写入。
- 跨进程数据经过版本化 runtime schema 验证。
- 每个 Viewer 独立判断和生成，不由中心模型统一选人或统一回答。
- 任何停止、重启或失败结果都不能补发陈旧弹幕或留下孤儿进程。

## 2. 总体边界

```text
┌──────────────────────── Electron application ────────────────────────┐
│ Control renderer   Capture renderer   Overlay   Floating chat        │
│        \                 |                /            /              │
│                    Preload IPC bridges                               │
│                            |                                         │
│ Electron Main: windows, permissions, safeStorage, backend supervisor │
└────────────────────────────┬──────────────────────────────────────────┘
                             │ loopback only
                  HTTP v3 + realtime v4/v3 + ADVX-BIN/3
                             │
┌────────────────────────────▼──────────────────────────────────────────┐
│ Bun child process, 127.0.0.1:8765                                    │
│ Elysia API -> Application services -> Domain                         │
│                Ports <- Providers / bun:sqlite / observability        │
└───────────────────────┬───────────────────────┬───────────────────────┘
                        │                       │
                  StepFun ASR         OpenAI-compatible model
```

The product never exposes this backend as a network service. Binding a
non-loopback address is rejected by configuration validation.

## 3. Electron application

### 3.1 Main Process

Electron Main owns:

- Control、Capture、Overlay 和 Floating Chat 窗口；
- 屏幕、麦克风和 Windows 系统回环音频权限；
- Provider 凭据的 `safeStorage` 存取；
- 一次性本地 token 的创建和继承通道；
- Bun source/compiled backend 的启动、就绪握手、异常恢复与退出；
- HTTP/WebSocket adapter、IPC sender 校验、托盘和紧急停止；
- 日志、crash dump、content trace 和诊断 bundle 的用户数据路径。

开发模式下 Electron 监督 Bun source 入口；打包后监督
`resources/backend/advx-backend-bun.exe`。后端只有在认证 `/health`
通过且 HTTP/realtime 版本匹配后才成为 ready。

### 3.2 Renderer 与 Preload

Renderer 只表达界面状态和用户意图。它们不能直接访问文件系统、密钥、
Provider 或后端进程。Preload 暴露窄类型 IPC API，Main 对 sender、参数和
状态再次校验。

Capture 维护屏幕、麦克风和系统声音的真实媒体轨道。暂停、停止和窗口退出
必须释放轨道。Overlay 使用透明、置顶、点击穿透窗口显示已经通过最终围栏
的弹幕，不允许预置或绕过后端的“成功”弹幕冒充真实管线。

## 4. Bun backend

`apps/backend-bun` 是当前产品后端：

- `api`：Elysia HTTP、WebSocket、binary ingest、协议和错误映射；
- `application`：Session、Observation、Viewer、Barrage、Replay/Eval；
- `domain`：身份、事件、状态机和不变量；
- `infrastructure`：配置、生命周期、`bun:sqlite`、Drizzle、日志和 trace；
- `providers`：StepFun ASR 与 OpenAI-compatible model adapter。

Composition root 注入所有具体 adapter。API handler 不保存业务状态，Domain
不依赖 Elysia、SQLite、Electron 或 Provider wire format。

## 5. 协议与鉴权

- HTTP control plane 当前版本为 v3，`@advx/contracts` 注册 47 个
  method/path operation。
- 所有产品控制面请求，包括 `GET /health`，都需要
  `Authorization: Bearer <local-token>` 和
  `X-ADVX-Protocol-Version: 3`。
- WebSocket `/ws` 首帧为 `client.hello`；服务端在支持集合中协商当前
  realtime v4，并保留 v3 reader。
- 当前 binary writer 为 `ADVX-BIN/3`；v1/v2 只作兼容读取。
- JSON、binary、队列、连接和 deadline 都有硬上限；未知字段、版本、状态、
  token、长度或 ownership 不合法时明确拒绝。

## 6. 运行时数据流

1. Electron 创建 Session，并发送文本、原子音频提交、voice activity 和帧。
2. Realtime Hub 校验 token、协议、Session、输入 ID、大小和顺序。
3. 麦克风与系统声音进入相互隔离的 ASR 通道；只有 final transcript 成为
   Room Event。
4. 输入形成有界 Observation work。优先级、latest-wins、deadline、epoch 和
   sequence 防止陈旧工作产生副作用。
5. 每个符合本地确定性预算且 active 的 Viewer 使用自己的 Persona、状态、
   新鲜公开上下文和相关画面独立决定沉默或生成。
6. Provider 输出经过 schema、身份、evidence、target、moderation、时效、
   epoch、sequence 和去重围栏。
7. 合法弹幕写入 Room 公开事件并通过 realtime transport 发送给 Overlay。

AI 弹幕不会直接递归触发新的生成波。模型隐藏推理、原始 Provider payload
和调试信息不进入其他 Viewer 的上下文。

## 7. 数据与隐私

SQLite 由单个 Bun 进程写入，位于 Electron 提供的 `userData` 数据目录。
当前 schema migration 为 0001 到 0006，覆盖 Room/Session、Viewer、Room
Event、长期记忆、Mode Meme 和 durable outbox。

允许持久化的是结构化身份、配置 revision、公开事件、共享记忆、成长梗、
恢复状态和 outbox。禁止持久化 Provider 凭据、原始音频、原始帧、完整
prompt、隐藏推理和原始 Provider 响应。诊断只保存脱敏 metadata、hash、ID、
状态和有界时间信息。

## 8. 生命周期与失败语义

- Electron 是后端父进程；后端监视父 PID。
- 正常停止先取消输入和 Provider 工作，再关闭 Session、transport、数据库和
  listener。
- 正常应用退出通过本地 shutdown IPC 请求 Bun 清理；超过 deadline 才终止
  进程树。
- 后端异常退出时 Electron 使用有界退避恢复，并重新建立 WebSocket；旧 epoch
  结果永远不能发布。
- 停止完成条件包括媒体轨道关闭、端口 8765 释放和零 Electron/Bun orphan。

## 9. 可观测性与证据

结构化日志、OpenTelemetry span、AI call timeline、debug trace、replay、eval、
headless harness、profile 和 diagnostics bundle 使用同一组 ID 与 redaction
规则。Recorded、credentialed live、platform 和 synthetic evidence 必须明确
区分，不能互相代替。

## 10. 打包与平台

当前打包目标是 Windows x64 Electron + compiled Bun backend。后端作为
`extraResources` 分发，Electron fuses 和 ASAR integrity 在打包时应用。
默认包不签名、不发布、不启用自动更新。

macOS 是未来架构目标而非当前产品声明。恢复 macOS 支持前必须在真实目标
环境完成安装生命周期、原生媒体、签名和公证验证。

## 11. Historical Python boundary

Python backend、测试、toolchain 与 Alembic runtime 已经过人工门禁移除。
`apps/backend` 只保留一份文档型删除记录，不在 workspace、正常开发命令、
CI workflow、Electron supervisor 或 package artifact 中。历史 parity 与 schema
证据保留在 Git 和迁移证据中；数据 rollback 使用已验证 backup，而不是 Python
产品 fallback。
