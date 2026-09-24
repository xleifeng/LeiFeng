'use strict';

// AssistantTools.dll may decode UTF-8 torrent fields as Windows-1252 before
// returning UTF-16 through XL_ParseTorrentFileW. dk_addon.node then correctly
// encodes that UTF-16 as UTF-8, so repair the reversible SDK mistake once at
// the native adapter boundary instead of parsing torrent metadata in services.
const CP1252_REVERSE = new Map([
  ['\u20ac', 0x80], ['\u201a', 0x82], ['\u0192', 0x83], ['\u201e', 0x84],
  ['\u2026', 0x85], ['\u2020', 0x86], ['\u2021', 0x87], ['\u02c6', 0x88],
  ['\u2030', 0x89], ['\u0160', 0x8a], ['\u2039', 0x8b], ['\u0152', 0x8c],
  ['\u017d', 0x8e], ['\u2018', 0x91], ['\u2019', 0x92], ['\u201c', 0x93],
  ['\u201d', 0x94], ['\u2022', 0x95], ['\u2013', 0x96], ['\u2014', 0x97],
  ['\u02dc', 0x98], ['\u2122', 0x99], ['\u0161', 0x9a], ['\u203a', 0x9b],
  ['\u0153', 0x9c], ['\u017e', 0x9e], ['\u0178', 0x9f],
]);

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const nonLatinScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}]/u;
const mojibakeLead = /[\u00c2-\u00ef\u0160\u0161\u017d\u017e\u0192\u02c6\u02dc\u2013-\u2026\u2030\u2039\u203a\u2122]/u;

function windows1252Bytes(value) {
  const bytes = [];
  for (const character of value) {
    if (CP1252_REVERSE.has(character)) bytes.push(CP1252_REVERSE.get(character));
    else {
      const codePoint = character.codePointAt(0);
      if (codePoint > 0xff) return null;
      bytes.push(codePoint);
    }
  }
  return Buffer.from(bytes);
}

function repairTorrentSdkText(value) {
  if (typeof value !== 'string' || !value || !mojibakeLead.test(value)) return value;
  const bytes = windows1252Bytes(value);
  if (!bytes) return value;
  let repaired;
  try { repaired = utf8Decoder.decode(bytes); } catch { return value; }
  if (!repaired || repaired === value) return value;

  // The affected SDK output loses all original non-Latin script characters.
  // Requiring their recovery avoids rewriting legitimate Western filenames.
  return nonLatinScript.test(repaired) && !nonLatinScript.test(value) ? repaired : value;
}

function repairTorrentSdkResult(value) {
  if (!value || typeof value !== 'object') return value;
  return {
    ...value,
    title: repairTorrentSdkText(value.title),
    fileLists: Array.isArray(value.fileLists) ? value.fileLists.map((file) => ({
      ...file,
      fileName: repairTorrentSdkText(file && file.fileName),
      filePath: repairTorrentSdkText(file && file.filePath),
    })) : value.fileLists,
  };
}

module.exports = { repairTorrentSdkText, repairTorrentSdkResult };
