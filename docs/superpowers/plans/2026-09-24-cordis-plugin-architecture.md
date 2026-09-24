# tlei Cordis 插件化实施计划

**状态**：待用户审阅批准；批准后按 SDD 执行。  
**Spec**：[2026-09-24-cordis-plugin-architecture-design.md](../specs/2026-09-24-cordis-plugin-architecture-design.md)（已批准；dsh 只作架构参考）。  
**目标**：daemon 内核及桥运行时全部交由 Cordis 插件树装配，统一 profile 启动，Recipient 三角色仅接 qbit，E4 输入面完成。

## 0. 全局约束与已知现场

- 中文代码说明、文档、报告；不提交、不 push，除非用户另行明确要求。实现在 feature 分支，任务按 fresh implementer → 评审 → 修复循环；结束前全分支终审。
- 2026-09-24 预检：16800 daemon、7127 桥、8085 qbit 在线。`/status`、qbit 版本与磁力 preflight 已探通。`.p0/qbit-root` 已由保留 deb 重建。**不得重跑 `daemon/run.sh`、重启现有实例或清理 `.p0/a1-hybrid`**。真机验证先用隔离端口和临时 runtime，换版另设可回退门槛。
- 当前 `/home/yj/code/tlei` 无有效 `.git`；`git status` 报非仓库。Task 0 必须恢复原历史/可用 checkout 后才能开始实质代码。禁止 `git init` 假装延续原项目、禁止覆盖本目录未追踪的现场数据。若远端/历史不可确认，停在 Task 0，保留本 plan 可审阅，不实施。
- Cordis **仅从直接上游** `https://github.com/cordiverse/cordis` pin，不从 `/tmp/dsh-probe` 复制源码、补丁或构建文件。dsh 只用于核对插件树、profile、seam 和入口守卫的架构语义。已从 `codeload.github.com/cordiverse/cordis` 成功获取固定 commit 源码包（SHA256 `a1ee72d28c0db7367348ad6e6214f35ae4c8c62d5a220fe9013300bb1fb4f4d9`）；Task 1 仍须独立核对 Git commit 对象及每包文件，不能用 dsh 快照填空。
- 不把二维码、临时登录码、token、session、peer ID、磁力 passkey、auth runtime 或 qbit profile 写入仓库/源码日志。refresh 失效时按 AGENTS.md 当次二维码直接展示并及时清理；登录验收三条件成立后才做 P2SP。
- 磁盘余量预检；下载类测试控制数据目录。`run.sh` 的 Wine PATH、setsid、lockfile、磁力 preflight 和精确 PID 规则照 HANDOVER §2.5。

## Task 0：恢复源码管理基线和迁移清单

**产物**：可用的原 Git checkout/feature 分支、基线测试记录、插件依赖图清单。

1. 查项目原 remote、快照来源和现有文件状态；在保全 `/home/yj/code/tlei` 与 `.p0` 的前提下恢复 `.git`，或在独立 checkout 中核对所有受控文件后迁入设计文档。核对 `git status`、HEAD、remote、当前文件差异；切 `feature/cordis-plugin-architecture`。恢复不了就停，向用户报告所缺的原仓库信息。
2. 盘点 `daemon/host/src/main.js` 的所有构造、`start`、定时器、回调、`shutdown`、循环引用，形成 `docs/superpowers/plans/` 附录表（每个运行时对象：provider、consumer、dispose、profile）。扫描 `services/`、`repositories/`、`driver`、`poller`，确保无漏迁实例。
3. 在**不启动第二个 daemon**的前提下记录 `npm test`（daemon）和 `npm test`（桥）的基线；测试若触碰在线端口则只跑隔离 unit/architecture，标明跳过项。记录代码树和现有服务 PID，不记录 secret。

**Gate**：Git 元数据可用、feature 分支已存在、迁移清单覆盖 main.js 全部运行时对象。

## Task 1：上游 Cordis vendor 与构建

**产物**：`vendor/cordis/`、`vendor/README.md`、锁文件/构建脚本、生命周期测试。

1. 直接从 `cordiverse/cordis` 获取固定 commit `56b3d4f725681cf4556c1a8695a709cc3b6eed74`，验证上游 remote、对象完整 hash、路径及 LICENSE；核对 core 的实际 `package.json`、依赖、Node/ESM 要求。若该 commit 不适合当前 Node 24，**先修订 spec/plan 并复审**，不得悄悄换 pin。网络失败时记录错误并重试合理次数，仍失败即停在此 gate。
2. 只拷 core 及实际需要的同仓上游目录；`cosmokit`、`schemastery` 等优先固定 npm 版本。若必须 vendor，分别从其直接上游 pin。改私有 `@tlei` 包名与内部引用，保留 MIT 文本；不移植 dsh Fiber 补丁。
3. 当前根目录没有 `package.json`，先建立最小 workspace manifest，纳入现有 daemon/桥包及 vendor 构建；保留现有 lockfile 内容并生成根锁文件。manifest 记上游 repo/commit、版本、SHA256、许可证。每项本地修改进入逐条日志。执行根目录 `npm ci`、vendor build、clean build；增加 Fiber setup 中 unload、异步 cleanup、子 Fiber 销毁用例。若发现上游缺陷，先写复现，再最小补丁并登记。

**Gate**：离线 lockfile 安装与 clean build 可重复，vendor 来源可核验，生命周期用例通过。

## Task 2：统一 launcher、profile 与配置

**产物**：ESM launcher、base/`thunderd`/`thunderd-core`/`bridge-host` profile、配置 schema、dump、真实 composition 测试。

1. 设计插件 entry 格式及稳定 ID，叠层次序为 base → 形态 → profile patch → 用户 patch；对重复 ID、未知字段、缺少 provider、非法禁用做明确错误。选择上游 loader/include 或 Cordis core API 组合；不得复制 dsh 的 patch 实现。
2. launcher 解析 `--profile`、`--dump-config` 和 profile 参数；`--dump-config` 只组合/校验，不启动实例，不获取 lock，secret 与 magnet URI 脱敏。启动统一安装 SIGTERM/SIGINT 与有界异步 dispose；失败非零退出。
3. 用真实 launcher/config 文件分别 boot 三 profile 的测试替身（仅外部原生引擎、qbit 和网络可 mock），检查服务激活、关闭顺序、端口冲突、缺 provider、配置覆写。测试不能只手工 `ctx.plugin()`。

**Gate**：三形态 tree dump 与启动/退出测试通过，配置结果可复现。

## Task 3：daemon 基础插件（repositories、driver、poller）

**产物**：`runtime-config`、`repositories`、`engine-driver`、`event-observation` 插件。

1. 保留现有 CJS 领域类与单测，ESM adapter 通过 `createRequire` 引入。插件负责所有 repository/secret store 的创建、load、flush、backup、close；TaskRepository outbox 与既有数据格式不改。
2. driver 插件选 Wine/Windows，保留 generation、TaskDb reader、boot/respawn/close；poller 和 eventBus 在依赖就绪后启动。每个事件 listener、定时器由所属 Fiber 释放。把现有 driver down/up 的交叉引用拆成注册阶段，不能在 provider 尚未激活时消费。
3. 逐插件做真实组合测试：旧数据目录副本可读、dispose 后句柄关闭、driver 失败时 control/RPC 不对外开放、同源 TaskDb observation 与旧 poller 结果一致。

**Gate**：此层没有独立手工生命周期；仓库与引擎重启测试通过。

## Task 4：daemon 业务插件与 RPC 外壳

**产物**：`auth-vip`、`task-core`、`product-services`、`control-rpc`、`web-api-process` 插件及旧入口迁移。

1. 按 Task 0 清单逐项迁入。TaskService、scheduler、policy、schedule、completion、metadata 的现有循环引用采用 post-bind，明确先提供接口再注册回调；启动前检查所有依赖。`history/link/private/media/capture/remote/diagnostics/bootstrap` 都由插件树创建，纯函数模块保留普通导入。
2. control socket 与 RPC 最后开放；`thunderd` profile 的 web-api 子进程按现行策略单独重启，core 退出时停止 gateway。`thunderd-core` 只开放 core 控制面。将旧 `run.sh`、`main.js`、`stack.js` 改为明确兼容入口/迁移提示，不保留第二套装配路径。
3. 运行 daemon unit、architecture、web-api 测试；增加旧 RPC 请求/响应契约、lockfile、driver respawn、SIGTERM 清理和 web-api 重启验收。用独立 runtime 与端口冒烟，绝不碰在线实例。

**Gate**：main.js 不再直接 new 全量服务；全量与裸 core 两 profile 达到旧行为等价。

## Task 5：桥插件与 Recipient 三角色

**产物**：`Recipient` 定义、唯一 `recipient-qbit` Provider、`bridge-orchestrator` Consumer、桥 HTTP/daemon-client 插件。

1. 定义与 qbit DTO 无关的 `addTorrent`、`addMagnet`、`getTorrent`、`webseeds`、capabilities 和错误契约。Provider 包装现有 client；桥 orchestrator 只注入接口，禁止直接 import qbit-client。缺/多 provider 在启动时失败。
2. 将 verifier、会话 Map、HTTP server、orchestrator 监控及恢复 timer、daemon RPC client 交 Fiber 所有；dispose 关闭 fd/HTTP/timer，保留已建 tlei/qbit 任务。保持 loopback 绑定、206/503/404、SHA1 门控、208 BUSY 和 engine failure start 自愈。
3. 桥真实 profile composition 测试及现有桥测试；额外断言同 hash 接管不重复提交、Provider 可被假实现替换且 Consumer 不修改。隔离端口端到端验证注入种子 infohash 不变。

**Gate**：桥 `main.js` 无独立装配树；Recipient 三角色完整且仅 qbit Provider 发布。

## Task 6：E4 输入、事件一致性和入口守卫

**产物**：`.torrent` + 批量 CLI、状态结果、outbox 回放/运行时断言、入口检查。

1. CLI 解析重复 `--magnet`/`--torrent`、`--input-file` 和每项 savePath；预检路径、BT v1、infohash、重复项。`.torrent` 走既有 web-api 上传/daemon 草稿能力；桥 client 增加受鉴权的上传方法，完成 nonce/CSRF/bearer 配置，不新增绕过鉴权的 RPC。批次有限并发，按项报告成功/失败；有活跃会话则持续供种，`/status` 展示逐项结果。
2. 从既有 TaskRepository outbox 建任务状态回放；对照 UI DTO 的状态字段。**当前已核实**：`task.updated` 事件仅有 `{reason}`，且 outbox 的已确认事件可能 compact，因此不能直接重放完整 UI 状态。先定义可持久重建的快照/事件保留边界与版本，再在同一持久化事务补齐必要状态字段，避免把供 history/links 消费的有限 outbox 当成永久日志；加入投影一致性运行时断言。创建、暂停、完成、失败、删除回放用例必须通过。异常只记脱敏诊断，不把不一致状态继续返回 UI。
3. CI 入口守卫扫描可执行脚本/package.json，拒绝绕开 profile launcher。更新 daemon/桥 README 与 HANDOVER 中启动、profile、vendor、E4 说明，不引入 dsh 文档机器。

**Gate**：新增输入矩阵、outbox 回放、入口扫描与全量测试通过。

## Task 7：收口验收与分支终审

1. `npm test`（daemon）、`npm test`（桥）、profile composition、vendor clean build、入口守卫全绿，记录具体命令与结果。检查 diff 中无凭据、二维码、临时登录码、session、peer ID、磁力 passkey 或运行时数据。
2. 磁盘余量、端口、PID 预检；隔离 runtime 冒烟三 profile。真机桥/qbit 测试前确认账号实时有效、session 注册、native 通知，再验证 webseed 206/503 与 qbit 接收，磁盘增量作下载最终裁判。若需要替换在线版本，先给出旧 PID、备份、回退命令和停机窗口，再执行获授权的切换。
3. SDD 各任务完成评审和修复，进行全分支最终 review。测试结论、限制与回退步骤写入实施报告；按 `finishing-a-development-branch` 向用户提供整合方式，未获明确要求不 commit/push。

## 覆盖检查

| Spec 要求 | Task |
|---|---|
| 直接上游 vendor、pin、许可、修改日志 | 1 |
| 一切运行时实例上插件树 | 0、3、4、5 |
| 三 profile、配置层、dump、入口守卫 | 2、4、5、6 |
| Recipient 定义 / qbit Provider / Consumer | 5 |
| 独立桥 host 与生命周期隔离 | 2、5、7 |
| E4 `.torrent` 与批量输入 | 6 |
| durable/live/capability、UI 可重建 | 3、6 |
| 老协议、原生引擎、BEP-19、登录纪律 | 3–7 |

**批准门槛**：本 plan 经用户审阅同意后开始 Task 0；Git 历史与 Cordis 上游来源分别是 Task 0/1 的独立硬 gate。
