'use strict';

const fs = require('node:fs');
const path = require('node:path');

const safeMessage = (error, input) => input ? String(error.message).replaceAll(String(input), '[input]') : String(error.message);

function checkSavePath(target) {
  const resolved = path.resolve(target);
  let parent = resolved;
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) throw new Error('保存路径不可访问');
    parent = next;
  }
  if (!fs.statSync(parent).isDirectory()) throw new Error('保存路径的上级不是目录');
  fs.accessSync(parent, fs.constants.W_OK | fs.constants.X_OK);
  return resolved;
}

function parseBridgeInputs(argv, { cwd = process.cwd() } = {}) {
  const result = { command: '', data: '', port: 7127, daemonPort: 16800, host: '127.0.0.1', inputs: [] };
  let last = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { if (!result.command) result.command = arg; else throw new Error('未知位置参数'); continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 缺少值`);
    if (arg === '--magnet' || arg === '--torrent') { last = { kind: arg.slice(2), value, savePath: null }; result.inputs.push(last); }
    else if (arg === '--save-path') { if (!last) throw new Error('--save-path 必须跟在输入项之后'); last.savePath = path.resolve(cwd, value); }
    else if (arg === '--input-file') {
      const file = path.resolve(cwd, value);
      for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.trim(); if (!line || line.startsWith('#')) continue;
        let item;
        if (line.startsWith('{')) {
          let obj;
          try { obj = JSON.parse(line); } catch { throw new Error('input-file 包含无效 JSON 行'); }
          item = { kind: obj.kind || (String(obj.value || '').startsWith('magnet:') ? 'magnet' : 'torrent'), value: obj.value, savePath: obj.savePath ? path.resolve(path.dirname(file), obj.savePath) : null };
        } else item = { kind: line.startsWith('magnet:') ? 'magnet' : 'torrent', value: line, savePath: null };
        result.inputs.push(item); last = item;
      }
    } else if (arg === '--data') result.data = path.resolve(cwd, value);
    else if (arg === '--port' || arg === '--daemon-port') {
      const number = Number(value); if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`${arg} 端口无效`);
      result[arg === '--port' ? 'port' : 'daemonPort'] = number;
    } else if (arg === '--host') result.host = value;
    else if (arg === '--out') result.out = value;
    else throw new Error(`未知选项 ${arg}`);
  }
  return result;
}

async function preflightBridgeInputs(inputs, { defaultSavePath, cwd = process.cwd() } = {}) {
  const parseTorrent = (await import('parse-torrent')).default;
  const seen = new Set();
  const checked = [];
  for (const [index, item] of inputs.entries()) {
    const result = { index, kind: item.kind, savePath: item.savePath || defaultSavePath };
    try {
      if (!result.savePath) throw new Error('缺少保存路径');
      result.savePath = checkSavePath(result.savePath);
      if (item.kind === 'torrent') {
        const filePath = path.resolve(cwd, item.value);
        if (path.extname(filePath).toLowerCase() !== '.torrent') throw new Error('种子路径必须以 .torrent 结尾');
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('torrent 不是普通文件或超过 20 MiB');
        result.filePath = filePath;
        result.raw = fs.readFileSync(filePath);
        const parsed = await parseTorrent(result.raw);
        if (!parsed.pieces?.length || parsed.metaVersion === 2) throw new Error('只支持 BT v1 torrent');
        result.infohash = parsed.infoHash?.toLowerCase();
      } else if (item.kind === 'magnet') result.infohash = (await parseTorrent(item.value)).infoHash?.toLowerCase();
      else throw new Error('输入类型必须为 magnet 或 torrent');
      if (!/^[a-f0-9]{40}$/.test(result.infohash || '')) throw new Error('只支持 BT v1 infohash');
      if (seen.has(result.infohash)) { result.error = { code: 'DUPLICATE_INFOHASH', message: '同批次 infohash 重复' }; checked.push(result); continue; }
      seen.add(result.infohash);
      result.value = item.value;
    } catch (error) { result.error = { code: error.code || 'INVALID_INPUT', message: safeMessage(error, item.value) }; }
    checked.push(result);
  }
  return checked;
}

async function runBridgeBatch(preflight, orchestrator, { concurrency = 2 } = {}) {
  const results = new Array(preflight.length);
  let next = 0;
  async function worker() {
    while (next < preflight.length) {
      const item = preflight[next++];
      if (item.error) { results[item.index] = { index: item.index, kind: item.kind, infohash: item.infohash || null, ok: false, error: item.error }; continue; }
      try {
        const output = item.kind === 'magnet'
          ? await orchestrator.hybridDownload(item.value, { dataPath: item.savePath })
          : await orchestrator.hybridTorrent(item.raw, { dataPath: item.savePath, filename: path.basename(item.filePath) });
        results[item.index] = { index: item.index, kind: item.kind, infohash: item.infohash, ok: true, taskId: output.taskId, session: Boolean(output.session) };
      } catch (error) { results[item.index] = { index: item.index, kind: item.kind, infohash: item.infohash, ok: false, error: { code: error.code || 'BRIDGE_INPUT_FAILED', message: safeMessage(error, item.value) } }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), preflight.length) }, worker));
  return results;
}

module.exports = { parseBridgeInputs, preflightBridgeInputs, runBridgeBatch };
