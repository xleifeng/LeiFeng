'use strict';
const validators = require('./validators');

function createRemoteMethods({ pairing = null, nodes = null, tasks = null } = {}) {
  const methods = [];
  if (pairing) {
    methods.push(['thunder.ui.v2.remote.server.startPairing', (params) => pairing.startServerPairing(validators.remotePairingStart(params && params[0]))]);
    methods.push(['thunder.ui.v2.remote.server.stopPairing', (params) => ({ stopped: pairing.stopServerPairing ? pairing.stopServerPairing(validators.remotePairingStop(params && params[0] || {})) : false })]);
    methods.push(['thunder.ui.v2.remote.server.clients.query', () => ({ items: pairing.queryPairedClients() })]);
    methods.push(['thunder.ui.v2.remote.server.clients.revoke', (params) => ({ revoked: pairing.revokeClient(params && params[0] && params[0].clientId) })]);
  }
  if (nodes) {
    methods.push(['thunder.ui.v2.remote.nodes.query', () => nodes.query()]);
    methods.push(['thunder.ui.v2.remote.nodes.acceptPairing', (params) => nodes.acceptPairing(validators.remoteNodeAccept(params && params[0] || {}))]);
    methods.push(['thunder.ui.v2.remote.nodes.remove', (params) => nodes.remove(validators.remoteNodeRemove(params && params[0] || {}))]);
  }
  if (tasks) {
    methods.push(['thunder.ui.v2.remote.tasks.query', (params) => tasks.query(validators.remoteTaskQuery(params && params[0] || {}))]);
    methods.push(['thunder.ui.v2.remote.tasks.command', (params) => tasks.command(validators.remoteTaskCommand(params && params[0] || {}))]);
  }
  return methods;
}

module.exports = { createRemoteMethods };
