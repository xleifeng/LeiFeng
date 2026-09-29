'use strict';
// 前端插件静态服务：/plugins-registry.json 聚合 + /plugins-frontend/<id>/<file> 映射与穿越防护。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createWebApiServer } = require('../src/server');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `leifeng-fpstatic-${process.pid}-`));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function get(port, url) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: url }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

test('plugins-registry.json 聚合有效 manifest，坏 manifest 跳过', async () => {
  const dir = makeTempDir();
  fs.mkdirSync(path.join(dir, 'hello'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'hello', 'manifest.json'), JSON.stringify({ id: 'hello', capabilities: ['hello'], navItems: [{ to: '/hello', label: '你好' }] }));
  fs.mkdirSync(path.join(dir, 'broken'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'broken', 'manifest.json'), '{ not json');
  fs.mkdirSync(path.join(dir, 'mismatch'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'mismatch', 'manifest.json'), JSON.stringify({ id: 'other-id' }));
  const server = createWebApiServer({ client: { invoke: async () => ({}) }, frontendPluginsDir: dir });
  const port = await listen(server);
  try {
    const res = await get(port, '/plugins-registry.json');
    assert.equal(res.status, 200);
    const payload = JSON.parse(res.body);
    assert.deepEqual(payload.plugins.map((p) => p.id), ['hello']);
  } finally { server.close(); server.closeAllConnections?.(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('plugins-registry.json 跟随软链插件目录（README 推荐用法）', async () => {
  const realDir = makeTempDir();
  const linkDir = makeTempDir();
  fs.mkdirSync(path.join(realDir, 'hello'), { recursive: true });
  fs.writeFileSync(path.join(realDir, 'hello', 'manifest.json'), JSON.stringify({ id: 'hello' }));
  // Dirent 对软链报 symlink 不报 directory——扫描须 stat 目标判定，否则软链插件全部失踪
  fs.symlinkSync(path.join(realDir, 'hello'), path.join(linkDir, 'hello'), 'dir');
  const server = createWebApiServer({ client: { invoke: async () => ({}) }, frontendPluginsDir: linkDir });
  const port = await listen(server);
  try {
    const res = await get(port, '/plugins-registry.json');
    assert.equal(res.status, 200);
    const payload = JSON.parse(res.body);
    assert.deepEqual(payload.plugins.map((p) => p.id), ['hello']);
  } finally { server.close(); server.closeAllConnections?.(); fs.rmSync(realDir, { recursive: true, force: true }); fs.rmSync(linkDir, { recursive: true, force: true }); }
});

test('plugins-frontend/<id>/ui.js 服务文件 + 穿越拒绝', async () => {
  const dir = makeTempDir();
  fs.mkdirSync(path.join(dir, 'hello'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'hello', 'ui.js'), 'export const nav = 1');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'top');
  const server = createWebApiServer({ client: { invoke: async () => ({}) }, frontendPluginsDir: dir });
  const port = await listen(server);
  try {
    const ok = await get(port, '/plugins-frontend/hello/ui.js');
    assert.equal(ok.status, 200);
    assert.match(ok.headers['content-type'], /javascript/);
    assert.equal(ok.body, 'export const nav = 1');
    // URL 解析层已归一化 ../，不落进插件前缀分支——断言核心是寻址不到目录外文件（403/404 均不可达）
    const traversal = await get(port, '/plugins-frontend/../secret.txt');
    assert.ok(traversal.status === 403 || traversal.status === 404, `穿越应不可达，实际 ${traversal.status}`);
    const missing = await get(port, '/plugins-frontend/hello/nope.js');
    assert.equal(missing.status, 404);
  } finally { server.close(); server.closeAllConnections?.(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('frontendPluginsDir 为 null 时不劫持任何路径', async () => {
  const server = createWebApiServer({ client: { invoke: async () => ({}) }, frontendPluginsDir: null });
  const port = await listen(server);
  try {
    const res = await get(port, '/plugins-registry.json');
    assert.equal(res.status, 404);
  } finally { server.close(); server.closeAllConnections?.(); }
});
