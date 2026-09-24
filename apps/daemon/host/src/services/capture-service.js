'use strict';

const fs = require('node:fs');
const path = require('node:path');

function captureError(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

class CaptureService {
  constructor({ tokenStore, createDraftService, maxUrls = 100, desktopConfigPath = null, endpoint = null } = {}) { if (!tokenStore || typeof tokenStore.createPairing !== 'function' || !createDraftService) throw new Error('CaptureService dependencies are incomplete'); this.tokens = tokenStore; this.createDraftService = createDraftService; this.maxUrls = maxUrls; this.desktopConfigPath = desktopConfigPath; this.endpoint = endpoint; }
  startPairing({ permissions } = {}) { return this.tokens.createPairing({ permissions }); }
  acceptPairing(input) { return this.tokens.acceptPairing(input); }
  listClients() { return this.tokens.list(); }
  revokeClient(clientId) { return this.tokens.revoke(clientId); }
  authenticate(token, origin) { return this.tokens.authenticate(token, origin); }
  provisionDesktopCapture() {
    if (!this.desktopConfigPath || !this.endpoint) throw captureError('DESKTOP_CAPTURE_UNAVAILABLE', '桌面接管配置路径或本机地址不可用');
    const issued = this.tokens.issueClient({ origin: 'app://thunder-desktop', name: '桌面协议接管', permissions: ['submit'] });
    const directory = path.dirname(this.desktopConfigPath);
    const temporary = `${this.desktopConfigPath}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, `${JSON.stringify({ endpoint: this.endpoint, token: issued.token, origin: issued.origin }, null, 2)}\n`, { mode: 0o600, flag: 'w' });
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, this.desktopConfigPath);
      try { fs.chmodSync(this.desktopConfigPath, 0o600); } catch {}
      this.tokens.revokeOrigin(issued.origin, { exceptClientId: issued.clientId });
      return { clientId: issued.clientId, endpoint: this.endpoint, configPath: this.desktopConfigPath };
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      this.tokens.revoke(issued.clientId);
      throw captureError('DESKTOP_CAPTURE_CONFIG_FAILED', `桌面接管凭据写入失败: ${error.message}`);
    }
  }
  async capture({ urls, referrer = null, suggestedName = null, targetNodeId = null, mode = 'preflight' } = {}, principal = {}) {
    if (!principal || !principal.clientId) throw captureError('UNAUTHORIZED', '未配对的浏览器扩展');
    if (!Array.isArray(urls) || !urls.length || urls.length > this.maxUrls) throw captureError('CAPTURE_URLS_INVALID', '一次最多发送 100 个链接');
    const inputs = urls.map((value) => String(value || '').trim()).filter(Boolean);
    if (inputs.length !== urls.length || inputs.some((value) => !/^(?:https?|ftp|magnet|ed2k|thunder):/i.test(value))) throw captureError('UNSUPPORTED_PROTOCOL', '浏览器接管只支持下载协议链接');
    if (mode === 'silent') throw captureError('CAPTURE_POLICY_REQUIRED', '静默接管必须先经过下载策略确认');
    const result = await this.createDraftService.preflight({ inputs: inputs.map((value) => ({ kind: 'link', value })), suggestedName, referrer, targetNodeId });
    return { ...result, capturedBy: principal.clientId };
  }
  async captureTorrent({ filePath, originalName = 'capture.torrent' } = {}, principal = {}) {
    if (!principal || !principal.clientId) throw captureError('UNAUTHORIZED', '未配对的下载接管客户端');
    if (typeof filePath !== 'string' || !filePath) throw captureError('INVALID_TORRENT', 'torrent 文件无效');
    const draft = await this.createDraftService.createTorrentDraftFromFile(filePath, { originalName });
    return { draft, capturedBy: principal.clientId };
  }
}

module.exports = { CaptureService, captureError };
