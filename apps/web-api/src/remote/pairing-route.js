'use strict';

function createRemotePairingRoute({ client } = {}) {
  if (!client) throw new Error('remote pairing route requires daemon client');
  return { name: 'remote-pairing', async tryHandle(req, res, context = {}) {
    const pathname = new URL(req.url || '/', 'https://127.0.0.1').pathname;
    if (pathname !== '/remote/v1/pairing/accept' || req.method !== 'POST') return false;
    const chunks = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 64 * 1024) { res.writeHead(413); res.end(); return true; } chunks.push(chunk); }
    let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { res.writeHead(400); res.end(); return true; }
    try { const result = await client.call('daemon.v1.remote.pairing.accept', { input: { ...input, certificateFingerprint: context.fingerprint } }); res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(result)); }
    catch (error) { res.writeHead(422, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: error.code || 'PAIRING_FAILED', message: error.message } })); }
    return true;
  } };
}

module.exports = { createRemotePairingRoute };
