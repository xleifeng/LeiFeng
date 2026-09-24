'use strict';

const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');

function fingerprint(cert) { return cert && cert.raw ? crypto.createHash('sha256').update(cert.raw).digest('hex') : null; }

class MtlsServer {
  constructor({ key, cert, ca, port = 0, host = '127.0.0.1', pairingRoute = null, handler } = {}) {
    if (!key || !cert || !ca || !handler) throw new Error('MtlsServer dependencies are incomplete');
    this.options = { key: fs.readFileSync(key), cert: fs.readFileSync(cert), ca: fs.readFileSync(ca), requestCert: true, rejectUnauthorized: false };
    this.port = port; this.host = host; this.pairingRoute = pairingRoute; this.handler = handler; this.server = null;
  }
  start() {
    this.server = https.createServer(this.options, async (req, res) => {
      try {
        const peerFingerprint = fingerprint(req.socket.getPeerCertificate(true));
        if (this.pairingRoute && await this.pairingRoute.tryHandle(req, res, { fingerprint: peerFingerprint })) return;
        await this.handler(req, res, { fingerprint: peerFingerprint });
      } catch (error) {
        if (!res.headersSent) { const status = ['REMOTE_CERT_REJECTED', 'REMOTE_PERMISSION_DENIED'].includes(error.code) ? 403 : 500; res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: error.code || 'REMOTE_FAILED', message: error.message } })); }
      }
    });
    this.server.listen(this.port, this.host);
    return this.server;
  }
  stop() { return new Promise((resolve) => this.server ? this.server.close(resolve) : resolve()); }
}

module.exports = { MtlsServer, fingerprint };
