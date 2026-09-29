'use strict';
// NullKernel 单测：契约合规（assertKernel 过）、能力面诚实（零协议/不健康）、
// 下载类操作 NOT_SUPPORTED、生命周期 noop；kernel-hub 零注册降级返回 null slot。
const test = require('node:test');
const assert = require('node:assert/strict');
const { NullKernel, createNullKernelSlot } = require('../../host/src/domain/null-kernel');
const { assertKernel } = require('../../host/src/domain/kernel-port');
const { kernelHub } = require('../../host/plugins/kernel-hub.cjs');
const { createUiCapabilityRegistry } = require('../../host/src/domain/ui-capabilities');

test('NullKernel 过 KernelPort 核心契约校验', () => {
  assert.doesNotThrow(() => assertKernel(new NullKernel()));
});

test('能力面诚实：零协议、不健康、sdkReady=false、快照空', async () => {
  const k = new NullKernel();
  assert.equal(k.isHealthy(), false);
  assert.equal(k.sdkReady, false);
  assert.equal(k.enginePid(), null);
  assert.deepEqual(await k.getSupportedProtocols(), []);
  assert.deepEqual(await k.getQueueCount(), 0);
  assert.ok(await k.getTaskSnapshots() instanceof Map);
  assert.deepEqual(k.getNativeCapabilities(), {});
});

test('下载类操作显式 NOT_SUPPORTED（带 kernelId=null）', async () => {
  const k = new NullKernel();
  for (const method of ['createTask', 'startTasks', 'parseTaskInfo', 'setProxy', 'restart']) {
    await assert.rejects(() => k[method](), (error) => error.code === 'NOT_SUPPORTED' && error.kernelId === 'null');
  }
});

test('生命周期 noop：start/shutdown 可静默完成', async () => {
  const k = new NullKernel();
  await k.start();
  await k.shutdown();
  assert.equal(k._generation, 0);
});

test('null slot 形状对齐（eventBus 真总线、account 缺席、start noop）', async () => {
  const slot = createNullKernelSlot();
  assert.equal(slot.kernelId, 'null');
  assert.doesNotThrow(() => assertKernel(slot.kernel));
  assert.equal(typeof slot.eventBus.on, 'function');
  assert.equal(slot.account, null);
  assert.equal(slot.nativeBtLookup, null);
  await slot.start();
});

test('kernel-hub 零注册：default() 返回 null slot（daemon 无内核也成在）', () => {
  const provided = {};
  const ctx = { provide: (name, value) => { provided[name] = value; }, leifengConfig: {} };
  const teardown = kernelHub.apply(ctx, {});
  try {
    const hub = provided.leifengKernelHub;
    const slot = hub.default();
    assert.equal(slot.kernelId, 'null');
    assert.equal(hub.list().length, 0, 'null slot 不进 list（真实内核清单不含占位）');
    // 注册真内核后 default 切换为真内核
    const withdraw = hub.register({ kernelId: 'thunder', kernel: new NullKernel() });
    assert.equal(hub.default().kernelId, 'thunder');
    withdraw();
    // 撤销后回落 null slot
    assert.equal(hub.default().kernelId, 'null');
  } finally { teardown(); }
});
