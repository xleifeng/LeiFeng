'use strict';

const validators = require('./validators');

function createHistoryLinkMethods({ historyService = null, linkService = null } = {}) {
  const methods = new Map();
  if (historyService) {
    methods.set('thunder.ui.v2.history.query', (params, ctx) => historyService.query(validators.historyQuery(params && params[0]), ctx));
    methods.set('thunder.ui.v2.history.get', (params, ctx) => historyService.get(validators.historyId(params && params[0]).historyId, ctx));
    methods.set('thunder.ui.v2.history.remove', (params, ctx) => historyService.remove(validators.historyIds(params && params[0]).historyIds, ctx));
    methods.set('thunder.ui.v2.history.clear', (params, ctx) => historyService.clear(validators.historyQuery(params && params[0]), ctx));
    methods.set('thunder.ui.v2.history.createDraft', (params, ctx) => historyService.createDraft(validators.historyId(params && params[0]).historyId, ctx));
  }
  if (linkService) {
    methods.set('thunder.ui.v2.links.query', (params, ctx) => linkService.query(validators.linksQuery(params && params[0]), ctx));
    methods.set('thunder.ui.v2.links.get', (params, ctx) => linkService.get(validators.linkId(params && params[0]).linkId, ctx));
    methods.set('thunder.ui.v2.links.save', (params, ctx) => linkService.save(validators.linkSave(params && params[0]), ctx));
    methods.set('thunder.ui.v2.links.setFavorite', (params, ctx) => { const input = validators.object(params && params[0]); if (typeof input.linkId !== 'string' || !input.linkId || typeof input.favorite !== 'boolean') throw validators.invalid('linkId/favorite 无效'); return linkService.setFavorite(input.linkId, input.favorite, input, ctx); });
    methods.set('thunder.ui.v2.links.setTags', (params, ctx) => { const input = validators.linkTags(params && params[0]); return linkService.setTags(input.linkId, input.tags, input, ctx); });
    methods.set('thunder.ui.v2.links.remove', (params, ctx) => linkService.remove(validators.linkIds(params && params[0]).linkIds, ctx));
    methods.set('thunder.ui.v2.links.createDraft', (params, ctx) => linkService.createDraft(validators.linkId(params && params[0]).linkId, ctx));
  }
  return methods;
}

module.exports = { createHistoryLinkMethods };
