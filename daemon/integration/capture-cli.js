#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

function fail(message, code = 1) { console.error(message); process.exitCode = code; }
function readConfig() {
  const file = process.env.THUNDERD_CAPTURE_CONFIG || path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '.', '.config'), 'thunder', 'capture.json');
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (!value.endpoint || !value.token || !value.origin) throw new Error('invalid config'); return value; } catch { throw new Error(`capture 配置不可用: ${file}`); }
}

function torrentPath(source) {
  if (!/^file:/i.test(source)) return null;
  const value = fileURLToPath(source);
  if (!/\.torrent$/i.test(value)) throw new Error('桌面接管只接受 .torrent 文件');
  const stat = fs.statSync(value);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 100 * 1024 * 1024) throw new Error('torrent 文件大小无效');
  return value;
}

async function submitCapture(source, config, request = fetch) {
  const headers = { authorization: `Capture ${config.token}`, origin: config.origin };
  const localTorrent = torrentPath(source);
  let url;
  let options;
  if (localTorrent) {
    const body = fs.readFileSync(localTorrent);
    if (body[0] !== 0x64) throw new Error('torrent bencode 无效');
    url = new URL('/api/v2/capture/torrent', config.endpoint).toString();
    options = { method: 'POST', headers: { ...headers, 'content-type': 'application/x-bittorrent', 'content-length': String(body.length), 'x-thunder-filename': encodeURIComponent(path.basename(localTorrent)) }, body };
  } else {
    if (!/^(?:https?|ftp|magnet|ed2k|thunder):/i.test(source)) throw new Error('需要受支持的下载链接或 .torrent 文件');
    url = new URL('/api/v2/capture', config.endpoint).toString();
    options = { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ urls: [source] }) };
  }
  const response = await request(url, options);
  const body = await response.text(); if (!response.ok) throw new Error(`capture 失败 (${response.status}): ${body.slice(0, 300)}`); return body;
}

async function main(argv) {
  const sourceIndex = argv.indexOf('--source-uri'); const source = sourceIndex >= 0 ? argv[sourceIndex + 1] : '';
  if (!source) throw new Error('需要受支持的下载链接或 .torrent 文件');
  process.stdout.write(`${await submitCapture(source, readConfig())}\n`);
}

if (require.main === module) main(process.argv.slice(2)).catch((error) => fail(error.message));

module.exports = { readConfig, torrentPath, submitCapture, main };
