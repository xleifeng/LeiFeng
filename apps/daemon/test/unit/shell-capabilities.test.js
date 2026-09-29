'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SHELL_FALLBACK_OPERATIONS, shellFallbackOperations } = require('../../host/src/domain/shell-capabilities');

test('壳回退操作七项恒真且冻结', () => {
  assert.deepEqual(Object.keys(SHELL_FALLBACK_OPERATIONS).sort(), ['btSelection', 'btSequential', 'move', 'recover', 'recycle', 'redownload', 'rename']);
  assert.ok(Object.values(SHELL_FALLBACK_OPERATIONS).every((v) => v === true));
  assert.throws(() => { SHELL_FALLBACK_OPERATIONS.recycle = false; }, TypeError);
});

test('shellFallbackOperations 按系统集成能力组装开放动作', () => {
  const full = shellFallbackOperations({ getCapabilities: () => ({ openOnHost: true, showInFolder: true }) });
  assert.equal(full.open, true);
  assert.equal(full.showInFolder, true);
  assert.equal(full.copyInfo, true);
  assert.equal(full.recycle, true);
  const bare = shellFallbackOperations(null);
  assert.equal(bare.open, false);
  assert.equal(bare.showInFolder, false);
});
