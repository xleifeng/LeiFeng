'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SafePathResolver } = require('../../host/src/services/safe-path-resolver');

test('safe path resolver allows only download roots and rejects traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-path-v2-'));
  const resolver = new SafePathResolver({ allowedRoots: [root] });
  assert.equal(resolver.assertInsideAllowedRoots(path.join(root, 'nested')), path.join(root, 'nested'));
  assert.throws(() => resolver.assertInsideAllowedRoots(path.join(root, '..', 'outside')), (error) => error.code === 'UNSAFE_PATH');
  assert.throws(() => resolver.resolveTaskRoot({ savePath: root, displayName: '../outside.txt' }), (error) => error.code === 'UNSAFE_PATH');
});

test('safe path resolver rejects symlink components and detects file changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-path-link-v2-'));
  const real = path.join(root, 'real');
  const link = path.join(root, 'link');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, 'dir');
  const resolver = new SafePathResolver({ allowedRoots: [root] });
  assert.throws(() => resolver.resolveDirectory(link), (error) => error.code === 'SYMLINK_PATH');

  const file = path.join(real, 'file.bin');
  fs.writeFileSync(file, 'before');
  const snapshot = resolver.snapshot(file);
  fs.writeFileSync(file, 'after');
  assert.throws(() => resolver.assertUnchanged(snapshot, file), (error) => error.code === 'FILE_CHANGED_DURING_OPERATION');
});

test('resolveTaskRoot 回退 .xltd 部分文件（SDK 下载中形态）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-path-xltd-'));
  const resolver = new SafePathResolver({ allowedRoots: [root] });
  const task = { savePath: root, displayName: 'movie.bin' };
  // 磁盘上只有下载中部分文件：任务根应解析到 .xltd，删/移/改名对准真实落盘物
  fs.writeFileSync(path.join(root, 'movie.bin.xltd'), 'partial');
  assert.equal(resolver.resolveTaskRoot(task), path.join(root, 'movie.bin.xltd'));
  // 完成后改名最终名：任务根回到最终名
  fs.renameSync(path.join(root, 'movie.bin.xltd'), path.join(root, 'movie.bin'));
  assert.equal(resolver.resolveTaskRoot(task), path.join(root, 'movie.bin'));
  // 两者都不存在（未开始下载）：返回最终名占位（调用方自行报 FILE_NOT_FOUND）
  assert.equal(resolver.resolveTaskRoot({ savePath: root, displayName: 'ghost.bin' }), path.join(root, 'ghost.bin'));
});
