'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  VipSpeedupClient, VipSpeedupError, deriveAesKey, encryptJson, decryptJson,
} = require('../../host/src/vip-speedup-client');

const context = { ok: true, uid: '664727041', accessToken: 'access-secret', sessionId: 'sid-secret',
  isVip: true, isDownloadVip: true, userVas: 2, vipType: 5, vipLevel: 9 };
const token = 'fixture-token-should-never-be-logged';

function encryptedReply(random, data, status = 200, headers = {}) {
  return { status, headers: { 'random-num': String(random), ...headers }, body: encryptJson(context.uid, String(random), data) };
}

function requestPayload(endpoint, request) {
  const url = new URL(endpoint);
  return { url, payload: decryptJson(context.uid, url.searchParams.get('r'), request.body), request };
}

test('AES key KAT + roundtrip', () => {
  assert.strictEqual(deriveAesKey('664727041', '1700000000000'), crypto.createHash('md5').update('xl_xdas25008215626647270411700000000000').digest('hex').toUpperCase().slice(0, 16));
  const value = { result: 0, task_infos: [{ token, result: 0 }] };
  const encrypted = encryptJson(context.uid, '1700000000000', value);
  assert.deepStrictEqual(decryptJson(context.uid, '1700000000000', encrypted), value);
});

test('speedup 请求加密 body、Basic/Bearer、P2SP 字段和成功 item', async () => {
  let observed;
  const logs = [];
  const client = new VipSpeedupClient({ random: () => 1700000000000, log: (value) => logs.push(value),
    transport: async (endpoint, request) => {
      observed = requestPayload(endpoint, request);
      return encryptedReply(1700000000001, { result: 0, task_infos: [{ result: 0, token, time_interval: 3600 }] });
    } });
  const result = await client.requestTokens(context, { peerId: 'PEER-12345678', files: [
    { fileIndex: -1, url: 'https://example.test/a.bin', name: 'a.bin', size: 123, cid: 'CID', gcid: 'GCID', traceId: '' },
  ] });
  assert.strictEqual(result.intervalSec, 3600);
  assert.deepStrictEqual(result.items[0], { fileIndex: -1, token, resultCode: 0, intervalSec: 3600 });
  assert.strictEqual(observed.request.headers.Authorization, 'Basic ' + Buffer.from('664727041:sid-secret').toString('base64'));
  assert.strictEqual(observed.request.headers.Authorization2, 'Bearer access-secret');
  assert.strictEqual(observed.request.headers['content-type'], 'application/json');
  assert.strictEqual(observed.payload.peer_id, 'PEER-12345678');
  assert.strictEqual(observed.payload.task_infos[0].url, 'https://example.test/a.bin');
  assert.strictEqual(Buffer.isBuffer(observed.request.body), true);
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(token));
});

test('BT payload 按 infohash/fileIndex 构造 bt:// URL', async () => {
  let payload;
  const client = new VipSpeedupClient({ random: () => 1, transport: async (endpoint, request) => {
    payload = requestPayload(endpoint, request).payload;
    return encryptedReply(2, { result: 0, task_infos: [
      { result: 0, token: 'bt-token-a', time_interval: 305 },
      { result: 0, token: 'bt-token-b', time_interval: 310 },
    ] });
  } });
  const result = await client.requestTokens(context, { peerId: 'PEER-12345678', infohash: 'ABCDEF0123456789', btTitle: 'title', files: [
    { fileIndex: 0, name: 'a', size: 1, cid: 'c0', gcid: 'g0' },
    { fileIndex: 2, name: 'c', size: 3, cid: 'c2', gcid: 'g2' },
  ] });
  assert.strictEqual(payload.infohash, 'ABCDEF0123456789');
  assert.strictEqual(payload.bt_title, 'title');
  assert.strictEqual(payload.task_infos[0].url, 'bt://ABCDEF0123456789/0');
  assert.strictEqual(payload.task_infos[0].file_index, 0);
  assert.strictEqual(payload.task_infos[1].url, 'bt://ABCDEF0123456789/2');
  assert.strictEqual(payload.task_infos[1].file_index, 2);
  assert.strictEqual(result.intervalSec, 305);
});

test('资源资格请求复刻 filter/sec 查询并保留逐文件结果', async () => {
  let observed;
  const client = new VipSpeedupClient({ random: () => 21, transport: async (endpoint, request) => {
    observed = requestPayload(endpoint, request);
    return encryptedReply(22, { result: 0, task_infos: [
      { filter_result: 0, sec_result: 0 }, { filter_result: 7, sec_result: 1 },
    ] });
  } });
  const result = await client.requestResourceStatus(context, { peerId: 'PEER-12345678', infohash: 'ABCDEF0123456789', btTitle: 'title', files: [
    { fileIndex: 0, name: 'a', size: 1, cid: 'c0', gcid: 'g0' },
    { fileIndex: 2, name: 'c', size: 3, cid: 'c2', gcid: 'g2' },
  ] });
  assert.equal(observed.url.pathname, '/speed/res_status');
  assert.equal(observed.url.searchParams.get('need_check_filter'), '1');
  assert.equal(observed.url.searchParams.get('need_check_sec'), '1');
  assert.equal(observed.payload.task_infos[1].file_index, 2);
  assert.deepStrictEqual(result.items, [
    { fileIndex: 0, banned: false, eligible: true, filterResult: 0, secResult: 0 },
    { fileIndex: 2, banned: true, eligible: false, filterResult: 7, secResult: 1 },
  ]);
});

test('client_sequence 单调递增且非 200 使用同一加密请求立即重试一次', async () => {
  const requests = [];
  const client = new VipSpeedupClient({ random: () => 10, transport: async (endpoint, request) => {
    requests.push({ endpoint, body: Buffer.from(request.body) });
    if (requests.length === 1) return { status: 503, headers: {}, body: Buffer.alloc(0) };
    return encryptedReply(101, { result: 0, task_infos: [{ result: 0, token: 'token-1', time_interval: 3600 }] });
  } });
  await client.requestTokens(context, { peerId: 'PEER-12345678', files: [
    { fileIndex: -1, url: 'http://x', name: 'a', size: 1, cid: 'c', gcid: 'g' },
  ] });
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0].endpoint).searchParams.get('client_sequence'), '1');
  assert.equal(requests[0].endpoint, requests[1].endpoint);
  assert.deepStrictEqual(requests[0].body, requests[1].body);

  const sequences = [];
  let random = 20;
  const second = new VipSpeedupClient({ random: () => random++, transport: async (endpoint) => {
    sequences.push(new URL(endpoint).searchParams.get('client_sequence'));
    return encryptedReply(200 + sequences.length, { result: 0, task_infos: [{ result: 0, token: `token-${sequences.length}`, time_interval: 3600 }] });
  } });
  const request = () => second.requestTokens(context, { peerId: 'PEER-12345678', files: [
    { fileIndex: -1, url: 'http://x', name: 'a', size: 1, cid: 'c', gcid: 'g' },
  ] });
  await request(); await request();
  assert.deepStrictEqual(sequences, ['1', '2']);
});

test('协议错误分类且不回显 token/body/header', async (t) => {
  const input = { peerId: 'PEER-12345678', files: [
    { fileIndex: -1, url: 'http://x', name: 'a', size: 1, cid: 'c', gcid: 'g' },
  ] };
  await t.test('非 200 重试后失败', async () => {
    let calls = 0;
    const client = new VipSpeedupClient({ transport: async () => { calls++; return { status: 403, headers: {}, body: Buffer.from('secret-body') }; } });
    await assert.rejects(client.requestTokens(context, input), (error) => error instanceof VipSpeedupError && error.code === 'http-error' && !error.message.includes(token));
    assert.equal(calls, 2);
  });
  await t.test('缺 random-num / 超大 response', async () => {
    const client1 = new VipSpeedupClient({ transport: async () => ({ status: 200, headers: {}, body: Buffer.from('x') }) });
    await assert.rejects(client1.requestTokens(context, input), (error) => error.code === 'missing-random');
    let calls = 0;
    const client2 = new VipSpeedupClient({ transport: async () => { calls++; throw new VipSpeedupError('response-too-large', 200); } });
    await assert.rejects(client2.requestTokens(context, input), (error) => error.code === 'response-too-large');
    assert.equal(calls, 1);
  });
  await t.test('item 非零时不保留 token', async () => {
    const client = new VipSpeedupClient({ transport: async () => encryptedReply(3, { result: 0, task_infos: [{ result: 17, token, time_interval: 10 }] }) });
    await assert.rejects(client.requestTokens(context, input), (error) => error.code === 'item-error' && !error.message.includes(token));
  });
});
