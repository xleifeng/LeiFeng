'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { KERNEL_PROTOCOL_ROUTES, supportedProtocols, resolveCreateKernel } = require('../../host/src/domain/create-router');
const { WineNodeDriver, WindowsNodeDriver } = require('../../host/kernels/thunder/driver');

test('路由表：单一内核时代每个受支持 kind 都路由到 thunder', () => {
  for (const kind of ['http', 'https', 'ftp', 'magnet', 'bt', 'ed2k', 'thunder']) {
    assert.equal(resolveCreateKernel(kind), 'thunder', kind);
  }
});

test('qbit 条目就位但 bt/magnet 默认仍路由 thunder（首命中不漂移）', () => {
  assert.deepEqual(KERNEL_PROTOCOL_ROUTES.qbit, ['bt', 'magnet']);
  // Object.entries 顺序 thunder 在前——显式钉死默认路由，P4 引入偏好配置才可变
  assert.equal(resolveCreateKernel('bt'), 'thunder');
  assert.equal(resolveCreateKernel('magnet'), 'thunder');
});

test('未知 kind 与非法输入返回 null（不抛错）；无参调用兜底表序首内核', () => {
  assert.equal(resolveCreateKernel('unknown'), null);
  assert.equal(resolveCreateKernel(''), null);
  assert.equal(resolveCreateKernel(null), null);
  assert.equal(resolveCreateKernel(123), null);
  // P3：无参调用（undefined）= CreateTaskService defaultKernelId 兜底语义
  assert.equal(resolveCreateKernel(), 'thunder');
});

test('supportedProtocols 多内核汇总去重（qbit 子集并入不重复）', () => {
  const all = [...new Set(supportedProtocols())].sort();
  assert.deepEqual(all, ['bt', 'ed2k', 'ftp', 'http', 'magnet', 'thunder', 'https'].sort());
});

test('路由表与 driver.getSupportedProtocols 一致（两视图不漂移）', async () => {
  for (const DriverImpl of [WineNodeDriver, WindowsNodeDriver]) {
    const protocols = await DriverImpl.prototype.getSupportedProtocols();
    // 迅雷双实现的每个协议都必须在路由表 thunder 条目内（驱动声明 ⊆ 表）
    for (const kind of protocols) {
      assert.ok(KERNEL_PROTOCOL_ROUTES.thunder.includes(kind), `${DriverImpl.name} 声明 ${kind} 不在 thunder 表`);
      const kernelId = resolveCreateKernel(kind);
      assert.ok(kernelId && KERNEL_PROTOCOL_ROUTES[kernelId].includes(kind), `${DriverImpl.name} ${kind}`);
    }
  }
  // 表的 thunder 条目不超出驱动声明（表 ⊆ 驱动声明）
  const declared = new Set(await WineNodeDriver.prototype.getSupportedProtocols());
  for (const kind of KERNEL_PROTOCOL_ROUTES.thunder) assert.ok(declared.has(kind), `thunder 表的 ${kind} 驱动未声明`);
});
