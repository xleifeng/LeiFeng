// bridge.test.js — node:test 单元测试：verifier / injector / http-server 应答矩阵。
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');

const { Verifier } = require('../src/verifier');
const { createServer } = require('../src/http-server');
const { createInjector } = require('../src/torrent-injector');

// fileMap 构造（与生产 buildSessionFiles 的 fileMap 部分同构）
function buildFileMap(parsed) {
  const map = new Map();
  for (const file of parsed.files) map.set(file.path, { file, physPath: file.path });
  return map;
}

// ---------- 测试工具：合成 torrent ----------

// 生成合成数据 + 对应 .torrent Buffer（bencode 库编码，不用注入器自身逻辑做夹具）
async function bencodeMod() { const m = await import('bencode'); return m.default; }

// files: [{path, data:Buffer}]；返回 {raw, layout, total, piecesBuf}（async：用 bencode 库编码）
async function makeTorrent({ name, files, pieceLength = 16384 }) {
  const bencode = await bencodeMod();
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : 1);
  let offset = 0;
  const layout = [];
  const all = Buffer.alloc(sorted.reduce((s, f) => s + f.data.length, 0));
  for (const f of sorted) {
    f.data.copy(all, offset);
    layout.push({ path: f.path, length: f.data.length, offset });
    offset += f.data.length;
  }
  const pieces = [];
  for (let p = 0; p * pieceLength < all.length; p++) {
    pieces.push(crypto.createHash('sha1').update(all.subarray(p * pieceLength, (p + 1) * pieceLength)).digest());
  }
  const fileList = sorted.length === 1 && sorted[0].path === name
    ? null
    : sorted.map((f) => ({ length: f.data.length, path: f.path.split('/') }));
  const info = fileList
    ? { files: fileList, name, 'piece length': pieceLength, pieces: Buffer.concat(pieces) }
    : { length: all.length, name, 'piece length': pieceLength, pieces: Buffer.concat(pieces) };
  const raw = bencode.encode({ announce: 'http://t/ann', info });
  return { raw, layout, total: all.length, piecesBuf: Buffer.concat(pieces) };
}

// （parsedLike 已移除：http-server/verifier 测试直接手写最小 parsed 结构）

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wsb-test-')); }

// ---------- verifier ----------

test('verifier: 完整数据全量通过 + 跨文件 piece 校验', async () => {
  const dir = tmpDir();
  const data1 = crypto.randomBytes(10000);
  const data2 = crypto.randomBytes(10000);
  fs.writeFileSync(path.join(dir, 'multi.bin.0'), data1);
  fs.writeFileSync(path.join(dir, 'multi.bin.1'), data2);
  // 两文件拼成 20000B，piece 16KB → piece0 跨文件
  const layout = [
    { path: 'multi.bin.0', length: 10000, offset: 0 },
    { path: 'multi.bin.1', length: 10000, offset: 10000 },
  ];
  const all = Buffer.concat([data1, data2]);
  const pieces = [];
  for (let p = 0; p * 16384 < all.length; p++) pieces.push(crypto.createHash('sha1').update(all.subarray(p * 16384, (p + 1) * 16384)).digest());
  const parsed = { infoHash: 'a'.repeat(40), name: 'multi.bin', pieceLength: 16384, pieces, length: 20000, files: layout };
  const v = new Verifier({ parsed, rootDir: dir });
  const r = v.verifyAll();
  assert.strictEqual(r.verified, 2);
  assert.strictEqual(r.total, 2);
  assert.ok(v.isRangeVerified(0, 20000));
  v.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verifier: 缺失文件/半写数据 → 对应 piece fail，verified 保守', async () => {
  const dir = tmpDir();
  const data = crypto.randomBytes(20000); // 2 pieces
  fs.writeFileSync(path.join(dir, 'half.bin'), data.subarray(0, 17000)); // piece1 半写
  const pieces = [];
  for (let p = 0; p * 16384 < data.length; p++) pieces.push(crypto.createHash('sha1').update(data.subarray(p * 16384, (p + 1) * 16384)).digest());
  const parsed = { infoHash: 'b'.repeat(40), name: 'half.bin', pieceLength: 16384, pieces, length: 20000,
    files: [{ path: 'half.bin', length: 20000, offset: 0 }] };
  const v = new Verifier({ parsed, rootDir: dir });
  const r = v.verifyAll();
  assert.strictEqual(r.verified, 1); // piece0 过，piece1 fail
  assert.ok(v.isRangeVerified(0, 16384));
  assert.ok(!v.isRangeVerified(0, 20000));
  v.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- injector ----------

test('injector: url-list 注入不改 infohash，读回一致', async () => {
  const injector = await createInjector();
  const { raw } = await makeTorrent({ name: 'inj.bin', files: [{ path: 'inj.bin', data: crypto.randomBytes(5000) }] });
  const baseUrl = 'http://127.0.0.1:7127/seeds/' + 'c'.repeat(40) + '/';
  const { injected, infoHash, parsed } = await injector.injectAndVerify(raw, baseUrl);
  assert.strictEqual(parsed.urlList[0], baseUrl);
  assert.ok(infoHash.length === 40);
  // 原始解析对比（injectAndVerify 内部已断言不漂移）
  const before = await injector.parse(raw);
  assert.strictEqual(before.infoHash, infoHash);
});

// ---------- http-server 应答矩阵 ----------

async function withServer({ parsed, rootDir }, fn) {
  const sessions = new Map();
  const verifier = new Verifier({ parsed, rootDir });
  verifier.verifyAll();
  sessions.set(parsed.infoHash, { verifier, parsed, rootDir, fileMap: buildFileMap(parsed, rootDir) });
  const { server, port } = await createServer({ sessions, port: 0 });
  try { await fn(`http://127.0.0.1:${port}`, parsed); } finally { server.close(); verifier.close(); }
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('http-server: 200 全量（单文件已验证）', async () => {
  const dir = tmpDir();
  const data = crypto.randomBytes(4000);
  fs.writeFileSync(path.join(dir, 's.bin'), data);
  const pieces = [crypto.createHash('sha1').update(data).digest()];
  const parsed = { infoHash: 'd'.repeat(40), name: 's.bin', pieceLength: 16384, pieces, length: data.length,
    files: [{ path: 's.bin', length: data.length, offset: 0 }] };
  await withServer({ parsed, rootDir: dir }, async (base) => {
    const r = await httpGet(`${base}/seeds/${parsed.infoHash}/s.bin`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.equals(data));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('http-server: 206 精确等于请求区间（libtorrent 契约）/ 覆盖未验证 piece → 按需验证或 503', async () => {
  const dir = tmpDir();
  const data = crypto.randomBytes(20000); // 2 pieces à 16KB
  fs.writeFileSync(path.join(dir, 'p.bin'), data.subarray(0, 16384)); // 仅 piece0 落盘
  const pieces = [];
  for (let p = 0; p * 16384 < data.length; p++) pieces.push(crypto.createHash('sha1').update(data.subarray(p * 16384, (p + 1) * 16384)).digest());
  const parsed = { infoHash: 'e'.repeat(40), name: 'p.bin', pieceLength: 16384, pieces, length: data.length,
    files: [{ path: 'p.bin', length: data.length, offset: 0 }] };
  await withServer({ parsed, rootDir: dir }, async (base) => {
    // 命中 piece0 → 206 区间逐字节等于请求区间
    const ok = await httpGet(`${base}/seeds/${parsed.infoHash}/p.bin`, { Range: 'bytes=0-1023' });
    assert.strictEqual(ok.status, 206);
    assert.strictEqual(ok.headers['content-range'], `bytes 0-1023/${data.length}`);
    assert.ok(ok.body.equals(data.subarray(0, 1024)));
    // 跨到 piece1（数据在盘但未验证）→ 按需验证通过 → 206 等于完整请求区间
    // （旧契约回子段 206 会被 libtorrent 判 invalid_range 断连——2026-09-23 评审反转）
    const partial = await httpGet(`${base}/seeds/${parsed.infoHash}/p.bin`, { Range: 'bytes=0-19999' });
    // piece1 未落盘 → hasAllFilesForRange false → 503
    assert.strictEqual(partial.status, 503);
    // 现在把 piece1 写盘 → 同一请求应按需验证成功 → 206 精确区间
    fs.writeFileSync(path.join(dir, 'p.bin'), data);
    const full = await httpGet(`${base}/seeds/${parsed.infoHash}/p.bin`, { Range: 'bytes=0-19999' });
    assert.strictEqual(full.status, 206);
    assert.strictEqual(full.headers['content-range'], `bytes 0-19999/${data.length}`);
    assert.ok(full.body.equals(data));
    // 纯未验证且已落盘 → 按需验证过 → 206（不是 503）
    const no = await httpGet(`${base}/seeds/${parsed.infoHash}/p.bin`, { Range: 'bytes=16384-19999' });
    assert.strictEqual(no.status, 206);
    // 未知路径 → 404
    const nf = await httpGet(`${base}/seeds/${parsed.infoHash}/nope.bin`);
    assert.strictEqual(nf.status, 404);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('http-server: Range 边界——suffix / end 超界 / 多区间忽略 / 416 / HEAD', async () => {
  const dir = tmpDir();
  const data = crypto.randomBytes(20000);
  fs.writeFileSync(path.join(dir, 'b.bin'), data);
  const pieces = [];
  for (let p = 0; p * 16384 < data.length; p++) pieces.push(crypto.createHash('sha1').update(data.subarray(p * 16384, (p + 1) * 16384)).digest());
  const parsed = { infoHash: '1f'.repeat(20), name: 'b.bin', pieceLength: 16384, pieces, length: data.length,
    files: [{ path: 'b.bin', length: data.length, offset: 0 }] };
  await withServer({ parsed, rootDir: dir }, async (base) => {
    // suffix range：bytes=-100 → 末 100 字节
    const sfx = await httpGet(`${base}/seeds/${parsed.infoHash}/b.bin`, { Range: 'bytes=-100' });
    assert.strictEqual(sfx.status, 206);
    assert.strictEqual(sfx.headers['content-range'], `bytes ${data.length - 100}-${data.length - 1}/${data.length}`);
    assert.ok(sfx.body.equals(data.subarray(data.length - 100)));
    // suffix N > fileSize → 整文件
    const sfxBig = await httpGet(`${base}/seeds/${parsed.infoHash}/b.bin`, { Range: `bytes=-${data.length + 500}` });
    assert.strictEqual(sfxBig.status, 206);
    assert.strictEqual(sfxBig.headers['content-range'], `bytes 0-${data.length - 1}/${data.length}`);
    // end 超界 → 钳到 fileSize-1
    const over = await httpGet(`${base}/seeds/${parsed.infoHash}/b.bin`, { Range: `bytes=0-${data.length + 999}` });
    assert.strictEqual(over.status, 206);
    assert.strictEqual(over.headers['content-range'], `bytes 0-${data.length - 1}/${data.length}`);
    // start 越界 → 416
    const bad = await httpGet(`${base}/seeds/${parsed.infoHash}/b.bin`, { Range: `bytes=${data.length + 1}-` });
    assert.strictEqual(bad.status, 416);
    // 多区间 → 忽略 Range 按 200 整文件（不回 416）
    const multi = await httpGet(`${base}/seeds/${parsed.infoHash}/b.bin`, { Range: 'bytes=0-99,200-299' });
    assert.strictEqual(multi.status, 200);
    assert.ok(multi.body.equals(data));
    // HEAD → 200 只回头
    const head = await new Promise((resolve, reject) => {
      http.request(`${base}/seeds/${parsed.infoHash}/b.bin`, { method: 'HEAD' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject).end();
    });
    assert.strictEqual(head.status, 200);
    assert.strictEqual(head.body.length, 0);
    assert.strictEqual(head.headers['content-length'], String(data.length));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('http-server: 数据未落盘 → 503（not-on-disk 快速路径，不白读）', async () => {
  const dir = tmpDir();
  const data = crypto.randomBytes(40000); // 3 pieces
  // 不写任何数据文件——整文件缺失
  const pieces = [];
  for (let p = 0; p * 16384 < data.length; p++) pieces.push(crypto.createHash('sha1').update(data.subarray(p * 16384, (p + 1) * 16384)).digest());
  const parsed = { infoHash: '2f'.repeat(20), name: 'miss.bin', pieceLength: 16384, pieces, length: data.length,
    files: [{ path: 'miss.bin', length: data.length, offset: 0 }] };
  await withServer({ parsed, rootDir: dir }, async (base) => {
    const r = await httpGet(`${base}/seeds/${parsed.infoHash}/miss.bin`, { Range: 'bytes=0-16383' });
    assert.strictEqual(r.status, 503);
    assert.ok(r.headers['retry-after']);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- data-root：数据根探测 ----------

test('data-root: 单文件种子 + <infohash>.torrent 元数据文件共存 → 不误选元数据文件', async () => {
  const { detectDataRoot } = require('../src/data-root');
  const dir = tmpDir();
  const data = crypto.randomBytes(8000);
  const infohash = '3f'.repeat(20);
  // 场景：daemon 落了 <infohash>.torrent 元数据【文件】；数据文件是 <name>
  fs.writeFileSync(path.join(dir, `${infohash}.torrent`), Buffer.from('d4:infod')); // 伪 bencode 元数据
  fs.writeFileSync(path.join(dir, 'single.dat'), data);
  const pieces = [crypto.createHash('sha1').update(data).digest()];
  const parsed = { infoHash: infohash, name: 'single.dat', pieceLength: 16384, pieces, length: data.length,
    files: [{ path: 'single.dat', length: data.length, offset: 0 }] };
  const detected = detectDataRoot(parsed, dir);
  assert.ok(detected, '应探测到数据根');
  assert.notStrictEqual(detected.rootDir, path.join(dir, `${infohash}.torrent`), '绝不能选中元数据文件');
  // 命中的根下能直接读到数据
  const fsx = require('node:fs');
  assert.ok(fsx.existsSync(detected.rootDir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('data-root: 迅雷形态 <infohash>.torrent/ 目录（strip）命中', async () => {
  const { detectDataRoot, buildSessionFiles } = require('../src/data-root');
  const dir = tmpDir();
  const infohash = '4f'.repeat(20);
  // 迅雷形态：目录 + 内容文件直接在内（种子 name 首段不落盘）
  const root = path.join(dir, `${infohash}.torrent`);
  fs.mkdirSync(root);
  const data = crypto.randomBytes(8000);
  fs.writeFileSync(path.join(root, 'inner.dat'), data);
  const pieces = [crypto.createHash('sha1').update(data).digest()];
  const parsed = { infoHash: infohash, name: '种子名', pieceLength: 16384, pieces, length: data.length,
    files: [{ path: '种子名/inner.dat', length: data.length, offset: 0 }] };
  const detected = detectDataRoot(parsed, dir);
  assert.ok(detected);
  assert.strictEqual(detected.rootDir, root);
  assert.strictEqual(detected.strip, true);
  // fileMap：URL 键 = 种子原始 path，physPath = 剥段后
  const { fileMap } = buildSessionFiles(parsed, detected.rootDir, detected.strip);
  assert.ok(fileMap.has('种子名/inner.dat'));
  assert.strictEqual(fileMap.get('种子名/inner.dat').physPath, 'inner.dat');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('data-root: 多文件原始布局 <name>/ 目录（非 strip）命中', async () => {
  const { detectDataRoot } = require('../src/data-root');
  const dir = tmpDir();
  const data = crypto.randomBytes(8000);
  fs.mkdirSync(path.join(dir, 'bundle'));
  fs.writeFileSync(path.join(dir, 'bundle', 'f1.dat'), data.subarray(0, 4000));
  fs.writeFileSync(path.join(dir, 'bundle', 'f2.dat'), data.subarray(4000));
  const pieces = [];
  for (let p = 0; p * 16384 < data.length; p++) pieces.push(crypto.createHash('sha1').update(data.subarray(p * 16384, (p + 1) * 16384)).digest());
  const parsed = { infoHash: '5f'.repeat(20), name: 'bundle', pieceLength: 16384, pieces, length: data.length,
    files: [
      { path: 'bundle/f1.dat', length: 4000, offset: 0 },
      { path: 'bundle/f2.dat', length: 4000, offset: 4000 },
    ] };
  const detected = detectDataRoot(parsed, dir);
  assert.ok(detected);
  assert.strictEqual(detected.rootDir, path.join(dir, 'bundle'));
  assert.strictEqual(detected.strip, true); // 形态 b：name 目录 = strip 语义
  fs.rmSync(dir, { recursive: true, force: true });
});

test('http-server: /status 输出会话状态', async () => {
  const dir = tmpDir();
  const data = crypto.randomBytes(100);
  fs.writeFileSync(path.join(dir, 'st.bin'), data);
  const parsed = { infoHash: 'f'.repeat(40), name: 'st.bin', pieceLength: 16384,
    pieces: [crypto.createHash('sha1').update(data).digest()], length: data.length,
    files: [{ path: 'st.bin', length: data.length, offset: 0 }] };
  await withServer({ parsed, rootDir: dir }, async (base) => {
    const r = await httpGet(`${base}/status`);
    assert.strictEqual(r.status, 200);
    const j = JSON.parse(r.body.toString());
    assert.strictEqual(j[parsed.infoHash].verifiedPieces, 1);
    assert.strictEqual(j[parsed.infoHash].name, 'st.bin');
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
