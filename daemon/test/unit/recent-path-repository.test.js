'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RecentPathRepository } = require('../../host/src/repositories/recent-path-repository');

test('recent paths are durable, de-duplicated and capped at ten entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-paths-v2-'));
  const filePath = path.join(dir, 'recent.json');
  const repository = new RecentPathRepository({ filePath });
  for (let index = 0; index < 12; index += 1) repository.remember(`/downloads/${index}`);
  assert.equal(repository.list().length, 10);
  assert.equal(repository.list()[0], '/downloads/11');
  repository.remember('/downloads/5');
  assert.equal(repository.list()[0], '/downloads/5');
  const reloaded = new RecentPathRepository({ filePath });
  assert.equal(reloaded.list()[0], '/downloads/5');
  reloaded.remove('/downloads/5');
  assert.equal(reloaded.list().includes('/downloads/5'), false);
  reloaded.clear();
  assert.deepEqual(reloaded.list(), []);
});
