'use strict';
// RPC 注册边界守卫（rpc-plugin-registration，2026-09-28）：壳不持有业务 RPC——
// leifeng.ui.v2.* 方法字面量禁止出现在 rpc-host.cjs 与 src/methods.js（传输机制
// 层）；account.*/vip.* 的注册点只允许在 kernel-thunder（迅雷绑定域随内核走，
// 换内核时这批方法应整体 -32601 而非壳里伪装可用）。
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');

const hostRoot = path.join(__dirname, '../../host');

test('rpc-host 与 methods.js 不含业务方法名字面量（壳零 RPC）', () => {
  const mechanismFiles = [
    path.join(hostRoot, 'plugins/rpc-host.cjs'),
    path.join(hostRoot, 'plugins/rpc-registry.cjs'),
    path.join(hostRoot, 'plugins/request-policy.cjs'),
    path.join(hostRoot, 'plugins/control-transport.cjs'),
    path.join(hostRoot, 'src/methods.js'),
    path.join(hostRoot, 'src/control/dispatcher.js'),
    path.join(hostRoot, 'src/rpc/registry.js'),
  ];
  const violations = [];
  for (const file of mechanismFiles) {
    const source = fs.readFileSync(file, 'utf8');
    // daemon.v1. 三机制方法（health/web.invoke/lease.release）是传输层自身，白名单
    const hits = [...source.matchAll(/'(leifeng\.ui\.v2\.[a-z.]+|daemon\.v1\.[a-z.]+)'/g)].map((m) => m[1]);
    for (const name of hits) {
      if (['daemon.v1.health', 'daemon.v1.web.invoke', 'daemon.v1.web.lease.release'].includes(name)) continue;
      violations.push(`${path.relative(hostRoot, file)}: ${name}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('account.*/vip.* 注册点只在 kernel-thunder（迅雷绑定域随内核）', () => {
  const pluginsDir = path.join(hostRoot, 'plugins');
  const violations = [];
  for (const name of fs.readdirSync(pluginsDir).filter((n) => n.endsWith('.cjs'))) {
    if (name === 'kernel-thunder.cjs') continue;
    const source = fs.readFileSync(path.join(pluginsDir, name), 'utf8');
    const hits = [...source.matchAll(/'(leifeng\.ui\.v2\.(?:account|vip)\.[a-z.]+)'/g)].map((m) => m[1]);
    for (const hit of hits) violations.push(`${name}: ${hit}`);
  }
  assert.deepEqual(violations, []);
});

test('P4 拆分无方法丢失：聚合方法面的注册点守卫（restartEngine 随 product-core）', () => {
  // P4 拆分时 restartEngine 曾随 product-services 退役丢失（e2e sup1v2 抓回）——
  // 静态钉死：内核生命周期 system 面注册在 product-core（聚合核持 driver/operations/eventBus）。
  const productCore = fs.readFileSync(path.join(hostRoot, 'plugins/product-core.cjs'), 'utf8');
  assert.match(productCore, /createSystemMethods\(\{[^}]*driver/s, 'product-core 须注册 system 面（含 restartEngine）');
  // 其余域插件不得重复注册（media-capture 只持 mediaCapabilities——createSystemMethods media 专属面）
  const mediaCapture = fs.readFileSync(path.join(hostRoot, 'plugins/media-capture.cjs'), 'utf8');
  assert.doesNotMatch(mediaCapture, /restartEngine/, 'media-capture 不注册内核生命周期面');
});
