'use strict';

const validators = require('./validators');

function createPrivateSpaceMethods({ privateSpace } = {}) {
  if (!privateSpace) throw new Error('privateSpace is required');
  return new Map([
    ['thunder.ui.v2.private.getStatus', () => privateSpace.getStatus()],
    ['thunder.ui.v2.private.setup', (params) => privateSpace.setup(validators.privateSetup(params && params[0]))],
    ['thunder.ui.v2.private.unlock', (params) => privateSpace.unlock(validators.privateUnlock(params && params[0]))],
    ['thunder.ui.v2.private.lock', (_params, ctx) => privateSpace.lock(ctx && ctx.privateSession)],
    ['thunder.ui.v2.private.queryTasks', (params, ctx) => ({ items: privateSpace.queryTasks(validators.privateQuery(params && params[0]), ctx) })],
    ['thunder.ui.v2.private.moveIn', (params, ctx) => privateSpace.moveIn(validators.privateMove(params && params[0]), ctx)],
    ['thunder.ui.v2.private.moveOut', (params, ctx) => privateSpace.moveOut(validators.privateMove(params && params[0], { out: true }), ctx)],
    ['thunder.ui.v2.private.changePassword', (params, ctx) => privateSpace.changePassword(validators.privatePasswordChange(params && params[0]), ctx)],
  ]);
}

module.exports = { createPrivateSpaceMethods };
