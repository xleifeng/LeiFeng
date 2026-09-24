'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNativeBtInfo } = require('../../host/src/domain/native-bt-info');

test('native BT creation info includes the parsed file tree required for CID/GCID metadata', () => {
  const info = buildNativeBtInfo({
    infoId: '00112233445566778899AABBCCDDEEFF00112233',
    seedFile: '/tmp/ubuntu.torrent',
    selectedFileIndices: [2, 0, 2],
    fileLists: [{ realIndex: 0, fileName: 'ubuntu.iso', filePath: '', fileSize: 10, fileOffset: 0 }],
    displayName: 'ubuntu.iso',
    trackerUrls: ['https://tracker.example/announce'],
    scheduler: 'sequential',
  });

  assert.equal(info.origin, 'magnet:?xt=urn:btih:00112233445566778899AABBCCDDEEFF00112233');
  assert.deepEqual(info.fileRealIndexLists, [0, 2]);
  assert.deepEqual(info.fileLists, [{ realIndex: 0, fileName: 'ubuntu.iso', filePath: '', fileSize: 10, fileOffset: 0 }]);
  assert.equal(info.tracker, 'https://tracker.example/announce');
  assert.equal(info.subFileScheduler, 2);
});

test('native BT creation preserves a real magnet origin and derives one from a parsed torrent info id', () => {
  const origin = 'magnet:?xt=urn:btih:00112233445566778899AABBCCDDEEFF00112233&dn=ubuntu.iso';
  const info = buildNativeBtInfo({
    infoId: '00112233445566778899AABBCCDDEEFF00112233',
    seedFile: '/tmp/ubuntu.torrent',
    selectedFileIndices: [0],
    fileLists: [{ realIndex: 0, fileName: 'ubuntu.iso', filePath: '', fileSize: 10, fileOffset: 0 }],
    origin,
  });

  assert.equal(info.origin, origin);
  assert.equal(buildNativeBtInfo({ infoId: 'abcdef' }).origin, 'magnet:?xt=urn:btih:abcdef');
});
