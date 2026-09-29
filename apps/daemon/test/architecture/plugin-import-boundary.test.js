'use strict';
// P0 插件装配层导入守卫（cordis-arch P0）：plugins/*.cjs 是 Cordis 装配层，
// 不是公共桶。三条规则防止拆分遗留再次堆积：
//  1. 零死导入——require 解构出的符号必须在文件内真实使用；
//  2. 零循环——插件文件之间不允许 require 环（shared↔product-services 曾出现）；
//  3. shared.cjs 保持极小——只许 plugin/repoRoot 工具，禁止 re-export 实现类
//     （历史上曾拖 72 个顶层实现导入，禁用插件不等于其 JS 实现不被加载）。
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');

const pluginsDir = path.join(__dirname, '../../host/plugins');
const files = fs.readdirSync(pluginsDir).filter((n) => n.endsWith('.cjs'));

function requireLinesOf(source) {
  return [...source.matchAll(/^const\s*\{([^}]+)\}\s*=\s*require\((['"][^'"]+['"])\)/gm)].map((m) => ({
    symbols: m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean),
    spec: m[2].slice(1, -1),
  }));
}

test('插件装配文件零死导入', () => {
  const violations = [];
  for (const name of files) {
    const source = fs.readFileSync(path.join(pluginsDir, name), 'utf8');
    const lines = source.split('\n');
    for (const line of lines) {
      const m = line.match(/^const\s*\{([^}]+)\}\s*=\s*require\(/);
      if (!m) continue;
      for (const raw of m[1].split(',')) {
        const sym = raw.split(':')[0].trim();
        if (!sym) continue;
        const used = lines.some((l) => l !== line && new RegExp(`\\b${sym.replace(/\$/g, '\\$')}\\b`).test(l));
        if (!used) violations.push(`${name}: 未使用符号 ${sym}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('插件文件之间无循环 require', () => {
  // 有向图：plugins 内 ./x.cjs -> ./y.cjs；DFS 找环。
  const graph = new Map(files.map((name) => [name, []]));
  for (const name of files) {
    const source = fs.readFileSync(path.join(pluginsDir, name), 'utf8');
    for (const { spec } of requireLinesOf(source)) {
      if (spec.startsWith('./')) {
        const target = spec.replace(/^\.\//, '');
        if (graph.has(target)) graph.get(name).push(target);
      }
    }
  }
  const violations = [];
  const state = new Map(); // 1=在栈 2=完成
  const visit = (node, stack) => {
    if (state.get(node) === 2) return;
    if (state.get(node) === 1) {
      violations.push([...stack.slice(stack.indexOf(node)), node].join(' -> '));
      return;
    }
    state.set(node, 1);
    for (const next of graph.get(node)) visit(next, [...stack, node]);
    state.set(node, 2);
  };
  for (const name of files) visit(name, []);
  assert.deepEqual(violations, []);
});

test('shared.cjs 只保留装配工具导出', () => {
  const source = fs.readFileSync(path.join(pluginsDir, 'shared.cjs'), 'utf8');
  // 任何对 ../src 实现的 require 都不许回到 shared（它只承载 plugin()/repoRoot）
  const implRequires = requireLinesOf(source).filter(({ spec }) => spec.startsWith('../'));
  assert.deepEqual(implRequires.map((r) => r.spec), [], 'shared.cjs 禁止导入 host/src 实现');
});

test('禁用迅雷内核不加载其实现（kernel-qbit 文件零迅雷符号）', () => {
  // P0 最小可验：qbit 内核的装配文件不得 require 任何迅雷专属模块——
  // 这是“任意内核独立成在”的装载边界底线（运行期验证在 kernel-any-only.test.js）。
  // 注意 ../src/qbit-driver.js 是 qbit 自己的实现（文件名含 driver 但非迅雷符号），
  // 迅雷专属 = host/src 下 driver.js/taskdb-reader/auth-*/vip-*/sdk-* 等。
  const THUNDER_ONLY = /^(driver|taskdb-reader|auth-manager|auth-wallet|vip-manager|vip-speedup-client|sdk-peer-id|xunlei-client-config)\.js$/;
  const qbit = fs.readFileSync(path.join(pluginsDir, 'kernel-qbit.cjs'), 'utf8');
  const violations = requireLinesOf(qbit)
    .filter(({ spec }) => spec.startsWith('../src/') && THUNDER_ONLY.test(path.basename(spec)))
    .map(({ spec }) => spec);
  assert.deepEqual(violations, []);
});
