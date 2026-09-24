# AGENTS.md

tlei 是迅雷（Thunder）Linux 下载栈的逆向移植与产品化仓库：thunderd daemon 直连原生下载 SDK（Wine 引擎），配外部 Web API、原生风格 WebUI 与 webseed-bridge（P2SP→BT 输血桥）。全部运行时装配走 Cordis 插件树与 profile launcher。动手前先读 [ARCHITECTURE.md](ARCHITECTURE.md)。

## Repository layout

```
daemon/            thunderd 宿主：CJS 领域类 + Cordis 插件树装配
  engine/          原生引擎 JS（Wine 下驱动迅雷 SDK 的 dk_addon.node）
  host/src/        domain / services / repositories / rpc 源码；entry.mjs 为 launcher 入口
  host/plugins/    daemon 插件定义（registry.cjs、product-services.cjs）
  test/            unit / architecture / integration / regression
web-api/           外部 HTTP 网关：JSON-RPC、静态 WebUI、mTLS 远程面
webui/             原生风格 WebUI（Vue 3 + Vite + Playwright 像素验收）
packages/
  runtime/         profile launcher（composeProfile / bootProfile / runCli）
  webseed-bridge/  桥：5 插件树 + Recipient 三角色 + E4 批量输入
  daemon-client/   control socket 客户端 SDK
vendor/cordis/     上游 pin 收编（vendor/README.md 记来源与修改日志）
scripts/           入口守卫等门禁
docs/              本地过程文档：spec / plan / 报告（gitignored）
recon/             逆向调研材料（gitignored）
.p0/               真机测试基线数据（gitignored，勿清理）
thunder_x/         迅雷原版安装树（gitignored）
```

## Commands

```sh
npm ci                                 # workspace 安装，postinstall 自动构建 vendor
npm run build:vendor                   # esbuild 构建 vendored cordis 的 lib/
npm test --workspaces --if-present     # 全量测试（daemon / web-api / runtime / bridge）
npm run test:vendor                    # Cordis Fiber 生命周期用例
npm run test:entrypoints               # 入口守卫：拒绝绕过 profile launcher 的旁路

# 三 profile 启动（详见 daemon/README.md 与 packages/webseed-bridge/README.md）
node daemon/host/src/entry.mjs --profile thunderd                  # 全量：core + Web API 子进程
node daemon/host/src/entry.mjs --profile thunderd-core             # 裸 core
node daemon/host/src/entry.mjs --profile thunderd --dump-config    # 脱敏装配预览（不启动、不取锁）
node packages/webseed-bridge/src/main.js hybrid --magnet <URI> --data <dir>   # 桥
```

旧入口（`daemon/host/src/main.js`、`stack.js`、`run.sh`）只是兼容跳转；新代码必须走 launcher，`scripts/verify-application-entrypoints.mjs` 会拦截旁路。

## 在线实例与测试纪律

- 真机常驻实例：daemon 16800、桥 7127、qbit 8085。测试一律用隔离端口与临时 runtime（`THUNDERD_RUNTIME_DIR` / `THUNDERD_PORT` 指到 /tmp），不得重启或清理在线实例与 `.p0/a1-hybrid` 基线。
- 换版部署先记录 PID / 端口 / 磁盘余量并给出回退步骤，获用户授权后才执行。
- 磁盘配额打满时 SQLite 报 `disk I/O error`，会造成大面积假性测试失败——先查配额再查代码。

## 登录与凭据纪律

- refresh token 失效需要设备登录时，必须把当次 `verificationUrl` 编码成二维码直接展示给用户；链接和 `userCode` 只作备用。二维码只生成在临时目录，登录完成或过期后清理。
- 二维码、临时登录码、access / refresh token、session、peer ID、磁力 passkey 不得写入仓库、源码日志或提交内容。
- 登录验收三条件同时成立才继续 P2SP / 会员加速验证：实时账号有效、session 已注册、原生引擎已收到登录通知（`thunder.ui.v2.account.refresh` 三个布尔）。

## 进程管理

- **禁用 `pkill -f`**：`-f` 按完整命令行匹配，会误杀承载命令的 shell 自身（实测 `pkill -f thunder.exe` 连当前 shell 一起杀）。`pkill -x` 对 Wine 进程名同样有冲突风险。
- 替代：精确 PID——`pgrep -f <pattern>` 查 PID，`kill -TERM <pid>`。
- daemon 优雅关闭：一体启动杀 launcher 进程，仅 core 时杀 core 入口 PID；引擎子进程由 driver.shutdown 统一清理，不要直接杀引擎。Wine 残留用 `wineserver -k`。
- 起 daemon 用 `setsid` 脱离当前 shell 进程组，避免后续清理误伤。

## 工作流程

- 始终中文输出（代码注释、文档、报告、commit message 主体）。
- 实质实现走 Superpowers 进程，不得跳步直接写代码：brainstorming 落 spec（`docs/superpowers/specs/`）→ 获批 → writing-plans 落 plan → 获批 → subagent-driven-development 实现（fresh implementer + 任务评审 + 修复循环 + 全分支终审）。进入 plan mode 前若未 brainstorm，先补 brainstorming。
- 缺陷修复走 systematic-debugging：先根因调查，修根因不修症状，禁症状补丁。分支收尾走 finishing-a-development-branch：测绿 → 探环境 → 整合方式由用户定。
- 工程原则——拿来主义优先：能力需求先找现成方案（npm 包、系统命令、开源移植，注明出处与许可），不从零自写；确无现成方案须在 spec 说明理由。“零 npm 依赖”只是阶段 1 daemon 宿主的历史决定，不约束后续。

## 提交与分支

- commit / push 仅在用户明确要求时执行；默认不主动提交。
- 提交消息遵循 Conventional Commits：`<type>(<scope>?): <subject>`，type 用 feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert；正文（可选）写动机与行为变化，footer（可选）写 `BREAKING CHANGE` / `Closes #N`。subject 中文、祈使语气、不加句号。
- 实现工作在 feature 分支进行，不在 master / main 直接开发。
- 重大不可逆操作（删除、覆盖未自创文件、外发内容）先确认，除非获持久授权。

## WebUI 像素复刻

范围基线 = daemon 真实能力（云盘 / 片库 / 会员 / 企业能力不伪装可用）：

- 主模型无多模态：一切视觉对比（原版截图 vs webui 同场景截图、字体度量漂移）派视觉子代理读图出报告，禁止凭文件名或经验臆断像素差异。
- 许可线：允许 import 原版 CSS / 字体 / 3D 插画 / 蜂鸟 logo（个人使用，禁再分发）；资产放 `webui/src/assets/orig/` 并保留 NOTICE.md。
- 验收：Playwright 固定视口 1200×760、deviceScaleFactor=1、字体加载后截图，与 `docs/ui-reference/orig-*.png` 做 pixelmatch diff，mismatch ≤5%（threshold 0.1 容抗锯齿）；超阈值出报告人工复核。
- 弹窗用页内 dialog 模态（`useDialog()` 单例注册表 + Teleport），组件名沿用原版 kebab；遮罩 / 圆角 / 宽高按 `orig-modal-*.png` 定死，不自适应。
- 数据面 100% 走真实 RPC（thunder.ui.* / aria2.*），无 fallback 伪装；daemon RPC 面之外的原版设置项直接隐藏，不伪装。

## Vendoring

`vendor/cordis/` 是上游 `cordiverse/cordis` 固定 commit 的源码收编：来源、SHA256 与逐项本地修改记录在 [vendor/README.md](vendor/README.md) 与 [vendor/cordis/MODIFICATIONS.md](vendor/cordis/MODIFICATIONS.md)。更新只走显式同步流程（重放或退役已登记的修改，`npm run test:vendor && npm run build:vendor` 全绿），禁止浮动 `latest`。

## 背景速览

- 阶段 1（已交付）：daemon 双进程直连原生 SDK；HTTP/HTTPS 下载 + aria2 兼容 RPC 子集 + thunder.* 扩展；落盘名分叉已由 poller 回读 TaskDb 根治。
- 阶段 1.5（已交付）：登录集成（OAuth2 device flow → session 注册 → 引擎通知桥链），探针依据 `recon/login-inject/RESULTS.md`。
- 当前主线：Cordis 插件化（一切皆插件、三 profile）与桥产品化；过程 spec / plan 在 `docs/superpowers/`（本地，不入库）。

## Editing these instructions

`CLAUDE.md` 是指向本文件的符号链接；编辑本文件即可。规则保持自包含、给长文档留链接；能精简则精简，不堆叙事。Claude Code 会话的模型分派遵循全局准则（`~/.claude/docs/model-dispatch.md`），不在本文件重复。
