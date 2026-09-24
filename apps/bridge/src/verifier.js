// verifier.js — 种子会话的 piece 校验引擎。
// P1：全量 recheck（tlei 完成后一次跑完）；P2 预留游标式增量（verifyUpTo）。
// 铁律：sha1 不通过的 piece 永不标记 verified —— 防污染 swarm 的唯一闸门。

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 迅雷 Wine 引擎以 CP1252 码页写盘，中文文件名呈 UTF-8→CP1252 双层 mojibake。
// 修复：优先按磁盘原名直取；失败则尝试 mojibake 修复名（encode('cp1252').decode('utf-8')）。
function resolveOnDisk(rootDir, relPath) {
  const direct = path.join(rootDir, relPath);
  if (fs.existsSync(direct)) return direct;
  // 迅雷下载中文件为 <name>.bt.xltd（稀疏，数据布局与正主一致）——作为候补可读
  const xltd = direct + '.bt.xltd';
  if (fs.existsSync(xltd)) return xltd;
  const parts = relPath.split('/');
  let cur = rootDir;
  for (const part of parts) {
    const directChild = path.join(cur, part);
    if (fs.existsSync(directChild)) { cur = directChild; continue; }
    // 磁盘名是「种子名 utf8 字节被当 cp1252 读」的 mojibake；
    // 反向匹配：对磁盘候选名 repairCp1252（cp1252 编回字节 → utf-8 解），与种子名比对。
    const siblings = fs.existsSync(cur) && fs.statSync(cur).isDirectory() ? fs.readdirSync(cur) : [];
    let matched = null;
    for (const sib of siblings) {
      if (repairCp1252(sib) === part) { matched = sib; break; }
      // mojibake + xltd 后缀候补
      if (repairCp1252(sib) === part + '.bt.xltd') { matched = sib; break; }
    }
    if (matched === null) return null; // 未找到
    cur = path.join(cur, matched);
  }
  return cur;
}

// JS 字符串 → cp1252 字节 → utf-8 解码。含不可映射字符（不在 cp1252 表内）时返回 null。
function repairCp1252(name) {
  const bytes = [];
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code < 0x100) bytes.push(code);
    else {
      const b = CP1252_REVERSE.get(ch);
      if (b === undefined) return null;
      bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString('utf-8');
}

// CP1252 高位字符（0x80-0x9F）→ Unicode 反查表
const CP1252_REVERSE = new Map();
{
  const table = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
    0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D,
    0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
  };
  for (const [byte, code] of Object.entries(table)) CP1252_REVERSE.set(String.fromCodePoint(code), Number(byte));
}

// 从多文件布局按逻辑偏移读字节（跨文件拼接）。
// files: [{ path, length, offset }]（parse-torrent 结构，offset 为 torrent 内逻辑偏移）
class PieceReader {
  // fd 缓存上限：大种子（数千文件）不能无限持有 fd（ulimit -n 保护）。
  static FD_LIMIT = 64;

  constructor({ rootDir, files, length }) {
    this.rootDir = rootDir;          // 种子数据根目录（含 <name> 或直接文件）
    this.files = files;              // 有序 by offset
    this.totalLength = length;
    this._fds = new Map();           // path -> fd（LRU，懒开，共享读）
  }

  _fd(file) {
    let fd = this._fds.get(file.path);
    if (fd !== undefined) {
      // LRU touch
      this._fds.delete(file.path);
      this._fds.set(file.path, fd);
      return fd;
    }
    const abs = resolveOnDisk(this.rootDir, file.path);
    if (abs === null) {
      const error = new Error(`文件不在磁盘上: ${file.path}`);
      error.code = 'FILE_NOT_FOUND';
      throw error;
    }
    fd = fs.openSync(abs, 'r');    // 只读；文件不存在会 throw，由调用方降级
    this._fds.set(file.path, fd);
    // 超限逐出最旧（关闭其 fd）。引擎把 .bt.xltd 改名/删旧写新时，
    // 缓存里陈旧 fd 也会被此路径自然轮换，读到旧 inode 的问题随之有界。
    while (this._fds.size > PieceReader.FD_LIMIT) {
      const oldest = this._fds.keys().next().value;
      const oldFd = this._fds.get(oldest);
      this._fds.delete(oldest);
      try { fs.closeSync(oldFd); } catch {}
    }
    return fd;
  }

  // 数据源陈化自愈：引擎把 xltd 改名正主/搬目录后，缓存的 fd 与 absPath 失效。
  // 调用方在读失败/校验异常时调用，丢弃缓存下次重解析。
  invalidate(file) {
    const fd = this._fds.get(file.path);
    if (fd !== undefined) {
      this._fds.delete(file.path);
      try { fs.closeSync(fd); } catch {}
    }
  }

  // 读逻辑区间 [start, end)（end 不含），返回 Buffer；越界部分以 0 填充（稀疏未写区语义）
  readLogical(start, end) {
    const out = Buffer.alloc(end - start);
    for (const file of this.files) {
      const fStart = file.offset;
      const fEnd = file.offset + file.length;
      if (fEnd <= start) continue;
      if (fStart >= end) break;
      const clipStart = Math.max(fStart, start);
      const clipEnd = Math.min(fEnd, end);
      try {
        const fd = this._fd(file);
        const buf = Buffer.alloc(clipEnd - clipStart);
        let got = 0;
        while (got < buf.length) {
          const n = fs.readSync(fd, buf, got, buf.length - got, clipStart - fStart + got);
          if (n <= 0) break;
          got += n;
        }
        buf.copy(out, clipStart - start);
      } catch {
        // 文件缺失/短读：保持 0 填充（校验自然 fail，安全）
      }
    }
    return out;
  }

  // 逻辑区间 [start,end) 覆盖的文件是否都已落盘（含 .bt.xltd 边车形态）。
  // 按需验证前置闸：数据还没写盘就不必白读白哈希。
  hasAllFilesForRange(start, end) {
    for (const file of this.files) {
      const fStart = file.offset;
      const fEnd = file.offset + file.length;
      if (fEnd <= start || fStart >= end || file.length === 0) continue;
      if (resolveOnDisk(this.rootDir, file.path) === null) return false;
    }
    return true;
  }

  close() {
    for (const fd of this._fds.values()) { try { fs.closeSync(fd); } catch {} }
    this._fds.clear();
  }
}

class Verifier {
  // parsed: parse-torrent 产物；rootDir: 数据根目录
  constructor({ parsed, rootDir }) {
    this.pieceLength = parsed.pieceLength;
    this.pieces = parsed.pieces;              // Buffer[]（每片 20 字节 sha1）
    this.pieceCount = parsed.pieces.length;
    this.reader = new PieceReader({ rootDir, files: parsed.files, length: parsed.length });
    this.verified = new Uint8Array(this.pieceCount); // 0/1
    this.verifiedCount = 0;
    this.lastErrorPiece = -1;
  }

  // 校验单个 piece（稀疏零块读出来 sha1 必然 fail，无污染风险）
  // 注：parse-torrent 的 pieces 是 40 字符 hex 字符串数组；测试夹具可能传 Buffer，两者兼容。
  verifyPiece(index) {
    if (index < 0 || index >= this.pieceCount) return false;
    if (this.verified[index]) return true;
    const start = index * this.pieceLength;
    const end = Math.min(start + this.pieceLength, this.reader.totalLength);
    const buf = this.reader.readLogical(start, end);
    const hash = crypto.createHash('sha1').update(buf).digest();
    const expected = this.pieces[index];
    const match = typeof expected === 'string'
      ? hash.toString('hex') === expected.toLowerCase()
      : hash.equals(expected);
    if (match) {
      this.verified[index] = 1;
      this.verifiedCount += 1;
      return true;
    }
    this.lastErrorPiece = index;
    return false;
  }

  // 按需验证：区间 [startByte,endByte) 覆盖的所有 piece 就地验证。
  // returns { ok, reason }：
  //   ok                — 全部 piece 已验证（含本轮新过），可放行 206
  //   'not-on-disk'     — 覆盖文件尚未落盘（含边车形态探测），不必白读
  //   'hash-mismatch'   — 有 piece 数据在盘但 sha1 不过（未完成的稀疏块）
  verifyRange(startByte, endByte) {
    if (endByte <= startByte) return { ok: false, reason: 'empty' };
    const first = Math.floor(startByte / this.pieceLength);
    const last = Math.floor((endByte - 1) / this.pieceLength);
    if (!this.reader.hasAllFilesForRange(startByte, endByte)) return { ok: false, reason: 'not-on-disk' };
    for (let p = first; p <= last; p++) {
      if (this.verified[p]) continue;
      if (!this.verifyPiece(p)) return { ok: false, reason: 'hash-mismatch', piece: p };
    }
    return { ok: true };
  }

  // 全量校验（P1 主路径）。onProgress(verifiedCount, pieceCount) 可选。
  verifyAll({ onProgress } = {}) {
    let i = 0;
    for (; i < this.pieceCount; i++) {
      this.verifyPiece(i);
      if (onProgress && (i % 100 === 0 || i === this.pieceCount - 1)) {
        try { onProgress(this.verifiedCount, this.pieceCount); } catch {}
      }
    }
    return { verified: this.verifiedCount, total: this.pieceCount };
  }

  // 区间 [startByte, endByte) 是否完全落在已验证 piece 内（供 HTTP 206 门控）
  isRangeVerified(startByte, endByte) {
    if (endByte <= startByte) return false;
    const first = Math.floor(startByte / this.pieceLength);
    const last = Math.floor((endByte - 1) / this.pieceLength);
    for (let p = first; p <= last; p++) {
      if (!this.verified[p]) return false;
    }
    return true;
  }

  // 已验证字节区间的总长（粗略进度视图）
  verifiedBytes() {
    let bytes = 0;
    for (let i = 0; i < this.pieceCount; i++) {
      if (this.verified[i]) {
        const start = i * this.pieceLength;
        const end = Math.min(start + this.pieceLength, this.reader.totalLength);
        bytes += end - start;
      }
    }
    return bytes;
  }

  close() { this.reader.close(); }
}

module.exports = { Verifier, PieceReader, resolveOnDisk, repairCp1252 };
