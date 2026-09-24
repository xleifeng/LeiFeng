'use strict';
// 凭据钱包：auth.json 纯 IO 层（spec §5 / D1 / D2）。不做网络与状态判断。
// 纪律：tmp+rename 原子写；写入后 chmod 0600；load 纠正权限并告警一条；
//       损坏 → .corrupt-<ts> 备份 + 视为未登录（沿用 registry.js 惯例）。
const fs = require('fs');
const path = require('path');

const EMPTY = () => ({ version: 1, credentials: null, session: null, vip: null, meta: {} });

class CredentialWallet {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = EMPTY();
  }
  // 返回 true = 文件存在且含 session 块（daemon 启动可直接进 active，spec §5 持久化边界）
  load() {
    let obj = null;
    try {
      obj = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        try {
          const bak = this.filePath + '.corrupt-' + Date.now();
          fs.copyFileSync(this.filePath, bak);
          console.error('[auth-wallet] corrupted wallet backed up to', bak);
        } catch {}
      }
      this.data = EMPTY();
      return false;
    }
    if (!obj || typeof obj !== 'object' || obj.version !== 1) { this.data = EMPTY(); return false; }
    this.data = { ...EMPTY(), ...obj };
    try {
      const st = fs.statSync(this.filePath);
      if ((st.mode & 0o777) !== 0o600) {
        fs.chmodSync(this.filePath, 0o600);
        console.error('[auth-wallet] wallet permission corrected to 0600');
      }
    } catch {}
    return this.hasSession();
  }
  saveSync() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
  clear() {
    this.data = EMPTY();
    try { fs.unlinkSync(this.filePath); } catch {}
  }
  hasSession() { return !!(this.data.session && this.data.session.sessionId); }
}

module.exports = { CredentialWallet };
