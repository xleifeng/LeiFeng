'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVipDescriptor } = require('../../host/src/vip-descriptor');

const base = (overrides = {}) => ({ gid: 'g1', engineId: 1, taskType: 'http', taskName: 'a.bin', url: 'https://x/a.bin',
  selectedFileIndices: [], fileLists: [], vipEnabled: true, metadataPhase: '', ...overrides });
const snapshot = (overrides = {}) => ({ engineId: 1, type: 1, status: 5, url: 'https://x/a.bin', name: 'a.bin', resourceSize: 10,
  cid: 'CID', gcid: 'GCID', vipReceiveSize: 0, freeDcdnReceiveSize: 0, btFiles: [], ...overrides });

test('HTTP/HTTPS/FTP P2SP 和 ed2k 使用 fileIndex=-1', () => {
  const http = buildVipDescriptor(base(), snapshot());
  assert.strictEqual(http.ok, true); assert.strictEqual(http.items[0].fileIndex, -1); assert.strictEqual(http.protocol, 'p2sp');
  const https = buildVipDescriptor(base({ taskType: 'https' }), snapshot({ url: 'https://x/a.bin' }));
  assert.strictEqual(https.items[0].fileIndex, -1);
  const ftp = buildVipDescriptor(base({ taskType: 'ftp', url: 'ftp://x/a.bin' }), snapshot({ url: 'ftp://x/a.bin' }));
  assert.strictEqual(ftp.protocol, 'p2sp'); assert.strictEqual(ftp.items[0].fileIndex, -1);
  const ed2k = buildVipDescriptor(base({ taskType: 'ed2k', url: 'ed2k://x' }), snapshot({ url: 'ed2k://x' }));
  assert.strictEqual(ed2k.protocol, 'ed2k'); assert.strictEqual(ed2k.items[0].fileIndex, -1);
});

test('CID/GCID/size 缺失只等待，不制造 descriptor', () => {
  const r = buildVipDescriptor(base(), snapshot({ cid: '' }));
  assert.deepStrictEqual(r, { ok: false, kind: 'wait', reason: 'waiting-metadata', detail: '' });
});

test('BT 多文件只选择 selectedFileIndices 且按 BtFile 元数据生成 bt://', () => {
  const r = buildVipDescriptor(base({ taskType: 'bt', taskName: 'bundle', infoId: 'HASH',
    selectedFileIndices: [2], fileLists: [{ realIndex: 0, fileName: 'skip', fileSize: 1 }, { realIndex: 2, fileName: 'pick', fileSize: 3 }] }),
    snapshot({ btFiles: [{ fileIndex: 0, download: 0, fileName: 'skip', fileSize: 1, cid: 'c0', gcid: 'g0' },
      { fileIndex: 2, download: 1, fileName: 'pick', fileSize: 3, cid: 'c2', gcid: 'g2' }] }));
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.items.map((i) => i.fileIndex), [2]);
  assert.strictEqual(r.items[0].url, 'bt://HASH/2');
});

test('BT 多文件元数据渐进就绪时先返回可加速文件', () => {
  const r = buildVipDescriptor(base({ taskType: 'bt', taskName: 'bundle', infoId: 'HASH', selectedFileIndices: [0, 1], fileLists: [
    { realIndex: 0, fileName: 'ready.bin', fileSize: 3 }, { realIndex: 1, fileName: 'pending.bin', fileSize: 4 },
  ] }), snapshot({ btFiles: [
    { fileIndex: 0, download: 1, fileName: 'ready.bin', fileSize: 3, cid: 'CID0', gcid: 'GCID0' },
    { fileIndex: 1, download: 1, fileName: 'pending.bin', fileSize: 4, cid: '', gcid: '' },
  ] }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.items.map((item) => item.fileIndex), [0]);
});

test('BT 单文件 root fallback 默认禁用，显式允许才可用', () => {
  const record = base({ taskType: 'bt', infoId: 'HASH', selectedFileIndices: [0], fileLists: [{ realIndex: 0, fileName: 'one', fileSize: 10 }] });
  const row = snapshot({ btFiles: [] });
  assert.strictEqual(buildVipDescriptor(record, row).reason, 'waiting-bt-file');
  const r = buildVipDescriptor(record, row, { allowBtRootFallback: true });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.items[0].fileIndex, 0);
});

test('磁力 metadata fetching 不请求，转 BT 后才生成 descriptor', () => {
  const fetching = buildVipDescriptor(base({ taskType: 'magnet', metadataPhase: 'fetching', infoHash: 'HASH' }), snapshot());
  assert.strictEqual(fetching.reason, 'metadata-fetching');
  const ready = buildVipDescriptor(base({ taskType: 'magnet', metadataPhase: 'download', infoId: 'HASH', taskName: 'mag',
    fileLists: [{ realIndex: 0, fileName: 'a', fileSize: 1 }], selectedFileIndices: [0] }), snapshot({ btFiles: [{ fileIndex: 0, download: 1, fileName: 'a', fileSize: 1, cid: 'c', gcid: 'g' }] }));
  assert.strictEqual(ready.ok, true); assert.strictEqual(ready.protocol, 'bt');
});
