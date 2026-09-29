'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createMethodHandler } = require('../../host/src/methods');
const { RpcRegistry } = require('../../host/src/rpc/registry');

// v1 兼容面（aria2.* / thunder.* / system.multicall）已整体移除（2026-09-28，
// docs/specs/2026-09-28-remove-legacy-rpc.md）。本文件守护两件事：
// 1) 非 leifeng.ui.v2.* 方法一律 -32601，防止兼容层复活；
// 2) 配 rpcSecret 时 V2 只认 Authorization: Bearer，拒绝 token:<secret> 参数形。

function makeHandler({ rpcSecret = '' } = {}) {
  const registry = new RpcRegistry();
  registry.register('test', new Map([
    ['leifeng.ui.v2.echo', (params) => ({ echoed: (params && params[0]) || null })],
  ]));
  return createMethodHandler({ config: { rpcSecret }, registry });
}

test('v1 方法名一律 -32601（aria2/thunder/system.multicall 均已删除）', async () => {
  const handle = makeHandler();
  for (const method of ['aria2.addUri', 'aria2.tellStatus', 'aria2.getVersion', 'aria2.getGlobalStat',
    'system.multicall', 'thunder.getVersion', 'thunder.getEngineInfo', 'thunder.ui.bootstrap',
    'thunder.auth.startLogin', 'thunder.pan.list', 'no.such.method']) {
    await assert.rejects(handle(method, []), (e) => e.code === -32601, `${method} 应被拒绝`);
  }
});

test('V2 只认 Authorization: Bearer；token:<secret> 参数形与错误 bearer 均拒绝', async () => {
  const handle = makeHandler({ rpcSecret: 's3cr3t' });
  const params = [{ echoed: 'x' }];
  await assert.rejects(handle('leifeng.ui.v2.echo', [['token:s3cr3t'], ...params]), /unauthorized/i);
  await assert.rejects(handle('leifeng.ui.v2.echo', params, { rpcSecret: 's3cr3t' }), /unauthorized/i);
  await assert.rejects(handle('leifeng.ui.v2.echo', params, { bearerToken: 'wrong' }), /unauthorized/i);
  const ok = await handle('leifeng.ui.v2.echo', params, { bearerToken: 's3cr3t' });
  assert.deepStrictEqual(ok, { echoed: { echoed: 'x' } });
});

test('无 secret 配置时不鉴权；v2Methods 未注册方法 -32601', async () => {
  const handle = makeHandler();
  const ok = await handle('leifeng.ui.v2.echo', []);
  assert.deepStrictEqual(ok, { echoed: null });
  await assert.rejects(handle('leifeng.ui.v2.tasks.query', [], { bearerToken: 'whatever' }), (e) => e.code === -32601);
  const bare = createMethodHandler({ config: {} }); // registry=null
  await assert.rejects(bare('leifeng.ui.v2.echo', []), (e) => e.code === -32601);
});
