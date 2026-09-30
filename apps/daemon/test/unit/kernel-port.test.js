'use strict';
// KernelPort 契约用例：assertKernel 分层校验（核心强校验 / 可选形态校验）
// + 真实 driver 双实现自证。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  KERNEL_METHODS, KERNEL_PROPERTIES, KERNEL_EVENTS, assertKernel,
  KERNEL_CORE_METHODS, KERNEL_OPTIONAL_METHODS, KERNEL_CORE_PROPERTIES, KERNEL_OPTIONAL_PROPERTIES,
} = require('../../host/src/domain/kernel-port');
const { WineNodeDriver, WindowsNodeDriver } = require('../../host/kernels/thunder/driver');

function makeKernel(overrides = {}) {
  const kernel = { on() {}, off() {} };
  for (const name of KERNEL_METHODS) kernel[name] = typeof overrides[name] === 'function' ? overrides[name] : () => {};
  for (const name of KERNEL_PROPERTIES) kernel[name] = overrides[name] !== undefined ? overrides[name] : 0;
  return kernel;
}

test('assertKernel 接受满足全部契约的内核', () => {
  const kernel = makeKernel();
  assert.equal(assertKernel(kernel), kernel);
});

test('assertKernel 拒绝缺核心方法并报缺失清单', () => {
  const kernel = makeKernel();
  delete kernel.startTasks;
  delete kernel.parseTaskInfo;
  assert.throws(() => assertKernel(kernel), /缺失方法: startTasks, parseTaskInfo/);
});

test('可选方法缺席放行、形态错误（非函数）拒绝', () => {
  const minimal = { on() {}, off() {} };
  for (const name of KERNEL_CORE_METHODS) minimal[name] = () => {};
  for (const name of KERNEL_CORE_PROPERTIES) minimal[name] = 0;
  for (const name of KERNEL_OPTIONAL_METHODS) delete minimal[name];
  for (const name of KERNEL_OPTIONAL_PROPERTIES) delete minimal[name];
  assert.equal(assertKernel(minimal), minimal, '可选成员全缺席的最小内核应通过');
  minimal.notifyAuth = 'not-a-function';
  assert.throws(() => assertKernel(minimal), /可选方法形态错误.*notifyAuth/);
});

test('assertKernel 拒绝缺核心属性与缺事件接口', () => {
  const kernel = makeKernel();
  delete kernel.sdkReady;
  assert.throws(() => assertKernel(kernel), /缺失属性: sdkReady/);
  const noEvents = makeKernel();
  delete noEvents.on;
  assert.throws(() => assertKernel(noEvents), /事件接口/);
});

test('契约清单冻结且分层汇总一致', () => {
  assert.equal(KERNEL_METHODS.length, 39);
  assert.equal(KERNEL_PROPERTIES.length, 7);
  assert.deepEqual(KERNEL_EVENTS, ['up', 'down', 'bootError']);
  // 分层：核心 32 方法 + 可选 7（2026-09-30 增详情面板三方法）；核心 6 属性 + 可选 1（taskDbPath）
  assert.equal(KERNEL_CORE_METHODS.length, 32);
  assert.deepEqual(KERNEL_OPTIONAL_METHODS, ['notifyAuth', 'notifyLogout', 'getBtFileRuntime', 'getSeedDescriptor',
    'getTaskDetailExtras', 'getTaskPeers', 'getSeedingStats']);
  assert.equal(KERNEL_CORE_PROPERTIES.length, 6);
  assert.deepEqual(KERNEL_OPTIONAL_PROPERTIES, ['taskDbPath']);
  // 汇总表 = 核心 + 可选（顺序拼接，无交叠）
  assert.deepEqual([...KERNEL_METHODS], [...KERNEL_CORE_METHODS, ...KERNEL_OPTIONAL_METHODS]);
  assert.deepEqual([...KERNEL_PROPERTIES], [...KERNEL_CORE_PROPERTIES, ...KERNEL_OPTIONAL_PROPERTIES]);
  assert.throws(() => { KERNEL_METHODS.push('nope'); }, TypeError);
  assert.throws(() => { KERNEL_CORE_METHODS.push('nope'); }, TypeError);
});

test('WineNodeDriver 与 WindowsNodeDriver 双实现满足契约（prototype 面自证）', () => {
  for (const Ctor of [WineNodeDriver, WindowsNodeDriver]) {
    // 核心方法强校验；可选方法允许缺席（thunder 不实现 getTaskPeers/getSeedingStats 即无入口语义），
    // 「若在则函数」形态由 assertKernel 校验覆盖。
    const missing = KERNEL_CORE_METHODS.filter((name) => typeof Ctor.prototype[name] !== 'function');
    assert.deepEqual(missing, [], `${Ctor.name} 缺失: ${missing.join(', ')}`);
    for (const name of KERNEL_OPTIONAL_METHODS) {
      if (Ctor.prototype[name] !== undefined) assert.equal(typeof Ctor.prototype[name], 'function', `${Ctor.name}.${name} 形态错误`);
    }
  }
});
