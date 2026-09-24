'use strict';
const validators = require('./validators');

function createCaptureMethods({ capture } = {}) {
  if (!capture) return [];
  return [
    ['thunder.ui.v2.capture.startPairing', (params) => capture.startPairing(validators.capturePairingStart(params && params[0]))],
    ['thunder.ui.v2.capture.desktop.provision', () => capture.provisionDesktopCapture()],
    ['thunder.ui.v2.capture.clients.query', () => ({ items: capture.listClients() })],
    ['thunder.ui.v2.capture.clients.revoke', (params) => ({ revoked: capture.revokeClient(validators.captureClientRevoke(params && params[0]).clientId) })],
  ];
}

module.exports = { createCaptureMethods };
