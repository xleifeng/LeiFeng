'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskRegistry } = require('../../host/src/registry');

function freshRegistry() {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reg-')), 'r.json');
  return new TaskRegistry(f);
}

test('create 记 taskType/infoId/infoHash/metadataPhase', () => {
  const r = freshRegistry();
  const rec = r.create({ url: 'magnet:?x', savePath: '/s', taskName: 'H.torrent', totalLength: 0, engineId: 1,
    taskType: 'magnet', infoHash: 'HASH', metadataPhase: 'fetching' });
  assert.strictEqual(rec.taskType, 'magnet');
  assert.strictEqual(rec.infoHash, 'HASH');
  assert.strictEqual(rec.metadataPhase, 'fetching');
  assert.strictEqual(r.get(rec.gid).taskType, 'magnet');
});

test('findDuplicate BT 按 infoId+savePath', () => {
  const r = freshRegistry();
  r.create({ url: '', savePath: '/s', taskName: 'a', totalLength: 0, engineId: 1, taskType: 'bt', infoId: 'ID1' });
  const dup = r.findDuplicate('bt', 'ID1', '/s');
  assert.ok(dup);
  assert.strictEqual(dup.infoId, 'ID1');
  // 不同 savePath 不命中
  assert.strictEqual(r.findDuplicate('bt', 'ID1', '/other'), undefined);
});

test('findDuplicate 磁力 按 infoHash+savePath', () => {
  const r = freshRegistry();
  r.create({ url: 'magnet:?x', savePath: '/s', taskName: 'H.torrent', totalLength: 0, engineId: 1, taskType: 'magnet', infoHash: 'IH' });
  assert.ok(r.findDuplicate('magnet', 'IH', '/s'));
  assert.strictEqual(r.findDuplicate('magnet', 'IH', '/o'), undefined);
});

test('findDuplicate HTTP 按 url+savePath', () => {
  const r = freshRegistry();
  r.create({ url: 'http://x/f', savePath: '/s', taskName: 'f', totalLength: 0, engineId: 1, taskType: 'http' });
  assert.ok(r.findDuplicate('http', 'http://x/f', '/s'));
  assert.strictEqual(r.findDuplicate('http', 'http://x/f', '/o'), undefined);
});

test('findDuplicate 跨 taskType 不误命中', () => {
  const r = freshRegistry();
  // BT infoId='U1' 与 HTTP url='U1' 同串，不应跨类型命中
  r.create({ url: '', savePath: '/s', taskName: 'a', totalLength: 0, engineId: 1, taskType: 'bt', infoId: 'U1' });
  assert.strictEqual(r.findDuplicate('http', 'U1', '/s'), undefined);
});

test('findDuplicate 终态任务不命中', () => {
  const r = freshRegistry();
  const rec = r.create({ url: 'http://x/f', savePath: '/s', taskName: 'f', totalLength: 0, engineId: 1, taskType: 'http' });
  r.update(rec.gid, { status: 'complete' });
  assert.strictEqual(r.findDuplicate('http', 'http://x/f', '/s'), undefined);
});

test('metadataPhase 切换 update', () => {
  const r = freshRegistry();
  const rec = r.create({ url: 'magnet:?x', savePath: '/s', taskName: 'H.torrent', totalLength: 0, engineId: 1, taskType: 'magnet', infoHash: 'IH', metadataPhase: 'fetching' });
  r.update(rec.gid, { engineId: 2, metadataPhase: 'download' });
  const got = r.get(rec.gid);
  assert.strictEqual(got.engineId, 2);
  assert.strictEqual(got.metadataPhase, 'download');
});
