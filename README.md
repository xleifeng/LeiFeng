# LeiFeng

Linux 下载服务：daemon 核心、HTTP API 与 Web 界面三层分离，下载引擎以独立进程托管，插件化运行时装配。不依赖 Electron。

```
浏览器 / CLI
    │  HTTP JSON-RPC + WebUI
    ▼
web-api（网关，127.0.0.1:16800）
    │  私有 Unix socket
    ▼
thunderd（daemon core，Cordis 插件树）
    │  JSON-lines 私有协议
    ▼
引擎子进程（P2SP / BT / HTTP）
```

**能力**：HTTP/HTTPS/FTP/BT/磁力/ed2k 下载，P2SP 加速与会员试用加速，任务组、计划任务、限速、空闲调度、完成动作，下载历史与链接库，私人空间（加密），扫码登录，媒体在线播放（Range），远程节点（mTLS）。对 CLI 兼容 aria2 JSON-RPC 子集，同时提供 `thunder.ui.v2.*` 完整方法面。

## 前置要求

- Linux x64，Node.js ≥ 24
- **Wine**（引擎运行环境）：`sudo apt install wine`
- **引擎运行时**：`thunder_x/program/` 需自行准备（含 `thunder.exe`、`dk_addon.node`、`SDK/` 约 69 个文件）；`apps/daemon/run.sh` 启动时会做完整性预检并给出缺失提示
- qBittorrent WebUI（仅 apps/bridge 需要）

## 快速开始

```bash
# 1. 安装依赖（workspace + vendor 构建一步完成）
npm ci

# 2. 构建 WebUI（可选——不构建则只有 JSON-RPC，无页面）
npm --prefix apps/webui install && npm --prefix apps/webui run build

# 3. 启动（预检 Wine/运行时/端口，前台运行）
bash apps/daemon/run.sh
```

看到 `[thunderd] core control socket=...` 即启动成功。打开 <http://127.0.0.1:16800/> 进入 Web 界面：新建任务、扫码登录（首次）、VIP 加速、设置、引擎诊断都在里面。

### systemd 常驻部署

```bash
sudo install -m 0644 apps/daemon/thunderd.service /etc/systemd/system/
sudo install -m 0644 apps/web-api/thunder-web-api.service /etc/systemd/system/
# 按需修改 unit 内 WorkingDirectory / ExecStart 指向本仓库，然后：
sudo systemctl enable --now thunderd thunder-web-api
```

两个 unit 独立重启：重启网关不会动下载引擎和任务状态。

## 登录

首次使用建议先登录（不登录也能下 HTTP/BT，登录后才有 P2SP 与会员加速）：

- WebUI 右上角头像 → 扫码登录；或 RPC `thunder.auth.startLogin`（返回的 `verificationUrl` 需自行生成二维码）
- 凭据只存在本机 `apps/daemon/.runtime/auth.json`（0600），不出本机
- 登录状态用 `thunder.ui.v2.account.refresh` 确认三条件：账号有效、session 已注册、引擎已收到通知

## 常用 RPC（curl）

```bash
RPC=http://127.0.0.1:16800/jsonrpc
# 设置了 THUNDERD_RPC_SECRET 时加 -H 'Authorization: Bearer <secret>'

# 新建任务：先预检，再提交（draft 两段式，防止误提交）
curl -s $RPC -d '{"jsonrpc":"2.0","id":1,"method":"thunder.ui.v2.create.preflight","params":[{"inputs":[{"kind":"link","value":"https://example.com/file.bin"}]}]}'
curl -s $RPC -d '{"jsonrpc":"2.0","id":2,"method":"thunder.ui.v2.create.commit","params":[{"draftIds":["<draftId>"],"expectedRevisions":{"<draftId>":1},"idempotencyKey":"k1"}]}'

# 任务列表 / 操作
curl -s $RPC -d '{"jsonrpc":"2.0","id":3,"method":"thunder.ui.v2.tasks.query","params":[{}]}'
curl -s $RPC -d '{"jsonrpc":"2.0","id":4,"method":"thunder.ui.v2.tasks.command","params":[{"taskIds":["<taskId>"],"command":"pause","idempotencyKey":"p1"}]}'

# BT 种子：raw body 上传，不走 base64
curl -s -H 'Content-Type: application/x-bittorrent' -H 'X-Thunder-Filename: s.torrent' \
  --data-binary @s.torrent http://127.0.0.1:16800/api/v2/create-drafts/torrent
```

aria2 兼容面：`aria2.addUri` / `addTorrent` / `tellStatus` 等子集可直接对接现有工具。

## 启动形态（profile）

所有运行时都由同一 Cordis 插件树 launcher 装配，三种 profile：

| profile | 用途 | 命令 |
|---|---|---|
| `thunderd` | 全量：core + Web API（`run.sh` 默认） | `node apps/daemon/host/src/entry.mjs --profile thunderd` |
| `thunderd-core` | 裸 core，供自己的应用经 daemon-client 接入 | `node apps/daemon/host/src/entry.mjs --profile thunderd-core` |
| `bridge-host` | webseed-bridge 独立桥进程 | `node apps/bridge/src/main.js ...` |

`--dump-config` 输出脱敏后的最终装配树（不启动、不取锁）；`--config file.json` 以 `{"plugins":[{"id":..,"config":..}]}` 覆写插件配置。

## webseed-bridge（P2SP→BT 混合加速）

P2SP 通道作为 qBittorrent 的 web seed：LeiFeng 下载 + qbit swarm 双路取数，互补加速；LeiFeng 侧停滞自动止损。

```bash
# 磁力（LeiFeng 与 qbit 同时下载，桥按 piece 校验后供种给 qbit）
node apps/bridge/src/main.js hybrid \
  --magnet 'magnet:?xt=urn:btih:<hash>' --data /path/to/save

# 批量：混用 --magnet / --torrent / --input-file，--save-path 跟在所属项后
node apps/bridge/src/main.js hybrid --input-file ./batch.txt --data /path/to/save

# 给已有完整数据生成带 web seed 的种子（不触 daemon）
node apps/bridge/src/main.js serve --torrent ./x.torrent --data /path/to/files
```

运行中 `GET /status`（默认 `127.0.0.1:7127`）查看逐项进度与校验状态。仅绑定 loopback；不打印完整磁力 URI。

## 常用环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `THUNDERD_PORT` / `THUNDERD_HOST` | `16800` / `127.0.0.1` | RPC 监听地址 |
| `THUNDERD_RPC_SECRET` | 空 | 设置后所有 RPC 需 Bearer 认证 |
| `THUNDERD_RUNTIME_DIR` | `apps/daemon/.runtime` | 任务数据、SQLite、凭据、socket |
| `THUNDERD_DOWNLOAD_DIR` | `./downloads` | 默认下载目录 |
| `THUNDERD_VIP_ENABLED` | `1` | 会员试用加速开关 |
| `THUNDERD_LEGACY_RPC` | `0` | 旧 aria2 兼容 handler，仅迁移回归用 |
| `THUNDERD_CSRF` | `1` | 浏览器 mutation 的 CSRF 校验 |
| `WINEPREFIX` | `~/.wine-thunder` | Wine 前缀 |
| `THUNDERD_ENGINE_MODE` | 自动 | `wine` 或 `windows-native`（WSL 下跑 Windows 原生引擎） |

完整清单见 `apps/daemon/host/src/config.js`。

## 项目结构

三个概念要分清：**包**（`packages/`，npm workspace，代码组织）≠ **插件**（运行时装配单元，Cordis Fiber 管生命周期）≠ **进程**（故障隔离边界）。web-api 是进程——由 daemon 的 `web-api-process` 插件托管（spawn / 崩溃自动重启 / 优雅退出都进插件生命周期）；webui 是纯静态前端，由 web-api 托管，不在 daemon 装配面上。

```
.
├── apps/
│   ├── daemon/            thunderd 宿主
│   │   ├── engine/        引擎 JS：驱动原生下载组件
│   │   ├── host/src/      领域源码：domain / services / repositories / rpc
│   │   │   └── entry.mjs  profile launcher 入口
│   │   ├── host/plugins/  daemon 插件定义（见下方插件清单）
│   │   ├── integration/   桌面集成（协议关联、浏览器捕获）
│   │   ├── run.sh         一键启动（预检 + 前台运行）
│   │   └── test/          unit / architecture / integration / regression
│   ├── web-api/           外部 HTTP 网关进程：JSON-RPC、静态 WebUI、mTLS 远程面
│   ├── webui/             Web 界面（Vue 3 + Vite，Playwright 像素验收）
│   └── bridge/            P2SP→BT 混合加速桥（领域码 + 桥插件定义）
├── packages/
│   ├── runtime/           装配框架：profile launcher（composeProfile / bootProfile / runCli）
│   └── daemon-client/     control socket 客户端 SDK
├── vendor/cordis/         上游 Cordis 固定 commit 收编（来源与修改日志在内）
├── scripts/               门禁脚本（入口守卫等）
├── thunder_x/             引擎运行时（gitignored，自行放置）
└── docs/                  本地过程文档（gitignored）
```

## 插件清单

一切运行时皆插件：14 个插件构成三 profile，声明 `provides`/`requires` 服务，缺依赖或多 provider 在启动前即失败，逆序 dispose 保证释放。

**daemon 侧**（`apps/daemon/host/plugins/`，`thunderd` = 全部 9 个，`thunderd-core` = 前 8 个）：

| 插件 | 职责 | 提供 |
|---|---|---|
| `runtime-config` | 配置加载、目录创建、单实例锁 | `tleiConfig` |
| `repositories` | 任务/设置/草稿/种子/SQLite 持久层 + secret stores | `tleiRepositories` |
| `engine-driver` | 引擎进程选择（Wine/Windows 原生）、启动、TaskDb 读取 | `tleiEngine` |
| `event-observation` | 领域事件总线、进度 poller、诊断缓冲 | `tleiObservation` |
| `auth-vip` | 凭据钱包、OAuth2 登录管理、会员加速 | `tleiAuth` |
| `task-core` | 任务域全量服务（创建/查询/操作/调度/策略/元数据）+ 定时器 | `tleiTasks` |
| `product-services` | 历史、链接库、私空、媒体、捕获、通知、远程节点 | `tleiProducts` |
| `control-rpc` | control socket + RPC 方法面（依赖齐后才对外监听） | `tleiControl` |
| `web-api-process` | **托管 web-api 子进程**：spawn、崩溃重启、有界退出 | `tleiWebApi` |

**桥侧**（`apps/bridge/src/profile-plugins.cjs`，`bridge-host`）：

| 插件 | 职责 |
|---|---|
| `runtime-config` | 输入预检（磁力/torrent/批量，infohash 去重） |
| `bridge-daemon-client` | daemon RPC 客户端 + 登录验收 |
| `recipient-qbit` | 种子出口（Recipient 缝的 qbit 实现，唯一 provider） |
| `bridge-seed-http` | BEP-19 HTTP 供种 + `/status` |
| `bridge-orchestrator` | 会话表、恢复/监控定时器、停滞止损 |

插件定义在 registry（`.cjs`）里声明 ID 与服务依赖，`packages/runtime` 负责解析、按 profile 组合、校验并逐个激活。新增能力 = 写一个插件声明 provides/requires + 注册进对应 profile，不改启动代码。

## 测试

```bash
npm test --workspaces --if-present   # 全量（daemon 393 + web-api 11 + runtime 8 + bridge 25）
npm run test:vendor                  # vendored Cordis Fiber 生命周期
npm run test:entrypoints             # 入口守卫（禁止绕过 launcher）
```

进一步阅读：[ARCHITECTURE.md](ARCHITECTURE.md)（分层与依赖规则）、[apps/daemon/README.md](apps/daemon/README.md)（RPC 全量示例）、[apps/bridge/README.md](apps/bridge/README.md)（桥详解）、[vendor/README.md](vendor/README.md)（vendored Cordis 来源）。

## 许可

MIT。登录凭据仅存本机，不经过任何第三方服务。
