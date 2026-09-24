'use strict';

function startFakeXluser(script = {}) {
  const state = {
    pendingCount: script.pendingCount ?? 2, interval: script.interval ?? 0.02, expiresIn: script.expiresIn ?? 60,
    registerStatus: script.registerStatus ?? 200, registerFailAfter: script.registerFailAfter ?? Infinity,
    userMeStatus: script.userMeStatus ?? 200,
    userMeBody: script.userMeBody ?? { vip_info: [{ is_vip: '1', user_vas: '2', vas_type: '5', level: '9' }], user_channel: 'thunderd' },
    keepAliveStatus: script.keepAliveStatus ?? 200, keepAliveFailOnce: script.keepAliveFailOnce ?? false,
    refreshStatus: script.refreshStatus ?? 200,
    refreshBody: script.refreshBody ?? { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 },
    requests: [], tokenPolls: 0, registerCount: 0, channelPutCount: 0, refreshCount: 0, userMeCount: 0,
  };
  const reply = (status, body) => ({ status, body });
  const request = async (method, fullUrl, options = {}) => {
    const url = new URL(fullUrl);
    const body = options.body ?? null;
    const headers = {};
    for (const [key, value] of Object.entries(options.headers || {})) headers[String(key).toLowerCase()] = value;
    state.requests.push({ method, url: url.pathname + url.search, headers, body });
    if (url.pathname === '/v1/auth/device/code')
      return reply(200, { device_code: 'dc-1', user_code: 'UC-9', verification_uri: 'http://verify.x/v',
        verification_uri_complete: 'http://verify.x/v?user_code=UC-9', interval: state.interval, expires_in: state.expiresIn });
    if (url.pathname === '/v1/auth/token' && body && body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
      state.tokenPolls++;
      if (state.tokenPolls <= state.pendingCount) return reply(400, { error: 'authorization_pending' });
      return reply(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600,
        token_type: 'Bearer', sub: '664727041' });
    }
    if (url.pathname === '/v1/auth/token' && body && body.grant_type === 'refresh_token') {
      state.refreshCount++;
      return reply(state.refreshStatus, state.refreshStatus === 200 ? state.refreshBody : { error: 'invalid_grant' });
    }
    if (url.pathname === '/session/v1/register') {
      state.registerCount++;
      if (state.registerCount > state.registerFailAfter) return reply(401, { error: 'token invalid' });
      if (state.registerStatus !== 200) return reply(state.registerStatus, { error: 'fail' });
      return reply(200, { sessionid: 'sid-1', secure_key: 'sk-1', user_id: 664727041,
        keepAliveMinPeriod: '30', keepAlivePeriod: '300' });
    }
    if (url.pathname === '/v1/user/me') {
      state.userMeCount++;
      return reply(state.userMeStatus, state.userMeStatus === 200 ? state.userMeBody : { error: 'invalid_token' });
    }
    if (url.pathname === '/channel/put') {
      state.channelPutCount++;
      if (state.keepAliveFailOnce && state.channelPutCount === 1) return reply(401, { error: 'session invalid' });
      return reply(state.keepAliveStatus, state.keepAliveStatus === 200 ? { error: 'success' } : { error: 'session invalid' });
    }
    return reply(404, { error: 'not found' });
  };
  return Promise.resolve({ server: { close() {} }, state, origin: 'http://xluser.test', request });
}

module.exports = { startFakeXluser };
