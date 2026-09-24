// qbit-client.js — qBittorrent WebUI API 客户端（127.0.0.0/8 免认证白名单已由环境配置）。
'use strict';

const http = require('http');
const crypto = require('crypto');

function createQbitClient({ port = 8085, host = '127.0.0.1', timeoutMs = 10000, username = '', password = '' } = {}) {
  let cookie = '';
  let loginPromise = null;
  function rawRequest({ path, method = 'GET', body = null, contentType }) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body) {
        headers['content-type'] = contentType || 'application/x-www-form-urlencoded';
        headers['content-length'] = Buffer.byteLength(body);
      }
      const req = http.request({ host, port, path, method, headers, timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  const form = (obj) => Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  async function request(options) {
    if (username || password) {
      if (!username || !password) throw new Error('qbit username/password must be configured together');
      if (!cookie) {
        loginPromise ||= rawRequest({ path: '/api/v2/auth/login', method: 'POST', body: form({ username, password }) })
          .then((response) => {
            const sid = (response.headers['set-cookie'] || []).find((value) => /^SID=/.test(value));
            if (response.status !== 200 || !sid) throw new Error(`qbit login HTTP ${response.status}`);
            cookie = sid.split(';', 1)[0];
          }).finally(() => { loginPromise = null; });
        await loginPromise;
      }
    }
    return rawRequest(options);
  }

  async function listTorrents() {
    const r = await request({ path: '/api/v2/torrents/info' });
    if (r.status !== 200) throw new Error(`torrents/info HTTP ${r.status}`);
    return JSON.parse(r.body.toString());
  }

  async function getTorrent(hash) {
    const all = await listTorrents();
    return all.find((t) => t.hash === hash) || null;
  }

  // 上传 .torrent（multipart）。有限重试：qbit 短暂不可用时 hybrid 前期工作
  // （tlei 任务、会话）已就绪，单次超时放弃会拖死整个编排。
  async function addTorrent(torrentBuf, { name = 'seed.torrent', retries = 2 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const boundary = `----bridge${crypto.randomBytes(8).toString('hex')}`;
        const head = `--${boundary}\r\ncontent-disposition: form-data; name="torrents"; filename="${name}"\r\ncontent-type: application/x-bittorrent\r\n\r\n`;
        const body = Buffer.concat([
          Buffer.from(head, 'utf-8'),
          torrentBuf,
          Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
        ]);
        const r = await request({ path: '/api/v2/torrents/add', method: 'POST', body, contentType: `multipart/form-data; boundary=${boundary}` });
        if (r.status !== 200) throw new Error(`torrents/add HTTP ${r.status}: ${r.body.toString().slice(0, 120)}`);
        return true;
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async function addMagnet(magnet, { retries = 2 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const r = await request({ path: '/api/v2/torrents/add', method: 'POST', body: form({ urls: magnet }) });
        if (r.status !== 200) throw new Error(`torrents/add magnet HTTP ${r.status}`);
        return true;
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async function pause(hash) { return request({ path: `/api/v2/torrents/pause?hashes=${hash}`, method: 'POST' }); }
  async function resume(hash) { return request({ path: `/api/v2/torrents/resume?hashes=${hash}`, method: 'POST' }); }
  async function remove(hash, deleteFiles = true) {
    return request({ path: '/api/v2/torrents/delete', method: 'POST', body: form({ hashes: hash, deleteFiles: deleteFiles ? 'true' : 'false' }) });
  }
  async function webseeds(hash) {
    const r = await request({ path: `/api/v2/torrents/webseeds?hash=${hash}` });
    return r.status === 200 ? JSON.parse(r.body.toString()) : [];
  }

  return { request, listTorrents, getTorrent, addMagnet, addTorrent, pause, resume, remove, webseeds };
}

module.exports = { createQbitClient };
