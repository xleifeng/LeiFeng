'use strict';

const crypto = require('crypto');

function problem(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

function base32ToHex(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let buffer = 0; let output = '';
  for (const char of String(value || '').toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw problem('INVALID_MAGNET', 'magnet infoHash 无效');
    buffer = (buffer << 5) | index; bits += 5;
    if (bits >= 8) { bits -= 8; output += String.fromCharCode((buffer >> bits) & 0xff); }
  }
  if (output.length !== 20) throw problem('INVALID_MAGNET', 'magnet infoHash 长度无效');
  return Buffer.from(output, 'binary').toString('hex');
}

function normalizeHttpUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw problem('INVALID_URL', '链接 URL 无效'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw problem('UNSUPPORTED_PROTOCOL', '仅支持 HTTP/HTTPS 链接');
  url.hash = '';
  return url.toString();
}

function parseFtp(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw problem('INVALID_FTP', 'FTP 链接无效'); }
  if (url.protocol !== 'ftp:') throw problem('INVALID_FTP', 'FTP 链接协议无效');
  const username = decodeFilename(url.username);
  const password = decodeFilename(url.password);
  url.username = '';
  url.password = '';
  url.hash = '';
  const basename = decodeFilename(url.pathname.split('/').filter(Boolean).pop() || '') || 'download.bin';
  return {
    kind: 'ftp', normalizedSource: url.toString(), displayName: basename, totalBytes: null, files: [],
    ftpAuth: username || password ? { username, password } : null,
  };
}

function decodeFilename(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); }
}

/**
 * Normalize a pasted BitTorrent v1 info hash to its hexadecimal form.
 *
 * A hash by itself is not a torrent file, so it must enter the native
 * metadata path as a magnet/BTIH source.  Accept both forms commonly copied
 * from clients: 40 hexadecimal characters and 32-character Base32.  The
 * optional `btih:`/`urn:btih:` prefix is accepted as well.
 */
function normalizeTorrentHash(value) {
  const candidate = String(value || '').trim().replace(/^(?:urn:)?btih:/i, '');
  if (/^[a-f0-9]{40}$/i.test(candidate)) return candidate.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(candidate)) return base32ToHex(candidate);
  return null;
}

function looksLikeTorrentHash(value) {
  const candidate = String(value || '').trim().replace(/^(?:urn:)?btih:/i, '');
  return /^[A-Za-z0-9]{32}$/.test(candidate) || /^[A-Za-z0-9]{40}$/.test(candidate);
}

function parseTorrentHash(value) {
  const infoHash = normalizeTorrentHash(value);
  if (!infoHash) throw problem('INVALID_TORRENT_HASH', '种子 hash 必须是 40 位十六进制或 32 位 Base32');
  return {
    kind: 'magnet',
    normalizedSource: `magnet:?xt=urn:btih:${infoHash}`,
    displayName: `${infoHash}.torrent`,
    totalBytes: null,
    infoHash,
    files: [],
  };
}

function parseEd2k(value) {
  const match = String(value).match(/^ed2k:\/\/\|file\|([^|]*)\|(\d+)\|([a-f0-9]{32})\|/i);
  if (!match) throw problem('INVALID_ED2K', 'eD2k 链接格式无效');
  return { kind: 'ed2k', normalizedSource: String(value), displayName: decodeFilename(match[1]) || 'ed2k-file', totalBytes: Number(match[2]), infoHash: match[3].toLowerCase(), files: [] };
}

function parseMagnet(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw problem('INVALID_MAGNET', '磁力链接无效'); }
  if (url.protocol !== 'magnet:') throw problem('INVALID_MAGNET', '磁力链接协议无效');
  const xt = url.searchParams.getAll('xt').find((item) => /^urn:btih:/i.test(item));
  if (!xt) throw problem('INVALID_MAGNET', '磁力链接缺少 btih');
  const raw = xt.slice(9);
  const infoHash = /^[a-f0-9]{40}$/i.test(raw) ? raw.toLowerCase() : base32ToHex(raw);
  const displayName = url.searchParams.get('dn') ? decodeFilename(url.searchParams.get('dn')) : `${infoHash}.torrent`;
  return { kind: 'magnet', normalizedSource: url.toString(), displayName: displayName || `${infoHash}.torrent`, totalBytes: null, infoHash, files: [] };
}

class ProtocolParser {
  constructor({ driver = null } = {}) { this.driver = driver; }

  async parseNativeTorrentHash(value) {
    if (!this.driver || typeof this.driver.normalizeTorrentHash !== 'function' || !looksLikeTorrentHash(value)) return null;
    if (typeof this.driver.isHealthy === 'function' && !this.driver.isHealthy()) return null;
    try {
      const native = await this.driver.normalizeTorrentHash(value);
      if (!native || native.accepted !== true || typeof native.normalizedSource !== 'string') return null;
      const infoHash = String(native.infoHash || normalizeTorrentHash(value) || String(value).trim().replace(/^(?:urn:)?btih:/i, ''));
      return {
        kind: 'magnet',
        normalizedSource: native.normalizedSource,
        displayName: String(native.displayName || `${infoHash}.torrent`),
        totalBytes: null,
        infoHash,
        files: [],
      };
    } catch { return null; }
  }

  async parseInput(raw, context = {}) {
    if (typeof raw !== 'string' || !raw.trim()) throw problem('INVALID_ARGUMENT', '链接不能为空');
    const value = raw.trim();
    if (Buffer.byteLength(value, 'utf8') > 1024 * 1024) throw problem('INVALID_ARGUMENT', '链接长度不能超过 1 MiB');
    if (/^magnet:/i.test(value)) return parseMagnet(value);
    if (/^ed2k:/i.test(value)) {
      const parsed = parseEd2k(value);
      if (this.driver && typeof this.driver.parseTaskInfo === 'function') {
        try {
          const native = await this.driver.parseTaskInfo({ kind: 'ed2k', data: value });
          if (native && typeof native === 'object') {
            parsed.displayName = native.fileName || native.displayName || parsed.displayName;
            parsed.totalBytes = Number(native.fileSize || native.totalBytes || parsed.totalBytes) || parsed.totalBytes;
            parsed.infoHash = String(native.fileHash || native.infoHash || parsed.infoHash).toLowerCase();
          }
        } catch (error) {
          throw problem('INVALID_ED2K', error.message || 'eD2k 链接无法解析');
        }
      }
      return parsed;
    }
    if (/^thunder:\/\//i.test(value)) return this.resolveThunder(value, Number(context.depth) || 0, context.seen || new Set());
    if (/^ftp:\/\//i.test(value)) return parseFtp(value);
    if (/^https?:\/\//i.test(value)) {
      const normalizedSource = normalizeHttpUrl(value);
      const parsed = new URL(normalizedSource);
      const basename = decodeFilename(parsed.pathname.split('/').filter(Boolean).pop() || '') || 'download.bin';
      return { kind: parsed.protocol === 'https:' ? 'https' : 'http', normalizedSource, displayName: basename, totalBytes: null, files: [] };
    }
    // Match the stock Electron client first: thunder_helper.node validates the
    // bare code, NativeDkHelper classifies the generated BTIH magnet, and the
    // normal native metadata flow handles the actual download.
    const nativeHash = await this.parseNativeTorrentHash(value);
    if (nativeHash) return nativeHash;
    // Environments without thunder_helper.node still accept standard v1 hash
    // forms through this deterministic compatibility fallback.
    if (normalizeTorrentHash(value)) return parseTorrentHash(value);
    throw problem('UNSUPPORTED_PROTOCOL', '不支持的下载协议');
  }

  async resolveThunder(value, depth = 0, seen = new Set()) {
    if (depth >= 3) throw problem('THUNDER_REDIRECT_LOOP', 'thunder 链接解析层级过深');
    const fingerprint = crypto.createHash('sha256').update(String(value)).digest('hex');
    if (seen.has(fingerprint)) throw problem('THUNDER_REDIRECT_LOOP', 'thunder 链接存在循环');
    seen.add(fingerprint);
    if (!this.driver || typeof this.driver.resolveThunderUrl !== 'function') throw problem('NATIVE_UNAVAILABLE', '当前 daemon 不具备 thunder 链接解析能力');
    const resolved = await this.driver.resolveThunderUrl(value);
    if (!resolved || !resolved.resolvedUrl) throw problem('INVALID_THUNDER', 'thunder 链接无法解析');
    const parsed = await this.parseInput(resolved.resolvedUrl, { depth: depth + 1, seen });
    return { ...parsed, originalSource: value, thunderResolvedSource: parsed.normalizedSource };
  }

  fingerprint(parsed) {
    const identity = parsed.infoHash || parsed.infoId || parsed.normalizedSource || parsed.originalSource || '';
    return crypto.createHash('sha256').update(`${parsed.kind}\0${identity}`).digest('hex');
  }
}

module.exports = { ProtocolParser, normalizeHttpUrl, parseFtp, parseEd2k, parseMagnet, parseTorrentHash, normalizeTorrentHash, base32ToHex };
