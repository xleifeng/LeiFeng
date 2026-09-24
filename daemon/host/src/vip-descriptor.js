'use strict';

function wait(reason, detail = '') { return { ok: false, kind: 'wait', reason, detail }; }
function unsupported(detail) { return { ok: false, kind: 'unsupported', reason: 'unsupported', detail }; }

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeItem(file, fileIndex, fallback = {}) {
  const cid = file && file.cid != null ? String(file.cid) : '';
  const gcid = file && file.gcid != null ? String(file.gcid) : '';
  const name = file && file.fileName != null ? String(file.fileName) : String(fallback.fileName || '');
  const size = numberOrZero(file && file.fileSize != null ? file.fileSize : fallback.fileSize);
  if (!cid || !gcid || !name || size < 0) return null;
  return { fileIndex: Number(fileIndex), url: fallback.url || '', name, size, cid, gcid, traceId: '' };
}

function buildP2sp(record, snapshot) {
  if (!snapshot || !snapshot.cid || !snapshot.gcid || numberOrZero(snapshot.resourceSize) <= 0) return wait('waiting-metadata');
  const item = normalizeItem({ cid: snapshot.cid, gcid: snapshot.gcid, fileName: snapshot.name || record.taskName,
    fileSize: snapshot.resourceSize }, -1, { url: snapshot.url || record.url, fileName: snapshot.name || record.taskName, fileSize: snapshot.resourceSize });
  return item ? { ok: true, protocol: 'p2sp', infohash: '', btTitle: '', items: [item] } : wait('waiting-metadata');
}

function buildEd2k(record, snapshot) {
  if (!snapshot || !snapshot.cid || !snapshot.gcid || numberOrZero(snapshot.resourceSize) <= 0) return wait('waiting-metadata');
  const item = normalizeItem({ cid: snapshot.cid, gcid: snapshot.gcid, fileName: snapshot.name || record.taskName,
    fileSize: snapshot.resourceSize }, -1, { url: snapshot.url || record.url, fileName: snapshot.name || record.taskName, fileSize: snapshot.resourceSize });
  return item ? { ok: true, protocol: 'ed2k', infohash: '', btTitle: '', items: [item] } : wait('waiting-metadata');
}

function buildBt(record, snapshot, { allowBtRootFallback = false } = {}) {
  if (record.taskType === 'magnet' && record.metadataPhase === 'fetching') return wait('metadata-fetching');
  const infohash = String(record.infoId || record.infoHash || '');
  if (!infohash) return wait('waiting-metadata');
  const listed = Array.isArray(record.fileLists) ? record.fileLists : [];
  const selected = Array.isArray(record.selectedFileIndices) && record.selectedFileIndices.length
    ? [...new Set(record.selectedFileIndices.map(Number).filter((n) => Number.isSafeInteger(n) && n >= 0))].sort((a, b) => a - b)
    : listed.map((f) => Number(f.realIndex)).filter((n) => Number.isSafeInteger(n) && n >= 0);
  if (!selected.length) return wait('waiting-metadata');
  const btFiles = new Map((snapshot && Array.isArray(snapshot.btFiles) ? snapshot.btFiles : []).map((f) => [Number(f.fileIndex), f]));
  const items = [];
  let waitingReason = 'waiting-bt-file';
  for (const index of selected) {
    const listedFile = listed.find((f) => Number(f.realIndex) === index) || {};
    const row = btFiles.get(index);
    let item = row && Number(row.download) !== 0
      ? normalizeItem(row, index, listedFile)
      : null;
    if (!item && allowBtRootFallback && selected.length === 1 && selected[0] === index && !row && snapshot && snapshot.cid && snapshot.gcid)
      item = normalizeItem({ cid: snapshot.cid, gcid: snapshot.gcid, fileName: listedFile.fileName || snapshot.name || record.taskName,
        fileSize: listedFile.fileSize || snapshot.resourceSize }, index, listedFile);
    if (!item) {
      if (row) waitingReason = 'waiting-bt-file-metadata';
      continue;
    }
    item.url = `bt://${infohash}/${index}`;
    items.push(item);
  }
  if (!items.length) return wait(waitingReason);
  return { ok: true, protocol: 'bt', infohash, btTitle: record.taskName || (snapshot && snapshot.name) || '', items };
}

function buildVipDescriptor(record, snapshot, options = {}) {
  if (!record || !snapshot) return wait('waiting-metadata');
  if (record.taskType === 'http' || record.taskType === 'https' || record.taskType === 'ftp') return buildP2sp(record, snapshot);
  if (record.taskType === 'ed2k') return buildEd2k(record, snapshot);
  if (record.taskType === 'bt' || record.taskType === 'magnet') return buildBt(record, snapshot, options);
  return unsupported('task type is not covered');
}

module.exports = { buildVipDescriptor, buildP2sp, buildEd2k, buildBt, normalizeItem, wait, unsupported };
