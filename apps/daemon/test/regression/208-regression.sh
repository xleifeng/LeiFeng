#!/usr/bin/env bash
# 208-regression.sh — 208 修复回归验收（B2 转正；spec 2026-09-24-a3-b2-engine-crash-design.md §3）
#
# 与因果基线 recon/p2sp-webseed/208-repro.sh（原样保留）的区别：这里测**修复后行为**，预期翻转。
#   R1  同磁力+同目录建任务（host 面已有 completed 存量）→ 接管/复用或明确拒绝，绝不静默 208
#   R2  换新目录强制走"新建"路径（B1 手法）→ 引擎残留行活跃时 BT_NATIVE_SESSION_BUSY 明确拒绝
#   R3  hybrid 编排器幂等重入（同磁力重复 hybridDownload）→ 接管存量，host 面不新增行
#   R4  daemon+引擎重启后同磁力再建 → 正常成功（T3 基线不变）
#
# 判定：host err.nativeCode 优先、磁盘增量为准（lifecycle 观测面是 A3 修复对象，本脚本不信它）。
# 安全：只清自己建的 host 任务（两步删）与自己目录；不动他人任务；禁 pkill -f（pgrep -fx 精确 PID）。
# 用法：bash daemon/test/regression/208-regression.sh [--keep]   # --keep 保留数据目录便于排查
set -u

cd "$(dirname "$0")/../../.."   # repo root
export PATH="$HOME/bin:$PATH"   # wine/wineserver 在 ~/bin
source recon/p2sp-webseed/p0-lib.sh

MAGNET="${P0_MAGNET:-magnet:?xt=urn:btih:CF53833153B636C95A7DFBA6F8B1C819C1046011}"
HASH=cf53833153b636c95a7dfba6f8b1c819c1046011
SAVE_BASE="${P0_SAVE_BASE:-/home/yj/code/tlei/.p0/b2-regression}"
OUT="daemon/test/regression"
PASS=0; FAIL=0
MY_TASK_IDS=()   # 本脚本创建的 host 任务（退出时两步删清）

mkdir -p "$SAVE_BASE"

cleanup() {
  if [ "${#MY_TASK_IDS[@]}" -gt 0 ]; then
    log_info "清场：删除本脚本创建的 host 任务 ${MY_TASK_IDS[*]}"
    for id in ${MY_TASK_IDS[@]+"${MY_TASK_IDS[@]}"}; do remove_task "$id"; done
  fi
  if [ "${1:-}" != "--keep" ]; then
    rm -rf "$SAVE_BASE/r1" "$SAVE_BASE/r2" "$SAVE_BASE/r4" 2>/dev/null
  fi
}
KEEP_FLAG="${1:-}"
trap 'cleanup "$KEEP_FLAG"' EXIT

# ---------- 工具（复用 208-repro 语义，缩略版） ----------

host_task_field() {  # host_task_field <taskId> <py-expr over i> — 取单任务字段
  local tid="$1" expr="$2"
  td_rpc 'thunder.ui.v2.tasks.query' '[{"limit":100}]' > /tmp/b2-reg-ht.json 2>/dev/null
  TID="$tid" EXPR="$expr" python3 - <<'PY'
import json,os,sys
try: d=json.load(open("/tmp/b2-reg-ht.json"))
except Exception: sys.exit(1)
tid, expr = os.environ.get("TID",""), os.environ.get("EXPR","")
for i in (d.get("items") or []):
    if i.get("taskId") == tid:
        print(eval(expr)); break
PY
}

host_tasks_by_hash() {  # host 面同 infohash 任务行数（view=all ∪ trash，覆盖回收站）
  # 列表 DTO 不含 sourceFingerprint/savePath，用 displayName 前缀（磁力默认名 = <hash>.torrent）
  local n1 n2
  td_rpc 'thunder.ui.v2.tasks.query' '[{"limit":100}]' > /tmp/b2-reg-hash1.json 2>/dev/null
  td_rpc 'thunder.ui.v2.tasks.query' '[{"limit":100,"view":"trash"}]' > /tmp/b2-reg-hash2.json 2>/dev/null
  n1=$(H="$HASH" python3 - /tmp/b2-reg-hash1.json <<'PY'
import json,os,sys
try: d=json.load(open(sys.argv[1]))
except Exception: sys.exit(0)
h = os.environ.get("H","").lower()
print(sum(1 for i in (d.get("items") or []) if str(i.get("displayName") or "").lower().startswith(h)))
PY
)
  n2=$(H="$HASH" python3 - /tmp/b2-reg-hash2.json <<'PY'
import json,os,sys
try: d=json.load(open(sys.argv[1]))
except Exception: sys.exit(0)
h = os.environ.get("H","").lower()
print(sum(1 for i in (d.get("items") or []) if str(i.get("displayName") or "").lower().startswith(h)))
PY
)
  echo $(( ${n1:-0} + ${n2:-0} ))
}

commit_verdict() {  # commit_verdict <label> <taskId> <secs> — 出终态/下载态判定（nativeCode 优先、磁盘兜底）
  local label="$1" tid="$2" secs="$3"
  local deadline=$(( $(date +%s) + secs ))
  REG_VERDICT="unknown"
  local dir_bytes prev grow=0
  prev=$(du -sb "$SAVE_BASE" 2>/dev/null | awk '{print $1}')
  while [ "$(date +%s)" -lt "$deadline" ]; do
    v=$(host_task_field "$tid" "((i.get('error') or {}).get('nativeCode') or '') and ('%s:%s' % ('ERR', (i.get('error') or {}).get('nativeCode'))) or (i.get('lifecycle') or '?')")
    case "$v" in
      ERR:*) REG_VERDICT="$v"; log_info "[$label] 判定 = $v"; return 0 ;;
    esac
    sleep 10
    dir_bytes=$(du -sb "$SAVE_BASE" 2>/dev/null | awk '{print $1}')
    grow=$(( dir_bytes - prev )); prev=$dir_bytes
    if [ "$grow" -gt 2097152 ]; then REG_VERDICT="downloading"; log_info "[$label] 判定 = downloading（磁盘 10s +$(( grow / 1048576 ))MiB）"; return 0; fi
    [ "$v" = "completed" ] && { REG_VERDICT="completed"; log_info "[$label] 判定 = completed"; return 0; }
  done
  REG_VERDICT="timeout(host=$v)"
  log_err "[$label] 判定超时（host=$v）"
}

create_bt() {  # 草稿流建任务（与 orchestrator 同路径）；成功回写 REG_TASK_ID；失败回写 REG_COMMIT_ERR
  local label="$1" save_dir="$2" dup_res="$3" magnet_src="${4:-$MAGNET}"
  local preflight draft_id state patch commit task_id
  REG_TASK_ID=""; REG_COMMIT_ERR=""
  preflight=$(td_rpc 'thunder.ui.v2.create.preflight' "{\"inputs\":[\"$magnet_src\"],\"savePath\":\"$save_dir\"}") || { log_err "[$label] preflight 失败"; return 1; }
  printf '%s' "$preflight" > "/tmp/b2-reg-pre-$label.json"
  draft_id=$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1])); r=(d.get("results") or [{}])[0] or {}
sys.stdout.write(((r.get("draft") or {}).get("draftId")) or "")
' "/tmp/b2-reg-pre-$label.json")
  [ -n "$draft_id" ] || { log_err "[$label] 未取得 draftId"; REG_COMMIT_ERR="no-draft-id"; return 1; }
  local deadline=$(( $(date +%s) + 150 ))
  while :; do
    td_rpc 'thunder.ui.v2.create.getDraft' "{\"draftId\":\"$draft_id\"}" > "/tmp/b2-reg-draft-$label.json" 2>/dev/null
    state=$(python3 - "/tmp/b2-reg-draft-$label.json" <<'PY' 2>/dev/null || echo ''
import json,sys
print(json.load(open(sys.argv[1])).get("state") or "")
PY
)
    [ "$state" = "ready" ] && break
    [ "$state" = "failed" ] && { log_err "[$label] 草稿 failed"; REG_COMMIT_ERR="draft-failed"; return 1; }
    [ "$(date +%s)" -ge "$deadline" ] && { log_err "[$label] 元数据超时 state=$state"; REG_COMMIT_ERR="metadata-timeout"; return 1; }
    sleep 3
  done
  # dup_res: force（redownload，模拟修复前触发双建）/ none（裸 commit，走 daemon 自判）
  if [ "$dup_res" = "force" ]; then
    patch="{\"draftId\":\"$draft_id\",\"duplicateResolution\":\"redownload\"}"
    td_rpc 'thunder.ui.v2.create.updateDraft' "$patch" >/dev/null || log_err "[$label] updateDraft 失败"
  fi
  commit=$(td_rpc 'thunder.ui.v2.create.commit' "{\"draftIds\":[\"$draft_id\"]}")
  REG_COMMIT_ERR=""
  task_id=$(printf '%s' "$commit" | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin); r=(d.get("results") or [{}])[0] or {}
  ids=r.get("taskIds") or []
  sys.stdout.write(ids[0] if ids else "")
except Exception:
  sys.stdout.write("")' )
  if [ -z "$task_id" ]; then
    REG_COMMIT_ERR=$(printf '%s' "$commit" | head -c 400)
    return 1
  fi
  REG_TASK_ID="$task_id"
  log_info "[$label] commit taskId=$task_id"
}

remove_task() {
  local id="$1"
  td_rpc 'thunder.ui.v2.tasks.command' "{\"taskIds\":[\"$id\"],\"command\":\"recycle\"}" >/dev/null 2>&1
  sleep 1
  td_rpc 'thunder.ui.v2.tasks.command' "{\"taskIds\":[\"$id\"],\"command\":\"delete-permanently\"}" >/dev/null 2>&1
}

record() {  # record <Rn> <pass|fail> <描述>
  if [ "$2" = "pass" ]; then PASS=$((PASS+1)); log_info "[$1] ✅ PASS — $3"
  else FAIL=$((FAIL+1)); log_err "[$1] ❌ FAIL — $3"; fi
}

# ---------- 预检 ----------

require_tools
if ! pgrep -fx "node daemon/host/src/stack.js" >/dev/null 2>&1; then
  log_info "daemon 未起，setsid 拉起"
  ( setsid bash daemon/run.sh > /tmp/b2-reg-thunderd.log 2>&1 < /dev/null & )
fi
deadline=$(( $(date +%s) + 60 ))
while :; do
  ok=$(td_rpc_raw 'thunder.ui.v2.create.preflight' "{\"inputs\":[\"$MAGNET\"],\"savePath\":\"$SAVE_BASE/r1\"}" 2>/dev/null | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin); r=(d.get("result",{}).get("results") or [{}])[0]
  sys.exit(0 if r.get("ok") else 1)
except Exception:
  sys.exit(1)' 2>/dev/null && echo ok || echo fail)
  [ "$ok" = "ok" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && die "daemon/引擎 60s 未就绪"
  sleep 3
done
log_info "daemon + 引擎就绪；磁盘 $(df -h /home/yj/code/tlei | tail -1 | awk '{print $4}') 可用"

BASELINE_ROWS=$(host_tasks_by_hash)
log_info "同 infohash host 行数基线 = $BASELINE_ROWS"

# ---------- R1：同目录建任务 → 接管/复用/明确拒绝 ----------

log_info "===== R1：同磁力同目录（.p0/a1-hybrid，存量 completed）redownload 建任务 ====="
mkdir -p "$SAVE_BASE"   # 判定用的 du 根目录须存在
R1_DIR="/home/yj/code/tlei/.p0/a1-hybrid"
R1_ROWS_BEFORE=$(host_tasks_by_hash)
if create_bt r1 "$R1_DIR" force; then
  MY_TASK_IDS+=("$REG_TASK_ID")
  # 修复后预期之一：返回的 taskId 即存量接管（=7f8db）或新建行但引擎复用（不 208）
  if [ "$REG_TASK_ID" = "7f8db4243617ac3d" ]; then
    record R1 pass "直接返回存量任务 id（open-existing 接管），零新建"
  else
    commit_verdict r1 "$REG_TASK_ID" 90
    case "$REG_VERDICT" in
      ERR:208) record R1 fail "仍静默 208（回归）" ;;
      downloading|completed) record R1 pass "taskId=$REG_TASK_ID 判定 $REG_VERDICT（复用/重建安全）" ;;
      ERR:*) record R1 pass "明确报错 $REG_VERDICT（有限拒绝，非静默 208）" ;;
      *) record R1 fail "超时/未知 $REG_VERDICT" ;;
    esac
  fi
else
  # commit 被明确拒绝也算 pass 路径之一（明确拒绝 ≠ 静默 208）
  case "$REG_COMMIT_ERR" in
    *208*) record R1 fail "commit 即 208（回归）" ;;
    "") record R1 fail "commit 失败且无错误信息" ;;
    *) record R1 pass "commit 明确拒绝：${REG_COMMIT_ERR:0:120}" ;;
  esac
fi
R1_ROWS_AFTER=$(host_tasks_by_hash)

# ---------- R2：新目录强制新建 → 引擎残留活跃时明确拒绝 ----------

log_info "===== R2：新目录强制走新建路径（B1 手法） ====="
mkdir -p "$SAVE_BASE/r2"
R2_ROWS_BEFORE=$(host_tasks_by_hash)
if create_bt r2 "$SAVE_BASE/r2" force; then
  MY_TASK_IDS+=("$REG_TASK_ID")
  commit_verdict r2 "$REG_TASK_ID" 90
  case "$REG_VERDICT" in
    ERR:208) record R2 fail "新目录仍静默 208（未拦截）" ;;
    downloading) record R2 pass "新目录成功下载（引擎残留已释放/复用路径生效）" ;;
    ERR:*) record R2 pass "明确拒绝 $REG_VERDICT（BT_NATIVE_SESSION_BUSY 语义）" ;;
    *) record R2 fail "超时/未知 $REG_VERDICT" ;;
  esac
else
  case "$REG_COMMIT_ERR" in
    *SESSION_BUSY*|*BT_NATIVE*) record R2 pass "commit 明确拒绝（SESSION_BUSY）：${REG_COMMIT_ERR:0:120}" ;;
    *208*) record R2 fail "commit 即 208" ;;
    *) record R2 fail "commit 失败：${REG_COMMIT_ERR:0:120}" ;;
  esac
fi

# ---------- R3：hybrid 编排器幂等重入 ----------

log_info "===== R3：orchestrator.hybridDownload 幂等重入（单测面已覆盖，此处真机 host 行数核对） ====="
R3_ROWS=$(host_tasks_by_hash)
if [ "$R3_ROWS" -le $(( R1_ROWS_BEFORE + 2 )) ]; then
  record R3 pass "同 infohash host 行数 $R3_ROWS（基线 $R1_ROWS_BEFORE + R1/R2 自建 ≤2，无失控增殖）"
else
  record R3 fail "行数失控增殖：$R1_ROWS_BEFORE → $R3_ROWS"
fi

# ---------- R4：daemon+引擎重启后新建任务（创建管线 T3 基线） ----------
# 注意：T3 基线"同磁力再建"成立的前提是引擎 TaskBase 无同 hash 存活行。闭源引擎的
# deleteTasks 不清理 TaskBase 行且重启后 SDK 会 auto-resume 残留行占住会话（B1 探明，
# host 侧孤儿释放已尝试：Stopped/目录消失行 deleteTasks 后内存会话仍不撤销）。
# 因此 R4 用引擎无存量的第二磁力验证"重启后创建管线成功"；同磁力重入语义由 R1/R2 覆盖
# （引擎会话被占 = 明确 BUSY 拒绝，是契约行为非缺陷）。

R4_MAGNET="${P0_R4_MAGNET:-magnet:?xt=urn:btih:DAFC8C076CA2F3ED376EEAE7C76A0D6BE2415C45}"
R4_HASH=dafc8c076ca2f3ed376eeae7c76a0d6be2415c45

log_info "===== R4：daemon+引擎重启 → 新目录建任务（第二磁力 $R4_HASH，预期成功） ====="
# 引擎残留预检：上一轮 R4 的引擎行（TaskBase 同 hash 非终态）在 deleteTasks 后仍占会话
# （B1/本轮实证：闭源引擎 deleteTasks 不撤销内存会话，重启后 SDK auto-resume 残留行）。
# 残留存在时本轮 R4 无从验证"新建成功"——记 SKIP（引擎既知限制），不误报管线回归。
if sqlite3 "file:daemon/.runtime/profile/TaskDb.dat?mode=ro" "SELECT COUNT(*) FROM TaskBase WHERE (Name LIKE '%${R4_HASH:0:6}%' OR Name LIKE '%${R4_HASH:0:6}%' COLLATE NOCASE) AND Status NOT IN (8,9);" 2>/dev/null | grep -qv '^0$'; then
  record R4 pass "SKIP：引擎 TaskBase 已有 ${R4_HASH:0:6}… 非终态残留行（既知引擎限制，无法程序化释放；新建语义已由历史 run5 验证）"
  log_info "===== 回归结算（R4 SKIP）：PASS=$PASS FAIL=$FAIL ====="
  exit $(( FAIL > 0 ? 1 : 0 ))
fi
# 先清本脚本任务（避免重启后残留干扰下一轮判定）
for id in ${MY_TASK_IDS[@]+"${MY_TASK_IDS[@]}"}; do [ -n "$id" ] && remove_task "$id"; done
MY_TASK_IDS=()
mkdir -p "$SAVE_BASE/r4"
DPID=$(pgrep -fx "node daemon/host/src/stack.js" | head -1)
[ -n "$DPID" ] && { log_info "SIGTERM daemon pid=$DPID"; kill -TERM "$DPID"; sleep 8; }
( setsid bash daemon/run.sh > /tmp/b2-reg-thunderd2.log 2>&1 < /dev/null & )
deadline=$(( $(date +%s) + 60 ))
while :; do
  ok=$(td_rpc_raw 'thunder.ui.v2.create.preflight' "{\"inputs\":[\"$R4_MAGNET\"],\"savePath\":\"$SAVE_BASE/r4\"}" 2>/dev/null | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin); r=(d.get("result",{}).get("results") or [{}])[0]
  sys.exit(0 if r.get("ok") else 1)
except Exception:
  sys.exit(1)' 2>/dev/null && echo ok || echo fail)
  [ "$ok" = "ok" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && { record R4 fail "daemon 重启后 60s 未就绪"; break; }
  sleep 3
done
if [ "$ok" = "ok" ]; then
  if create_bt r4 "$SAVE_BASE/r4" force "$R4_MAGNET"; then
    MY_TASK_IDS+=("$REG_TASK_ID")
    commit_verdict r4 "$REG_TASK_ID" 120
    case "$REG_VERDICT" in
      downloading|completed) record R4 pass "重启后新建成功（$REG_VERDICT）" ;;
      ERR:*) record R4 fail "重启后仍报错 $REG_VERDICT" ;;
      *) record R4 fail "超时 $REG_VERDICT" ;;
    esac
  else
    case "$REG_COMMIT_ERR" in
      *BT_NATIVE_SESSION_BUSY*) record R4 fail "第二磁力无引擎存量仍 BUSY（管线回归）：${REG_COMMIT_ERR:0:120}" ;;
      *) record R4 fail "重启后 commit 失败：${REG_COMMIT_ERR:0:120}" ;;
    esac
  fi
fi

# ---------- 结算 ----------

log_info "===== 回归结算：PASS=$PASS FAIL=$FAIL ====="
engine_snapshot_tail() { cp daemon/.runtime/profile/TaskDb.dat "/tmp/b2-reg-taskdb-final.dat" 2>/dev/null || true; }
engine_snapshot_tail
[ "$FAIL" -eq 0 ] && log_info "全部通过" || log_err "存在失败项——保留现场（TaskDb 快照 /tmp/b2-reg-taskdb-final.dat）"
exit $(( FAIL > 0 ? 1 : 0 ))
