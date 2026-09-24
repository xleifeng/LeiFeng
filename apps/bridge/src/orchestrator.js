// orchestrator.js — P2 混合加速编排器。
// 形态：磁力 → [tlei 下载（P2SP，sequential）] + [qbit 下载（swarm）+ 桥 web seed（增量供种）]
//      → 两路数据在 qbit 侧拼装成完整文件 → qbit 做种回哺。
// 混合逻辑：qbit 自带 swarm 源；桥把 tlei 已验证增量喂给 qbit；互补兜底（swarm 封迅雷 /
//      P2SP 无缓存均不影响另一路）。加速无效检测：tlei 长期停滞 → 停 tlei 任务止损。

'use strict';

const fs = require('fs');
const path = require('path');
const { Verifier, resolveOnDisk } = require('./verifier');
const { detectDataRoot, buildSessionFiles } = require('./data-root');
const { createDaemonClient } = require('./daemon-client');
const { assertRecipient } = require('./recipient');
const { createInjector } = require('./torrent-injector');

const log = (tag, msg) => process.stderr.write(`[${new Date().toISOString()}] [${tag}] ${msg}\n`);

function createOrchestrator({
  daemonPort = 16800,
  bridgeHost = '127.0.0.1',
  bridgePort = 7127,
  savePath,                       // tlei 保存目录（--data）
  stalledTimeoutMs = 10 * 60 * 1000, // tlei 停滞判定窗口（BT 乱序落盘下 5 分钟粒度太激进，真机误触过）
  stalledRateBps = 10 * 1024,     // 低于此速率视为停滞
  recoveryIntervalMs = 20000,
  daemonClient = null,
  recipient = null,
  qbitClient = null, // compatibility for existing injected test doubles
  sessionStore = null,
} = {}) {
  const daemon = daemonClient || createDaemonClient({ port: daemonPort, timeoutMs: 120000 });
  const getRecipient = () => assertRecipient(recipient || (qbitClient && {
    addTorrent: qbitClient.addTorrent || (() => { throw new Error('addTorrent unavailable'); }),
    addMagnet: qbitClient.addMagnet || (() => { throw new Error('addMagnet unavailable'); }),
    getTorrent: qbitClient.getTorrent || (async () => null),
    webseeds: qbitClient.webseeds || (async () => []),
  }));
  const sessions = sessionStore || new Map(); // infohash -> session
  let injectorPromise = null;
  const getInjector = () => (injectorPromise ||= createInjector());

  async function matchingTasks(infohash) {
    const { default: parseTorrent } = await import('parse-torrent');
    const matches = [];
    // 游标绑定快照 revision，列表并发变更会 CURSOR_EXPIRED —— 从首页重开（限 3 次）。
    for (let restarts = 0; restarts < 3; restarts++) {
      try {
        let cursor;
        do {
          const page = await daemon.rpc('thunder.ui.v2.tasks.query', [{ limit: 200, ...(cursor ? { cursor } : {}) }]);
          for (const item of page.items || []) {
            if (!['bt', 'magnet'].includes(item.kind)) continue;
            // 列表 DTO 先粗筛（sourceFingerprint 直接可判），减少 tasks.get N+1 往返
            const quick = /^(?:bt|magnet):(?:info|hash):([a-f0-9]{40})$/i.exec(item.sourceFingerprint || '')?.[1];
            if (quick && quick.toLowerCase() !== infohash) continue;
            const task = await daemon.rpc('thunder.ui.v2.tasks.get', [{ taskId: item.taskId, includeFiles: false }]);
            let hash = quick || /^(?:bt|magnet):(?:info|hash):([a-f0-9]{40})$/i.exec(task.sourceFingerprint || '')?.[1];
            if (!hash && /^magnet:\?/i.test(task.source || '')) {
              try { hash = (await parseTorrent(task.source)).infoHash; } catch {}
            }
            if (hash && hash.toLowerCase() === infohash) matches.push(task);
          }
          cursor = page.nextCursor;
        } while (cursor);
        return matches;
      } catch (error) {
        if (error.code !== 'CURSOR_EXPIRED' || restarts === 2) throw error;
        matches.length = 0;
      }
    }
    return matches;
  }

  async function removeFailedTask(taskId) {
    for (const command of ['recycle', 'delete-permanently']) {
      const result = await daemon.rpc('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command, options: { deleteLocalFiles: false } }]);
      const item = result.results?.[0];
      if (!item?.ok) throw new Error(`${command} 失败: ${item?.error?.message || '未知错误'}`);
    }
  }

  // ---- 单种子会话 ----
  async function adoptTorrent(rawTorrentBuffer, dataPath = savePath) {
    const injector = await getInjector();
    const parsed = await injector.parse(rawTorrentBuffer);
    const infohash = parsed.infoHash;

    if (sessions.has(infohash)) return sessions.get(infohash);

    // 数据根探测（形态/变体/mojibake 见 data-root.js；单文件元数据文件错配已修）
    const detected = detectDataRoot(parsed, dataPath);
    let rootDir; let strip; let fileMap; let mapped;
    if (detected) {
      ({ rootDir, strip } = detected);
    } else {
      rootDir = path.join(dataPath, `${infohash}.torrent`); strip = true;
      log('orch', `⚠ 未确认数据根，默认 ${rootDir}（数据落盘后自动按请求路径重解析）`);
    }
    ({ mapped, fileMap } = buildSessionFiles(parsed, rootDir, strip));
    const verifier = new Verifier({ parsed: mapped, rootDir: rootDir });

    const session = {
      infohash, parsed, verifier, fileMap, rootDir, strip,
      lastVerified: 0,
      lastProgressAt: Date.now(),
      dataBytesAt: dataBytesOnDisk(session0(rootDir)),
    };
    sessions.set(infohash, session);
    log('orch', `会话建立 ${infohash} root=${rootDir} strip=${strip}`);
    return session;
  }

  function session0(rootDir) { return { rootDir }; } // dataBytesOnDisk 只需 rootDir
  function dataBytesOnDisk({ rootDir }) {
    // 粗粒度目录字节量（du 语义，Sync 慢但停滞检查 5 分钟一次可接受；root 不存在=0）
    try {
      let total = 0;
      const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.isFile()) { try { total += fs.statSync(p).size; } catch {} }
        }
      };
      walk(rootDir);
      return total;
    } catch { return 0; }
  }

  // ---- 验证模型（2026-09-23 产品化重设计）----
  // 废除 15s 周期全量快扫：实测 87min 读 1020GiB（199MiB/s 常驻）、60-70% CPU、
  // 同步 IO 冻结事件循环。改为按需验证——HTTP 请求路径上对覆盖 piece 就地验证
  // （verifier.verifyRange），结果缓存进 verified 位图。低频巡检（stalled 检查共用）
  // 只做“进度观测”（verifiedCount / 磁盘字节），不再主动读 piece 数据。

  async function createBtTask(magnet, dataPath = savePath) {
    const pre = await daemon.rpc('thunder.ui.v2.create.preflight', [{ inputs: [magnet], savePath: dataPath }]);
    const draft = pre.results?.[0];
    if (!draft?.ok) throw new Error(`preflight 失败: ${draft?.error?.message || '未知错误'}`);
    let d = draft.draft;
    for (let i = 0; i < 60 && d.state !== 'ready'; i++) {
      await sleep(2000);
      d = await daemon.rpc('thunder.ui.v2.create.getDraft', [{ draftId: d.draftId }]);
    }
    if (d.state !== 'ready') throw new Error('元数据等待超时');
    const patch = d.duplicate ? { duplicateResolution: 'redownload' }
      : d.options?.collision?.collision ? { duplicateResolution: 'overwrite-never' } : {};
    if (Object.keys(patch).length) {
      d = await daemon.rpc('thunder.ui.v2.create.updateDraft', [{ draftId: d.draftId, ...patch }]);
    }
    const commit = await daemon.rpc('thunder.ui.v2.create.commit', [{ draftIds: [d.draftId] }]);
    const first = commit.results?.[0];
    const taskId = first?.taskIds?.[0];
    if (!taskId) {
      const failure = new Error(first?.error?.message || 'commit 未返回 taskId');
      failure.code = first?.error?.code || 'COMMIT_FAILED';
      throw failure;
    }
    return taskId;
  }

  // 引擎重启类失败（START_FAILED/ENGINE_RESTARTED/ENGINE_UNAVAILABLE 等 retryable 引擎错）：
  // 引擎崩溃 respawn 后 host 行被标 failed，但 engineId 与磁盘数据完好，`start` 命令即可救回
  // （B3 长跑第 31 分钟真机实证：START_FAILED → start → downloading，数据 8.6G 保留）。
  const ENGINE_FAILURE_CODES = new Set(['START_FAILED', 'ENGINE_RESTARTED', 'ENGINE_UNAVAILABLE', 'BT_RECREATE_FAILED']);
  const engineRestartBackoffMs = [5000, 15000, 30000, 60000]; // 略宽于 driver respawn 退避首段
  const engineBackoffScale = engineRestartBackoffMs[0] / 5000; // 测试可整体缩短：按首值比例缩放

  function scheduleRecovery(session, magnet) {
    const check = async () => {
      if (!session.taskId || !sessions.has(session.infohash)) return;
      try {
        const task = await daemon.rpc('thunder.ui.v2.tasks.get', [{ taskId: session.taskId, includeFiles: false }]);
        if (task.lifecycle === 'failed') {
          if (Number(task.error?.nativeCode) === 208) {
            session.recoveryAttempts = (session.recoveryAttempts || 0) + 1;
            if (session.recoveryAttempts > 2) {
              log('orch', '208 恢复达到次数上限；保留 qbit 下载');
              return;
            }
            const oldId = session.taskId;
            await removeFailedTask(oldId);
            session.taskId = null;
            try {
              session.taskId = await createBtTask(magnet);
              log('orch', `208 恢复任务 ${oldId} → ${session.taskId}`);
              await daemon.rpc('thunder.ui.v2.tasks.command', [{ taskIds: [session.taskId], command: 'set-bt-scheduler', options: { btScheduler: 'sequential' } }]);
              if (sessions.has(session.infohash)) scheduleRecovery(session, magnet);
            } catch (error) {
              log('orch', `208 后无法安全重建 (${error.code || 'unknown'})；保留 qbit 下载`);
            }
            return;
          }
          // 引擎类失败：任务行没坏，start 重试即可救回（B3 真机实证）。单定时器链：
          // 退避 → 发 start → 下轮 check 复核；失败重读不多发。
          if (ENGINE_FAILURE_CODES.has(task.error?.code) && task.error?.retryable) {
            session.engineStartAttempts = (session.engineStartAttempts || 0) + 1;
            if (session.engineStartAttempts > 6) {
              log('orch', `引擎失败重试 ${task.error.code} 达到次数上限；保留 qbit 下载`);
              return;
            }
            const baseWait = engineRestartBackoffMs[Math.min(session.engineStartAttempts - 1, engineRestartBackoffMs.length - 1)];
            const wait = Math.max(50, Math.round(baseWait * (recoveryIntervalMs / 20000))); // 测试快钟按 recoveryIntervalMs 比例缩短
            log('orch', `任务失败(${task.error.code})，引擎自愈重试 ${session.engineStartAttempts}/6（退避 ${wait >= 1000 ? `${wait / 1000}s` : `${wait}ms`} 后 start）`);
            session.recoveryTimer = setTimeout(async () => {
              try {
                await daemon.rpc('thunder.ui.v2.tasks.command', [{ taskIds: [session.taskId], command: 'start' }]);
                log('orch', `已对 ${session.taskId} 发出 start（引擎失败自愈）`);
              } catch (error) { log('orch', `start 重试失败: ${error.message}`); }
              if (sessions.has(session.infohash) && session.taskId) {
                session.recoveryTimer = setTimeout(check, recoveryIntervalMs);
              }
            }, wait);
            return;
          }
          log('orch', `任务失败(${task.error?.code || 'unknown'})；保留 qbit 下载`);
          return;
        }
        // 自愈成功或仍健康：清计数，继续监控直至终态。
        session.engineStartAttempts = 0;
        // paused = 用户或止损暂停：不自动重启，降到低频看终态即可。
        if (task.lifecycle === 'paused') {
          session.recoveryTimer = setTimeout(check, 5 * 60 * 1000);
          return;
        }
        if (session.taskId && !['completed', 'recycled'].includes(task.lifecycle)) {
          session.recoveryTimer = setTimeout(check, recoveryIntervalMs);
        }
      } catch (error) {
        log('orch', `恢复检查失败: ${error.message}`);
        // RPC 瞬断（daemon 重启等）不终止监控：低频续命
        if (session.taskId && sessions.has(session.infohash)) {
          session.recoveryTimer = setTimeout(check, 30 * 1000);
        }
      }
    };
    session.recoveryTimer = setTimeout(check, recoveryIntervalMs);
  }

  // ---- 混合加速：磁力 → tlei 任务 + qbit 种子（带 web seed URL）----
  async function hybridDownload(magnet, { dataPath = savePath } = {}) {
    const { default: parseTorrent } = await import('parse-torrent');
    const infohash = (await parseTorrent(magnet)).infoHash?.toLowerCase();
    if (!infohash) throw new Error('磁力缺少有效 BT infohash');
    const existing = await matchingTasks(infohash);
    const healthy = existing.filter((t) => !['failed', 'missing', 'recycled'].includes(t.lifecycle));
    if (healthy.length > 1) throw new Error('同 hash 存在多个健康任务，无法安全选择接管对象');
    let adoptTarget = healthy[0] || null;
    // 引擎类 failed（START_FAILED 等，engineId+数据完好，start 可救回——B3 实证）也作为
    // 接管对象：真机曾出现桥无视 START_FAILED 直接重建第二条任务的双行残留（2026-09-23）。
    if (!adoptTarget) {
      const engineFailed = existing.filter((t) => t.lifecycle === 'failed' && Number(t.error?.nativeCode) !== 208 &&
        ENGINE_FAILURE_CODES.has(t.error?.code) && t.error?.retryable);
      if (engineFailed.length > 1) throw new Error('同 hash 存在多个引擎失败任务，无法安全选择接管对象');
      if (engineFailed.length === 1) {
        adoptTarget = engineFailed[0];
        log('orch', `接管引擎失败任务 ${adoptTarget.taskId}（${adoptTarget.error?.code}），先 start 救活`);
        try {
          await daemon.rpc('thunder.ui.v2.tasks.command', [{ taskIds: [adoptTarget.taskId], command: 'start' }]);
        } catch (e) { log('orch', `start 救活失败（转重建评估）: ${e.message}`); adoptTarget = null; }
      }
    }
    let taskId = adoptTarget?.taskId || null;
    let torrentBuf = null;
    if (taskId) {
      log('orch', `接管已有 tlei 任务 ${taskId}`);
      // 接管含桥自身止损暂停过的任务：新桥进场 = 继续混合加速，显式恢复。
      // （用户在 webui 手动暂停的任务同理——hybrid 命令本身就是"要下载"的表达。）
      try {
        const t = await daemon.rpc('thunder.ui.v2.tasks.get', [{ taskId, includeFiles: false }]);
        if (t.lifecycle === 'paused') {
          await daemon.rpc('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'start' }]);
          log('orch', '接管的任务处于暂停态，已 start 恢复');
        }
      } catch (e) { log('orch', `接管恢复检查失败（继续）: ${e.message}`); }
    }
    if (!taskId) {
      const failed = existing.filter((t) => t.lifecycle === 'failed' && Number(t.error?.nativeCode) === 208 &&
        path.resolve(t.savePath || '') === path.resolve(dataPath));
      if (failed.length) {
        // 先保存种子，再移除确认为 208 的 host 任务；本地数据不删。
        try { torrentBuf = await daemon.exportTorrent(failed[0].taskId); } catch {}
        for (const task of failed) await removeFailedTask(task.taskId);
      }
    }
    if (!taskId) {
      try { taskId = await createBtTask(magnet, dataPath); }
      catch (error) {
        if (error.code !== 'BT_NATIVE_SESSION_BUSY') throw error;
        log('orch', '同 hash 原生会话未释放；跳过 tlei 重建，qbit 独立继续');
      }
    }
    log('orch', `tlei 任务 ${taskId}`);

    // 顺序调度（游标校验最优）
    if (taskId) try {
      await daemon.rpc('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'set-bt-scheduler', options: { btScheduler: 'sequential' } }]);
      log('orch', '顺序调度已设置');
    } catch (e) { log('orch', `⚠ 顺序调度失败（继续，非致命）: ${e.message}`); }

    // 2) 拿种子（导出）
    for (let i = 0; taskId && !torrentBuf && i < 10; i++) {
      try { torrentBuf = await daemon.exportTorrent(taskId); if (torrentBuf && torrentBuf.length > 0) break; } catch {}
      await sleep(2000);
    }
    if (!torrentBuf && !taskId) {
      await getRecipient().addMagnet(magnet);
      log('orch', '原生会话占用且暂无种子元数据；qbit 已按磁力独立下载');
      return { taskId: null, infohash, session: null };
    }
    if (!torrentBuf) throw new Error('种子导出失败');
    log('orch', `种子已导出 (${torrentBuf.length} B)`);

    // 3) 桥会话（先建立，数据落地即供种）
    const session = await adoptTorrent(torrentBuf, adoptTarget?.savePath || dataPath);

    // 4) 注入 url-list → qbit 加种（leech 模式，两路并行）
    const injector = await getInjector();
    const baseUrl = `http://${bridgeHost}:${bridgePort}/seeds/${session.infohash}/`;
    const { injected } = await injector.injectAndVerify(torrentBuf, baseUrl);
    await ensureRecipientTorrent(session.infohash, injected, baseUrl);
    session.injectedToQbit = true;
    log('orch', `qbit 已加种（web seed = 桥），hash=${session.infohash}`);

    session.taskId = taskId;
    session.lastVerified = session.verifier.verifiedCount;
    if (taskId) scheduleRecovery(session, magnet);
    return { taskId, infohash: session.infohash, session };
  }

  async function hybridTorrent(rawTorrentBuffer, { dataPath = savePath, filename = 'upload.torrent' } = {}) {
    if (!Buffer.isBuffer(rawTorrentBuffer)) throw new TypeError('torrent input must be a Buffer');
    const injector = await getInjector();
    const parsed = await injector.parse(rawTorrentBuffer);
    if (!parsed.infoHash || !parsed.pieces?.length || parsed.metaVersion === 2) {
      const error = new Error('只支持 BT v1 torrent'); error.code = 'UNSUPPORTED_TORRENT'; throw error;
    }
    const infohash = parsed.infoHash.toLowerCase();
    const existing = await matchingTasks(infohash);
    const healthy = existing.filter((task) => !['failed', 'missing', 'recycled'].includes(task.lifecycle));
    if (healthy.length > 1) throw new Error('同 hash 存在多个健康任务，无法安全选择接管对象');
    let taskId = healthy[0]?.taskId || null;
    if (!taskId) {
      if (typeof daemon.uploadTorrent !== 'function') {
        const error = new Error('daemon client 缺少已鉴权 torrent 上传能力'); error.code = 'TORRENT_UPLOAD_UNAVAILABLE'; throw error;
      }
      let draft = await daemon.uploadTorrent(rawTorrentBuffer, { filename });
      const patch = { draftId: draft.draftId, savePath: dataPath };
      if (draft.duplicate) patch.duplicateResolution = 'redownload';
      else if (draft.options?.collision?.collision) patch.duplicateResolution = 'overwrite-never';
      draft = await daemon.rpc('thunder.ui.v2.create.updateDraft', [patch]);
      const committed = await daemon.rpc('thunder.ui.v2.create.commit', [{ draftIds: [draft.draftId] }]);
      const first = committed.results?.[0];
      taskId = first?.taskIds?.[0];
      if (!taskId) { const error = new Error(first?.error?.message || 'torrent commit 未返回 taskId'); error.code = first?.error?.code || 'COMMIT_FAILED'; throw error; }
    }
    const session = await adoptTorrent(rawTorrentBuffer, healthy[0]?.savePath || dataPath);
    try {
      await daemon.rpc('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'set-bt-scheduler', options: { btScheduler: 'sequential' } }]);
    } catch (error) { log('orch', `顺序调度失败（继续）: ${error.code || 'unknown'}`); }
    const baseUrl = `http://${bridgeHost}:${bridgePort}/seeds/${infohash}/`;
    const { injected } = await injector.injectAndVerify(rawTorrentBuffer, baseUrl);
    await ensureRecipientTorrent(infohash, injected, baseUrl);
    session.injectedToRecipient = true;
    session.taskId = taskId;
    session.lastVerified = session.verifier.verifiedCount;
    scheduleRecovery(session, `magnet:?xt=urn:btih:${infohash}`);
    return { taskId, infohash, session };
  }

  async function ensureRecipientTorrent(infohash, injected, baseUrl) {
    const provider = getRecipient();
    const existing = await provider.getTorrent(infohash);
    if (existing) {
      const urls = await provider.webseeds(infohash);
      if (urls.some((entry) => (typeof entry === 'string' ? entry : entry?.url) === baseUrl)) return;
      const error = new Error('Recipient 已有同 hash 种子但缺少桥 webseed，无法安全重复注入');
      error.code = 'RECIPIENT_WEBSEED_MISSING';
      error.retryable = false;
      throw error;
    }
    await provider.addTorrent(injected, { name: `${infohash}.torrent`, infohash, webseedUrl: baseUrl });
    const added = await provider.getTorrent(infohash);
    if (added) {
      const urls = await provider.webseeds(infohash);
      if (!urls.some((entry) => (typeof entry === 'string' ? entry : entry?.url) === baseUrl)) {
        const error = new Error('Recipient 未接收桥 webseed'); error.code = 'RECIPIENT_WEBSEED_MISSING'; error.retryable = true; throw error;
      }
    }
  }

  // ---- 停滞止损：tlei 无进展则停其任务（D10）----
  // 进度三信号任一成立即不算停滞（host 观测面冻结已实证，HANDOVER §2.5-④）：
  //   1. 验证推进（verifiedCount 增长——HTTP 按需验证驱动）
  //   2. 磁盘字节增长（唯一可信的数据面信号）
  //   3. host 速度 > 阈值（冻结时可漏报但不会误报——有速度必在收）
  async function checkStalled(session, taskId) {
    taskId = session.taskId || taskId;
    if (!taskId) return false;
    const idleMs = Date.now() - session.lastProgressAt;
    if (idleMs < stalledTimeoutMs) return false;
    try {
      const q = await daemon.rpc('thunder.ui.v2.tasks.query', [{ limit: 50 }]);
      const t = (q.items || []).find((x) => x.taskId === taskId);
      if (!t) { log('orch', `tlei 任务 ${taskId} 已不在任务列表（外部删除）；停监控`); return true; }
      if (t.lifecycle === 'failed') { log('orch', `tlei 任务失败(${t.error?.nativeCode || t.error?.code || 'unknown'})，保留 qbit 独立下载`); return true; }
      if (t.lifecycle === 'completed' || t.lifecycle === 'recycled') return false;
      // 信号 1：验证推进
      if (session.verifier.verifiedCount > session.lastVerified) {
        session.lastVerified = session.verifier.verifiedCount;
        session.lastProgressAt = Date.now();
        return false;
      }
      // 信号 3：host 速度
      if ((t.downloadBytesPerSecond || 0) > stalledRateBps) { session.lastProgressAt = Date.now(); return false; }
      // 信号 2：磁盘字节增长。dataBytesAt 取 max 不回缩（xltd 改名正主/清理边车时
      // 字节会瞬时回缩，回缩更新会把增长基线磨低造成假停滞）。真机 2026-09-23：
      // completedBytes 涨 350MB 但 5 分钟窗口跨边界 + 基线回缩误触止损。
      const bytes = dataBytesOnDisk(session);
      if (bytes > (session.dataBytesAt || 0)) {
        session.dataBytesAt = bytes;
        session.lastProgressAt = Date.now();
        return false;
      }
      // 三信号全灭且任务处于可暂停态 → 止损
      if (!['queued', 'downloading'].includes(t.lifecycle)) return false; // paused 等不重复 pause
      await daemon.rpc('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'pause' }]);
      log('orch', `tlei 任务停滞 ${Math.round(idleMs / 1000)}s（验证/磁盘/host 速度均无进展），已暂停止损（qbit 独立继续）`);
      return true;
    } catch (e) { log('orch', `止损检查失败: ${e.message}`); return false; }
  }

  function close() {
    for (const s of sessions.values()) {
      if (s.recoveryTimer) clearTimeout(s.recoveryTimer);
      s.verifier.close();
    }
    sessions.clear();
  }

  return { sessions, adoptTorrent, hybridDownload, hybridTorrent, checkStalled, close };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { createOrchestrator };
