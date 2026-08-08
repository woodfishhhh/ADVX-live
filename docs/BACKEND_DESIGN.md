# Bun 后端详细设计

> 状态：Current Backend Baseline
>
> 更新日期：2026-08-08

本文描述 `apps/backend-bun` 当前实现。产品发言语义以
[AI 观众发言产品规格](./AUDIENCE_SPEAKING_PRODUCT_SPEC.md) 为准。

## 1. 设计结论

- Bun `1.3.14` 是运行时和脚本执行器。
- Elysia 承载回环 HTTP/WebSocket；`@advx/contracts` 承载 runtime schemas。
- Application/Domain 只通过 Ports 使用 persistence、ASR、model 和 clock。
- `bun:sqlite` 是单写者数据库；Drizzle 提供 typed query adapter，迁移仍是
  可审计的普通 SQL。
- 一个后端进程只服务一个 Electron 父进程和一个活动产品 Session。
- 每个 Viewer 独立决策；本地 scheduler 只执行容量、优先级和 deadline，
  不生成统一答案。
- 原始媒体和凭据不持久化。

## 2. 依赖方向

```text
api -------------> application -------------> domain
                         |
                         v
                       ports
                    /    |     \
          persistence  providers  observability
```

允许的 composition roots 是产品进程、headless/diagnostics 工具和测试装配。
Transport 不查询数据库策略，Domain 不 import Elysia/Drizzle/Provider SDK，
Provider adapter 不修改 Session 状态。

## 3. 进程装配

`src/main.ts`：

1. 读取严格 allowlist 的后端配置；
2. 从 inherited file descriptor 一次性消费 startup token；
3. 打开并迁移 SQLite，装配 repository、Provider 和 runtime control；
4. 绑定 `127.0.0.1:8765`；
5. 使用真实认证 `/health` 自检；
6. 向父进程发布 `advx.backend.ready` 和协议版本；
7. 监视父 PID、shutdown IPC、信号和异常退出；
8. 按 deadline 清理 listener、WebSocket、任务、数据库和 token。

配置拒绝非 loopback host、明文 credential 字段、未知键、越界容量和
`ADVX_LOCAL_TOKEN`/`*_API_KEY` 风格的普通环境密钥。

## 4. API 与协议

### 4.1 System

- `GET /health`：认证的 process health、版本和 protocol v3。
- readiness/version metadata：供 Electron 判定 build、HTTP/realtime 和
  schema 兼容。
- 文档与 debug endpoints 仅在显式 development flags 下可用。

### 4.2 Control plane

HTTP operation registry 是 method/path、request schema、status response 和
normalized error 的权威。所有请求先检查 Bearer token 和
`X-ADVX-Protocol-Version: 3`，再进入 Application service。

### 4.3 Realtime

`/ws` 使用 `client.hello` 建立身份和版本。v4 是当前 writer，v3 是兼容
reader。Hub 管理 connection/queue/backpressure/heartbeat/handshake limits，
并发送 session status、ingest ack/rejection、ASR transcript 和 barrage。

### 4.4 Binary ingest

`@advx/contracts/binary` 在正文进入业务层前解析 `ADVX-BIN` envelope。
当前 v3 音频 envelope 原子提交；帧携带稳定 input ID、时间、mime metadata
和有界 body。重复、过期、未知 Session、错误 source/type 或超限 payload
明确拒绝。

## 5. Application services

| Service | Owns | Does not own |
| --- | --- | --- |
| Session lifecycle | 状态机、幂等 start、pause/resume/stop、epoch/revision | Electron 媒体权限 |
| Runtime spec coordinator | canonical spec、hash、compare-and-swap apply | UI 草稿 |
| Realtime dispatch | 输入 ownership、queue、ack/rejection | Provider wire format |
| Observation scheduling | 优先级、latest-wins、deadline、冻结上下文 | 中心生成答案 |
| Session audience | Viewer identity、presence、moderation、behavior state | Persona 持久模板编辑 UI |
| Viewer generation | 独立 context、Provider request、schema validation | 全局排名或统一回答 |
| Barrage pipeline | 最终围栏、去重、公开事件、publish | 绕过身份的手工弹幕 |
| Shared brain | Room 公开上下文、长期记忆候选、Mode Meme side effects | Viewer 私有长期事实 |
| Replay/eval | 脱敏 bundle、deterministic replay、规则评估 | 把 recorded 冒充 live |

## 6. 发言管线

1. Text/final voice/frame/ambient 输入成为有 ID 的 Observation work。
2. Scheduler 根据产品规格进行优先级替换和容量控制。
3. Context builder 只读取新鲜、有界公开文本、回复上下文、相关帧和共享记忆。
4. 每个可参与 Viewer 根据自己的状态独立判断 silence 或 generation。
5. Model adapter 只在调用边界解析 frame bytes 和 credential reference。
6. 输出必须是 role-whitelisted 的结构化 payload。
7. Barrage pipeline 重新验证 Session、epoch、Viewer、sequence、presence、
   moderation、behavior revision、deadline、cancellation、target、evidence、
   content 和 dedupe。
8. 合法结果与必要 side effect 在持久化边界提交，再发布 realtime event。

被取代、超时、取消、协议非法或所有权不匹配的结果零副作用。

## 7. Persistence

### 7.1 Database lifecycle

- 路径由 Electron `userData` 派生，禁止依赖 cwd。
- foreign keys、WAL、busy timeout 和完整性检查在打开时设置。
- migrations 0001-0006 在 listener ready 前执行。
- 写事务有界；outbox 分批最多处理固定数量并在批次间 yield。
- backup/restore 使用 SQLite Online Backup API 和 copy-and-swap，不复制活动
  WAL 文件冒充备份。

### 7.2 Current schema ownership

| Area | Durable data |
| --- | --- |
| Room/Session | identity、state、epoch、revision、config hash、恢复 metadata |
| Viewer | Session-scoped identity、Persona assignment、presence/moderation/behavior state |
| Room events | 有界结构化公开事件与 ordering |
| Long-term memory | Room-shared memory、candidate、evidence refs、CAS head |
| Mode memes | mode namespace、candidate、status、decay/archive metadata |
| Durable outbox | commit 后待发布的幂等 side effects |

不保存原始音频、原始帧、完整 prompt、密钥、隐藏推理或原始 Provider body。

### 7.3 Synchronous budget

`bun:sqlite` 同步切片必须保持已接受预算：事件 append 单次不超过 10 ms；
上下文、runtime revision、32 Viewer 恢复、Top-K 记忆和 16 条 outbox batch
保持各自 p95 门限。扩大窗口、Top-K 或 batch 前必须重新测量，不得靠放宽
deadline 掩盖阻塞。

## 8. Providers

Application 只依赖 ASR 和 Model Ports。

- StepFun adapter 管理麦克风与系统声音两个隔离通道、SSE、final transcript、
  deadline、cancellation 和 normalized error。
- Model Gateway 使用 OpenAI-compatible adapter 和 Vercel AI SDK，管理能力
  探测、结构化输出、超时、取消、重试和错误归一化。
- Credential reference 由 Electron 配置边界解析；序列化 public contract、
  database、trace 和 diagnostics 不含密钥。

## 9. Observability

Pino JSON logs、OpenTelemetry spans、AI-call evidence、debug trace、diagnostic
bundle 和 profiles 使用 session/observation/request/viewer IDs 关联。所有
artifact 先 redaction，再写入有界 user-data 路径。Remote telemetry 默认
关闭，不能因 trace 启用而泄露正文或凭据。

## 10. Testing and evidence

- `bun test`：Domain、Application、API、Provider、persistence 和 fault tests。
- recorded integration：真实 Elysia、SQLite 和 deterministic Providers。
- TST-008：真实 Electron 监督 Bun source/compiled backend，验证 Overlay 和
  cleanup。
- parity：仅在迁移任务要求时与历史 Python oracle 比较。
- credentialed live：独立 opt-in 证据，不能混入普通测试。

## 11. Historical boundary

`apps/backend` 的 Python service 和 Alembic history 只为 parity/rollback
保留。当前后端不得 import、启动、打包或生成合同自该目录。删除必须等待
后续人工门禁，而不是在普通重构中顺手移除。
