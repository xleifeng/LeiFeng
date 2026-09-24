'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CredentialWallet } = require('../../host/src/auth-wallet');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-'));
  return { file: path.join(dir, 'auth.json'), dir };
}
const SAMPLE = {
  version: 1,
  credentials: { accessToken: 'at-x', refreshToken: 'rt-x', accessTokenExpiresAt: 1, obtainedAt: 1 },
  session: { sessionId: 'sid-x', secureKey: 'sk-x', userId: '42', registeredAt: 1, keepAlivePeriodSec: 300, keepAliveMinPeriodSec: 30 },
  vip: { isVip: true, vipType: 5, vipLevel: 9, userChannel: 'thunderd', checkedAt: 1 },
  meta: { deviceId: 'dev-x', clientId: 'XW-G4v1H72tgfJym' },
};

test('save → 0600 权限 + roundtrip 全字段', () => {
  const { file } = setup();
  const w = new CredentialWallet(file);
  w.data = JSON.parse(JSON.stringify(SAMPLE));
  w.saveSync();
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  const w2 = new CredentialWallet(file);
  assert.strictEqual(w2.load(), true);
  assert.deepStrictEqual(w2.data, SAMPLE);
});

test('load 纠正 0644 → 0600', () => {
  const { file } = setup();
  fs.writeFileSync(file, JSON.stringify(SAMPLE));
  fs.chmodSync(file, 0o644);
  const w = new CredentialWallet(file);
  assert.strictEqual(w.load(), true);
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('原子写：save 后无 .tmp 残留', () => {
  const { file, dir } = setup();
  const w = new CredentialWallet(file);
  w.data.session = SAMPLE.session;
  w.saveSync();
  assert.deepStrictEqual(fs.readdirSync(dir), ['auth.json']);
});

test('损坏 → .corrupt-* 备份 + 视为未登录', () => {
  const { file, dir } = setup();
  fs.writeFileSync(file, '{not json');
  const w = new CredentialWallet(file);
  assert.strictEqual(w.load(), false);
  assert.strictEqual(w.hasSession(), false);
  assert.strictEqual(w.data.session, null);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('auth.json.corrupt-')));
});

test('缺文件 → load false + EMPTY（无 .corrupt 备份）', () => {
  const { file, dir } = setup();
  const w = new CredentialWallet(file);
  assert.strictEqual(w.load(), false);
  assert.deepStrictEqual(w.data, { version: 1, credentials: null, session: null, vip: null, meta: {} });
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('clear 删文件 + 复位 + 幂等', () => {
  const { file } = setup();
  const w = new CredentialWallet(file);
  w.data.session = SAMPLE.session;
  w.saveSync();
  w.clear();
  assert.ok(!fs.existsSync(file));
  assert.strictEqual(w.hasSession(), false);
  w.clear(); // 幂等不抛
});

test('hasSession：仅 version/meta 为 false，含 session.sessionId 为 true', () => {
  const { file } = setup();
  const w = new CredentialWallet(file);
  assert.strictEqual(w.hasSession(), false);
  w.data.meta.deviceId = 'dev-x';
  assert.strictEqual(w.hasSession(), false);
  w.data.session = SAMPLE.session;
  assert.strictEqual(w.hasSession(), true);
});
