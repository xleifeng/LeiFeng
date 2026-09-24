'use strict';

// 官方客户端常量的唯一来源。clientSecret 是应用级协议常量，不是用户凭据；
// 运行时仍不得把它打印、写入 registry 或 RPC。环境变量允许部署时替换测试/轮换值。
function versionCodeFromName(value, fallback = '2500821562') {
  const match = String(value || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,2})\.(\d{1,4})$/);
  if (!match) return fallback;
  return match.slice(1).map((part, index) => String(Number(part)).padStart(index === 3 ? 4 : 2, '0')).join('');
}

const RUNTIME_RELEASE_VERSION = process.env.THUNDERD_WINDOWS_SDK_VERSION || process.env.THUNDERD_SDK_VERSION_NAME || '25.0.82.1562';
const XUNLEI_CLIENT = Object.freeze({
  clientId: 'XW-G4v1H72tgfJym',
  // main.js 的 clientSecret_win_prod；旧 account 链的 secret 不用于 OAuth2 device flow。
  clientSecret: process.env.THUNDERD_CLIENT_SECRET || 'Qbaferw2knfQKqxa25EYJGtZ2_6755CMwzXBN3ctW54',
  appId: '0',
  appName: 'com.xunlei.thunderx',
  bundleName: 'com.xunlei.thunderx',
  appSignKey: 'n&Ng)QE3EZ',
  clientName: 'xl_xdas',
  clientVersion: versionCodeFromName(RUNTIME_RELEASE_VERSION),
  releaseVersion: RUNTIME_RELEASE_VERSION,
  sdkVersion: '0.0.12',
  protocolVersion: '301',
});

// @xbase/electron_auth_kit 的 OAuth2 stat-info 常量（与 old-account sdkVersion
// 0.0.12 不同）。这些值来自解出的 main-renderer/634.js；不要与 VIP
// speedup 的 clientVersion/clientName 混用。
const AUTH_SDK_VERSION = '5.1.4';
const AUTH_DEVICE_MODEL = 'Windows';
const AUTH_PLATFORM_VERSION = '0';
const AUTH_OS_VERSION = process.env.THUNDER_AUTH_OS_VERSION || '10.0.19045';
const AUTH_ELECTRON_VERSION = '22.3.27';
const AUTH_CHROME_VERSION = '108.0.5359.215';
// main.js 的 AppMetaDataManager.genUserAgent() 返回的桌面产品前缀。
// 版本号来自本地 program/version 与 XDASKernel.dll 的编译字符串。
const AUTH_USER_AGENT_PREFIX = `thunder/${XUNLEI_CLIENT.releaseVersion} windows`;
const AUTH_DEFAULT_USER_AGENT = `${AUTH_USER_AGENT_PREFIX} Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${AUTH_CHROME_VERSION} Electron/${AUTH_ELECTRON_VERSION} Safari/537.36`;

function buildDesktopAuthHeaders({ clientId = XUNLEI_CLIENT.clientId, deviceId,
  deviceName, osVersion, deviceModel, platformVersion,
  userAgent = process.env.THUNDER_AUTH_USER_AGENT || AUTH_DEFAULT_USER_AGENT } = {}) {
  const h = {
    'content-type': 'application/json',
    'x-client-id': clientId,
    'x-sdk-version': AUTH_SDK_VERSION,
    'x-protocol-version': XUNLEI_CLIENT.protocolVersion,
    'user-agent': userAgent,
  };
  if (deviceId) h['x-device-id'] = deviceId;
  // statInfo2StatHeaders 只在 statInfo 显式提供时发送这些可选字段；
  // 官方当前 OAuth2Client 实例只传 deviceId。保留显式参数供有证据的覆盖使用。
  if (deviceName) h['x-device-name'] = encodeURIComponent(deviceName);
  if (osVersion) h['x-os-version'] = encodeURIComponent(osVersion);
  if (deviceModel) h['x-device-model'] = encodeURIComponent(deviceModel);
  if (platformVersion) h['x-platform-version'] = encodeURIComponent(platformVersion);
  return h;
}

module.exports = {
  XUNLEI_CLIENT,
  CLIENT_ID: XUNLEI_CLIENT.clientId,
  CLIENT_SECRET: XUNLEI_CLIENT.clientSecret,
  APP_ID: XUNLEI_CLIENT.appId,
  APP_NAME: XUNLEI_CLIENT.appName,
  BUNDLE_NAME: XUNLEI_CLIENT.bundleName,
  APP_SIGN_KEY: XUNLEI_CLIENT.appSignKey,
  AUTH_SDK_VERSION,
  AUTH_DEVICE_MODEL,
  AUTH_PLATFORM_VERSION,
  AUTH_OS_VERSION,
  AUTH_ELECTRON_VERSION,
  AUTH_CHROME_VERSION,
  AUTH_USER_AGENT_PREFIX,
  AUTH_DEFAULT_USER_AGENT,
  buildDesktopAuthHeaders,
  versionCodeFromName,
};
