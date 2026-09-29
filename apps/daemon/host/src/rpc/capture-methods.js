'use strict';
const validators = require('./validators');

function createCaptureMethods({ capture } = {}) {
  if (!capture) return [];
  return [
    ['leifeng.ui.v2.capture.startPairing', (params) => capture.startPairing(validators.capturePairingStart(params && params[0]))],
    ['leifeng.ui.v2.capture.desktop.provision', () => capture.provisionDesktopCapture()],
    ['leifeng.ui.v2.capture.clients.query', () => ({ items: capture.listClients() })],
    ['leifeng.ui.v2.capture.clients.revoke', (params) => ({ revoked: capture.revokeClient(validators.captureClientRevoke(params && params[0]).clientId) })],
  ];
}

module.exports = { createCaptureMethods };
