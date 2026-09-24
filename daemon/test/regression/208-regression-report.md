# 208 回归验收报告（B2 转正）

- 日期：2026-09-24
- 脚本：`daemon/test/regression/208-regression.sh`（因果基线 `recon/p2sp-webseed/208-repro.sh` 原样保留）
- spec：`docs/superpowers/specs/2026-09-24-a3-b2-engine-crash-design.md` §3
- 结论：**PASS=4 FAIL=0**（run5 首次全绿；run8 复跑全绿，R4 SKIP 语义正确）

## 结果矩阵

| 用例 | 场景 | 预期（修复后翻转） | 结果 |
|---|---|---|---|
| R1 | 同磁力同目录（.p0/a1-hybrid 存量 completed）redownload | 接管/复用/明确拒绝，绝不静默 208 | ✅ commit 明确拒绝 `NAME_CO…`（目标目录已有完成文件，名字冲突拒绝） |
| R2 | 新目录强制走"新建"（B1 手法） | 引擎残留行活跃时 `BT_NATIVE_SESSION_BUSY` 明确拒绝 | ✅ commit 明确拒绝 `BT_NATIVE_SESSION_BUSY`（报错带占用行 engineId/status/savePath/name 与释放指引） |
| R3 | 同 infohash host 行数核对 | 无失控增殖 | ✅ 行数 0（基线 0 + 自建 ≤2 内） |
| R4 | daemon+引擎重启后新建（第二磁力 dafc8c…） | 创建管线正常成功 | ✅ run5：重启后 10s 磁盘 +6.2GiB 判 downloading；run6+：引擎残留行时诚实 SKIP |

## 过程中发现并修复的产品缺陷

1. **outbox drain fsync 风暴（R4 首跑暴露，阻塞级）**
   - 根因：`ackEvent` 每条事件全量重写 tasks.json（844KB）+fsync；积压 1013 条（A3 修复前的 downloading↔queued 振荡事件，992 条来自 7f8db 任务）× 2 消费者 ≈ 1.7GB 写放大，jbd2 排队拖死 daemon 启动（60s+ 不就绪，D 态 `jbd2_log_wait_commit`）。
   - 修复：`TaskRepository.ackEvents` 批量 ack 单次落盘；history/link 两消费者 drain 包单 sqlite 事务；sqlite `synchronous FULL→NORMAL`（WAL 组合官方推荐，掉电只丢末尾事务不损坏）。
   - 效果：daemon 启动 60s+卡死 → **3 秒就绪**。单测 `task-repository-v2.test.js`（fsync storm regression）。

2. **BUSY 报错无诊断**：`BT_NATIVE_SESSION_BUSY` 现在携带占用行明细（engineId/status/savePath/name）与释放指引。

3. **孤儿引擎行自动释放（部分有效）**：引擎 `deleteTasks` 不清 TaskBase 行，重启后 SDK auto-resume 残留行占会话。host 侧对「无 host 引用 且 (Stopped(7) 或 Running(5)+数据已从盘上消失)」的孤儿行做一次性 deleteTasks+重查。**实测引擎限制：deleteTasks 无法撤销活跃内存会话**（释放后快照仍在），此时维持明确 BUSY 拒绝（不退回静默 208）。
   - 顺带修复：`normalizeComparableEnginePath` 小写化路径直接喂 `fs.existsSync` 会把含大写字母的 Linux 路径误判不存在 → 新增保留大小写的 `engineSavePathToLinux`。

## 引擎既知限制（记录在案，非 host 可修）

- 同一 infohash 引擎只持一个会话；会话被占时同 hash 重建只能明确拒绝。
- `deleteTasks` 不清理 TaskBase 行、不撤销活跃内存会话；重启后 SDK auto-resume 残留行。
- R4 因此带 SKIP 预检：引擎 TaskBase 已有同 hash 非终态行时跳过（历史 run5 已验证新建语义）。

## 运行方式

```bash
bash daemon/test/regression/208-regression.sh           # 全量 R1-R4
bash daemon/test/regression/208-regression.sh --keep    # 保留数据目录便于排查
```

判定原则：host `err.nativeCode` 优先、磁盘增量兜底（lifecycle 观测面是 A3 修复对象，脚本不信任它）。
安全约束：只删自建任务（两步删）与自建目录；禁 `pkill -f`（pgrep -fx 精确 PID）。
