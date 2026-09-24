'use strict';

async function readJson(req, maxBytes = 4 * 1024 * 1024) { const chunks = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > maxBytes) throw Object.assign(new Error('远程请求体过大'), { code: 'REMOTE_BODY_TOO_LARGE' }); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('远程请求体无效'), { code: 'INVALID_ARGUMENT' }); } }
function reply(res, result) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(result)); }

function createRemoteHandler({ client, nodeId } = {}) {
  if (!client) throw new Error('remote handler requires daemon client');
  return async (req, res, context = {}) => {
    const pathname = new URL(req.url || '/', 'https://remote.local').pathname;
    const base = { fingerprint: context.fingerprint };
    if (req.method === 'GET' && pathname === '/remote/v1/hello') { reply(res, await client.call('daemon.v1.remote.hello', { ...base, nodeId })); return; }
    const input = await readJson(req);
    if (pathname === '/remote/v1/tasks/query' && req.method === 'POST') { reply(res, await client.call('daemon.v1.remote.tasks.query', { ...base, input })); return; }
    if (pathname === '/remote/v1/tasks/command' && req.method === 'POST') { reply(res, await client.call('daemon.v1.remote.tasks.command', { ...base, input })); return; }
    if (pathname === '/remote/v1/drafts/preflight' && req.method === 'POST') { reply(res, await client.call('daemon.v1.remote.drafts.preflight', { ...base, input })); return; }
    if (pathname === '/remote/v1/drafts/commit' && req.method === 'POST') { reply(res, await client.call('daemon.v1.remote.drafts.commit', { ...base, input })); return; }
    if (pathname === '/remote/v1/media-token' && req.method === 'POST') { reply(res, await client.call('daemon.v1.remote.media.issueToken', { ...base, input })); return; }
    throw Object.assign(new Error('远程方法不存在'), { code: 'REMOTE_METHOD_NOT_FOUND' });
  };
}

module.exports = { createRemoteHandler, readJson };
