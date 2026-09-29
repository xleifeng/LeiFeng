'use strict';
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function plugin(name, inject, apply) {
  return { name, inject, apply };
}

module.exports = { plugin, repoRoot };
