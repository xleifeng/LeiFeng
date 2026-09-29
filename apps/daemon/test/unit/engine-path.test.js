'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeComparableEnginePath } = require('../../host/src/engine-path');

test('normalizeComparableEnginePath：wine Z: 盘与 Windows 盘符路径归一到可比形态', () => {
  // wine 引擎回读的落盘路径（Z: 盘形态）
  assert.equal(normalizeComparableEnginePath('Z:\\home\\test\\downloads'), '/home/test/downloads');
  // native 引擎回读的 Windows 路径（原样语义，仅归一分隔符与大小写）
  assert.equal(normalizeComparableEnginePath('C:\\Users\\test\\Downloads'), 'c:/users/test/downloads');
  // 宿主 Linux 路径
  assert.equal(normalizeComparableEnginePath('/home/test/downloads/'), '/home/test/downloads');
  // 空值兜底
  assert.equal(normalizeComparableEnginePath(''), '/');
  assert.equal(normalizeComparableEnginePath(null), '/');
});
