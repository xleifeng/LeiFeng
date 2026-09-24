'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');

test('V2 domain/services/repositories do not depend on aria2 adapter symbols', () => {
  const root = path.join(__dirname, '../../host/src'); const dirs = ['domain', 'services', 'repositories']; const files = dirs.flatMap((dir) => fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.js')).map((name) => path.join(root, dir, name)));
  const forbidden = /aria2\.|system\.multicall|AriaNg/;
  for (const file of files) assert.equal(forbidden.test(fs.readFileSync(file, 'utf8')), false, file);
});
