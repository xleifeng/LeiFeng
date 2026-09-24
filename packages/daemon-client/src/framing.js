'use strict';

const DEFAULT_MAX_FRAME_BYTES = 64 * 1024 * 1024;
const HEADER_END = Buffer.from('\r\n\r\n');

function protocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function encodeFrame(message, { maxFrameBytes = DEFAULT_MAX_FRAME_BYTES } = {}) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > maxFrameBytes) throw protocolError('CONTROL_FRAME_TOO_LARGE', 'daemon control frame exceeds the configured limit');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

class FrameDecoder {
  constructor({ maxFrameBytes = DEFAULT_MAX_FRAME_BYTES, onMessage } = {}) {
    if (typeof onMessage !== 'function') throw new Error('FrameDecoder requires onMessage');
    this.maxFrameBytes = maxFrameBytes;
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0);
    this.expectedLength = null;
  }

  push(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, bytes]) : bytes;
    while (true) {
      if (this.expectedLength === null) {
        const end = this.buffer.indexOf(HEADER_END);
        if (end < 0) {
          if (this.buffer.length > 8192) throw protocolError('CONTROL_HEADER_TOO_LARGE', 'daemon control header exceeds 8 KiB');
          return;
        }
        const header = this.buffer.subarray(0, end).toString('ascii');
        this.buffer = this.buffer.subarray(end + HEADER_END.length);
        const lengths = header.split('\r\n').map((line) => /^Content-Length:\s*(\d+)$/i.exec(line)).filter(Boolean);
        if (lengths.length !== 1) throw protocolError('CONTROL_LENGTH_REQUIRED', 'daemon control frame requires one Content-Length header');
        const length = Number(lengths[0][1]);
        if (!Number.isSafeInteger(length) || length < 0) throw protocolError('CONTROL_LENGTH_INVALID', 'daemon control Content-Length is invalid');
        if (length > this.maxFrameBytes) throw protocolError('CONTROL_FRAME_TOO_LARGE', 'daemon control frame exceeds the configured limit');
        this.expectedLength = length;
      }
      if (this.buffer.length < this.expectedLength) return;
      const body = this.buffer.subarray(0, this.expectedLength);
      this.buffer = this.buffer.subarray(this.expectedLength);
      this.expectedLength = null;
      let message;
      try { message = JSON.parse(body.toString('utf8')); }
      catch { throw protocolError('CONTROL_JSON_INVALID', 'daemon control frame contains invalid JSON'); }
      this.onMessage(message);
    }
  }
}

module.exports = { DEFAULT_MAX_FRAME_BYTES, FrameDecoder, encodeFrame, protocolError };
