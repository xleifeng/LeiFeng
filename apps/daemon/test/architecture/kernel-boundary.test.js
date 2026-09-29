'use strict';
// 壳/内核边界守卫（P0）：壳层 src（services/rpc/control/methods/domain/security 等）
// 禁止 require 迅雷专属模块——内核细节只允许出现在 plugins/kernel-thunder.cjs
// 装配文件与 src 自身的迅雷实现文件（driver/taskdb-reader/auth-* / vip-* / sdk-* /
// xunlei-client-config）里。将来 kernel-qbit 落地时，第二内核不得引入任何迅雷符号。
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');

const THUNDER_ONLY = /driver|taskdb-reader|auth-manager|auth-wallet|vip-manager|vip-speedup-client|sdk-peer-id|xunlei-client-config/;

test('壳层源码不 require 迅雷内核专属模块', () => {
  const root = path.join(__dirname, '../../host/src');
  const shellDirs = ['domain', 'services', 'repositories', 'rpc', 'control', 'security', 'adapters', 'secrets', 'remote'];
  const violations = [];
  for (const dir of shellDirs) {
    const dirPath = path.join(root, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const name of fs.readdirSync(dirPath).filter((n) => n.endsWith('.js'))) {
      const file = path.join(dirPath, name);
      if (THUNDER_ONLY.test(name)) continue; // 目录里的迅雷实现文件本身（如 security 误放时由 review 管）
      const requires = [...fs.readFileSync(file, 'utf8').matchAll(/require\((['"])(\.[^'"]+)\1\)/g)].map((m) => m[2]);
      for (const spec of requires) {
        if (THUNDER_ONLY.test(path.basename(spec))) violations.push(`${path.relative(root, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('顶层壳文件（methods.js / registry / poller 等）不 require 迅雷专属模块', () => {
  const root = path.join(__dirname, '../../host/src');
  const shellFiles = fs.readdirSync(root).filter((n) => n.endsWith('.js'));
  const violations = [];
  for (const name of shellFiles) {
    if (THUNDER_ONLY.test(name)) continue;
    const requires = [...fs.readFileSync(path.join(root, name), 'utf8').matchAll(/require\((['"])(\.[^'"]+)\1\)/g)].map((m) => m[2]);
    for (const spec of requires) {
      if (THUNDER_ONLY.test(path.basename(spec))) violations.push(`${name} -> ${spec}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('poller 观察通道纯构造注入（迅雷 TaskDb 回退在 kernel-thunder 插件层）', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../host/src/poller.js'), 'utf8');
  assert.equal(/require\([^)]*taskdb-reader/.test(source), false, 'poller 已不依赖 taskdb-reader');
});

// P1：壳层 services 对 driver 的成员访问必须 ⊆ KernelPort 契约面——
// 契约外成员（如迅雷内部 SDK 调用）只能住在 kernel 插件里，静态扫描兜底。
const { KERNEL_METHODS, KERNEL_PROPERTIES } = require('../../host/src/domain/kernel-port');
const KERNEL_SURFACE = new Set([...KERNEL_METHODS, ...KERNEL_PROPERTIES]);

test('壳层 services 对 driver 的成员访问都在 KernelPort 契约面内', () => {
  const dirPath = path.join(__dirname, '../../host/src/services');
  const violations = [];
  for (const name of fs.readdirSync(dirPath).filter((n) => n.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(dirPath, name), 'utf8');
    for (const match of source.matchAll(/\b(?:this\.)?driver\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      if (!KERNEL_SURFACE.has(match[1])) violations.push(`${name}: driver.${match[1]}`);
    }
  }
  assert.deepEqual(violations, []);
});
