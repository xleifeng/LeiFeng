'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { DraftRepository } = require('../../host/src/repositories/draft-repository');

test('draft repository persists revision/state and rejects stale commit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-v2-')); const filePath = path.join(dir, 'data', 'create-drafts.json'); const repo = new DraftRepository({ filePath, idFactory: () => 'draft-1' }); repo.load();
  const draft = repo.create({ kind: 'http', state: 'ready', normalizedSource: 'http://x/a', displayName: 'a.bin' });
  assert.equal(draft.draftId, 'draft-1'); const committing = repo.beginCommit(draft.draftId, draft.revision, 'op-1'); assert.equal(committing.state, 'committing');
  assert.throws(() => repo.beginCommit(draft.draftId, draft.revision, 'op-2'), (error) => error.code === 'DRAFT_NOT_READY');
  const finished = repo.finishCommit(draft.draftId, 'op-1', ['task-1']); assert.equal(finished.state, 'committed');
  const reloaded = new DraftRepository({ filePath }); reloaded.load(); assert.equal(reloaded.get('draft-1').state, 'committed');
});

test('committed drafts get a short idempotency retention window and are then swept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-sweep-v2-')); const filePath = path.join(dir, 'drafts.json'); let now = 1000;
  const clock = { now: () => now }; const repo = new DraftRepository({ filePath, clock, idFactory: () => 'draft-ttl' }); repo.load();
  const draft = repo.create({ state: 'ready', kind: 'http', displayName: 'a.bin', expiresAt: 5000 }); const committing = repo.beginCommit(draft.draftId, draft.revision, 'op'); const committed = repo.finishCommit(draft.draftId, 'op', ['task-1']);
  assert.equal(committed.expiresAt, 601000); now = 601001; assert.equal(repo.sweepExpired(), 1); assert.equal(repo.get(draft.draftId), null);
});
