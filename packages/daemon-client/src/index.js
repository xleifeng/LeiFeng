'use strict';

const path = require('node:path');
const { DaemonClient, daemonError } = require('./client');
const { DEFAULT_MAX_FRAME_BYTES, FrameDecoder, encodeFrame, protocolError } = require('./framing');

function controlSocketPath({ runtimeDir, explicitPath } = {}) {
  if (explicitPath) return path.resolve(explicitPath);
  if (!runtimeDir) throw new Error('controlSocketPath requires runtimeDir or explicitPath');
  return path.join(path.resolve(runtimeDir), 'thunderd-control.sock');
}

module.exports = { DaemonClient, daemonError, controlSocketPath, DEFAULT_MAX_FRAME_BYTES, FrameDecoder, encodeFrame, protocolError };
