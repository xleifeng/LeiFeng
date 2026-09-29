'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiCapabilityRegistry, ALWAYS, KNOWN } = require('../../host/src/domain/ui-capabilities');
const { BootstrapService } = require('../../host/src/services/bootstrap-service');

test('ui capability registry: 空 snapshot 只有 ALWAYS', () => {
  const registry = createUiCapabilityRegistry();
  assert.deepEqual([...registry.snapshot()].sort(), [...ALWAYS].sort());
});

test('ui capability registry: contribute 合并进 snapshot，withdraw 后消失', () => {
  const registry = createUiCapabilityRegistry();
  const withdraw = registry.contribute('product-services', ['history', 'media']);
  const snapshot = registry.snapshot();
  assert.ok(snapshot.includes('history'));
  assert.ok(snapshot.includes('media'));
  assert.ok(snapshot.includes('tasks')); // ALWAYS 仍在
  withdraw();
  assert.ok(!registry.snapshot().includes('history'));
  assert.ok(!registry.snapshot().includes('media'));
  assert.ok(registry.snapshot().includes('tasks'));
});

test('ui capability registry: 未知能力 ID 拒绝（防拼写漂移）', () => {
  const registry = createUiCapabilityRegistry();
  assert.throws(() => registry.contribute('p1', ['historyy']), /unknown capability historyy/);
  assert.throws(() => registry.contribute('p1', ['cloud-drive']), /unknown capability cloud-drive/);
});

test('ui capability registry: 同插件重复 contribute 拒绝', () => {
  const registry = createUiCapabilityRegistry();
  registry.contribute('p1', ['history']);
  assert.throws(() => registry.contribute('p1', ['media']), /duplicate plugin id p1/);
});

test('ui capability registry: 非法入参拒绝', () => {
  const registry = createUiCapabilityRegistry();
  assert.throws(() => registry.contribute('', ['history']), /invalid plugin id/);
  assert.throws(() => registry.contribute('p1', 'history'), /capabilities must be an array/);
});

test('KNOWN 能力全集覆盖 ALWAYS', () => {
  for (const id of ALWAYS) assert.ok(KNOWN.has(id));
});

test('bootstrap snapshot: 无 uiCapabilitiesProvider 时 views = ALWAYS', async () => {
  const service = new BootstrapService({
    repository: { repositoryRevision: 0 },
    settings: { get: async () => ({ revision: 0, desired: {}, applied: null }) },
    driver: {},
    config: { version: 'test' },
  });
  const snapshot = await service.getSnapshot();
  assert.deepEqual([...snapshot.capabilities.views].sort(), [...ALWAYS].sort());
});

test('bootstrap snapshot: 有 provider 时 views = ALWAYS ∪ 贡献', async () => {
  const registry = createUiCapabilityRegistry();
  registry.contribute('product-services', ['history', 'link-library', 'private-space', 'media', 'daemon-admin']);
  const service = new BootstrapService({
    repository: { repositoryRevision: 0 },
    settings: { get: async () => ({ revision: 0, desired: {}, applied: null }) },
    driver: {},
    config: { version: 'test' },
    uiCapabilitiesProvider: () => registry.snapshot(),
  });
  const views = await service.getSnapshot().then((s) => s.capabilities.views);
  for (const id of ['tasks', 'settings', 'diagnostics', 'history', 'link-library', 'private-space', 'media', 'daemon-admin']) {
    assert.ok(views.includes(id), `views 应含 ${id}`);
  }
});
