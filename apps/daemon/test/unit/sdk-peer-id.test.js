'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSdkPeerId, PEER_ID_PATTERN } = require('../../host/src/sdk-peer-id');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-peer-'));

test('readSdkPeerId 显式路径优先于 Wine prefix 候选', () => {
  const root = tempDir();
  const explicit = path.join(root, 'explicit.ini');
  const fallback = path.join(root, 'drive_c', 'users', 'tester', 'AppData', 'Local', 'Temp', 'Thunder Network', 'XLSDK', 'crashinfo.ini');
  fs.mkdirSync(path.dirname(fallback), { recursive: true });
  fs.writeFileSync(explicit, '[meta]\npeerid=EXPLICIT-PEER-1234\n');
  fs.writeFileSync(fallback, 'peerid=FALLBACK-PEER-1234\n');
  const r = readSdkPeerId({ explicitPath: explicit, winePrefix: root });
  assert.deepStrictEqual(r, { ok: true, peerId: 'EXPLICIT-PEER-1234', source: explicit });
  assert.match(r.peerId, PEER_ID_PATTERN);
});

test('readSdkPeerId 自动发现 prefix 下用户 Temp crashinfo.ini', () => {
  const root = tempDir();
  const p = path.join(root, 'drive_c', 'users', 'tester', 'AppData', 'Local', 'Temp', 'Thunder Network', 'XLSDK', 'crashinfo.ini');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '[sdk]\r\nPeerId = AUTO-PEER-1234\r\n');
  const r = readSdkPeerId({ winePrefix: root });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.peerId, 'AUTO-PEER-1234');
  assert.strictEqual(r.source, p);
});

test('readSdkPeerId 兼容 Wine 用户目录直系 Temp', () => {
  const root = tempDir();
  const p = path.join(root, 'drive_c', 'users', 'tester', 'Temp', 'Thunder Network', 'XLSDK', 'crashinfo.ini');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'peerid=WINE-TEMP-PEER-1234\n');
  const r = readSdkPeerId({ winePrefix: root });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.peerId, 'WINE-TEMP-PEER-1234');
  assert.strictEqual(r.source, p);
});

test('readSdkPeerId 拒绝缺失、格式非法和空 peer id', () => {
  const root = tempDir();
  const missing = readSdkPeerId({ winePrefix: root });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.reason, 'not-found');

  const bad = path.join(root, 'bad.ini');
  fs.writeFileSync(bad, 'peerid=bad value with spaces\n');
  const invalid = readSdkPeerId({ explicitPath: bad, winePrefix: root });
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.reason, 'invalid');
  assert.doesNotMatch(invalid.message || '', /bad value/);
});

test('readSdkPeerId 错误信息不回显 peer id', () => {
  const root = tempDir();
  const p = path.join(root, 'bad.ini');
  const secretLike = 'SECRETPEER-1234';
  fs.writeFileSync(p, `peerid=${secretLike} with-space\n`);
  const r = readSdkPeerId({ explicitPath: p, winePrefix: root });
  assert.strictEqual(r.ok, false);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(secretLike));
});
