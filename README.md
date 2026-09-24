# LeiFeng (tlei)

迅雷（Thunder）Linux 下载栈的逆向移植：原生下载引擎跑在 Wine 里，外面是一套干净的 Node.js daemon、HTTP API 和原生风格 Web 界面。不依赖 Electron，不依赖迅雷官方客户端。

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
Wine 引擎进程 → 迅雷原生下载 SDK（P2SP / BT / HTTP）
```

**能力**：HTTP/HTTPS/FTP/BT/磁力/ed2k/迅雷链下载，P2SP 加速与会员试用加速，任务组、计划任务、限速、空闲调度、完成动作，下载历史与链接库，私人空间（加密），扫码登录，媒体在线播放（Range），远程节点（mTLS）。对 CLI 兼容 aria2 JSON-RPC 子集，同时提供 `thunder.ui.v2.*` 完整方法面。

## 前置要求

- Linux x64，Node.js ≥ 24
- **Wine**（引擎运行环境）：`sudo apt install wine`
- **迅雷 SDK 运行树**：本仓库不含迅雷专有文件。安装官方迅雷 X 后把 `program/` 放到仓库根 `thunder_x/program/`（需含 `thunder.exe`、`dk_addon.node`、`SDK/` 约 69 个文件）；SDK 目录缺失时按 `daemon/run.sh` 的提示静默补齐
- qBittorrent WebUI（仅 webseed-bridge 需要）

## 快速开始

```bash
# 1. 安装依赖（workspace + vendor 构建一步完成）
npm ci

# 2. 构建 WebUI（可选——不构建则只有 JSON-RPC，无页面）
npm --prefix webui install && npm --prefix webui run build

# 3. 启动（预检 Wine/SDK/端口，前台运行）
bash daemon/run.sh
```

看到 `[thunderd] core control socket=...` 即启动成功。打开 <http://127.0.0.1:16800/> 是原生风格 Web 界面：新建任务、扫码登录（首次）、VIP 加速、设置、引擎诊断都在里面。

### systemd 常驻部署

```bash
sudo install -m 0644 daemon/thunderd.service /etc/systemd/system/
sudo install -m 0644 web-api/thunder-web-api.service /etc/systemd/system/
# 按需修改 unit 内 WorkingDirectory / ExecStart 指向本仓库，然后：
sudo systemctl enable --now thunderd thunder-web-api
```

两个 unit 独立重启：重启网关不会动下载引擎和任务状态。

## 登录

首次使用建议先登录（不登录也能下 HTTP/BT，登录后才有 P2SP 与会员加速）：

- WebUI 右上角头像 → 扫码登录；或 RPC `thunder.auth.startLogin`（返回的 `verificationUrl` 需自行生成二维码）
- 凭据只存在本机 `daemon/.runtime/auth.json`（0600），不会上传到任何地方
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
| `thunderd` | 全量：core + Web API（`run.sh` 默认） | `node daemon/host/src/entry.mjs --profile thunderd` |
| `thunderd-core` | 裸 core，供自己的应用经 daemon-client 接入 | `node daemon/host/src/entry.mjs --profile thunderd-core` |
| `bridge-host` | webseed-bridge 独立桥进程 | `node packages/webseed-bridge/src/main.js ...` |

`--dump-config` 输出脱敏后的最终装配树（不启动、不取锁）；`--config file.json` 以 `{"plugins":[{"id":..,"config":..}]}` 覆写插件配置。

## webseed-bridge（P2SP→BT 输血）

把迅雷 P2SP 通道当作 qBittorrent 的 web seed：tlei 下载 + qbit swarm 双路取数，互补加速；tlei 停滞自动止损。

```bash
# 磁力（tlei 与 qbit 同时下载，桥按 piece 校验后供种给 qbit）
node packages/webseed-bridge/src/main.js hybrid \
  --magnet 'magnet:?xt=urn:btih:<hash>' --data /path/to/save

# 批量：混用 --magnet / --torrent / --input-file，--save-path 跟在所属项后
node packages/webseed-bridge/src/main.js hybrid --input-file ./batch.txt --data /path/to/save

# 给已有完整数据生成带 web seed 的种子（不触 daemon）
node packages/webseed-bridge/src/main.js serve --torrent ./x.torrent --data /path/to/files
```

运行中 `GET /status`（默认 `127.0.0.1:7127`）查看逐项进度与校验状态。仅绑定 loopback；不打印完整磁力 URI。

## 常用环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `THUNDERD_PORT` / `THUNDERD_HOST` | `16800` / `127.0.0.1` | RPC 监听地址 |
| `THUNDERD_RPC_SECRET` | 空 | 设置后所有 RPC 需 Bearer 认证 |
| `THUNDERD_RUNTIME_DIR` | `daemon/.runtime` | 任务数据、SQLite、凭据、socket |
| `THUNDERD_DOWNLOAD_DIR` | `./downloads` | 默认下载目录 |
| `THUNDERD_VIP_ENABLED` | `1` | 会员试用加速开关 |
| `THUNDERD_LEGACY_RPC` | `0` | 旧 aria2 兼容 handler，仅迁移回归用 |
| `THUNDERD_CSRF` | `1` | 浏览器 mutation 的 CSRF 校验 |
| `WINEPREFIX` | `~/.wine-thunder` | Wine 前缀 |
| `THUNDERD_ENGINE_MODE` | 自动 | `wine` 或 `windows-native`（WSL 下跑 Windows 原生引擎） |

完整清单见 `daemon/host/src/config.js`。

## 测试与开发

```bash
npm test --workspaces --if-present   # 全量（daemon 393 + web-api 11 + runtime 8 + bridge 25）
npm run test:vendor                  # vendored Cordis Fiber 生命周期
npm run test:entrypoints             # 入口守卫（禁止绕过 launcher）
```

进一步阅读：[ARCHITECTURE.md](ARCHITECTURE.md)（分层与依赖规则）、[daemon/README.md](daemon/README.md)（RPC 全量示例）、[packages/webseed-bridge/README.md](packages/webseed-bridge/README.md)（桥详解）、[vendor/README.md](vendor/README.md)（vendored Cordis 来源）。

## 法律与许可

- 本仓库代码 MIT
- 迅雷 SDK、原版界面资产（字体/插画/logo）**属迅雷公司，仅个人使用，禁止再分发**——这就是它们不入库的原因，需要自行从官方安装包获取
- 登录走官方 OAuth2 设备流，凭据仅存本机；本项目与迅雷公司无关联

## 免责声明

本项目为个人学习与研究所用的逆向工程成果。使用者需自行承担合规风险，遵守所在地法律法规，仅用于合法内容下载。不支持、不鼓励任何侵犯版权或绕过付费的行为。
