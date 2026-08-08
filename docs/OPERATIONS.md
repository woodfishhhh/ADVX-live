# 运维、安全与发布

> 状态：Current Windows x64 Operations Baseline
>
> 更新日期：2026-08-08

## 1. 支持边界

- 产品与发布：Windows x64。
- Backend/runtime/package manager：Bun `1.3.14`。
- Electron tooling Node：`24.18.0`。
- 当前包：未签名、未发布、未部署、未启用自动更新。
- macOS：未来架构目标；当前没有支持或可用性声明。

## 2. 安装与本地开发

```powershell
bun install --frozen-lockfile --ignore-scripts
bun run contracts:bun-openapi:check
bun run typecheck
bun run dev
```

冻结安装必须使用 `bun.lock`，并保持 install scripts 禁用。不要绕过 lockfile、
临时启用 dependency trust，或从历史 workspace/lockfile 建立第二套产品依赖。

## 3. 针对性检查

```powershell
bun run typecheck
bun run test
bun run replay
bun run eval
bun run evidence
bun run audit
```

改动共享协议、鉴权、数据、进程生命周期或打包时，再运行对应的 recorded
Electron、parity、persistence 或 package gate。已经接受且未被本次改动触碰的
广泛证据不重复运行。

## 4. 数据位置

生产数据位于 Electron `app.getPath('userData')` 派生目录：

- Bun SQLite database、WAL/SHM；
- bounded JSON logs；
- crash dumps、content traces 和 diagnostics；
- securely wrapped Provider settings。

安装目录和 `resources` 只读。运行时不得把数据库、日志、凭据或可变状态写到
安装目录、cwd 或仓库。

## 5. 故障排查

### Backend 未就绪

1. 确认没有其他 listener 占用 8765。
2. 检查 Electron Main 的 `backend.process.*` 与 ready/version 记录。
3. 确认 child 使用 Bun source 或 packaged compiled executable，而非历史 oracle。
4. 确认 `/health` 请求携带当前一次性 token 和 HTTP protocol v3。
5. 使用界面重试或完整退出后重启；不要手工固定 token。

### Realtime 断开

检查 `client.hello`、协商版本、heartbeat、backpressure、payload upper bound
和 Session ownership。后端重启必须产生新 backend start ID；旧 epoch/sequence
输出不能恢复发布。

### Provider 失败

查看 normalized Provider code、retryability、deadline 和 cancellation，不要
记录原始 key、Authorization header、完整 request/response body 或用户媒体。
Recorded evidence 不能证明 credential、quota 或外部网络可用。

### 停止或退出失败

Session 停止后应释放所有 capture tracks；应用退出后 8765 应空闲且无
Electron/Bun child。先收集脱敏 diagnostics，再用 `bun run test:tst-008`
复现。不要把强杀成功当作正常 graceful cleanup 的证明。

## 6. 打包

```powershell
bun run package:desktop
```

该命令：

1. 编译 `apps/backend-bun/src/main.ts` 为 Windows x64 Bun executable；
2. 构建 Electron Main/Preload/Renderer；
3. 通过 electron-builder 生成 `apps/desktop/release/win-unpacked`；
4. 将 backend 放入 `resources/backend`；
5. 应用 Electron fuses 与 ASAR integrity。

检查 package manifest 时必须绑定 HEAD、Bun/Electron identity、文件大小和
SHA-256，并确认 source compiled backend 与 packaged backend 字节一致。

## 7. 安全基线

- 后端只绑定 loopback。
- `/health`、control、debug、replay 和 realtime 都使用本地认证与版本检查。
- startup token 经 inherited one-time channel 传递，消费后清零。
- Provider credentials 由 `safeStorage` 持有；public schema 只允许 credential
  reference，不允许 key/token/secret/password 字段。
- IPC 校验 sender 和 payload；Renderer 不启用 Node integration。
- Electron fuses 禁用 RunAsNode、Node options 和 CLI inspect，启用 cookie
  encryption、ASAR integrity 和 only-load-from-ASAR。
- Remote telemetry 默认关闭；日志、trace、diagnostics 和 replay 先脱敏。
- `bun run audit`、license/SBOM、secret 和 generated-output checks 必须在真实
  release candidate 上重新运行。

## 8. 发布门禁

当前仓库命令只产生本地 unsigned artifact。发布前至少需要：

- 当前 commit 的 frozen install、contracts、typecheck、tests、build 和 audit；
- Windows x64 installed end-to-end、restart、uninstall 和 orphan proof；
- credentialed release-critical Provider evidence；
- database migration、backup/restore 和 rollback evidence；
- manifest、SBOM、license、secret、fuse 和 ASAR integrity evidence；
- 独立 review；
- 明确的签名、渠道、staged rollout 和 incident-stop authority。

不要从本地开发任务推送、签名、发布或部署。macOS 需要独立的真实目标平台、
Developer ID、签名、公证和 installed lifecycle 证据，不能由 cross-build 替代。

## 9. Rollback 与历史 oracle

当前支持的数据 rollback 是：停止 Bun、从未被修改的 backup 恢复、再启动
已验证的 Bun runtime。Python oracle、测试和 toolchain 已经过人工门禁移除，
不再是可启动的 fallback 或发布 artifact。代码回退使用
`TS_backend_refactor` 的 Git checkpoint，数据回退继续使用 CUT-003
restore-from-backup 证据。
