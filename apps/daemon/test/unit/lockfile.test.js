'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireLock, releaseLock } = require('../../host/src/lockfile');

test('acquireLock 成功 + 写 PID', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const p = path.join(dir, 'thunderd.lock');
  assert.strictEqual(acquireLock(p, 12345), true);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), '12345');
  releaseLock(p);
});
test('acquireLock 已存在 + PID 存活 → 拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const p = path.join(dir, 'thunderd.lock');
  acquireLock(p, process.pid); // 自己 PID 存活
  assert.strictEqual(acquireLock(p, 99999), false); // 已锁
  releaseLock(p);
});
test('acquireLock 已存在但 PID 死 → 抢占', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const p = path.join(dir, 'thunderd.lock');
  fs.writeFileSync(p, '999999'); // 假 PID 不存活
  assert.strictEqual(acquireLock(p, process.pid), true);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), String(process.pid));
  releaseLock(p);
});
test('父目录不存在时自动创建', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const p = path.join(dir, 'nested', 'thunderd.lock');
  assert.strictEqual(acquireLock(p, process.pid), true);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), String(process.pid));
  releaseLock(p, process.pid);
  assert.strictEqual(fs.existsSync(p), false);
});
test('损坏锁文件可回收', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const p = path.join(dir, 'thunderd.lock');
  fs.writeFileSync(p, 'not-a-pid');
  assert.strictEqual(acquireLock(p, process.pid), true);
  releaseLock(p, process.pid);
});
test('releaseLock 不删除其他 PID 持有的锁', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const p = path.join(dir, 'thunderd.lock');
  acquireLock(p, process.pid);
  fs.writeFileSync(p, '424242');
  assert.strictEqual(releaseLock(p, process.pid), false);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), '424242');
  fs.unlinkSync(p);
});
