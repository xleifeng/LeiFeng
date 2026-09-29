# AGENTS.md

leifeng 是迅雷（Thunder）Linux 下载栈的逆向移植与产品化仓库：thunderd daemon 直连原生下载 SDK（Wine 引擎），配外部 Web API、原生风格 WebUI 与 webseed-bridge（P2SP→BT 输血桥）。全部运行时装配走 Cordis 插件树与 profile launcher。动手前先读 [ARCHITECTURE.md](ARCHITECTURE.md)。

## Repository layout

```
apps/
  daemon/          thunderd 宿主：CJS 领域类 + Cordis 插件树装配
    host/src/      domain / services / repositories / rpc 源码；entry.mjs 为 launcher 入口
    host/plugins/  daemon 插件定义（一插件一文件 + index.cjs 汇总）
    host/kernels/  内核实现包（thunder: driver/engine/账号/VIP；qbit: qbit-driver）
    test/          unit / architecture / regression
  web-api/         外部 HTTP 网关：JSON-RPC、静态 WebUI、mTLS 远程面
  webui/           原生风格 WebUI（Vue 3 + Vite + Playwright 像素验收）
  bridge/          桥：5 插件树 + Recipient 三角色 + E4 批量输入
packages/
  runtime/         profile launcher（composeProfile / bootProfile / runCli）
  daemon-client/   control socket 客户端 SDK
vendor/cordis/     上游 pin 收编（vendor/README.md 记来源与修改日志）
e2e/               跨 app 验收：真 daemon + Web API + Wine 引擎（npm run test:e2e，串行）
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
npm run test:e2e                       # 跨 app 验收（需本机 Wine 引擎，串行；wine 包装在 /home/yj/bin）

# 三 profile 启动（详见 apps/daemon/README.md 与 apps/bridge/README.md）
node apps/daemon/host/src/entry.mjs --profile thunderd                  # 全量：core + Web API 子进程
node apps/daemon/host/src/entry.mjs --profile thunderd-core             # 裸 core
node apps/daemon/host/src/entry.mjs --profile thunderd --dump-config    # 脱敏装配预览（不启动、不取锁）
node apps/bridge/src/main.js hybrid --magnet <URI> --data <dir>   # 桥
```

旧入口（`apps/daemon/host/src/main.js`、`stack.js`、`run.sh`）只是兼容跳转；新代码必须走 launcher，`scripts/verify-application-entrypoints.mjs` 会拦截旁路。

## 在线实例与测试纪律

- 真机常驻实例：daemon 16800、桥 7127、qbit 8085。测试一律用隔离端口与临时 runtime（`THUNDERD_RUNTIME_DIR` / `THUNDERD_PORT` 指到 `/home/yj/tmp/leifeng-<用途>` 等家目录下隔离目录，**禁用 /tmp**），不得重启或清理在线实例与 `.p0/a1-hybrid` 基线。
- 换版部署先记录 PID / 端口 / 磁盘余量并给出回退步骤，获用户授权后才执行。
- 磁盘配额打满时 SQLite 报 `disk I/O error`，会造成大面积假性测试失败——先查配额再查代码。`/tmp` 是有用户配额的 tmpfs，写满还会让 Claude Code 的 Bash 工具全线失灵（2026-09-24 实测），故一切测试临时写入走家目录。

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
- 实质实现前先落 spec（`docs/specs/`）并获用户批准；spec 批准后即可实施，用户明确要求跳过中间文档时遵从。
- 缺陷修复先根因调查，修根因不修症状，禁症状补丁。
- 工程原则——拿来主义优先：能力需求先找现成方案（npm 包、系统命令、开源移植，注明出处与许可），不从零自写；确无现成方案须在 spec 说明理由。“零 npm 依赖”只是阶段 1 daemon 宿主的历史决定，不约束后续。

## 提交与分支

- commit / push 仅在用户明确要求时执行；默认不主动提交。
- 提交消息遵循 Conventional Commits：`<type>(<scope>?): <subject>`，type 用 feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert；正文（可选）写动机与行为变化，footer（可选）写 `BREAKING CHANGE` / `Closes #N`。subject 中文、祈使语气、不加句号。
- 实现工作在 feature 分支进行，不在 master / main 直接开发。
- 重大不可逆操作（删除、覆盖未自创文件、外发内容）先确认，除非获持久授权。

## WebUI 设计（Leifeng Modern，2026-09-29 起）

2026-09-29 全面重设计：旧「迅雷像素复刻」体系（tokens-orig.css / 蜂鸟 / 1200×760 pixelmatch 验收）已整体退役，备份在 `apps/webui-legacy/`（冻结，仅供回退参考）与 git 历史（179e490）。同日第三轮：接入 **mdui 2**（M3 规范 Web Components）——按钮/开关/弹窗/分段控件/进度条/checkbox/navigation rail+bar 全部规范件化（ripple、state layer、暗色双套齐备）。

- 设计语言：Material 3。mdui 组件以 `#0b57d0` 为种子色经 HCT 色调板生成动态色（`setColorScheme`，`src/mdui.ts` 按需注册组件）；手书样式经 `--md-*` 令牌消费（`src/styles/tokens.css`——注意 mdui 颜色变量是 R,G,B 三通道数值，引用必须包 `rgb()`）。主题双轨同步：`data-theme`（手书）+ `mdui-theme-*` class（mdui），shell store 统一切换。
- 页面布局：`PageShell` 组件全站统一居中限宽列（`src/components/common/PageShell.vue`）；弹窗统一 `ModalShell`（mdui-dialog 承载）。设置大窗口 / 任务详情抽屉为自定义容器（非标准 dialog 形态）。
- 品牌：产品名 Leifeng，禁用蜂鸟 logo 与迅雷字样做品牌；仅登录二维码等「功能属实」场景保留迅雷 App 提示。
- 视觉验收：主模型无多模态——截图走查一律派视觉子代理（glm-5.3-flash）读图出报告，禁止臆断；不再做原版像素 diff。
- 数据面 100% 走真实 RPC（`leifeng.ui.v2.*`），无 fallback 伪装；daemon RPC 面之外的能力直接隐藏，不伪装。
- 交互关键元素带 `data-testid`；e2e 用语义选择器（role/label/text）优先。mdui 组件注意点：`@mdui/mcp`（.mcp.json）可查 API；segmented-button-group 必须带 `selects`；mdui-dialog 无内置 role 须宿主补 `role="dialog"`；Web Component 上 v-model 不可用，用 `:checked`/`:value` + `@change`。
- 品牌：产品名 Leifeng，禁用蜂鸟 logo 与迅雷字样做品牌；仅登录二维码等「功能属实」场景保留迅雷 App 提示。
- 视觉验收：主模型无多模态——截图走查一律派视觉子代理（glm-5.3-flash）读图出报告，禁止臆断；不再做原版像素 diff。
- 数据面 100% 走真实 RPC（`leifeng.ui.v2.*`），无 fallback 伪装；daemon RPC 面之外的能力直接隐藏，不伪装。
- 交互关键元素带 `data-testid`；e2e 用语义选择器（role/label/text）优先。

## Vendoring

`vendor/cordis/` 是上游 `cordiverse/cordis` 固定 commit 的源码收编：来源、SHA256 与逐项本地修改记录在 [vendor/README.md](vendor/README.md) 与 [vendor/cordis/MODIFICATIONS.md](vendor/cordis/MODIFICATIONS.md)。更新只走显式同步流程（重放或退役已登记的修改，`npm run test:vendor && npm run build:vendor` 全绿），禁止浮动 `latest`。

## 背景速览

- 阶段 1（已交付）：daemon 双进程直连原生 SDK；HTTP/HTTPS 下载 + aria2 兼容 RPC 子集 + thunder.* 扩展；落盘名分叉已由 poller 回读 TaskDb 根治。
- 阶段 1.5（已交付）：登录集成（OAuth2 device flow → session 注册 → 引擎通知桥链），探针依据 `recon/login-inject/RESULTS.md`。
- 下载内核插件化（已交付，2026-09-28）：KernelPort 契约（36 方法）+ kernel-thunder 三合一 + task-shell 拆分 + kernelId/协议路由 + kernel-qbit 参照内核（默认 disabled，验证契约完备性，缺口清单在 docs/specs/2026-09-28-kernel-pluggable-p3.md §5）；壳层产品 RPC 面为 `leifeng.ui.v2.*`，v1 aria2/thunder 兼容面已整层删除（2026-09-28，docs/specs/2026-09-28-remove-legacy-rpc.md）。
- 壳 RPC 注册化（已交付，2026-09-28）：RpcRegistry——壳零业务方法，93+20 方法全由插件注册；account/vip 随 kernel-thunder（守卫钉死注册点）。
- 任意内核独立成在 + leifeng 改名（已交付，2026-09-29）：kernel-hub 聚合槽（消费方经 `default()` 取内核，不硬编码 thunder）；kernel-qbit 常驻序内 `defaultEnabled:false`，patch 两行即 qbit-only；项目词汇 tlei→leifeng 全量改名（包名 `@leifeng/*`，spec docs/specs/2026-09-29-kernel-any-only-and-rename-leifeng.md）。
- 当前主线：Cordis 插件化（一切皆插件、三 profile）与桥产品化；过程 spec / plan 在 `docs/`（本地，不入库）。

## Editing these instructions

`CLAUDE.md` 是指向本文件的符号链接；编辑本文件即可。规则保持自包含、给长文档留链接；能精简则精简，不堆叙事。Claude Code 会话的模型分派遵循全局准则（`~/.claude/docs/model-dispatch.md`），不在本文件重复。
