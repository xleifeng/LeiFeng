# tlei 插件化架构设计（brainstorming 草案）

**状态**：已获用户批准（2026-09-24）；修订：deepseek-harness 仅作架构参考，Cordis 源码只取上游。实施 plan 待审阅。  
**范围**：HANDOVER §9.1 + E4 桥输入面。  
**日期**：2026-09-24。

## 1. 事实与目标

现行 daemon 的 `daemon/host/src/main.js` 一次性构造 repository、driver、poller、auth、VIP、任务服务、RPC、控制 socket，并负责定时器和逆序停止；`stack.js` 再托管 core 与 web-api。桥的 `main.js` 同时解析 CLI、装配 HTTP、orchestrator 和 qbit；orchestrator 直接构造 qbit client。现有类大多可通过 CJS `require` 单独测试。保留它们的领域实现，用薄插件适配层把创建、依赖、启动、释放交给 Cordis Fiber。

目标是**内核和桥都在插件树上**，并用一套 profile launcher 选择 `thunderd`（core + web-api）、`thunderd-core`（裸 core）或 `bridge-host`（独立桥）。profile 与配置可审计和打印；只有 qbit Recipient Provider；桥接受磁力、`.torrent` 文件和批量任务。现有 RPC、TaskDb、outbox、下载目录及 BEP-19 行为保持兼容。

## 2. 参照与方案比较

已读 `/tmp/dsh-probe` 的架构、vendor 策略和 profile 文档。它只提供**架构参考**：源码 vendor + pin 与修改日志、三角色能力缝、profile patch 顺序、Fiber 所有权与入口守卫。不得复制 dsh 的 Cordis fork、Fiber 补丁、loader 改动或业务包。Cordis 源码直接取 `cordiverse/cordis` 上游的完整固定 commit（候选 `56b3d4f725681cf4556c1a8695a709cc3b6eed74`，须从上游独立校验）；上游不可取得时停止 vendor 任务，不用 dsh 快照替代。

| 候选 | 结论 | 原因 |
|---|---|---|
| 仅桥插件化，内核维持手工装配 | 否 | 与 §9.1“一切皆插件”拍板冲突，生命周期仍两套。 |
| 全部服务改写成新类或按 dsh 60 包拆分 | 否 | 风险和迁移量失控，领域行为无需改写。 |
| 保留 CJS 领域类，ESM Cordis 插件薄层 + profile 启动 | **选用** | 所有资源进入 Fiber 所有权，现有单测与协议可复用，按 tlei 依赖图拆插件。 |

桥进程形态选 **独立 `bridge-host`**：桥面对 qbit、按需 SHA1 和 HTTP 供种，daemon 承载原生引擎与 RPC；现有部署已验证二者单独重启/崩溃不相互终止。Cordis Fiber 管理插件资源与卸载，不能替代进程级故障隔离。三种 profile 共用同一 launcher 和插件定义；将来若需同进程组合，可增加 profile，无须改桥领域逻辑。web-api 继续作为 `thunderd` profile 托管的独立子进程，保留现行 core 存活时 gateway 可单独重启的语义。

## 3. Vendor 边界和来源

直接从 `cordiverse/cordis` 固定 commit 收编 core；若选用其 loader/include，必须同样取上游对应目录与 commit。`cosmokit`、`schemastery` 等闭包依赖优先使用固定版本 npm 包；确需源码 vendor 时分别从其**上游**仓库 pin，不从 dsh 快照复制。保留上游 MIT LICENSE 和原始头信息；本地包名使用 `@tlei` 私有作用域，第三方依赖锁定在 npm lockfile。profile patch、Standard Schema 验证和 dump-config 的行为仍须满足本 spec。HMR、timer、logger-console 和 dsh 业务包不进入本轮。

`vendor/README.md` 必含表格：目录、tlei 包名、**直接上游**仓库及 commit、来源版本、复制时 SHA256、许可证。紧随表格维护**逐项本地修改日志**（路径、原因、验证、是否已回上游）；首项记作用域及构建配置改动。生命周期测试覆盖 setup 中卸载、异步 cleanup 与子 Fiber 时序；若上游行为有缺口，先用独立测试证实，再决定上游修复或最小本地补丁，逐项记日志。不得直接移植 dsh 的补丁。vendor 更新只经显式同步流程和测试，禁止浮动 `latest`。

构建产物从 vendored TS 生成；构建脚本和锁文件入仓。launcher 只导入生成的 ESM，旧 CJS 类由插件适配层通过 `createRequire` 或动态导入获取。禁止将敏感运行时目录、凭据或 qbit profile 纳入 vendor/commit。

## 4. 插件树与依赖

一套 ESM launcher 负责 `--profile`、`--dump-config`、配置读取、启动错误、SIGTERM/SIGINT、有界 dispose 和退出码。profile = base bundle → 形态 bundle → profile patch → 用户 patch；按 ID 替换、禁用或配置已有行，最后一层优先。默认配置只接受本地受控文件；dump 输出最终树但对 secret 字段脱敏，未启动服务、不触碰锁文件。配置以 Cordis `Config`/Standard Schema 校验，未知 profile 或缺依赖立即失败。

插件按**生命周期和依赖**划分，而非每个类一个 npm 包：

1. `runtime-config`：运行目录、路径、平台和 feature 配置；校验后提供只读配置。
2. `repositories`：Task/Settings/Draft/RecentPath/Seed/Operation/Schedule/History/Link/RemoteNode、SQLite 与 secret stores；Fiber dispose 做 flush、backup、close。Task outbox 的持久化仍由现有 TaskRepository 负责。
3. `engine-driver`：Wine/Windows 选择、原生进程启动与关闭；driver generation、TaskDb reader 与能力只由此提供。
4. `event-observation`：DomainEventBus、poller、诊断缓冲、outbox drain；启动在 repositories/driver 后，卸载先停 poller 与 drain。
5. `auth-vip`：钱包、AuthManager、VIP manager、加速 client、引擎 up/down 通知；不搬运或打印 token、session、peer ID。
6. `task-core`：任务创建/查询/操作、草稿、metadata、policy、scheduler、schedule、completion、group 与相关定时器；将现有循环引用改为明确的 post-bind 阶段，禁止插件 setup 阶段读取尚未提供的依赖。
7. `product-services`：history、link-library/sync、private-space、media、capture、notification、remote、diagnostics、bootstrap；所有 `services/` 运行时实例均由插件创建，纯函数工具继续留普通模块。
8. `control-rpc`：methods、dispatcher、control socket；只在依赖全激活后对外监听。`web-api-process` 由 `thunderd` profile 单独提供。
9. `bridge-seed-http`、`bridge-orchestrator`、`bridge-daemon-client`、`recipient-qbit`：桥 verifier、HTTP、会话、编排与 qbit 出口都进入桥 Fiber；绑定 loopback；卸载清定时器、fd、HTTP server，但不删除已有 tlei/qbit 任务。

插件声明所消费和提供的 Cordis service；依赖不齐时启动失败且不得开放 RPC/HTTP。启动顺序由依赖图决定，逆序 dispose 必须可重复且等待异步资源关闭。`thunderd-core` 不装 web-api、桥和 qbit；`thunderd` 加 web-api；`bridge-host` 只装桥及 qbit，daemon 通过既有 RPC 客户端连接。原有 `run.sh`、`main.js`、`stack.js`、桥 `main.js` 改为调用/提示统一 launcher 的兼容入口，CI 守卫拒绝新增绕过 launcher 的直接启动路径；在线部署切换应有明确旧入口退役窗口，不能在测试期间重启现有服务。

## 5. Recipient 缝（三角色）

**Service Definition**：`Recipient` 接口声明 `addTorrent(buffer, metadata)`、`addMagnet(uri)`、`getTorrent(infohash)`、`webseeds(infohash)` 和 capability 描述；操作结果返回明确错误与可重试性，不暴露 qbit HTTP 细节。单一 provider 约束，未装/多装都使 `bridge-host` 启动失败。

**Provider**：`recipient-qbit` 包装现有 qBittorrent WebUI client，配置 host/port/认证从受保护配置读取；继续校验注入后的 infohash 与 `url-list`，保留失败重试和无重复种子的语义。qbit 仍为本轮唯一实现。

**Consumer**：`bridge-orchestrator` 只注入 `Recipient`，从接口添加磁力或注入种子、检查已有种子与 webseed；不 import `qbit-client.js`，不使用 qbit 专属 DTO。现有 208 BUSY、接管健康任务、引擎失败 start 救活、停滞止损保持原语义。

## 6. E4 桥输入面

`bridge-host` profile 的运行配置是任务列表，每项为 `magnet` 或本地 `.torrent` 路径，含独立 savePath；CLI 接受重复 `--magnet`、重复 `--torrent` 与 `--input-file`（UTF-8 文本，逐行磁力或 `.torrent` 路径），可混用。空批次、坏路径、重复 infohash、非 BT v1 元数据应在批次预检时明确报告；同 hash 仅执行一项，错误不静默吞掉。`serve` 现有完成态供种作为 bridge profile 模式保留，其输出文件必须显式指定或按既有安全默认生成。

`.torrent` 路径走现有 web-api `torrent.import`/daemon `createTorrentDraftFromFile` 能力，不重造 bencode、种子上传协议或 TaskDb 写法；桥侧先用现有 `parse-torrent` 读取元数据和 infohash，并经已有 `torrent-injector` 注入 BEP-19 `url-list`。实施前须补齐桥到 daemon 的上传客户端路径及鉴权配置；导入后以既有草稿 commit 流程创建/接管，种子原始字节可用于桥会话。批量任务彼此隔离、限制并发，单项失败记录结构化结果，其余继续；有成功会话时服务保持运行并在 `/status` 暴露每项结果，全部失败才非零退出。`--dump-config` 不打印磁力完整 URI（可能含 tracker/passkey），仅打印脱敏输入摘要。

## 7. 事件、状态与安全不变量

沿用三域：TaskRepository outbox 为 durable 事实；poller/driver 的实时事件为 live 观测；Recipient、限速与加速策略的插件 hook 为 capability 事件。UI 任务状态以 repository/outbox 可重建为验收目标；本轮先做**投影一致性断言和回放测试**，覆盖创建、状态迁移、暂停、完成、失败、删除。若现有 outbox 缺少重建所需字段，需在同一持久化事务补事件，不能用仅内存 hook 伪造事实。断言失败记录诊断并使相关 UI 输出报错，不能继续返回相互矛盾的状态。

登录与桥验收严格遵守 AGENTS.md：refresh 失效时当次 verificationUrl 生成临时二维码直接展示；token/session/peer ID、二维码、临时登录码不得入仓或日志；登录后同时确认账号实时有效、session 已注册、引擎已收到通知，才做 P2SP 验证。既有 loopback 默认和 HTTP 503/206/404 语义保持。profile patch 不允许从 dump、日志泄露 secret。

## 8. 验收与迁移门槛

1. vendor 来源、许可、SHA256、pin 与每项修改可复查；Fiber 中途 unload、异步 cleanup、子 fiber dispose 用例通过。
2. 三个 profile 的最终树可 dump；无效配置和缺 provider 非零退出；core/全量/桥各有**真实 profile composition 启动测试**，不能只手写 `ctx.plugin()` 单测。
3. daemon 全量既有 unit、architecture、web-api 测试通过；旧运行时数据不迁移、不清空，RPC 方法和控制 socket 对照通过；driver respawn、退出清理及 web-api 单独重启行为通过。
4. 桥既有测试和新增磁力、`.torrent`、混合批次、重复 hash、部分失败用例通过；206/503/404、infohash 不变、qbit webseed 接收、BUSY 降级仍通过。
5. 在**不动当前 16800/7127/8085 在线实例及 `.p0/a1-hybrid` 基线**的前提下，用隔离端口与临时 runtime 做冒烟。需要真机换版时先记录 PID/端口、磁盘余量和 TaskDb 快照，使用可回退的部署步骤；磁力 preflight `ok:true` 才认引擎就绪。qbit-root 已从保留 deb 重建，进程无需重启。
6. 入口守卫扫描受支持脚本；README 和 HANDOVER 更新新 profile 命令与迁移记录，不引入 dsh 文档生成系统。

## 9. 实施切片（供后续 plan 展开）

先建 vendor/构建/launcher/profile 测试基座；再迁 repositories/driver/poller 与 task-core；再迁其余 daemon services、RPC/web-api；随后迁桥与 Recipient；最后 E4、事件回放断言、入口守卫和真机冒烟。每个切片由 fresh implementer 实施、任务评审与修复，终审后再选择整合方式。若中途未达到旧行为等价，保持当前在线实例和旧数据，按切片回退代码。

## 10. 当前环境限制

本工作目录没有可用的 `.git/`（初次查看为空目录，后续已不存在），`git status` 报 “not a git repository”；因此目前无法按项目规则创建 feature 分支或检查差异。实施前需恢复仓库 Git 元数据或确认一个可用 checkout，不能用 `git init` 冒充原有历史。此问题不影响本设计文档。当前在线 PID/端口已检查；未对在线进程发信号。
