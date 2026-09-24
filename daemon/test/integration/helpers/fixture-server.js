'use strict';
const http = require('http');
const crypto = require('crypto');

// path：URL basename（引擎按 URL basename 落盘、忽略 taskName——Task 0 RESULTS.md 实测；
// 各链路传不同 path 使落盘名与 out 对齐，避免跨链路 fixture.bin 冲突）。默认 fixture.bin。
function startFixture({ bytes, throttleChunk = 0, throttleMs = 0, path: urlPath = 'fixture.bin', hang = false }) {
  const data = crypto.randomBytes(bytes);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/notfound') { res.writeHead(404); return res.end('nope'); }
    if (u === '/redirect') { res.writeHead(302, { location: '/' + urlPath }); return res.end(); }
    if (u === '/nohead' && req.method === 'HEAD') { res.writeHead(405); return res.end(); }
    // 放行所有 .bin 路径（引擎按 URL basename 落盘，须与各链路 out/taskName 对齐——Task 0 授权模式）
    if (u !== '/nohead' && !/^\/[a-z0-9]+\.bin$/.test(u)) { res.writeHead(404); return res.end(); }
    let start = 0, end = data.length - 1;
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (m) {
      start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end);
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${data.length}`, 'content-length': end - start + 1 });
    } else {
      res.writeHead(200, { 'content-length': data.length });
    }
    if (req.method === 'HEAD') return res.end();
    if (hang) return; // 发了 content-length 但不发 body：任务永久 active（kill/chain4 用）
    if (!throttleChunk) return res.end(data.subarray(start, end + 1));
    let off = start;
    const timer = setInterval(() => {
      if (off > end) { clearInterval(timer); return res.end(); }
      const stop = Math.min(off + throttleChunk - 1, end);
      res.write(data.subarray(off, stop + 1));
      off = stop + 1;
    }, throttleMs);
    req.on('close', () => clearInterval(timer));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () =>
    resolve({ server, sha, size: data.length, url: `http://127.0.0.1:${server.address().port}/${urlPath}` })));
}

async function rpc(port, method, params) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/jsonrpc', method: 'POST' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const msg = JSON.parse(body);
        msg.error ? reject(Object.assign(new Error(msg.error.message), { code: msg.error.code })) : resolve(msg.result);
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}

module.exports = { startFixture, rpc };
