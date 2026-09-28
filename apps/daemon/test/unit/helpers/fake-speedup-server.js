'use strict';

const { decryptJson, encryptJson } = require('../../../host/src/vip-speedup-client');

function startFakeSpeedupServer({ context, intervalSec = 305, tokenPrefix = 'fixture-token-', script = {} } = {}) {
  if (!context || !context.uid) throw new Error('fake speedup context required');
  const state = { requests: [], count: 0, speedupCount: 0, resourceStatusCount: 0 };
  const transport = async (endpoint, request) => {
    const url = new URL(endpoint);
    const payload = decryptJson(context.uid, url.searchParams.get('r'), request.body);
    state.count++;
    if (url.pathname === '/speed/res_status') state.resourceStatusCount++;
    else state.speedupCount++;
    state.requests.push({ method: 'POST', path: url.pathname,
      itemCount: Array.isArray(payload.task_infos) ? payload.task_infos.length : 0,
      hasPeerId: !!payload.peer_id, hasBasic: typeof request.headers.Authorization === 'string',
      hasBearer: typeof request.headers.Authorization2 === 'string' });
    const custom = typeof script === 'function' ? await script({ payload, request, state })
      : (script.responses && script.responses[state.count - 1]);
    if (custom) return { status: custom.status || 200, headers: custom.headers || {}, body: custom.body || Buffer.alloc(0) };
    const taskInfos = (payload.task_infos || []).map((item, index) => url.pathname === '/speed/res_status'
      ? { filter_result: 0, sec_result: 0 }
      : { result: 0, token: `${tokenPrefix}${state.speedupCount}-${index}`, time_interval: intervalSec });
    const responseRandom = String(script.responseRandom || Date.now());
    return { status: 200, headers: { 'content-type': 'application/json', 'random-num': responseRandom },
      body: encryptJson(context.uid, responseRandom, { result: 0, task_infos: taskInfos }) };
  };
  return Promise.resolve({ server: { close() {} }, state,
    endpoint: 'https://speedup.test/speed/speedup',
    statusEndpoint: 'https://speedup.test/speed/res_status', transport });
}

module.exports = { startFakeSpeedupServer };
