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
