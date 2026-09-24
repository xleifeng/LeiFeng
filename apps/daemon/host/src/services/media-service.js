'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mime = require('mime-types');
const { parseSingleRange, formatContentRange, matchesIfRange } = require('../domain/byte-range');

function mediaError(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

function safeJson(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function parseJson(value) { try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { return null; } }

class MediaService {
  constructor({ tasks, resolver, secretStore, privateSpace = null, clock = Date, tokenTtlMs = 5 * 60 * 1000, maxStreams = 16 } = {}) {
    if (!tasks || !resolver || !secretStore) throw new Error('MediaService dependencies are incomplete');
    this.tasks = tasks;
    this.resolver = resolver;
    this.secretStore = secretStore;
    this.privateSpace = privateSpace;
    this.clock = clock;
    this.tokenTtlMs = tokenTtlMs;
    this.maxStreams = maxStreams;
    this.activeStreams = 0;
  }

  _now() { return Number(this.clock && typeof this.clock.now === 'function' ? this.clock.now() : Date.now()); }
  _key() { return this.secretStore.getKey(); }
  _sign(value) { return crypto.createHmac('sha256', this._key()).update(value).digest('base64url'); }
  _task(taskId) { try { return this.tasks.require(taskId); } catch { throw mediaError('TASK_NOT_FOUND', '任务不存在'); } }
  _file(task, fileIndex) {
    const index = fileIndex === undefined || fileIndex === null ? undefined : Number(fileIndex);
    let target;
    try { target = this.resolver.resolveTaskFile(task, index); } catch (error) { throw error; }
    return { index, target };
  }
  _privateGeneration(task, context = {}) {
    if (task.privateSpace !== true) return null;
    const session = String(context.privateSession || '');
    if (!session) return null;
    if (!this.privateSpace?.authorize?.(session)) throw mediaError('PRIVATE_SPACE_LOCKED', '私人空间已锁定');
    return this.privateSpace.sessionGeneration?.(session) ?? this.privateSpace.generation?.(session) ?? 1;
  }
  getCapabilities() {
    const desktop = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) && Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);
    return { openOnHost: desktop, streamInBrowser: true, mediaTokenTtlMs: this.tokenTtlMs, maxStreams: this.maxStreams };
  }
  getMimeType(fileName) {
    const value = mime.lookup(String(fileName || '')) || 'application/octet-stream';
    return String(value).toLowerCase() === 'text/plain' ? 'text/plain; charset=utf-8' : value;
  }
  _availableBytes(task, file, stat) {
    if (['completed'].includes(task.lifecycle)) return stat.size;
    const descriptor = Array.isArray(task.files) && file.index !== undefined ? task.files.find((item) => Number(item.index) === file.index) : null;
    if (descriptor && Number.isFinite(Number(descriptor.receivedBytes))) return Math.min(stat.size, Math.max(0, Number(descriptor.receivedBytes)));
    if (file.index !== undefined && Array.isArray(task.files) && task.files.length > 1) return Math.min(stat.size, Number(descriptor?.completedBytes || 0));
    return Math.min(stat.size, Math.max(0, Number(task.completedBytes) || 0));
  }
  issueToken({ taskId, fileIndex, disposition = 'inline' } = {}, context = {}) {
    const task = this._task(taskId);
    const file = this._file(task, fileIndex);
    let stat;
    try { stat = fs.statSync(file.target); } catch { throw mediaError('FILE_NOT_FOUND', '任务文件不存在'); }
    if (!stat.isFile()) throw mediaError('FILE_NOT_FOUND', '任务文件不存在');
    const privateGeneration = this._privateGeneration(task, context);
    const payload = {
      v: 1, taskId: String(task.id), fileIndex: file.index === undefined ? null : file.index,
      disposition: disposition === 'attachment' ? 'attachment' : 'inline', expiresAt: this._now() + this.tokenTtlMs,
      nonce: crypto.randomBytes(12).toString('base64url'), fileRevision: Number(task.fileRevision) || 1,
      dev: Number(stat.dev), ino: Number(stat.ino), privateGeneration,
    };
    const encoded = safeJson(payload);
    return { token: `${encoded}.${this._sign(encoded)}`, expiresAt: payload.expiresAt, fileIndex: file.index ?? null, mediaKind: this.mediaKind(task.displayName, file.target), mimeType: this.getMimeType(file.target), availableBytes: this._availableBytes(task, file, stat) };
  }
  _verifyToken(token, task, file, context = {}) {
    const value = String(token || ''); const [encoded, signature, extra] = value.split('.');
    if (!encoded || !signature || extra) throw mediaError('MEDIA_TOKEN_INVALID', '媒体令牌无效');
    const expected = this._sign(encoded);
    const a = Buffer.from(signature); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw mediaError('MEDIA_TOKEN_INVALID', '媒体令牌无效');
    const payload = parseJson(encoded);
    if (!payload || payload.v !== 1 || payload.taskId !== String(task.id)) throw mediaError('MEDIA_TOKEN_INVALID', '媒体令牌无效');
    if (Number(payload.expiresAt) <= this._now()) throw mediaError('MEDIA_TOKEN_EXPIRED', '媒体令牌已过期');
    if ((payload.fileIndex === null ? null : Number(payload.fileIndex)) !== (file.index === undefined ? null : file.index) || Number(payload.fileRevision) !== Number(task.fileRevision || 1)) throw mediaError('MEDIA_TOKEN_STALE', '文件状态已变化，请重新获取播放地址');
    let stat;
    try { stat = fs.statSync(file.target); } catch { throw mediaError('FILE_NOT_FOUND', '任务文件不存在'); }
    if (Number(payload.dev) !== Number(stat.dev) || Number(payload.ino) !== Number(stat.ino)) throw mediaError('MEDIA_TOKEN_STALE', '文件状态已变化，请重新获取播放地址');
    const currentGeneration = this._privateGeneration(task, context);
    if (task.privateSpace === true) {
      if (currentGeneration === null) { if (!this.privateSpace?.isGenerationActive?.(payload.privateGeneration)) throw mediaError('PRIVATE_SPACE_LOCKED', '私人空间已锁定'); }
      else if (payload.privateGeneration !== currentGeneration) throw mediaError('PRIVATE_SPACE_LOCKED', '私人空间已锁定');
    }
    return { payload, stat };
  }
  resolveContent({ taskId, fileIndex, token, method = 'GET', rangeHeader, ifRange } = {}, context = {}) {
    if (this.activeStreams >= this.maxStreams) throw mediaError('MEDIA_RATE_LIMIT', '媒体连接数已达上限');
    const task = this._task(taskId); const file = this._file(task, fileIndex); const verified = this._verifyToken(token, task, file, context); const stat = verified.stat;
    const available = this._availableBytes(task, file, stat); const complete = task.lifecycle === 'completed' || available >= stat.size;
    const etag = `"${Number(stat.dev).toString(16)}-${Number(stat.ino).toString(16)}-${Number(stat.size).toString(16)}-${Number(stat.mtimeMs).toString(16)}"`;
    const rangeAllowed = matchesIfRange(ifRange, etag, stat.mtimeMs);
    let range = null;
    if (rangeHeader && rangeAllowed) {
      try { range = parseSingleRange(rangeHeader, available); } catch (error) {
        if (error.code === 'RANGE_NOT_AVAILABLE_YET' && complete) error.code = 'RANGE_NOT_SATISFIABLE';
        throw error;
      }
    }
    const start = range ? range.start : 0; const end = range ? range.end : Math.max(-1, available - 1); const length = end >= start ? end - start + 1 : 0;
    if (method !== 'HEAD' && method !== 'GET') throw mediaError('METHOD_NOT_ALLOWED', '媒体只支持 GET/HEAD');
    this.activeStreams += 1;
    const release = () => { this.activeStreams = Math.max(0, this.activeStreams - 1); };
    return { task, file, stat, availableBytes: available, complete, etag, start, end, length, status: range ? 206 : 200, mimeType: this.getMimeType(file.target), disposition: verified.payload.disposition, release, contentRange: range ? formatContentRange(start, end, complete ? stat.size : available) : null, target: file.target };
  }
  mediaKind(name, target = '') {
    const type = this.getMimeType(name || target).split(';')[0];
    if (type.startsWith('video/')) return 'video'; if (type.startsWith('audio/')) return 'audio'; if (type.startsWith('image/')) return 'image'; if (type.startsWith('text/')) return 'text'; return 'download-only';
  }
}

module.exports = { MediaService, mediaError };
