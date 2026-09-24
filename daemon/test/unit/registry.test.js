'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskRegistry, isTerminal } = require('../../host/src/registry');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reg-')), 'registry.json');

test('create assigns 16-hex gid and waiting status', () => {
  const reg = new TaskRegistry(tmpFile());
  const r = reg.create({ url: 'http://x/f.bin', savePath: '/d', taskName: 'f.bin', totalLength: 100, engineId: 7 });
  assert.match(r.gid, /^[0-9a-f]{16}$/);
  assert.strictEqual(r.status, 'waiting');
  assert.strictEqual(reg.get(r.gid), r);
});

test('findDuplicate only matches non-terminal same url+path (http)', () => {
  const reg = new TaskRegistry(tmpFile());
  const a = reg.create({ url: 'u', savePath: '/d', taskName: 'f', totalLength: 1, engineId: 1 });
  assert.strictEqual(reg.findDuplicate('http', 'u', '/d').gid, a.gid);
  reg.update(a.gid, { status: 'complete' });
  assert.strictEqual(reg.findDuplicate('http', 'u', '/d'), undefined);
});

test('counts buckets', () => {
  const reg = new TaskRegistry(tmpFile());
  const mk = (s) => { const r = reg.create({ url: 'u' + s, savePath: '/d', taskName: s, totalLength: 1, engineId: 1 }); reg.update(r.gid, { status: s }); };
  mk('active'); mk('waiting'); mk('paused'); mk('complete'); mk('error');
  assert.deepStrictEqual(reg.counts(), { active: 1, waiting: 2, stopped: 2 });
});

test('persist + reload marks leftover non-terminal as interrupted', () => {
  const f = tmpFile();
  const reg = new TaskRegistry(f);
  const a = reg.create({ url: 'u', savePath: '/d', taskName: 'f', totalLength: 1, engineId: 1 });
  reg.update(a.gid, { status: 'active' });
  const b = reg.create({ url: 'u2', savePath: '/d', taskName: 'g', totalLength: 1, engineId: 2 });
  reg.update(b.gid, { status: 'complete' });
  reg.saveSync();
  const reg2 = new TaskRegistry(f);
  reg2.load();
  assert.strictEqual(reg2.get(a.gid).status, 'error');
  assert.strictEqual(reg2.get(a.gid).errorCode, 'interrupted');
  assert.strictEqual(reg2.get(b.gid).status, 'complete');
});

test('corrupted file is backed up, not silently emptied', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{{{{not json');
  const reg = new TaskRegistry(f);
  reg.load(); // 不抛
  const dir = path.dirname(f);
  assert.ok(fs.readdirSync(dir).some((x) => x.startsWith('registry.json.corrupt-')));
  assert.strictEqual(reg.list().length, 0);
});

test('isTerminal', () => {
  assert.ok(isTerminal('complete') && isTerminal('error') && isTerminal('removed'));
  assert.ok(!isTerminal('active') && !isTerminal('waiting') && !isTerminal('paused'));
});

test('create 保存 BT 选中文件和默认 VIP 偏好', () => {
  const reg = new TaskRegistry(tmpFile());
  const r = reg.create({ url: '', savePath: '/d', taskName: 'bundle', totalLength: 1024, engineId: 7,
    taskType: 'bt', infoId: 'IH', infoHash: 'IH', selectedFileIndices: [2, 0, 2],
    fileLists: [{ realIndex: 0, fileName: 'a', fileSize: 10 }], vipEnabled: true });
  assert.deepStrictEqual(r.selectedFileIndices, [0, 2]);
  assert.deepStrictEqual(r.fileLists[0], {
    realIndex: 0, fileName: 'a', fileSize: 10, fileOffset: 0, filePath: '',
  });
  assert.strictEqual(r.vipEnabled, true);
  assert.strictEqual(r.vipState, 'disabled');
  assert.strictEqual(r.infoId, 'IH');
});

test('update 丢弃 VIP token/cert/session/peer 等敏感字段', () => {
  const reg = new TaskRegistry(tmpFile());
  const r = reg.create({ url: 'u', savePath: '/d', taskName: 'f', totalLength: 1, engineId: 1 });
  reg.update(r.gid, {
    vipState: 'injected', vipLastErrorCode: 'none', vipToken: 'token-secret', cert: 'cert-secret',
    accessToken: 'access-secret', sessionId: 'session-secret', peerId: 'peer-secret',
    authorization: 'Bearer secret', nested: { token: 'nested-secret' },
  });
  reg.saveSync();
  const saved = JSON.parse(fs.readFileSync(reg.filePath, 'utf8'));
  const text = JSON.stringify(saved);
  assert.strictEqual(saved[0].vipState, 'injected');
  assert.strictEqual(saved[0].vipLastErrorCode, 'none');
  assert.doesNotMatch(text, /token-secret|cert-secret|access-secret|session-secret|peer-secret|Bearer secret|nested-secret/);
  assert.strictEqual(Object.hasOwn(saved[0], 'vipToken'), false);
  assert.strictEqual(Object.hasOwn(saved[0], 'nested'), false);
});
