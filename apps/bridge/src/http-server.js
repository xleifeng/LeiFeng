// http-server.js — BEP-19 语义的 web seed HTTP 服务。
// GET /seeds/<infohash>/ 尾斜杠（qbit 自动拼 name[/path/file]）
//
// 契约（按 libtorrent web_peer_connection 实测行为定死，2026-09-23 产品化评审）：
//   1. 206 的 content-range 必须逐字节等于请求区间——子区间应答触发 invalid_range 断连。
//      因此覆盖区间按需验证（verifyRange），过则整段放行，不过则 503，绝不回子段。
//   2. 无 Range（或多区间 bytes=a-b,c-d）：忽略 Range 语义，整文件已验证 → 200，否则 503。
//   3. 503 + Retry-After：客户端按退避重连（soak 实测 qbit 5.1.4 多文件场景持续重试）。

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { resolveOnDisk } = require('./verifier');

const RETRY_AFTER_SEC = 15;

function createServer({ sessions, inputResults = [], port = 7127, host = '127.0.0.1', logger = () => {} } = {}) {
  // sessions: Map<infohash, { verifier, parsed, rootDir, fileMap }>
  // fileMap: Map<urlPath（name[/path/file]）, { file（parse-torrent file 对象）, physPath }>

  const server = http.createServer((req, res) => {
    try { handle(req, res); } catch (error) {
      logger(`[http] handler error: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('internal error');
      } else res.destroy();
    }
  });

  function notVerified(res, infohash, rel, why) {
    res.writeHead(503, { 'retry-after': String(RETRY_AFTER_SEC), 'content-type': 'text/plain' });
    res.end(why || 'requested range not verified yet');
    logger(`[http] 503 ${infohash.slice(0, 8)} ${rel} (${why || 'not verified'})`);
  }

  function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400); res.end('bad request'); return;
    }
    if (url.pathname === '/status') return status(res);

    const m = /^\/seeds\/([a-f0-9]{40})\/(.*)$/.exec(url.pathname);
    if (!m) { res.writeHead(404); res.end('not found'); return; }
    const infohash = m[1];
    let rel;
    try {
      rel = decodeURIComponent(m[2]);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' }); res.end('bad percent-encoding'); return;
    }
    const session = sessions.get(infohash);
    if (!session) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('unknown infohash'); return; }

    const entry = session.fileMap.get(rel);
    // fileMap 精确匹配是唯一放行路径；rel 不参与任何路径拼接，无穿越面。
    if (!entry) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('path not in torrent'); return; }

    if (req.method === 'HEAD') {
      // 只回头不回体（BEP-19 客户端不发 HEAD，此为诊断友好）
      const ok = session.verifier.isRangeVerified(entry.file.offset, entry.file.offset + entry.file.length);
      res.writeHead(ok ? 200 : 503, ok
        ? { 'content-length': String(entry.file.length), 'accept-ranges': 'bytes' }
        : { 'retry-after': String(RETRY_AFTER_SEC) });
      res.end();
      return;
    }

    const fileSize = entry.file.length;
    const rangeHeader = req.headers.range;

    // Range 解析：仅单区间（libtorrent 恒发单区间）；多区间/畸形 → 忽略 Range 按 200 语义（RFC 9110：无效 Range 头当不存在）。
    let range = null;
    if (rangeHeader) {
      const rm = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (rm && !(rm[1] === '' && rm[2] === '')) {
        let start; let end;
        if (rm[1] === '') { // suffix range: bytes=-N
          const n = Number(rm[2]);
          start = Math.max(0, fileSize - n); end = fileSize - 1;
        } else {
          start = Number(rm[1]); end = rm[2] === '' ? fileSize - 1 : Math.min(Number(rm[2]), fileSize - 1);
        }
        if (start <= end && start < fileSize) range = { start, end };
        else { res.writeHead(416, { 'content-range': `bytes */${fileSize}` }); res.end(); return; }
      }
    }

    if (!range) {
      // 无 Range / 多区间：整文件语义——全部 piece 已验证才 200
      const vr = session.verifier.verifyRange(entry.file.offset, entry.file.offset + fileSize);
      if (!vr.ok) return notVerified(res, infohash, rel, vr.reason === 'not-on-disk' ? 'file not on disk yet' : 'file not fully verified yet');
      return streamFile(res, session, entry, entry.file.offset, entry.file.offset + fileSize, fileSize, 200, 0, fileSize);
    }

    // 单区间：按需验证覆盖 pieces → 过则 206 精确等于请求区间
    const logStart = entry.file.offset + range.start;
    const logEnd = entry.file.offset + range.end + 1; // 不含
    const vr = session.verifier.verifyRange(logStart, logEnd);
    if (!vr.ok) return notVerified(res, infohash, `${rel} bytes=${range.start}-${range.end}`, vr.reason === 'not-on-disk' ? 'data not on disk yet' : 'range not verified yet');
    streamFile(res, session, entry, logStart, logEnd, fileSize, 206, range.start, range.end + 1);
  }

  function streamFile(res, session, entry, logStart, logEnd, fileSize, code, fStart, fEnd) {
    const headers = {
      'content-type': 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    };
    if (code === 206) {
      headers['content-range'] = `bytes ${fStart}-${fEnd - 1}/${fileSize}`; // 逐字节等于请求区间（契约 1）
      headers['content-length'] = String(fEnd - fStart);
      res.writeHead(206, headers);
    } else {
      headers['content-length'] = String(fileSize);
      res.writeHead(200, headers);
    }
    // absPath 惰性解析：引擎把 .bt.xltd 改名正主后固化路径会 ENOENT，此处每次现解。
    const abs = resolveOnDisk(session.rootDir, entry.physPath) || path.join(session.rootDir, entry.physPath);
    const stream = fs.createReadStream(abs, code === 206 ? { start: fStart, end: fEnd - 1 } : {});
    // 客户端断开（libtorrent 取消请求常见）：销毁源流防 fd 挂到 GC
    res.on('close', () => stream.destroy());
    stream.on('error', (err) => { logger(`[http] stream error ${session.parsed.infoHash.slice(0, 8)} ${entry.file.path}: ${err.message}`); res.destroy(); });
    stream.pipe(res);
    logger(`[http] ${code} ${session.parsed.infoHash.slice(0, 8)} ${entry.file.path}${code === 206 ? ` bytes=${fStart}-${fEnd - 1}` : ''}`);
  }

  function status(res) {
    const out = {};
    for (const [ih, s] of sessions) {
      out[ih] = {
        name: s.parsed.name,
        rootDir: s.rootDir,
        verifiedPieces: s.verifier.verifiedCount,
        totalPieces: s.verifier.pieceCount,
        verifiedBytes: s.verifier.verifiedBytes(),
      };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    out.inputs = inputResults;
    res.end(JSON.stringify(out, null, 2));
  }

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port, host }));
  });
}

module.exports = { createServer };
