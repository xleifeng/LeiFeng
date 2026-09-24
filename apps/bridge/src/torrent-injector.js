// torrent-injector.js — url-list 注入器：改写 .torrent（info 字典外追加 url-list，不改 infohash）。
// ESM 依赖（parse-torrent/bencode 均为 ESM-only），故本模块导出 async 工厂。

'use strict';

async function createInjector() {
  const [{ default: parseTorrent }, { default: bencode }] = await Promise.all([
    import('parse-torrent'),
    import('bencode'),
  ]);

  // 注入 url-list 并返回改写后的 .torrent Buffer
  // raw: 原 .torrent Buffer；baseUrl: 如 http://127.0.0.1:7127/seeds/<infohash>/
  // BEP-19：url-list 为根字典级 key（info 之外），尾斜杠 → 客户端自动拼 name/path/file
  function injectUrlList(raw, baseUrl) {
    // 注：bencode@4 的 decode(buffer, 'utf8') 对 Buffer 输入有 bug（ERR_INVALID_ARG_TYPE），
    // 故不传 text encoding，保持默认（键与字符串值为 Buffer/混合），追加 url-list 后回编码。
    const decoded = bencode.decode(raw);
    const url = String(baseUrl).endsWith('/') ? String(baseUrl) : `${String(baseUrl)}/`;
    // 先清除既有 url-list 键（decode 后键为 Buffer 形态；不清除会产出 bencode 重复键的
    // 规范违规种子，解析方取值不确定）
    for (const key of [...Object.keys(decoded)]) {
      const k = Buffer.isBuffer(key) ? key.toString('utf8') : key;
      if (k === 'url-list') delete decoded[key];
    }
    decoded['url-list'] = [Buffer.from(url, 'utf8')];
    return bencode.encode(decoded);
  }

  // 解析 .torrent（Buffer）→ parse-torrent 结构
  async function parse(raw) {
    return parseTorrent(raw);
  }

  // 双向校验：注入后 infohash 不变、urlList 读回一致
  async function injectAndVerify(raw, baseUrl) {
    const before = await parse(raw);
    const injected = injectUrlList(raw, baseUrl);
    const after = await parse(injected);
    if (before.infoHash !== after.infoHash) {
      const err = new Error(`infohash 漂移: ${before.infoHash} -> ${after.infoHash}`);
      err.code = 'INFOHASH_DRIFT';
      throw err;
    }
    const expect = String(baseUrl).endsWith('/') ? String(baseUrl) : `${String(baseUrl)}/`;
    const got = (after.urlList || [])[0];
    if (got !== expect) {
      const err = new Error(`url-list 读回不一致: ${got}`);
      err.code = 'URLLIST_MISMATCH';
      throw err;
    }
    return { injected, infoHash: after.infoHash, parsed: after };
  }

  return { injectUrlList, parse, injectAndVerify };
}

module.exports = { createInjector };
