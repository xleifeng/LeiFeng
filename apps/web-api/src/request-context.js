'use strict';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function requestContext(req, { host = '127.0.0.1', port = 0 } = {}) {
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  const remoteAddress = req.socket?.remoteAddress || null;
  return {
    authorization, bearerToken,
    csrfToken: req.headers['x-thunder-csrf'] || '',
    privateSession: req.headers['x-thunder-private-session'] || '',
    origin: req.headers.origin || null,
    userAgent: req.headers['user-agent'] || '',
    clientType: req.headers['x-thunder-client'] || '',
    remoteAddress,
    isLoopback: LOOPBACK.has(remoteAddress || ''),
    host, port,
  };
}

module.exports = { LOOPBACK, requestContext };
