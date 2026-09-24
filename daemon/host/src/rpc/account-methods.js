'use strict';

const validators = require('./validators');

function createAccountMethods({ accountService } = {}) {
  if (!accountService) throw new Error('accountService is required');
  return new Map([
    ['thunder.ui.v2.account.get', () => accountService.getStatus({ refresh: false })],
    ['thunder.ui.v2.account.refresh', () => accountService.getStatus({ refresh: true })],
    ['thunder.ui.v2.account.startLogin', (params) => accountService.startLogin(validators.accountStart(params && params[0]))],
    ['thunder.ui.v2.account.cancelLogin', () => accountService.cancelLogin()],
    ['thunder.ui.v2.account.logout', () => accountService.logout()],
  ]);
}

module.exports = { createAccountMethods };
