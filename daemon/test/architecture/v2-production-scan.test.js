'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function files(root) { if (!fs.existsSync(root)) return []; return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(root, entry.name)) : entry.name.endsWith('.ts') || entry.name.endsWith('.vue') ? [path.join(root, entry.name)] : []); }
test('production WebUI source and daemon README expose only V2 vocabulary', () => { const roots = [path.join(__dirname, '../../../webui/src'), path.join(__dirname, '../../README.md')]; const forbidden = /aria-ng|ariang|aria2|angularjs|jquery|system\.multicall/i; for (const root of roots) { const targets = fs.statSync(root).isDirectory() ? files(root) : [root]; for (const file of targets) assert.equal(forbidden.test(fs.readFileSync(file, 'utf8')), false, file); } });
