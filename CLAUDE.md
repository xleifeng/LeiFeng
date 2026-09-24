# 项目工作规则 — thunder-recon/tlei

> 本文件为本项目的最高工作准则，覆盖默认行为。Claude Code 会话在此仓库内启动时自动加载。

## 进程管理：使用 Superpowers

本项目由 [Superpowers](https://github.com/claude-plugins/claude-plugins) 的 skill 体系管理开发进程。**任何实质实现工作**按下列进程走，不得跳步直接写代码：

1. **先 spec，再 plan** — 设计先落入 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`（brainstorming skill），获用户审阅批准后，才转 `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`（writing-plans skill）。spec 与 plan 双双落地、双双获批后，才进入实现。
2. **实现走 SDD**（subagent-driven-development）：每任务 fresh implementer + 任务评审 + 修复循环 + 合并前全分支终审。
3. **缺陷修复走 systematic-debugging**：先根因调查、再修根因不修症状，禁止症状补丁。
4. **分支收尾走 finishing-a-development-branch**：测绿 → 探环境 → 三选项菜单 → 用户定整合方式。

进入 plan mode 前若尚未 brainstorm，先调 brainstorming skill；不可跳过设计直接 plan。

> 模型分派遵循全局强制准则（`~/.claude/docs/model-dispatch.md`）：fable 负责每个问题循环开始时的架构设计与最终的 final review，其余执行与迭代由当前主模型自做；真正疑难才送 fable 给新方案。

## 语言

始终中文输出（含 spec、plan、报告、commit message 主体）。

## 工程原则：拿来主义优先，尽可能不自写

- **有现成轮子拿来即用，尽可能不自己实现。** 任何能力需求先找现成方案：npm 包、系统命令、Python 库、开源代码（注明出处+许可）。能拿来就拿来，不要从零自写。
- **"零 npm 依赖"非项目铁律**：它只是阶段 1 daemon 宿主的工程决定（部署免 `npm install`），不约束阶段 1.5 及之后。若拿来主义需要引 npm 包，引就是——部署时 `npm install` 可接受。阶段 1 已交付的零依赖现状不动，但不再作为全局约束推广。
- **禁止"重复造轮子"**：spec/plan 不得包含"内嵌从零实现 X"的描述（X = 编码器/加密/协议/解析器/HTTP 客户端等已有成熟实现的能力）。设计时明确"此处用 X 库/X 命令/X 开源方案"。若某能力确无现成方案、必须自写，在 spec 说明"为何无现成方案可用"——这是例外，不是默认。
- 优先级：现成库/命令/开源移植 > 从零自写。从零自写需在 spec 给出"无现成方案"的理由。

## 提交与分支

- **commit / push 仅在用户明确要求时执行**；默认不主动提交。
- **提交消息遵循 Conventional Commits 规范**：`<type>(<scope>?): <subject>`，type 用 feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert；正文（可选）写动机与行为变化，footer（可选）写 BREAKING CHANGE / Closes #N。subject 中文、祈使语气、不加句号。
- 实现工作在 feature 分支进行，不在 master/main 直接开发。
- 重大不可逆操作（删除、覆盖未自创文件、外发内容）先确认，除非获持久授权。

## 像素级 UI 复刻工作流（2026-08-05 起）

> 适用：把 webui 复刻为原版 Electron 界面（参照 `docs/ui-reference/`）。范围基线 = daemon 真实能力（云盘/片库/会员/企业能力不伪装可用）。

- **主模型为文本模型，无原生多模态。所有视觉设计对比必须派 haiku 执行**（vision-gateway MCP 工具，或 haiku 子代理）：原版截图 vs webui 同场景截图的结构差异、像素级反常项、D-DIN-PRO 字体度量漂移等，一律由 haiku 读图出报告，主模型据报告落地修正。**禁止主模型凭截图文件名/经验臆断像素差异。**
- **许可线**：允许 import 原版 CSS/字体/3D 插画/蜂鸟 logo（**个人使用，禁再分发**）。资产放 `webui/src/assets/orig/`，目录内置 `NOTICE.md` 注明许可与禁再分发。
- **交付**：按视图迭代；验收 = Playwright 固定视口 1200×760、deviceScaleFactor=1、字体加载后截图，与 `docs/ui-reference/orig-*.png` 经 pixelmatch diff，mismatch ≤5%（threshold 0.1 容抗锯齿），超阈值出报告人工复核。
- **弹窗**：页内 dialog 模态（`useDialog()` 单例注册表 + Teleport），组件名沿用原版 kebab；遮罩/圆角/宽高按 `orig-modal-*.png` 定死，不自适应。
- **数据面**：100% 走真实 RPC（thunder.ui.*/aria2.*），无 fallback 伪装；原版九分区设置中超出 daemon RPC 面的条目直接隐藏，不伪装。

## 进程管理：禁用 pkill -f，按精确 PID 杀

- **禁用 `pkill -f "<pattern>"`**：`-f` 按完整命令行匹配，会误杀承载 Bash 工具的 shell 自身或其进程组里含该 pattern 的进程（实测 `pkill -f thunder.exe` 返回 exit 144，把当前 shell 一起杀了——shell 命令行含该串）。`pkill -x` 也慎用（仍匹配进程名，Wine 进程名可能与 shell 子进程冲突）。
- **替代：精确 PID 杀**。流程：`pgrep -f <pattern>` 查 PID → `kill -TERM <pid>` 指定 PID。或先记 daemon/引擎的 spawn PID（spawn 返回 pid），shutdown 时 `kill -TERM <daemon pid>`（走 graceful 信号，daemon 收 SIGTERM 后自己清理引擎子进程）。
- **daemon 优雅关闭**：一体启动时优先 `kill -TERM <stack.js PID>`，仅 core 启动时使用 `kill -TERM <main.js PID>`；core 的 SIGTERM 钩子会停止 control socket、poller 和 driver，Web API 可独立重启。不要直接 pkill 引擎，引擎子进程由 driver.shutdown 统一清理。
- **起 daemon 用 setsid 脱离**：`setsid bash -c '...' < /dev/null &` 让 daemon 脱离当前 shell 进程组，避免后续清理误杀。
- **Wine 引擎残留**：若需清 `DownloadSDKServer.exe`/`thunder.exe`，用 `pgrep` 查 PID 精确 `kill`，或 `wineserver -k`（Wine 自己的清理），不用 `pkill -f`。

## 已知项目背景速览

- **阶段 1（已交付）**：迅雷 Linux 下载 daemon（thunderd），纯 Node 直连 `dk_addon.node`（ELECTRON_RUN_AS_NODE，无 renderer/CDP），HTTP/HTTPS 下载 + aria2 兼容 RPC 子集 + thunder.* 扩展。双进程（原生宿主 + Wine 引擎）。限制 1（落盘名分叉）已根治（poller 回读 TaskDb Name 列）。
- **阶段 1.5（已交付）**：登录集成（`thunder.auth.*` 三 RPC：startLogin/getLoginStatus/logout）。登录 = daemon 凭据钱包（非引擎状态）：OAuth2 device flow→/session/v1/register→/v1/user/me 桥链纯 Linux HTTPS + 官方 uid 通知序列灌 native + channel/put 保活 + refresh 降级梯。master merge `1c2a46d` + vip fix `058deef`，真机验收通过。
- **登录墙破除依据**：`recon/login-inject/RESULTS.md`（H1/H2/H3-E1/E2/E3 探针链 + fable 三次分析）。真根因 = 桥端点误认（`/session/v1/register` 活）+ 通知误当登录（setUserInfo 是登录完成后广播非触发器），非 Wine SSL 墙。
