# thunderd — 迅雷 Linux 下载 daemon

一条命令：`bash daemon/run.sh`（systemd 前台模式也可用 `bash daemon/run.sh --systemd`）会启动 daemon core 与独立 Web API；对外 JSON-RPC 监听 `127.0.0.1:16800`（`THUNDERD_PORT` 可改）。完整分层、依赖方向与独立启动方式见仓库根目录 `ARCHITECTURE.md`。

## 启动形态（profile launcher）

运行时装配统一由 Cordis 插件树完成（`packages/runtime`），旧入口 `main.js`/`stack.js` 只是兼容跳转，`run.sh` 也走同一 launcher：

```bash
# 全量形态（core + Web API 子进程）——即 run.sh 默认
node daemon/host/src/entry.mjs --profile thunderd
# 裸 core（不含 Web API）
node daemon/host/src/entry.mjs --profile thunderd-core
# 查看脱敏后的最终装配配置（不启动、不取锁）
node daemon/host/src/entry.mjs --profile thunderd --dump-config
# 用 JSON 覆写插件配置
node daemon/host/src/entry.mjs --profile thunderd --config ./my.json
```

`--config` 文件只接受 `{"plugins": [{"id": "<插件ID>", "enabled"?: boolean, "config"?: object}]}`；叠加顺序为 profile 默认 → profile patch → 用户 patch，重复 provider、缺依赖、未知字段会在启动前报错。secret 字段与磁力 URI 在 dump 中一律脱敏。桥的 `bridge-host` profile 见 `packages/webseed-bridge/README.md`。

完成 `npm --prefix webui install && npm --prefix webui run build` 后，外部 `web-api` 进程在同一端口提供迅雷原生风格 WebUI：打开 `http://127.0.0.1:16800/` 即可。新界面直接接入任务、扫码登录、VIP、设置和引擎诊断，不依赖 Electron 或第三方下载面板。可用 `THUNDERD_WEBUI_DIR` 指向另一份静态构建目录；目录不存在时只提供 JSON-RPC，不影响 daemon core。

V2 任务、创建、操作、策略、账号、私人空间、本地资料、媒体 Range、桌面集成、通知、浏览器接管和远程节点组件均已接入。V2 请求不把 secret 放进 params，而使用 `Authorization: Bearer <THUNDERD_RPC_SECRET>`；私人域另外使用 `X-Thunder-Private-Session`，只存浏览器 sessionStorage。浏览器 mutation 由 bootstrap 下发短期 CSRF token，自动随 WebUI 请求发送；CLI 可在 loopback 上不带 Origin 运行，生产临时排障可设置 `THUNDERD_CSRF=0`。默认 `THUNDERD_LEGACY_RPC=0`，生产入口只开放 `thunder.ui.v2.*`；旧兼容 handler 仅为迁移回归保留，必须显式设置 `THUNDERD_LEGACY_RPC=1` 才启用。任务数据写入 `${THUNDERD_RUNTIME_DIR}/data/tasks.json`，本地资料数据库写入 `data/thunder-data.db`（启动前 backup，迁移 001–004），诊断事件和导出均脱敏并以 ZIP 流式输出。试用加速与账号链接同步仍保持不可用；不调用云盘接口。远程 mTLS listener 只有显式证书配置后才启动。

```bash
# V2 查询
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":1,"method":"thunder.ui.v2.tasks.query","params":[{}]}'
# V2 任务操作（taskIds 必须是完整 taskId）
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":2,"method":"thunder.ui.v2.tasks.command","params":[{"taskIds":["<taskId>"],"command":"pause","idempotencyKey":"cli-1"}]}'
# 回收并明确本地文件策略
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":5,"method":"thunder.ui.v2.tasks.command","params":[{"taskIds":["<taskId>"],"command":"recycle","options":{"deleteLocalFiles":false},"idempotencyKey":"recycle-1"}]}'
# BT 种子导出只接收 taskId，不暴露 seed cache 路径
curl -L -H 'Authorization: Bearer my-secret' -o task.torrent http://127.0.0.1:16800/api/v2/tasks/<taskId>/torrent
# V2 新建任务：先预检，再 commit；不会把原始 URL 直接交给 UI 创建
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":3,"method":"thunder.ui.v2.create.preflight","params":[{"inputs":[{"kind":"link","value":"https://example.com/file.bin"}]}]}'
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":4,"method":"thunder.ui.v2.create.commit","params":[{"draftIds":["<draftId>"],"expectedRevisions":{"<draftId>":1},"idempotencyKey":"create-1"}]}'
# torrent 使用 raw body 上传，不走 JSON base64
curl -s -H 'Authorization: Bearer my-secret' -H 'Content-Type: application/x-bittorrent' -H 'X-Thunder-Filename: sample.torrent' \
  --data-binary @sample.torrent http://127.0.0.1:16800/api/v2/create-drafts/torrent
```

真实创建验收（仅使用 loopback tracker/seeder 和 `/tmp`）：

```bash
THUNDERD_RUN_CREATE_V2_IT=1 THUNDERD_CREATE_V2_PORT=16920 \
  node --test daemon/test/integration/create-v2.it.test.js
THUNDERD_RUN_CREATE_V2_BT_IT=1 THUNDERD_CREATE_V2_BT_PORT=16921 \
  node --test daemon/test/integration/create-v2-bt.it.test.js
# 真实 HTTP 文件操作矩阵（临时目录：rename → move → recycle → permanent delete）
THUNDERD_RUN_TASK_OPERATIONS_IT=1 THUNDERD_TASK_OPERATIONS_PORT=16945 \
  node --test daemon/test/integration/task-operations-v2.it.test.js
# 真实 daemon 策略持久化与 native 应用问题报告
THUNDERD_RUN_POLICIES_IT=1 THUNDERD_POLICIES_PORT=16950 \
  node --test daemon/test/integration/policies-v2.it.test.js
# 资料库/账号/私人空间单元回归
node --test daemon/test/unit/local-data-domains.test.js daemon/test/unit/account-data-rpc.test.js
```

常用 V2 账号与本地资料请求：

```bash
# 账号状态（DTO 不含 uid/token/sessionId）
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":10,"method":"thunder.ui.v2.account.get","params":[]}'
# 初始化私人空间；首次 setup 后必须再 unlock，下载内容是否静态加密取决于用户文件系统
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":11,"method":"thunder.ui.v2.private.setup","params":[{"password":"change-me"}]}'
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":12,"method":"thunder.ui.v2.private.unlock","params":[{"password":"change-me"}]}'
# unlock 返回的 session token 只放请求头，不放 params；生产脚本不得写入 shell history
curl -s -H 'Authorization: Bearer my-secret' -H 'X-Thunder-Private-Session: <private-session>' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":13,"method":"thunder.ui.v2.private.queryTasks","params":[{}]}'
# 本地历史与链接库
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":14,"method":"thunder.ui.v2.history.query","params":[{"limit":50}]}'
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":15,"method":"thunder.ui.v2.links.query","params":[{"favorite":true}]}'
```

## V2 快速上手

```bash
# 查询任务（taskId 是 V2 opaque id）
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":1,"method":"thunder.ui.v2.tasks.query","params":[{"view":"downloading"}]}'
# 任务操作
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":2,"method":"thunder.ui.v2.tasks.command","params":[{"taskIds":["<taskId>"],"command":"pause","idempotencyKey":"pause-1"}]}'
# 系统诊断（返回脱敏快照）
curl -s -H 'Authorization: Bearer my-secret' 127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":3,"method":"thunder.ui.v2.diagnostics.get","params":[]}'
```

V2 应用方法由 `daemon/host/src/rpc/` 与对应的 service/repository 实现，私有 daemon Node API 位于 `daemon/host/src/control/`，公共 HTTP/Web API 位于 `web-api/src/`，外部应用客户端位于 `packages/daemon-client/`。当前已实现 HTTP/HTTPS、FTP、BT、磁力、ed2k、thunder://、登录、策略、媒体、系统集成和 `thunder.ui.v2.*` 原生下载门面。生产默认不启用旧 RPC。

媒体与系统集成入口：完成任务可通过 `/api/v2/tasks/<taskId>/files/<fileIndex>/media-token` 获取短期 Range 播放令牌；`thunder.ui.v2.system.openFile/showInFolder/openFolder` 只接收 taskId；`thunder.ui.v2.capture.startPairing` 用于浏览器扩展配对；`thunder.ui.v2.diagnostics.get` 返回脱敏诊断。Linux 协议关联需显式运行 `daemon/integration/install-desktop-integration.sh --user`，不会在 daemon 启动时修改系统关联。

最终删除迁移期兼容代码前严格按门禁顺序执行：

```bash
node daemon/host/bin/migrate-v2.js --runtime "$THUNDERD_RUNTIME_DIR" --dry-run --report "$THUNDERD_RUNTIME_DIR/data/migration-manifest.json"
node daemon/host/bin/migrate-v2.js --runtime "$THUNDERD_RUNTIME_DIR" --apply --report "$THUNDERD_RUNTIME_DIR/data/migration-manifest.json"
node daemon/host/bin/migrate-v2.js --runtime "$THUNDERD_RUNTIME_DIR" --verify --report "$THUNDERD_RUNTIME_DIR/data/migration-manifest.json"
```

`--apply` 不覆盖已有 V2 文件；首次迁移时先创建精确回滚备份、再原子写入 `data/tasks.json`，不会删除 `registry.json`。确认 hash、任务数、回滚备份和真实四协议/破坏性操作验收均有证据后，才允许物理删除兼容层。`daemon/integration/migration-dry-run.js` 仍可作为无写入快速预检。

## 架构与约束（必读）

- 分层进程：`web-api` 持有公共 HTTP/JSON-RPC/静态页面/mTLS；daemon core 持有任务、账号、P2SP/VIP 和持久化状态；原生 engine 隔离加载 `dk_addon.node`。Web API 通过权限为 0600 的 Unix socket 和 `packages/daemon-client/` 访问 daemon，daemon 到 engine 的 JSON-lines 协议仍为私有实现细节。
- `daemon/host/src/stack.js` 只负责监管：Web API 异常退出时单独重启，不停止 daemon core 或进行中的 P2SP/VIP 下载；daemon core 退出时才收拢整个栈。
- **状态观测 = TaskDb.dat 只读轮询（sqlite3 mode=ro）为主、文件系统兜底**（纯 Node 下 native→JS 回调会 V8 fatal，无法订阅引擎事件）。sqlite3 缺失时降级为 FS 推断：此时 HEAD 失败的 URL 完成判定不可靠（README 声明的精度上限）。
- 引擎按 URL basename 落盘、忽略 RPC 的 `out`/taskName（`NamingType=0`，recon 实测）；daemon 的 poller 每 tick 回读 TaskDb `Name` 列修正内部登记名，addUri 返回后约 1s 内（首个 tick）生效。sqlite3 缺失降级为 FS 观测时不回读，此时 `out` 与落盘名可能不一致（精度上限同降级场景）。若需控制落盘文件名，须使 URL basename 即目标名。
- 当前承诺 HTTP/HTTPS、FTP、BT、磁力、ed2k、thunder://。FTP 凭据只保存在 0600 秘密存储中，任务 DTO 不回显用户名或密码。
- 引擎崩溃自动重启（指数退避至 60s）；重启期间**全部非终态任务**（含 paused）标 `error/interrupted`，重新 addUri 即可。
- 目标文件已存在 → 引擎自动加 `(1)` 后缀落盘（如 `f(1).bin`），不覆盖旧文件；daemon 回读 TaskDb `Name` 列对齐真实落盘名，`tellStatus.files[0].path` 始终指向真实文件。
- 部署必须保留完整 `thunder_x/program/SDK/`（69 文件，gitignored，属迅雷不可再分发）。
- 日志：`daemon/.runtime/engine.log`（引擎）、stdout（宿主）。
- 生产 RPC 只开放 V2 原生下载域；旧兼容 handler 默认关闭（`THUNDERD_LEGACY_RPC=0`）。磁力、BT 和 eD2k/thunder 链接全部从 V2 create preflight/commit 进入统一任务编排。

## systemd 部署

`daemon/thunderd.service` 与 `web-api/thunder-web-api.service` 是两个独立 systemd unit。前者只运行 daemon core，后者运行公共 HTTP/WebUI 网关；单独重启 `thunder-web-api.service` 不会停止下载引擎、P2SP/VIP 管理器或 daemon 持有的任务状态。示例安装目录为 `/opt/thunderd`，运行数据和下载目录分别为 `/var/lib/thunderd` 与 `/var/lib/thunderd/downloads`。部署到其他位置时，先修改 unit 中的 `WorkingDirectory` 和 `ExecStart`。

```bash
sudo install -m 0644 daemon/thunderd.service /etc/systemd/system/thunderd.service
sudo install -m 0644 web-api/thunder-web-api.service /etc/systemd/system/thunder-web-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now thunderd.service thunder-web-api.service
sudo systemctl status thunderd.service thunder-web-api.service
```

daemon unit 使用 `run.sh --systemd --core-only` 前台运行，Web API unit 使用 `web-api/run.sh --systemd`。两个进程分别处理 `SIGTERM` 并由 systemd 独立重启。若不以 root 运行，应在两个 unit 中使用同一 `User=<service-user>`，并确保该用户拥有 runtime socket、Wine prefix、下载目录及完整 `thunder_x/program/SDK/` 的访问权限。

## P2SP 登录态与 VIP 高速

- **P2SP 登录态**：`thunder.ui.v2.account.*` 登录成功后，daemon 通过官方 notify 序列把 uid 灌入引擎全局；P2SP 下载由引擎内部使用该登录态，不需要逐任务传 uid。引擎崩溃或重启后，driver 会从凭据钱包重新执行通知序列。
- **登录态可观测性**：`engine.notified` 只表示通知序列已执行，不等同于 native 内部登录态已被直接读取；账号、token 和 session 仍以宿主 HTTP 自证及钱包状态为准。
- **VIP 高速控制链**：2026-07-31 复审已证伪“token 只能来自 native `onNewToken` 事件”。daemon 现在由 Linux Node 主动请求 `speed/speedup`，从钱包/session、SDK peer ID 和 TaskDb CID/GCID 构造逐任务 cert，并经 Wine 引擎调用 `enableDcdnWithVipCert`；按服务端周期刷新、暂停/终态 disable、引擎代际失效和退避均已接入。协议链和资源效果的验收边界见仓库根目录的 `UBUNTU_VIP_RETEST_REPORT.md`。
- **VIP RPC**：`thunder.ui.v2.vip.getTaskState`、`thunder.ui.v2.vip.setTaskEnabled`、`thunder.ui.v2.vip.retryTask` 提供脱敏状态和开关。RPC 不返回 uid、session、peer ID、token 或 cert。
- **VIP 配置**：`THUNDERD_VIP_ENABLED=0|1`（默认 1）、`THUNDERD_VIP_API_ORIGIN`、`THUNDERD_XLSDK_CRASHINFO`、`THUNDERD_VIP_SCAN_MS`（500–30000）、`THUNDERD_VIP_MAX_BACKOFF_SEC`（30–1800）。钱包不可恢复时只进入 `auth-required`，不会自动生成二维码。
- **VIP 效果边界**：`VipReceiveSize=0` 不能单独判授权失败——官方 GUI 对同类资源收到 `DcdnStatusCode.Success` 时该计数也为 0。现阶段只确认控制链可实现，不承诺任意资源一定命中 VIP 通道；生产验收仍需选取官方 GUI 确实产生 VIP 字节的同资源对照。
- **单实例**：daemon 在 `THUNDERD_RUNTIME_DIR/thunderd.lock` 写入 PID；同一 runtime 目录中旧实例存活时拒绝并发启动，旧 PID 已死或锁损坏时可回收。`run.sh` 使用 lockfile PID 精确停止，不做模糊进程匹配。
- **RPC secret**：设置 `THUNDERD_RPC_SECRET` 后，V2 请求必须使用 `Authorization: Bearer <my-secret>`；secret 不进入 params。未设置时仍只监听 loopback。

## 登录

登录 = daemon 的凭据钱包（非引擎状态）。OAuth2 device flow → `/session/v1/register` → `/v1/user/me` 桥链全在宿主纯 Linux HTTPS，官方 uid 通知序列灌 native，channel/put 保活 + refresh 降级梯闭环。

```bash
# 发起登录（WebUI 将 verificationUrl 渲染为二维码）
curl -s 127.0.0.1:16800/jsonrpc -d '{"jsonrpc":"2.0","id":1,"method":"thunder.ui.v2.account.startLogin","params":[{}]}'
# 查登录状态
curl -s 127.0.0.1:16800/jsonrpc -d '{"jsonrpc":"2.0","id":2,"method":"thunder.ui.v2.account.get","params":[{}]}'
# 强制刷新 access token 并重新查询会员权益
curl -s 127.0.0.1:16800/jsonrpc -d '{"jsonrpc":"2.0","id":3,"method":"thunder.ui.v2.account.refresh","params":[{}]}'
# 登出
curl -s 127.0.0.1:16800/jsonrpc -d '{"jsonrpc":"2.0","id":4,"method":"thunder.ui.v2.account.logout","params":[{}]}'
```

- `startLogin` → `{verificationUrl, userCode, expiresIn, interval}`：WebUI 直接生成可扫描二维码，链接与 `userCode` 作为备用。
- `getLoginStatus` → 四层：`account`（valid/isVip/vipType/vipLevel/checkedAt）、`token`（accessTokenExpiresAt/refreshTokenPresent）、`session`（registered/sessionIdPresent/lastRegisterAt/lastKeepAliveAt/lastError）、`engine`（notified/notifiedAt/sequence）。账号 uid 不出 RPC。
- **`engine.notified` 语义 = "已执行官方通知序列"，非"引擎已登录"**——native 接口没有提供登录态回读能力。daemon 持有的凭据可通过 `/v1/user/me`、session register 和保活响应自证。
- 凭据本体（access_token/refresh_token/sessionid/secure_key）**永不出 RPC 面、不进日志**。钱包 `daemon/.runtime/auth.json`（0600，gitignored）。
- 保活周期默认 300s（register 返回 keepAlivePeriod），`THUNDERD_AUTH_KEEPALIVE_SEC` 可覆盖（夹 [30, 3600]）。
- 引擎崩溃/重启后 driver 自动从钱包重灌通知序列。

## 全功能下载（HTTP/HTTPS/FTP/BT/磁力/ed2k/thunder://）

```bash
# BT、磁力、eD2k、thunder:// 均使用同一套 V2 preflight → draft → commit 链路。
```

- BT/磁力按种子内文件名落盘到 `savePath/taskName/`；ed2k 按 fileName；poller 回读 TaskBase.Name 对齐。
- **磁力两步走**：addMagnetAddress 立即返回 gid（metadataPhase=fetching），后台拉 metadata → 转 BT（metadataPhase=download）。`THUNDERD_MAGNET_TIMEOUT_SEC`（默认 120，夹 [30,600]）控超时。
- **运行中改选文件不支持**（callback API 纯 Node 不可用）→ removeAndDelete + 重新 addTorrent。
- **BT 去重按 infoId**（非 URL）；磁力按 infoHash；HTTP/ed2k 按 URL。
- ed2k 暖机慢（Kad/eD2k 网络），进队列 Status=5 后可能长时间 0 字节，非 error。
- 磁力 metadata 拉取阶段 TaskDb 无行，tellStatus 报 metadataPhase=fetching。
- 保存目录勿用 tmpfs（BT/磁力预分配全尺寸稀疏文件，tmpfs 满则 errorCode=205）。
