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
  const shellDirs = ['domain', 'services', 'repositories', 'rpc', 'control', 'security', 'adapters', 'secrets'];
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

// P3（cordis-arch）新守卫：壳层源码不 import 内核私有模块——host/kernels/ 是
// 内核实现树（thunder/qbit 私有领地），P2 搬迁后旧路径兼容转发文件已删，
// 壳层对内核的一切消费必须经 KernelPort 契约或 hub slot 富件，静态钉死
// 不许任何 require 直接伸进 kernels/（防止转发文件与跨树引用回潮）。
test('壳层源码不 require host/kernels/ 内核私有模块', () => {
  const root = path.join(__dirname, '../../host/src');
  const shellDirs = ['domain', 'services', 'repositories', 'rpc', 'control', 'security', 'adapters', 'secrets'];
  const violations = [];
  const scan = (file) => {
    const requires = [...fs.readFileSync(file, 'utf8').matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
    for (const spec of requires) {
      if (/kernels\//.test(spec.replace(/\\/g, '/'))) violations.push(`${path.relative(root, file)} -> ${spec}`);
    }
  };
  for (const dir of shellDirs) {
    const dirPath = path.join(root, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const name of fs.readdirSync(dirPath).filter((n) => n.endsWith('.js'))) scan(path.join(dirPath, name));
  }
  for (const name of fs.readdirSync(root).filter((n) => n.endsWith('.js'))) scan(path.join(root, name));
  assert.deepEqual(violations, [], '壳层对内核的消费只许经 KernelPort / hub slot');
});

// P3：反向也钉死——内核树对壳层的依赖只许是纯领域模块（domain/ 下的纯函数），
// 不许拉 services/rpc/repositories 等有状态壳件（内核实现保持可独立装载）。
test('内核树 require 壳层只限纯领域模块（domain/）', () => {
  const root = path.join(__dirname, '../../host/kernels');
  const violations = [];
  const scan = (dirPath) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const file = path.join(dirPath, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const requires = [...fs.readFileSync(file, 'utf8').matchAll(/require\((['"])(\.\.[^'"]+)\1\)/g)].map((m) => m[2]);
      for (const spec of requires) {
        if (/src\/(services|rpc|repositories|control|security|adapters|secrets)\//.test(spec)) {
          violations.push(`${path.relative(root, file)} -> ${spec}`);
        }
      }
    }
  };
  scan(root);
  assert.deepEqual(violations, [], '内核树对壳层只许依赖 src/domain 纯函数');
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
