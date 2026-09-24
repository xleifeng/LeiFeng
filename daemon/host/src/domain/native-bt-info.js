'use strict';

function normalizeIndices(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((item) => Number.isSafeInteger(item) && item >= 0))].sort((a, b) => a - b);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeBtFileLists(value) {
  if (!Array.isArray(value)) return [];
  return value.map((file, position) => {
    const source = file && typeof file === 'object' ? file : {};
    const realIndex = Number(source.realIndex ?? source.index);
    return {
      ...source,
      fileSize: numberOrZero(source.fileSize ?? source.sizeBytes ?? source.size),
      realIndex: Number.isSafeInteger(realIndex) && realIndex >= 0 ? realIndex : position,
      fileOffset: numberOrZero(source.fileOffset ?? source.offsetBytes ?? source.offset),
      fileName: String(source.fileName ?? source.displayName ?? source.name ?? ''),
      filePath: String(source.filePath ?? source.relativePath ?? source.path ?? ''),
    };
  });
}

function trackerString(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).join(',');
  return typeof value === 'string' ? value : '';
}

function sdkBtScheduler(value) {
  return value === 'sequential' || Number(value) === 2 ? 2 : 1;
}

// The SDK accepts a deceptively small BT object and will even download with
// it, but without the parsed file tree it does not populate BtFile/live file
// metadata. VIP acceleration needs those rows for per-file CID/GCID values.
function buildNativeBtInfo({ infoId, seedFile, selectedFileIndices, fileLists, displayName, trackerUrls,
  origin = '', scheduler = 'normal', autoRenameWhenRepeat = false, taskNameModify = false } = {}) {
  const normalizedInfoId = String(infoId || '');
  const suppliedOrigin = String(origin || '');
  const normalizedOrigin = /^magnet:\?/i.test(suppliedOrigin)
    ? suppliedOrigin
    : normalizedInfoId ? `magnet:?xt=urn:btih:${normalizedInfoId}` : '';
  return {
    origin: normalizedOrigin,
    seedFile: String(seedFile || ''),
    displayName: String(displayName || ''),
    fileRealIndexLists: normalizeIndices(selectedFileIndices),
    fileLists: normalizeBtFileLists(fileLists),
    infoId: normalizedInfoId,
    tracker: trackerString(trackerUrls),
    subFileScheduler: sdkBtScheduler(scheduler),
    autoRenameWhenRepeat: autoRenameWhenRepeat === true,
    taskNameModify: taskNameModify === true,
  };
}

module.exports = { buildNativeBtInfo, normalizeBtFileLists, sdkBtScheduler };
