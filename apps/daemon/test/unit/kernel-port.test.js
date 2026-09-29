'use strict';
// KernelPort 契约用例：assertKernel 全量校验 + 真实 driver 双实现自证。
const test = require('node:test');
const assert = require('node:assert/strict');
const { KERNEL_METHODS, KERNEL_PROPERTIES, KERNEL_EVENTS, assertKernel } = require('../../host/src/domain/kernel-port');
const { WineNodeDriver, WindowsNodeDriver } = require('../../host/src/driver');

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

test('assertKernel 拒绝缺方法并报缺失清单', () => {
  const kernel = makeKernel();
  delete kernel.startTasks;
  delete kernel.parseTaskInfo;
  assert.throws(() => assertKernel(kernel), /缺失方法: startTasks, parseTaskInfo/);
});

test('assertKernel 拒绝缺属性与缺事件接口', () => {
  const kernel = makeKernel();
  delete kernel.taskDbPath;
  assert.throws(() => assertKernel(kernel), /缺失属性: taskDbPath/);
  const noEvents = makeKernel();
  delete noEvents.on;
  assert.throws(() => assertKernel(noEvents), /事件接口/);
});

test('契约清单冻结且与词汇文档一致', () => {
  assert.equal(KERNEL_METHODS.length, 36);
  assert.equal(KERNEL_PROPERTIES.length, 7);
  assert.deepEqual(KERNEL_EVENTS, ['up', 'down', 'bootError']);
  assert.throws(() => { KERNEL_METHODS.push('nope'); }, TypeError);
});

test('WineNodeDriver 与 WindowsNodeDriver 双实现满足契约（prototype 面自证）', () => {
  for (const Ctor of [WineNodeDriver, WindowsNodeDriver]) {
    const missing = KERNEL_METHODS.filter((name) => typeof Ctor.prototype[name] !== 'function');
    assert.deepEqual(missing, [], `${Ctor.name} 缺失: ${missing.join(', ')}`);
  }
});
