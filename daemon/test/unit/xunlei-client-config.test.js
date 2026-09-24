'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../host/src/xunlei-client-config');

test('官方客户端常量集中且别名一致', () => {
  const { XUNLEI_CLIENT: c } = config;
  assert.ok(Object.isFrozen(c));
  for (const key of ['clientId', 'clientSecret', 'appId', 'appName', 'bundleName', 'appSignKey',
    'clientName', 'clientVersion', 'releaseVersion', 'sdkVersion', 'protocolVersion']) {
    assert.equal(typeof c[key], 'string');
    assert.ok(c[key].length > 0);
  }
  assert.equal(config.CLIENT_ID, c.clientId);
  assert.equal(config.CLIENT_SECRET, c.clientSecret);
  assert.equal(config.APP_ID, c.appId);
  assert.equal(config.APP_NAME, c.appName);
  assert.equal(config.BUNDLE_NAME, c.bundleName);
  assert.equal(config.APP_SIGN_KEY, c.appSignKey);
});

test('下载协议版本号由四段客户端版本稳定派生', () => {
  assert.equal(config.versionCodeFromName('25.0.90.1592'), '2500901592');
  assert.equal(config.versionCodeFromName('bad', 'fallback'), 'fallback');
});

test('客户端配置不包含用户会话字段', () => {
  const keys = Object.keys(config.XUNLEI_CLIENT).join(',').toLowerCase();
  for (const forbidden of ['accessToken', 'refreshToken', 'sessionId', 'uid', 'peerId', 'cert'])
    assert.equal(keys.includes(forbidden.toLowerCase()), false);
});

test('OAuth2 桌面 stat-info 头与 old-account sdk 版本分离', () => {
  const h = config.buildDesktopAuthHeaders({ clientId: 'cid', deviceId: 'did', deviceName: 'host' });
  assert.equal(h['x-client-id'], 'cid');
  assert.equal(h['x-sdk-version'], '5.1.4');
  assert.equal(h['x-protocol-version'], '301');
  assert.equal(h['x-device-id'], 'did');
  assert.equal(h['x-device-model'], undefined);
  assert.equal(h['x-device-name'], encodeURIComponent('host'));
  assert.equal(h['x-platform-version'], undefined);
  assert.match(h['user-agent'], /^thunder\/25\.0\.82\.1562 windows Mozilla\/5\.0 .* Chrome\/108\.0\.5359\.215 Electron\/22\.3\.27 Safari\/537\.36$/);
  assert.notEqual(h['x-sdk-version'], config.XUNLEI_CLIENT.sdkVersion);
});

test('OAuth2 默认头不臆造 statInfo 可选字段', () => {
  const h = config.buildDesktopAuthHeaders({ clientId: 'cid', deviceId: 'did' });
  assert.equal(h['x-device-id'], 'did');
  assert.equal(Object.hasOwn(h, 'x-device-name'), false);
  assert.equal(Object.hasOwn(h, 'x-device-model'), false);
  assert.equal(Object.hasOwn(h, 'x-os-version'), false);
  assert.equal(Object.hasOwn(h, 'x-platform-version'), false);
});
