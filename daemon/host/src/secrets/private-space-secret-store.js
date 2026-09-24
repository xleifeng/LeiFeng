'use strict';

const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
function b64(value) { return Buffer.from(value).toString('base64'); }
function unb64(value) { return Buffer.from(String(value), 'base64'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

class PrivateSpaceSecretStore {
  constructor({ filePath, clock = Date } = {}) { if (!filePath) throw new Error('PrivateSpaceSecretStore filePath is required'); this.filePath = filePath; this.clock = clock; this.state = null; this.key = null; }
  load() { if (!fs.existsSync(this.filePath)) return this; try { this.state = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch { this.state = null; } return this; }
  _write() { fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 }); const tmp = `${this.filePath}.tmp`; const fd = fs.openSync(tmp, 'w', 0o600); try { fs.writeSync(fd, JSON.stringify(this.state, null, 2), null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, this.filePath); try { fs.chmodSync(this.filePath, 0o600); } catch {} }
  _derive(password, salt) { const value = String(password); if (!value || Buffer.byteLength(value) > 1024) throw Object.assign(new Error('私人空间密码无效'), { code: 'INVALID_PRIVATE_PASSWORD' }); return crypto.scryptSync(value, salt, 32, { N: 16384, r: 8, p: 1 }); }
  _hash(password, salt) { return crypto.createHash('sha256').update(this._derive(password, salt)).digest(); }
  setup(password, { directory } = {}) { if (this.state) throw Object.assign(new Error('私人空间已设置'), { code: 'PRIVATE_SPACE_ALREADY_SETUP' }); const salt = crypto.randomBytes(16); const dataKey = crypto.randomBytes(32); const derived = this._derive(password, salt); const wrapIv = crypto.randomBytes(12); const wrap = crypto.createCipheriv('aes-256-gcm', derived, wrapIv); const ciphertext = Buffer.concat([wrap.update(dataKey), wrap.final()]); const now = Number(this.clock.now ? this.clock.now() : Date.now()); this.state = { schemaVersion: 1, salt: b64(salt), passwordHash: b64(this._hash(password, salt)), encryptionKeyWrap: { algorithm: 'aes-256-gcm', iv: b64(wrapIv), tag: b64(wrap.getAuthTag()), ciphertext: b64(ciphertext) }, directory: directory ? path.resolve(directory) : null, createdAt: now, updatedAt: now }; this._write(); this.key = Buffer.from(dataKey); return { configured: true }; }
  verify(password) { if (!this.state) return false; const salt = unb64(this.state.salt); const expected = unb64(this.state.passwordHash); const actual = this._hash(password, salt); if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false; const derived = this._derive(password, salt); const wrapped = this.state.encryptionKeyWrap; const decipher = crypto.createDecipheriv('aes-256-gcm', derived, unb64(wrapped.iv)); decipher.setAuthTag(unb64(wrapped.tag)); this.key = Buffer.concat([decipher.update(unb64(wrapped.ciphertext)), decipher.final()]); return true; }
  getEncryptionKeyAfterVerify() { return this.key ? Buffer.from(this.key) : null; }
  changePassword(oldPassword, newPassword) { if (!this.verify(oldPassword)) throw Object.assign(new Error('私人空间密码错误'), { code: 'PRIVATE_PASSWORD_INVALID' }); const key = Buffer.from(this.key); const salt = crypto.randomBytes(16); const derived = this._derive(newPassword, salt); const wrapIv = crypto.randomBytes(12); const wrap = crypto.createCipheriv('aes-256-gcm', derived, wrapIv); const ciphertext = Buffer.concat([wrap.update(key), wrap.final()]); this.state.salt = b64(salt); this.state.passwordHash = b64(this._hash(newPassword, salt)); this.state.encryptionKeyWrap = { algorithm: 'aes-256-gcm', iv: b64(wrapIv), tag: b64(wrap.getAuthTag()), ciphertext: b64(ciphertext) }; this.state.updatedAt = Number(this.clock.now ? this.clock.now() : Date.now()); this._write(); return { changed: true }; }
  clearKey() { if (this.key) this.key.fill(0); this.key = null; }
  clear() { this.clearKey(); this.state = null; try { fs.unlinkSync(this.filePath); } catch {} }
  getStatus() { return { configured: !!this.state, unlocked: !!this.key }; }
}

module.exports = { PrivateSpaceSecretStore };
