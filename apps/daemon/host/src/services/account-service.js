'use strict';

const { classifyVipAccount } = require('../vip-account');

class AccountService {
  constructor({ auth, vip = null, privateSpace = null, linkSync = null, eventBus = null } = {}) { if (!auth) throw new Error('AccountService auth is required'); this.auth = auth; this.vip = vip; this.privateSpace = privateSpace; this.linkSync = linkSync; this.eventBus = eventBus; }
  async getStatus({ refresh = false } = {}) {
    const status = await this.auth.getStatus({ refresh });
    const tier = classifyVipAccount(status.account || {});
    return {
      loginFlow: { state: status.loginFlow?.state || 'idle', problemCode: status.loginFlow?.error || undefined },
      account: {
        valid: !!status.account?.valid,
        isVip: tier.isVip,
        isDownloadVip: tier.isDownloadVip,
        isSuperVip: tier.isSuperVip,
        isPlatinumVip: tier.isPlatinumVip,
        isPanVip: tier.isPanVip,
        userVas: tier.userVas,
        vipType: tier.vipType,
        vipLevel: tier.vipLevel,
        checkedAt: status.account?.checkedAt == null ? null : Number(status.account.checkedAt),
      },
      credential: { refreshTokenPresent: !!status.token?.refreshTokenPresent, accessTokenExpiresAt: status.token?.accessTokenExpiresAt == null ? null : Number(status.token.accessTokenExpiresAt) },
      session: { registered: !!status.session?.registered, lastKeepAliveAt: status.session?.lastKeepAliveAt == null ? null : Number(status.session.lastKeepAliveAt), problemCode: status.session?.lastError || undefined },
      engine: { notified: !!status.engine?.notified, notifiedAt: status.engine?.notifiedAt == null ? null : Number(status.engine.notifiedAt), problemCode: status.engine?.lastError || undefined },
    };
  }
  async startLogin() { return this.auth.startLogin(); }
  async cancelLogin() { if (typeof this.auth.cancelLogin === 'function') return this.auth.cancelLogin(); return { cancelled: false }; }
  async logout() { await this.vip?.disableAll?.({ reason: 'logout' }).catch?.(() => {}); this.privateSpace?.lockAll?.('logout', { clearKey: true }); await this.linkSync?.stopAndClearSession?.().catch?.(() => {}); const result = await this.auth.logout(); this.eventBus?.emit?.('account.changed', { state: 'logged-out' }); return result || { loggedOut: true }; }
  // 迅雷绑定域 RPC 归 kernel-thunder 后（2026-09-28 rpc-plugin-registration），
  // shell 协作者（privateSpace / linkSync）由 product-services 晚绑定注入——
  // kernel 装配期二者尚未存在，注入前的窗口内 logout 只做 auth 清理（与
  // qbit-only 缺席语义一致）。返回是否首次绑定成功，供装配层断言时序。
  attachShellCollaborators({ privateSpace = null, linkSync = null } = {}) {
    let bound = false;
    if (privateSpace && !this.privateSpace) { this.privateSpace = privateSpace; bound = true; }
    if (linkSync && !this.linkSync) { this.linkSync = linkSync; bound = true; }
    return bound;
  }
}

module.exports = { AccountService };
