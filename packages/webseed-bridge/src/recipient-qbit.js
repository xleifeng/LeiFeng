'use strict';

const { createQbitClient } = require('./qbit-client');
const { assertRecipient, recipientError } = require('./recipient');

function createQbitRecipient({ client, ...config } = {}) {
  const qbit = client || createQbitClient(config);
  const call = (method, ...args) => Promise.resolve().then(() => qbit[method](...args)).catch((error) => { throw recipientError(error); });
  return assertRecipient({
    capabilities: Object.freeze({ provider: 'qbit', torrent: true, magnet: true, webseeds: true }),
    addTorrent: (buffer, metadata = {}) => call('addTorrent', buffer, metadata),
    addMagnet: (uri) => call('addMagnet', uri),
    getTorrent: (infohash) => call('getTorrent', infohash),
    webseeds: (infohash) => call('webseeds', infohash),
  });
}

module.exports = { createQbitRecipient };
