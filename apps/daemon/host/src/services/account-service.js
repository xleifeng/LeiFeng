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
}

module.exports = { AccountService };
