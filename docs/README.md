# ADVX Live 文档

> 状态：当前产品与技术入口
>
> 更新日期：2026-08-08

ADVX Live（AI Audience / 众声）是 Windows x64 本地 AI 虚拟观众桌面
应用。当前系统由 Electron/React 桌面端和 Electron 监督的 Bun/Elysia
后端组成。Python 实现只作为迁移 parity oracle 和本地回滚证据保留，
不是当前开发、CI、打包或发布运行时。

## 当前事实来源

| 文档 | 权威范围 |
| --- | --- |
| [PRODUCT.md](./PRODUCT.md) | 用户价值、范围、隐私和验收 |
| [AUDIENCE_SPEAKING_PRODUCT_SPEC.md](./AUDIENCE_SPEAKING_PRODUCT_SPEC.md) | AI 观众发言时机、上下文、独立决策和展示规则 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Electron、Bun 后端、协议、进程和数据边界 |
| [BACKEND_DESIGN.md](./BACKEND_DESIGN.md) | Elysia、Application/Domain/Ports、Provider 和 SQLite 设计 |
| [INGEST_PROTOCOL.md](./INGEST_PROTOCOL.md) | HTTP v3、realtime v4/v3 和 `ADVX-BIN/3` 数据合同 |
| [REAL_PIPELINE.md](./REAL_PIPELINE.md) | 本地真实管线联调 |
| [OPERATIONS.md](./OPERATIONS.md) | 安装、检查、故障排查、打包、安全和发布边界 |
| [DECISIONS.md](./DECISIONS.md) | 当前接受、被取代和开放的架构决定 |

## 当前系统摘要

```text
selected screen / text / microphone / Windows system audio
                         |
                   Electron Main
               capture + safeStorage
               process supervision
                         |
         authenticated HTTP v3 / realtime v4
                         |
              Bun 1.3.14 backend :8765
            Elysia + bun:sqlite + Drizzle
                  |                 |
             StepFun ASR     model Provider
                         |
             individual Viewer decisions
                         |
                  desktop Overlay
```

- 当前发布与支持平台仅为 Windows x64。
- Bun `1.3.14` 是包管理器、脚本运行器和后端运行时。
- Node `24.18.0` 只服务 Electron、Playwright、Vitest Browser Mode 和
  electron-builder。
- `/health` 不是公开探针；它与其他控制面请求一样需要本地 token 和
  protocol v3。
- realtime 当前 writer 是 v4，读取兼容 v3；binary 当前 writer 是 v3。
- AI 观众各自决定是否发言，不存在中心 Director 选人或统一答案。
- Provider 凭据由 Electron `safeStorage` 保管；后端只接收一次性启动凭据
  和受控配置，不把密钥写入环境、数据库、日志或证据。
- 停止与退出必须释放媒体、Session、端口 8765 和后端子进程。

## 历史文档

以下文件保留需求和设计演进，不是当前实现说明：

- [VIEWER_RUNTIME_INTEGRATION_PLAN.md](./VIEWER_RUNTIME_INTEGRATION_PLAN.md)
- [VIEWER_RUNTIME_REQUIREMENTS_LOG.md](./VIEWER_RUNTIME_REQUIREMENTS_LOG.md)
- [VIEWER_BEHAVIOR_REDESIGN.md](./VIEWER_BEHAVIOR_REDESIGN.md)
- [SB6657_STYLE_TUNING.md](./SB6657_STYLE_TUNING.md)（Python parity 调优资产）
- [`apps/backend`](../apps/backend/README.md) Python parity oracle

历史记录中的 FastAPI、Python 生产运行时、Pydantic 合同权威、Director、
旧包管理器命令或跨平台发布声明均不覆盖当前文档。

迁移执行状态由
[migrations/typescript-bun/README.md](./migrations/typescript-bun/README.md)
及其 `STATE.md`/`00-MASTER-PLAN.md` 管理。
