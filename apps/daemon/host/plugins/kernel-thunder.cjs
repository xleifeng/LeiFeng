'use strict';
// kernel-thunder：迅雷下载内核插件（P0 三合一：engine-driver + event-observation + auth-vip）。
// 对壳层 provide 'leifengKernel:thunder'：kernel（经 assertKernel 校验的 driver）、
// 域事件总线、诊断缓冲、进度轮询、账号/会员面。迅雷专属知识（Wine/native 探测、
// TaskDb 直读、OAuth device flow、VIP 加速）从此全部住进本插件内部。
const path = require('path');
const fs = require('fs');
const { WineNodeDriver, WindowsNodeDriver } = require('../kernels/thunder/driver');
const { readVipTasks, readNativeBtTasks, createNodeSqliteTaskDbReader } = require('../kernels/thunder/taskdb-reader');
const { CredentialWallet } = require('../kernels/thunder/auth-wallet');
const { AuthManager, clampKeepAliveSec } = require('../kernels/thunder/auth-manager');
const { CLIENT_ID, CLIENT_SECRET } = require('../kernels/thunder/xunlei-client-config');
const { readSdkPeerId } = require('../kernels/thunder/sdk-peer-id');
const { VipSpeedupClient } = require('../kernels/thunder/vip-speedup-client');
const { VipAccelerationManager } = require('../kernels/thunder/vip-manager');
const { ProgressPoller } = require('../src/poller');
const { DomainEventBus } = require('../src/services/domain-event-bus');
const { DiagnosticEventBuffer } = require('../src/domain/diagnostic-events');
const { assertKernel } = require('../src/domain/kernel-port');
const { createAccountMethods } = require('../src/rpc/account-methods');
const { createVipMethods } = require('../src/rpc/vip-methods');
const { AccountService } = require('../src/services/account-service');
const { plugin } = require('./shared.cjs');

const kernelThunder = plugin('leifeng-kernel-thunder', ['leifengConfig', 'leifengRepositories', 'leifengRpc', 'leifengKernelHub'], (ctx) => {
  const { appConfig, runtimeDir, repoRoot, env } = ctx.leifengConfig;
  const { taskRepository } = ctx.leifengRepositories;
  const crashInfoPath = env.THUNDERD_XLSDK_CRASHINFO || '';
  const winePrefix = appConfig.winePrefix;

  // ---- 引擎进程：Wine 或 Windows native（原 engine-driver 逻辑原样搬入）----
  function discoverNativeProgramDir() {
    if (appConfig.programDir) return appConfig.programDir;
    // leifeng-sdk 新名 + tlei-sdk 旧名双探测（改名前部署的机器不失效）
    const sdkRoots = env.LOCALAPPDATA ? ['leifeng-sdk', 'tlei-sdk'].map((name) => path.join(env.LOCALAPPDATA, name)) : [];
    for (const localAppData of sdkRoots) {
      try {
        const candidates = fs.readdirSync(localAppData)
          .filter((name) => /^Thunder-\d/i.test(name))
          .sort()
          .map((name) => path.join(localAppData, name, 'program'))
          .reverse();
        const hit = candidates.find((dir) => fs.existsSync(path.join(dir, 'thunder.exe')));
        if (hit) return hit;
      } catch { /* 目录不存在：继续探测下一个 */ }
    }
    return path.join(repoRoot, 'thunder_x', 'program');
  }
  let driver;
  let taskDbReaders;
  let peerIdCandidates;
  if (appConfig.engineMode === 'native') {
    const programDir = discoverNativeProgramDir();
    if (!fs.existsSync(path.join(programDir, 'thunder.exe'))) {
      throw new Error(`native engine program directory is missing: ${programDir}`);
    }
    peerIdCandidates = [env.LOCALAPPDATA, env.TEMP, env.SystemRoot && path.join(env.SystemRoot, 'Temp')]
      .filter(Boolean).map((dir) => path.join(dir, 'Thunder Network', 'XLSDK'));
    const sdkPeer = readSdkPeerId({ explicitPath: crashInfoPath || undefined, candidateDirs: peerIdCandidates });
    driver = new WindowsNodeDriver({
      repoRoot, programDir, profileDir: runtimeDir,
      sdkVersionName: appConfig.sdkVersionName, sdkVersionCode: appConfig.sdkVersionCode,
      sdkPlatform: appConfig.sdkPlatform,
      sdkGuid: env.THUNDERD_SDK_GUID || (sdkPeer.ok ? sdkPeer.peerId : ''),
    });
    taskDbReaders = createNodeSqliteTaskDbReader();
    if (!taskDbReaders.available) {
      console.error('[thunderd] WARN: node:sqlite unavailable; native TaskDb observation degrades');
    }
  } else {
    driver = new WineNodeDriver({ repoRoot, profileDir: runtimeDir, winePrefix });
    taskDbReaders = { readVipTasks, readNativeBtTasks };
    peerIdCandidates = [winePrefix];
  }
  const kernel = assertKernel(driver);

  // ---- 观察通道（原 event-observation）：迅雷特有 TaskDb 直读回退住内核内部 ----
  const eventBus = new DomainEventBus();
  const diagnosticEvents = new DiagnosticEventBuffer();
  const { hasSqlite, readTasks } = require('../kernels/thunder/taskdb-reader');
  const poller = new ProgressPoller(taskRepository, {
    dbPath: driver.taskDbPath,
    readTasksFn: (ids) => driver.getTaskSnapshots(ids).catch(() => (hasSqlite ? readTasks(driver.taskDbPath, ids) : [])),
    eventBus,
  });
  // 事件桥接：driver 进程词汇 → 域事件词汇（壳层订阅 kernel.*，不接触 driver 本体）
  const bridgeEvent = (name) => (payload) => eventBus.emit(name, payload);
  const onKernelUp = bridgeEvent('kernel.up');
  const onKernelDown = bridgeEvent('kernel.down');
  const onKernelBootError = bridgeEvent('kernel.bootError');
  driver.on('up', onKernelUp);
  driver.on('down', onKernelDown);
  driver.on('bootError', onKernelBootError);
  const unsubs = [
    eventBus.on('task.transition', (event) => diagnosticEvents.record('task.transition', event)),
    eventBus.on('engine.down', (event) => diagnosticEvents.record('engine.down', event, 'warn')),
  ];
  for (const type of ['engine.restart.requested', 'engine.restart.completed', 'task.deleted', 'policy.applied']) {
    unsubs.push(eventBus.on(type, (event) => diagnosticEvents.record(type, event, type.includes('failed') ? 'error' : 'info')));
  }

  // ---- 账号与会员（原 auth-vip）：迅雷 OAuth device flow + VIP 加速 ----
  const { registry } = ctx.leifengRepositories;
  const wallet = new CredentialWallet(path.join(runtimeDir, 'auth.json'));
  const xlconfigPath = appConfig.xlconfigPath;
  const auth = new AuthManager({
    wallet, driver, apiOrigin: env.THUNDERD_AUTH_API_ORIGIN || 'https://xluser-ssl.xunlei.com',
    xlconfigPath, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    keepAliveOverride: env.THUNDERD_AUTH_KEEPALIVE_SEC ? clampKeepAliveSec(Number(env.THUNDERD_AUTH_KEEPALIVE_SEC)) : 0,
  });
  const envBool = (value, fallback) => value === undefined ? fallback : value !== '0' && value !== 'false';
  const speedupClient = new VipSpeedupClient({ origin: env.THUNDERD_VIP_API_ORIGIN || undefined,
    log: (entry) => console.error('[vip-speedup]', JSON.stringify(entry)) });
  const vipManager = new VipAccelerationManager({
    registry, driver, auth, readVipTasks: taskDbReaders.readVipTasks,
    readBtFileRuntime: driver.engineMode === 'native' ? null : (engineId) => driver.getBtFileRuntime(engineId),
    taskDbPath: driver.taskDbPath,
    peerIdProvider: () => readSdkPeerId({ explicitPath: crashInfoPath || undefined, candidateDirs: peerIdCandidates }),
    speedupClient, enabled: envBool(env.THUNDERD_VIP_ENABLED, true),
    scanMs: Math.min(Math.max(Number(env.THUNDERD_VIP_SCAN_MS) || 2000, 500), 30000),
    maxBackoffMs: Math.min(Math.max((Number(env.THUNDERD_VIP_MAX_BACKOFF_SEC) || 300) * 1000, 30000), 1800000),
    log: (entry) => console.error('[vip]', JSON.stringify(entry)),
  });
  const onAuthKernelDown = () => vipManager.onEngineDown();
  driver.on('down', onAuthKernelDown);
  // 启动时序与原三插件严格一致：auth/vip 在装配期启动（先于引擎），poller/引擎
  // 由 task-shell activate 经 start() 拉起（rpc-host 装配完成后）
  auth.start();
  vipManager.start();

  // ---- 迅雷绑定域 RPC（rpc-plugin-registration）：account.* / vip.* 注册权随内核。
  // AccountService 的 shell 协作者（privateSpace/linkSync）由 product-services 晚
  // 绑定注入（attachShellCollaborators）——kernel 装配期二者尚未存在，注入前
  // logout 只做 auth 清理（与 qbit-only 缺席语义一致）。
  const accountService = new AccountService({ auth, vip: vipManager, eventBus });
  const withdrawAccountRpc = ctx.leifengRpc.registry.register('kernel-thunder',
    new Map([...createAccountMethods({ accountService }), ...createVipMethods({ vipService: vipManager, taskRepository })]));

  // health 引擎段：rpc-host 的 daemon.v1.health 聚合（状态贡献者）
  const withdrawHealth = ctx.leifengRpc.registry.provideHealthStatus('kernel-thunder', 'engine', () => ({
    transportReady: Boolean(driver.isHealthy?.()),
    sdkReady: driver?.sdkReady === true,
    generation: Number(driver?._generation) || 0,
  }));

  const thunderSlot = {
    kernelId: 'thunder',
    kernel,
    eventBus,
    diagnosticEvents,
    poller,
    account: { wallet, auth, vipManager, accountService },
    taskDbReaders,
    // P3（cordis-arch）：壳层 BT 查重入口——闭包 taskDbPath，壳层不再接触
    // 迅雷 TaskDb 路径与 reader 形状（qbit 等内核缺席此富件即走旧创建路径）。
    nativeBtLookup: (infoId) => taskDbReaders.readNativeBtTasks(driver.taskDbPath, infoId),
    crashInfoPath,
    peerIdCandidates,
    start: () => { poller.start(); driver.start(); },
  };
  // kernel-any-only：slot 注册进 hub（消费方经 hub.default() 取用），富槽
  // leifengKernel:thunder 保留供定向消费（诊断等），二者同一对象。
  const withdrawHub = ctx.leifengKernelHub.register(thunderSlot);
  ctx.provide('leifengKernel:thunder', thunderSlot);
  return async () => {
    withdrawHub();
    withdrawAccountRpc();
    withdrawHealth();
    driver.off('down', onAuthKernelDown);
    driver.off('up', onKernelUp); driver.off('down', onKernelDown); driver.off('bootError', onKernelBootError);
    poller.stop();
    for (const unsubscribe of unsubs) unsubscribe?.();
    await vipManager.stop({ disable: true });
    auth.stop();
    eventBus.close();
    await driver.shutdown();
  };
});

module.exports = { kernelThunder };
