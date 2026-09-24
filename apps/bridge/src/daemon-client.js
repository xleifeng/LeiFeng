// daemon-client.js — 桥侧 daemon 客户端：JSON-RPC（thunder.ui.v2.*）+ .torrent 导出。
'use strict';

const http = require('http');

function createDaemonClient({ port = 16800, host = '127.0.0.1', timeoutMs = 10000, bearerToken = '', csrfToken = '', origin = '', nonce = '' } = {}) {
  const authHeaders = () => ({
    ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
    ...(csrfToken ? { 'x-thunder-csrf': csrfToken } : {}),
    ...(origin ? { origin } : {}),
    ...(nonce ? { 'x-thunder-nonce': nonce } : {}),
  });
  async function rpc(method, params = []) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const res = await request({ path: '/jsonrpc', method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body });
    const payload = JSON.parse(res.body || 'null');
    if (!payload || payload.error) {
      const err = new Error((payload && payload.error && payload.error.message) || `RPC ${method} 失败`);
      err.code = payload && payload.error && payload.error.code;
      throw err;
    }
    return payload.result;
  }

  function request({ path, method, headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host, port, path, method, headers, timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  // 导出任务种子（web-api task-export 路由，返回 Buffer）
  async function exportTorrent(taskId) {
    const res = await request({ path: `/api/v2/tasks/${encodeURIComponent(taskId)}/torrent`, headers: authHeaders() });
    if (res.status !== 200) {
      const err = new Error(`种子导出失败 HTTP ${res.status}`);
      err.code = 'TORRENT_EXPORT_FAILED';
      throw err;
    }
    return res.body;
  }

  async function uploadTorrent(buffer, { filename = 'upload.torrent' } = {}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError('torrent upload requires nonempty Buffer');
    const safeName = String(filename).split(/[\\/]/).pop();
    const res = await request({ path: '/api/v2/create-drafts/torrent', method: 'POST', body: buffer,
      headers: { ...authHeaders(), 'content-type': 'application/x-bittorrent', 'content-length': String(buffer.length), 'x-thunder-filename': encodeURIComponent(safeName) } });
    let payload;
    try { payload = JSON.parse(res.body.toString('utf8')); } catch { payload = null; }
    if (res.status !== 201 || !payload?.draft) {
      const error = new Error(payload?.error?.message || `torrent 上传失败 HTTP ${res.status}`);
      error.code = payload?.error?.code || 'TORRENT_UPLOAD_FAILED';
      throw error;
    }
    return payload.draft;
  }

  return { rpc, exportTorrent, uploadTorrent };
}

module.exports = { createDaemonClient };
