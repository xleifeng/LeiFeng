# Cordis 迁移清单（Task 0）

**基线**：`daemon/host/src/main.js`、`stack.js`、`packages/webseed-bridge/src/main.js`，2026-09-24。类的实现文件继续保留 CJS；表中写的是运行时实例所有权。纯函数、DTO、parser helper 不需要单独 Fiber。

| 插件 owner | 现有实例 / 工作 | 消费依赖 | dispose / 停止要求 |
|---|---|---|---|
| runtime-config | `loadConfig`、目录创建、单实例 lock、日志时间戳 | 环境、repoRoot | releaseLock；日志装饰只装一次 |
| repositories | TaskRepository、TaskRegistry view、SettingsRepository、DraftRepository、RecentPathRepository、SeedStore、OperationRepository、ScheduleRepository、SqliteDatabase、HistoryRepository、LinkRepository、RemoteNodeRepository | runtime-config | sqlite backup/close；settings/schedule/task close；其余持久对象按现有 API 释放 |
| repositories | FtpSecretStore、ProxySecretStore、PrivateSpaceSecretStore、MediaSecretStore、CaptureTokenStore | runtime-config | 不输出 secret；按对象 API 清理，私密区 lockAll |
| engine-driver | WineNodeDriver 或 WindowsNodeDriver、TaskDb readers、SDK peer provider | runtime-config | `driver.shutdown()`；终止子进程、socket、重启计时器 |
| event-observation | DomainEventBus、ProgressPoller、DiagnosticEventBuffer、TaskRepository outbox 消费连接 | repositories、engine-driver | `poller.stop()`、取消 event listeners、`eventBus.close()`；outbox 确认事务不丢 |
| auth-vip | CredentialWallet、AuthManager、VipSpeedupClient、VipAccelerationManager、driver up/down listeners | engine-driver、repositories | `vipManager.stop({disable:true})`、`auth.stop()`、取消 listeners；引擎 down 先失效 VIP |
| task-core | OperationLock、TaskService、TaskQueryService、TaskGroupService、CreateTaskService、CreateDraftService、MagnetMetadataService、ProtocolParser | repositories、engine-driver、event-observation、auth-vip | 停 metadata poll/sweep；保存已有任务语义；解除 driver down → task transition |
| task-core | SettingsService、DownloadPolicyService、TaskSchedulerService、ScheduleService、IdleDownloadController、CompletionActionService | repositories、engine-driver、event-observation、task-core | scheduler/schedule/idle/completion stop；取消 policy 和 task transition listeners |
| task-core | PathService、SafePathResolver、FileOperationService、TaskOperationService、SystemIntegrationService | repositories、engine-driver、task-core | 无运行线程者无需 stop；有租约由 control-rpc 先释放 |
| product-services | ProcessRunner、SystemIdleAdapter、SystemPowerAdapter、DesktopNotificationAdapter、NotificationService | task-core、event-observation | notification.stop；执行中的外部动作按既有策略收口 |
| product-services | PrivateSpaceService、MediaService、CaptureService、HistoryService、LinkLibraryService、LinkSyncService、LinkSyncAdapter | repositories、task-core、auth-vip、event-observation | history/link stop；linkSync.stopAndClearSession；privateSpace.lockAll；media/capture 租约先停止入口 |
| product-services | RemotePairingService、RemoteNodeService、RemoteTaskService、MtlsClient factory、AccountService、DiagnosticsService、BootstrapService | repositories、engine-driver、auth-vip、task-core | remoteNodeService.stop；远端健康轮询停止；临时客户端清理 |
| control-rpc | RateLimiter、RequestAuth、V2 methods、method handler、DaemonControlDispatcher、DaemonControlServer | 前述全部 daemon 插件 | **最先** stop controlServer/断开连接并释放 leases；不再接受新操作 |
| web-api-process | `stack.js` 子进程 supervisor、Web API child | control-rpc | SIGTERM 子进程，等待有界退出；core 退出时停止 gateway |
| bridge-daemon-client | `createDaemonClient` 与导出/上传 RPC | runtime-config（桥配置） | 停新请求；等待或取消未完成请求 |
| recipient-qbit | `createQbitClient`、qbit WebUI 连接 | Recipient 定义、桥配置 | 不删除 qbit 种子；关闭请求资源 |
| bridge-orchestrator | `createOrchestrator`、sessions、recovery timers、30s monitor、Verifier fd LRU、TorrentInjector | bridge-daemon-client、Recipient、bridge-seed-http | `orchestrator.close()`；clear timers、close verifier；保留 qbit/tlei 任务 |
| bridge-seed-http | `createServer`、BEP-19 route、`/status` | bridge-orchestrator 提供的 sessions | `server.close()` 并等连接关闭；后清 sessions |

## 必须拆开的交叉引用

- `driver.on('down')` 在 driver 构造后先挂闭包，稍后才把 `vipManager`、`taskService` 赋值；迁移为服务激活后的 listener 注册。
- `policyService.scheduler = scheduler`、`policyService.scheduleService = scheduleService`、`taskGroupService.operationService = operationService` 为显式 post-bind；不得让 Cordis 注入产生隐式未就绪引用。
- `eventBus` 的 observation、transition、engine、diagnostics 多处 listener 必须由注册插件持有 disposer。
- 现有 core 的 `draftSweepTimer`、`metadataPollTimer`、`groupRefreshTimer`、`privateSweepTimer` 无 owner；各归属 task-core/product-services Fiber。
- `main.js` 的 shutdown 目前 `process.exit(0)`；迁移后由唯一 launcher 控制进程退出，插件只返回 dispose Promise。
- 桥的 HTTP 会话表由 orchestrator 创建并被 HTTP 读取；启动前先发布会话服务，再开放监听，卸载则先停止 HTTP 接收再清会话。

## 基线与现场

- 当前在线端口：16800、7127、8085；不要在同端口启动测试实例。
- `thunder.ui.v2.account.refresh` 的三个布尔验收条件均为 true（仅记录结果，不记录凭据）。
- `node --test` driver/poller/task-repository 35/35；桥 `npm test` 18/18；daemon `npm test` 全部通过。
- 原项目从未建仓库，用户已授权本轮初始化；当前 HEAD 指向 `feature/cordis-plugin-architecture`，尚无提交。
