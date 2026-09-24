'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startFakeEngine } = require('./helpers/fake-engine');

test('enable/disable VIP cert 按 fileIndex 调 native 且不回显 token', async () => {
  const fx = await startFakeEngine();
  const secret = 'fixture-token-never-returned';
  const enabled = await fx.call('enableVipDcdn', { engineId: 12, certs: [{ fileIndex: -1, token: secret }, { fileIndex: 3, token: 'second-token' }] });
  assert.deepStrictEqual(enabled, { ok: true, items: [{ fileIndex: -1, invoked: true, errorCode: '' }, { fileIndex: 3, invoked: true, errorCode: '' }] });
  assert.deepStrictEqual(fx.state.vipCalls.map(({ op, fileIndex, tokenLength }) => ({ op, fileIndex, tokenLength })), [
    { op: 'enable', fileIndex: -1, tokenLength: secret.length }, { op: 'enable', fileIndex: 3, tokenLength: 12 },
  ]);
  const disabled = await fx.call('disableVipDcdn', { engineId: 12, fileIndices: [-1, 3] });
  assert.deepStrictEqual(disabled, { ok: true, items: [{ fileIndex: -1, invoked: true, errorCode: '' }, { fileIndex: 3, invoked: true, errorCode: '' }] });
  assert.doesNotMatch(JSON.stringify(enabled), /fixture-token|second-token/);
  fx.server.close();
});

test('VIP engine handler 在 native 调用前拒绝非法输入', async (t) => {
  const cases = [
    [{ engineId: 0, certs: [{ fileIndex: -1, token: 'x' }] }, /invalid engine id/],
    [{ engineId: 1, certs: [] }, /invalid cert batch/],
    [{ engineId: 1, certs: [{ fileIndex: 0, token: '' }] }, /invalid cert item/],
    [{ engineId: 1, certs: [{ fileIndex: 0, token: 'x' }, { fileIndex: 0, token: 'y' }] }, /duplicate file index/],
  ];
  for (const [params, pattern] of cases) {
    await t.test(pattern.source, async () => {
      const fx = await startFakeEngine();
      fx.state.vipCalls.length = 0;
      await assert.rejects(fx.call('enableVipDcdn', params), pattern);
      assert.strictEqual(fx.state.vipCalls.length, 0);
      fx.server.close();
    });
  }
});
