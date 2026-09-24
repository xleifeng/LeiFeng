'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

class PkiService {
  constructor({ directory, openssl = 'openssl' } = {}) { if (!directory) throw new Error('PkiService directory is required'); this.directory = directory; this.openssl = openssl; }
  _file(name) { return path.join(this.directory, name); }
  fingerprint(certPem) { return crypto.createHash('sha256').update(new crypto.X509Certificate(certPem).raw).digest('hex'); }
  async _run(args) { return execFileAsync(this.openssl, args, { shell: false, maxBuffer: 1024 * 1024 }); }
  async ensureLocalCa({ commonName = 'Thunder Native Download Local CA', days = 3650 } = {}) { fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 }); const key = this._file('ca.key.pem'); const cert = this._file('ca.cert.pem'); if (!fs.existsSync(key) || !fs.existsSync(cert)) { await this._run(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-keyout', key, '-out', cert, '-days', String(days), '-subj', `/CN=${commonName}`]); fs.chmodSync(key, 0o600); fs.chmodSync(cert, 0o644); } return { key, cert, fingerprint: this.fingerprint(fs.readFileSync(cert)) }; }
  async ensureServerCertificate({ nodeId, hosts = ['localhost'] } = {}) { const ca = await this.ensureLocalCa(); const key = this._file(`${nodeId}.server.key.pem`); const csr = this._file(`${nodeId}.server.csr.pem`); const cert = this._file(`${nodeId}.server.cert.pem`); const ext = this._file(`${nodeId}.server.ext`); if (!fs.existsSync(key) || !fs.existsSync(cert)) { const names = hosts.map((host) => /^\d+(?:\.\d+){3}$/.test(String(host)) ? `IP:${host}` : `DNS:${host}`); fs.writeFileSync(ext, `subjectAltName=${names.join(',')}\nextendedKeyUsage=serverAuth,clientAuth\n`, { mode: 0o600 }); await this._run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${nodeId}`]); await this._run(['x509', '-req', '-in', csr, '-CA', ca.cert, '-CAkey', ca.key, '-CAcreateserial', '-out', cert, '-days', '825', '-extfile', ext]); fs.chmodSync(key, 0o600); fs.chmodSync(cert, 0o644); } return { key, cert, ca: ca.cert, fingerprint: this.fingerprint(fs.readFileSync(cert)) }; }
}

module.exports = { PkiService };
