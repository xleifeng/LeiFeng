# Ubuntu BT 删除后重测：复现步骤、结果与问题分析

> 测试日期：2026-08-05（Asia/Shanghai）
>
> 测试对象：`ubuntu-26.04-desktop-amd64.iso` BT 任务
>
> 测试目的：删除已有任务和本地文件后重新创建任务，确认原生迅雷下载链路、任务删除链路和 VIP 加速链路是否闭环。
> 安全边界：只记录脱敏状态、计数和错误码；不记录 access token、refresh token、session、peer ID、VIP cert 或 speedup 响应正文。

## 0. 修复后复测结果

原报告记录的 `waiting-bt-file` 已解决。修复后的独立 Ubuntu BT 任务得到以下结果：

| 检查项 | 修复后结果 | 证据 |
|---|---|---|
| BT 文件级元数据 | 通过 | 新任务 `BtFileCount=1`，文件 `CID/GCID` 均为 20 字节原生值 |
| speedup 请求 | 通过 | 脱敏日志为 `httpStatus=200`、`resultCode=0`、`itemCount=1` |
| VIP cert 注入 | 通过 | 任务状态进入 `injected`，日志为 `event=injected,itemCount=1` |
| native 稳定性 | 通过 | `TaskDb.Status=5`、`FailureErrorCode=0`，engine 没有重启或崩溃 |
| VIP 实际字节 | 短时未观测到 | `VipReceiveSize=0`；这只表示该资源/观测窗口未命中 VIP 数据通道，不否定控制链成功 |
| 测试清理 | 通过 | 测试任务已从宿主仓库删除，测试稀疏文件和隔离探针目录已移入回收站 |

最终确认了三个相互叠加的实现问题：

1. BT 创建只传最小 `btInfo`，SDK 虽能下载，却不会建立 `BtFile` 文件树，因而没有逐文件 `CID/GCID`；
2. V2 仓库把原始 infohash 与去重用 `sourceFingerprint` 混为一谈，VIP 请求曾发送非法的 `bt://bt:info:<hash>/0`；
3. speedup BT 请求遗漏官方字段 `file_index`，且 `client_sequence` 没有递增。

修复后请求使用原始 infohash、完整 BT 文件树和官方请求字段，状态闭环为：

```text
BT create
  -> BtFile CID/GCID
  -> speedup HTTP 200 / result 0
  -> enableDcdnWithVipCert
  -> vip state = injected
```

## 1. 原始复测结论（修复前）

以下表格保留修复前的故障快照，当时得到的是“下载能力正常，VIP 加速未进入任务级生效阶段”：

| 检查项 | 结果 | 说明 |
|---|---|---|
| 删除旧任务 | 通过 | V2 任务记录从宿主任务查询中消失，随后本地 Ubuntu 文件被删除 |
| 重新上传/创建 BT | 通过 | 新任务得到 native engine id，并持续写入 TaskDb 与本地文件 |
| 普通 BT 下载 | 通过 | 复测任务最高约 5–8 MB/s；最终清理前已下载约 1.1 GB |
| daemon/SDK | 通过 | `sdkReady=true`、`transportReady=true` |
| 账号与全局 VIP 前置条件 | 通过 | `accountReady=true`、`isVip=true`、`peerIdReady=true`、全局 availability 为 `available` |
| 任务级 VIP | 未通过 | 状态稳定为 `waiting-bt-file`，`vipReceivedBytes=0`，没有进入 request/inject/effective |
| 删除复测任务和文件 | 通过 | 宿主查询无 Ubuntu 任务，本地下载目录无对应文件 |
| 自动化回归 | 通过 | daemon 单元测试 `317 pass, 0 fail`；VIP/仓库/native 能力重点测试 `16 pass, 0 fail` |

因此，原始问题不是登录、账号、下载网络、允许目录或删除逻辑，而是**没有拿到 BT 每个文件所需的 SDK `CID/GCID` 元数据**，导致 VIP descriptor 无法构造。

## 2. 测试前置条件

确保使用项目当前迅雷 SDK 基线和独立 runtime。不要把测试 runtime 与其他正在运行的 daemon 混用。

```bash
cd "$(git rev-parse --show-toplevel)"
bash daemon/run.sh
```

启动健康检查：

```bash
curl -sS -H 'Content-Type: application/json' \
  http://127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":1,"method":"thunder.ui.v2.bootstrap","params":[]}'
```

至少确认返回中的以下字段为真：

```text
result.engine.transportReady = true
result.engine.sdkReady       = true
```

本报告使用的监控器是只读的，不会自动启动、暂停、删除任务，也不会修改 VIP 开关：

```bash
THUNDERD_MONITOR_INTERVAL_MS=10000 \
  node daemon/monitor-ubuntu-vip.js
```

另一个终端查看脱敏 NDJSON：

```bash
tail -f daemon/.runtime/monitor/ubuntu-vip.ndjson
```

监控器源码为 [`daemon/monitor-ubuntu-vip.js`](daemon/monitor-ubuntu-vip.js)，日志固定写入 runtime 下的 `monitor/ubuntu-vip.ndjson`。如果设置了 `THUNDERD_RPC_SECRET`，需要先为监控器补充同样的 Authorization 头；本次复测使用 loopback 无 secret 模式。

## 3. 删除旧任务：可重复命令

先按显示名查询，不使用 native 的短 `engineId` 作为 V2 task id：

```bash
curl -sS -H 'Content-Type: application/json' \
  http://127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":2,"method":"thunder.ui.v2.tasks.query","params":[{"search":"ubuntu-26.04-desktop-amd64.iso","limit":50}]}'
```

将返回的完整 `taskId` 放入环境变量：

```bash
TASK_ID='<完整的 V2 taskId>'
```

推荐的“回收并删除本地文件”路径是 `recycle` 后再清空回收站：

```bash
curl -sS -H 'Content-Type: application/json' \
  http://127.0.0.1:16800/jsonrpc \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"thunder.ui.v2.tasks.command\",\"params\":[{\"taskIds\":[\"$TASK_ID\"],\"command\":\"recycle\",\"options\":{\"deleteLocalFiles\":true},\"idempotencyKey\":\"ubuntu-retest-recycle-$(date +%s)\"}]}"

curl -sS -H 'Content-Type: application/json' \
  http://127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":4,"method":"thunder.ui.v2.trash.empty","params":[{"deleteLocalFiles":true,"idempotencyKey":"ubuntu-retest-empty-1"}]}'
```

本次最后一轮清理时，任务 poller 正在更新 revision，为避免使用旧 `expectedRevision` 产生竞争，实际采用了以下等价顺序：

1. `thunder.ui.v2.tasks.command`，`command=remove-record`，不传 `expectedRevisions`；
2. `thunder.ui.v2.trash.empty`，`deleteLocalFiles=true`。

`remove-record` 负责停止并移除 native 记录、把宿主任务放入回收站；物理本地文件由后续 `trash.empty` 明确删除。不要直接修改 `TaskDb.dat`，因为它是 SDK 的历史数据库，不是宿主任务仓库。

删除完成后的判定：

```bash
curl -sS -H 'Content-Type: application/json' \
  http://127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":5,"method":"thunder.ui.v2.tasks.query","params":[{"search":"ubuntu-26.04-desktop-amd64.iso","limit":50}]}'
```

期望 `items=[]`。同时检查允许的下载根目录，确认 Ubuntu 文件或目录已经不存在。回收站和历史统计仍可能保留历史计数，这是宿主审计/历史设计，不代表文件删除失败。

## 4. 重新创建 BT 任务

### 4.1 上传种子

种子必须上传到 daemon 所在设备，不能把另一台设备的 Windows 路径直接交给 daemon。使用 raw body 上传：

```bash
TORRENT='/path/to/ubuntu-26.04-desktop-amd64.torrent'

curl -sS \
  -H 'Content-Type: application/x-bittorrent' \
  -H 'X-Thunder-Filename: ubuntu-26.04-desktop-amd64.torrent' \
  --data-binary "@$TORRENT" \
  http://127.0.0.1:16800/api/v2/create-drafts/torrent
```

响应中的 `draftId` 用于 V2 preflight/commit。若使用已经保存在本机的 seed cache，也可以直接使用类似下面的路径；路径仅是本机示例，不能硬编码到跨设备请求中：

```text
daemon/.runtime/seeds/<sha256>.torrent
```

### 4.2 预检、选择文件和提交

```bash
curl -sS -H 'Content-Type: application/json' \
  http://127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":6,"method":"thunder.ui.v2.create.preflight","params":[{"inputs":[{"kind":"torrent","value":"<draft/upload reference>"}],"savePath":"<允许的下载目录>"}]}'
```

根据预检返回的文件树保留需要下载的 `selectedFileIndices`，再执行：

```bash
curl -sS -H 'Content-Type: application/json' \
  http://127.0.0.1:16800/jsonrpc \
  -d '{"jsonrpc":"2.0","id":7,"method":"thunder.ui.v2.create.commit","params":[{"draftIds":["<draftId>"],"expectedRevisions":{"<draftId>":1},"idempotencyKey":"ubuntu-retest-create-1"}]}'
```

提交成功后得到新的宿主 `taskId`。本次复测出现过的代表性任务如下，ID 仅用于本机证据关联：

| 宿主 taskId | native engineId | 用途 | 结果 |
|---|---:|---|---|
| `6d6d932fbf659ecd` | `99166512` | 修复 VIP 状态归一化后的首个 BT 重测 | 正常下载，VIP 卡在 `waiting-bt-file` |
| `a0529f1ad8f84f63` | `109541152` | 最后一轮删除前的复测 | 下载到约 1.1 GB 后清理 |
| `afe98ddd2d31a498` | `106844924` | 完整修复后的独立 Ubuntu BT 验证 | speedup HTTP 200/result 0，VIP 进入 `injected`，随后清理 |

## 5. 监控判定方法

监控器每 10 秒同时读取四类信息：

1. `thunder.ui.v2.bootstrap`：daemon、SDK、账号基本状态；
2. `thunder.ui.v2.vip.getGlobalState`：全局 VIP 能力和 peer-id 就绪情况；
3. `thunder.ui.v2.tasks.query` 与 `thunder.ui.v2.vip.getTaskState`：宿主任务生命周期和任务级 VIP 状态；
4. `TaskDb.dat` 只读查询：native `Status`、总接收字节、`VipReceiveSize`、`FreeDcdnReceiveSize` 和历史重复行。

判定不是只看下载速度，而是看状态转换和 VIP 字节：

| 监控 verdict | 含义 |
|---|---|
| `effective` | 任务 VIP state 为 `effective` 或 VIP 字节增长 |
| `in-progress-*` | 已具备前置条件，正在申请、注入或等待周期刷新 |
| `not-effective-waiting-bt-file` | 普通下载在进行，但缺 BT 文件级 CID/GCID，尚未发起 speedup |
| `vip-unavailable-*` | 全局账号、会员或 peer-id 前置条件不满足 |
| `task-not-found` | 任务已删除或当前不在宿主仓库中；删除后的正常结果 |
| `daemon-unavailable` | daemon 重启窗口或端口不可用，不应直接判为下载失败 |

本次有效下载期间的典型日志如下（已脱敏）：

```json
{
  "verdict": "not-effective-waiting-bt-file",
  "daemon": {"ok": true, "sdkReady": true, "accountReady": true, "isVip": true, "peerIdReady": true},
  "task": {"lifecycle": "downloading", "completedBytes": 1065370439, "totalBytes": 6518974464},
  "vip": {"availability": "available", "state": "waiting-bt-file", "vipReceivedBytes": 0, "problemCode": "waiting-bt-file"},
  "native": {"status": 5, "failureErrorCode": 0, "relatedToHostTask": true}
}
```

这说明下载任务和 native TaskDb 都在增长，但 VIP 数据通道没有收到任何字节。

## 6. 实测结果

### 6.1 删除与重新下载

- 删除旧 Ubuntu 任务成功，宿主查询不再返回该任务。
- 本地已完成/部分完成的 Ubuntu 文件被删除；之后重新上传 torrent 并创建了新的 native 任务。
- 新任务在 `TaskDb` 中拥有对应 `TaskBase` 行，`TotalReceiveSize` 与宿主 `completedBytes` 持续增长。
- 最后一轮复测任务 `a0529f1ad8f84f63` 在清理前下载到约 `1.1 GB`，观测速度约 `5.97 MB/s`；这证明普通 BT 下载链路没有被 VIP 代码阻塞。

### 6.2 VIP 前置条件

监控持续报告：

```text
sdkReady=true
accountReady=true
isVip=true
peerIdReady=true
acceleration.availability=available
acceleration.enabled=true
```

所以不能把本次结果解释为“账号未登录”“不是会员”或“全局加速开关关闭”。

### 6.3 任务级 VIP 状态

任务级状态在有效下载期间保持：

```text
vip.state=waiting-bt-file
vip.problemCode=waiting-bt-file
vipReceivedBytes=0
freeDcdnReceivedBytes=0
```

没有出现以下任一阶段：

```text
requesting -> injected -> effective
```

因此本次没有发起可用的逐文件 speedup descriptor，也没有执行有效的 VIP cert 注入。`VipReceiveSize=0` 本身不能证明服务端授权失败，但这里同时有明确的 `waiting-bt-file`，根因定位更具体。

### 6.4 删除后的最终状态

最终清理后，V2 查询返回：

```json
{
  "items": [],
  "total": 0,
  "counts": {"all": 0, "active": 0, "completed": 0, "trash": 2}
}
```

监控器随后输出 `verdict=task-not-found`，这是因为宿主任务已不存在，属于预期清理状态。`TaskDb.dat` 仍能看到旧 native 历史行（包括重复任务行），这是 SDK 的历史保留行为；本次没有直接删除或改写该数据库。

## 7. 问题定位过程

### 7.1 先修复了一个“假 disabled”状态问题

最初观察到任务 VIP 总是 `disabled`，但宿主 registry 中实际写入的是嵌套对象：

```js
{ vip: { enabled: true, state: 'waiting-bt-file', ... } }
```

旧的 `normalizeTaskRecord/mapLegacyVip` 只读取旧版扁平字段 `vipState`、`vipEnabled` 等，归一化时把嵌套状态丢掉，下一次读回又变成 `disabled`。这会掩盖真正问题。

已修复 [`daemon/host/src/repositories/task-repository.js`](daemon/host/src/repositories/task-repository.js)：

- 同时兼容嵌套 VIP 对象和旧扁平字段；
- 保留 `enabled`、`state`、计数、刷新时间和最后错误码；
- 增加完整 VIP 状态白名单；
- 增加 `V2 VIP nested state survives repository normalization and legacy registry updates` 回归测试。

修复后状态从错误的 `disabled` 变为有意义的 `waiting-bt-file`，说明状态归一化问题已经与实际 SDK 元数据问题分离。

### 7.2 TaskDb 证据：BtTask 存在，但 BtFile 为空

对 runtime 下 `profile/TaskDb.dat` 做只读 SQLite 检查：

```bash
DB="${THUNDERD_RUNTIME_DIR:-daemon/.runtime}/profile/TaskDb.dat"

sqlite3 -json "file:$DB?mode=ro" \
  "SELECT TaskId,Status,FailureErrorCode,TotalReceiveSize,ResourceSize,VipReceiveSize,FreeDcdnReceiveSize,Name FROM TaskBase WHERE Name LIKE 'ubuntu-26.04-desktop-amd64.iso%';"

sqlite3 -json "file:$DB?mode=ro" \
  "SELECT COUNT(*) AS bt_file_count FROM BtFile;"

sqlite3 -json "file:$DB?mode=ro" \
  "SELECT * FROM BtTask ORDER BY rowid DESC LIMIT 10;"
```

观察结果：

- `TaskBase` 有有效任务行，接收字节持续增长；
- `BtTask` 有 BT 任务记录和 seed 关联；
- `BtFile` 对这些 live/historical Ubuntu 任务没有可用于 descriptor 的子文件行；
- 因此无法取得每个选中文件的 `CID/GCID`、文件索引映射和可注入项。

这也解释了为什么“BT 能正常下载”与“VIP descriptor 无法生成”可以同时成立：两条链路依赖的 native 数据面不同。

### 7.3 原生 SDK fallback 探针结果

当前 `NativeTaskManager` 的确没有名为 `getBtFileRuntime` 的直接方法，但官方 renderer 使用的是另一条真实接口：

```text
NativeTaskInterface.toTaskExtra(handle)
  -> waitLoadBtFileFinish(callback)
  -> getBtFileInfos(callback)
  -> getBtFileInfoByIndex(index, callback)
```

隔离 Wine prefix 实测确认：这组 **BT TaskExtra 只读 getter** 在 25.0.82.1562 下不会触发此前其他 callback API 的 V8 fatal，并能返回 `realIndex/fileSize/fileStatus/traceId/CID/GCID`。生产实现因此采用严格限定的只读 fallback：

- [`daemon/engine/bt-control.js`](daemon/engine/bt-control.js)：通过 `NativeTaskInterface.toTaskExtra` 读取文件列表，并设置 4 秒超时；
- [`daemon/engine/native-capabilities.js`](daemon/engine/native-capabilities.js)：按 `toTaskExtra` 探测能力；
- [`daemon/engine/native-capabilities.json`](daemon/engine/native-capabilities.json)：只对当前已隔离验证的 SDK 版本标记 `bt.getFileRuntime=verified`；
- [`daemon/host/src/vip-manager.js`](daemon/host/src/vip-manager.js)：仅在 TaskDb 缺少选中文件 CID/GCID 时调用 fallback，TaskDb 已完整时不触发 callback。

该例外不能推广到 event API 或其他 callback getter；它只覆盖已经单独验证的 BT 文件元数据读取。

### 7.4 根因链与修复链

```text
修复前：
最小 btInfo
  -> BT 可以下载
  -> TaskDb.BtFile 为空
  -> descriptor 无 items
  -> waiting-bt-file

修复后：
完整 btInfo.fileLists/tracker/origin/scheduler
  -> TaskDb.BtFile 有逐文件 CID/GCID
  -> 仓库单独保留 raw infoId 与 sourceFingerprint
  -> speedup BT item 带 file_index，client_sequence 递增
  -> HTTP 200 / result 0
  -> cert 注入
  -> injected
```

排除项：

- 不是 Windows 路径问题：torrent 已在 daemon 设备上传并被原生引擎接受；
- 不是下载目录安全策略：任务能创建并持续写入允许目录；
- 不是删除失败：host task 和本地文件均已清理；
- 不是 `TaskDb.Status=5` 的暂停误判：宿主 lifecycle 同时为 `downloading`，且字节增长；
- 不是监控器误报：监控器同时比对 host RPC、TaskDb 和 VIP RPC，三者一致；
- 不是账号/会员前置条件：全局状态全部可用。

## 8. 源码修改与回归测试

### 8.1 修改清单

| 文件 | 修改 |
|---|---|
| `daemon/host/src/repositories/task-repository.js` | 保留嵌套 VIP 状态，兼容旧扁平字段，增加状态白名单 |
| `daemon/host/src/domain/native-bt-info.js` | 统一构造官方完整 BT 创建参数，强制携带完整文件树 |
| `daemon/host/src/services/create-task-service.js` | 修复 V2 torrent、磁力转 BT 创建入口，并持久化原始 infoId/infoHash |
| `daemon/host/src/methods.js` | 修复兼容 RPC 的 torrent、磁力转 BT 创建入口 |
| `daemon/host/src/repositories/task-repository.js`、`registry.js` | 分离原始协议身份与去重指纹，避免 `bt:info:` 被当作 infohash |
| `daemon/host/src/vip-speedup-client.js` | BT item 增加 `file_index`，`client_sequence` 按请求递增，保留脱敏状态日志 |
| `daemon/host/src/vip-manager.js` | 仅在 TaskDb 元数据不完整时使用 native TaskExtra 只读 fallback |
| `daemon/host/src/main.js` | 接入 runtime fallback 与脱敏 speedup 结果日志 |
| `daemon/engine/bt-control.js` | 接入经隔离验证的 TaskExtra 文件元数据 callback，并设置超时 |
| `daemon/engine/native-capabilities.js`、`native-capabilities.json` | 当前 SDK 的 TaskExtra 文件 getter 标为 verified |
| `daemon/monitor-ubuntu-vip.js` | 只读监控 host/global VIP/task/native TaskDb，并输出 verdict |
| `daemon/package.json` | 增加 `monitor:ubuntu-vip` 启动脚本 |

### 8.2 重点测试命令

重点回归：

```bash
node --test \
  daemon/test/unit/native-bt-info.test.js \
  daemon/test/unit/create-task-service.test.js \
  daemon/test/unit/vip-speedup-client.test.js \
  daemon/test/unit/vip-manager.test.js \
  daemon/test/unit/task-repository-v2.test.js \
  daemon/test/unit/engine-task-control.test.js \
  daemon/test/unit/native-capabilities.test.js \
  daemon/test/unit/native-probe.test.js
```

完整 daemon 单元测试：

```bash
npm --prefix daemon run test:unit
```

本次结果：

```text
修复相关定向测试：42 pass, 0 fail
daemon 单元测试：322 pass, 0 fail
node --check：通过
```

其中必须保留的回归断言是：

1. BT 创建参数必须包含完整 `fileLists`，不能退化回“能下载但无 BtFile”的最小对象；
2. 原始 `infoId` 必须与 `sourceFingerprint` 分开持久化，并能兼容恢复旧的 `bt:info:<hash>` 记录；
3. BT speedup payload 必须携带 `file_index`，请求序号必须单调递增；
4. `BtFile` 为空且 native runtime fallback 返回文件时，VIP manager 能合并文件元数据；
5. TaskDb 已有完整 CID/GCID 时不得重复调用 callback fallback；
6. capability 只对隔离实测过的 SDK 版本标记 `verified`。

## 9. 已完成项与剩余验收

当前已经完成：

1. 取得真实逐文件 CID/GCID；
2. 验证 `fileIndex -> CID/GCID -> speedup item -> enableVipDcdnWithVipCert` 一一对应；
3. 验证 speedup 服务端返回 HTTP 200 / result 0；
4. 验证任务进入 `injected` 且 native 无崩溃。

剩余的是数据面效果验收，而不是控制链阻塞：

1. 选择官方 GUI 已确认会命中 VIP 通道的对照资源；
2. 观察 `VipReceiveSize` 增长并进入 `effective`；
3. 用同账号、同资源、相近网络窗口做官方 GUI A/B。`VipReceiveSize=0` 不能单独作为失败判据。

禁止的“修复”：

- 不从 torrent infohash、文件路径或文件序号猜造 CID/GCID；
- 不把任意 callback API 的存在自动推广为生产安全；只有当前 TaskExtra 文件 getter 已单独验证；
- 不直接改写 `TaskDb.dat` 补数据；
- 不用普通下载速度增长冒充 VIP 加速生效。

## 10. 证据文件

以下文件属于本机 runtime 证据，通常被 gitignore，不应提交凭据或迅雷专有二进制：

| 文件 | 用途 |
|---|---|
| `daemon/.runtime/monitor/ubuntu-vip.ndjson` | 10 秒一条的脱敏监控快照 |
| `daemon/.runtime/daemon-stdout.log` | VIP fallback 的脱敏错误，如 `bt-runtime-error` |
| `daemon/.runtime/engine.log` | Wine/native 引擎启动和任务日志 |
| `daemon/.runtime/profile/TaskDb.dat` | SDK TaskDb，只读查询，不手工修改 |
| `daemon/.runtime/data/tasks.json` | 宿主 V2 任务仓库，验证 host task 是否存在 |

复测结束后，监控器继续运行时看到 `verdict=task-not-found` 是预期结果；重新测试前应先确认旧 monitor 已停止或复用同一个 monitor lock，避免多个进程同时写同一份日志。
