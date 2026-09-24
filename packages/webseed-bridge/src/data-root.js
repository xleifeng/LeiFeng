// data-root.js — 数据根探测：种子布局 → 磁盘目录形态匹配。
// 共享模块（orchestrator hybrid 与 main serve 复用，原先两处重复实现已合并）。
//
// 迅雷落盘三层形态（HANDOVER §3）：
//   a) <savePath>/<infohash>.torrent/         目录（磁力元数据壳），内容文件直接在内（strip 种子 name 首段）
//   b) <savePath>/<种子name>/                  目录（多文件原始布局）
//   c) <savePath>/<种子name>                   单文件种子：数据文件本身
// 重名冲突变体：a 形态的 .1.torrent/.2.torrent 后缀。
// ⚠ 单文件种子时 <savePath>/<infohash>.torrent 是**文件**（daemon 元数据导出），
//   不是数据根——曾因此错配导致验证全败（产品化评审 F3），探测必须 stat 验目录。

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveOnDisk } = require('./verifier');

// 探测一个候选根。返回 { rootDir, strip } 或 null。
// cand: { root, strip } — strip=true 表示种子 name 首段不落盘（形态 a）
function probeRoot(parsed, cand) {
  let st;
  try { st = fs.statSync(cand.root); } catch { return null; }
  // strip 形态的根必须是目录；非 strip 形态的根可以是目录（多文件）或
  // 单文件种子的数据文件本身（形态 c）——fileMap 惰性解析会兜住文件形态。
  if (cand.strip && !st.isDirectory()) return null;

  const phys = (f) => (cand.strip ? f.path.split('/').slice(1).join('/') : f.path);
  // 命中判据：非 strip 单文件（root 即数据文件）直接认；其余要求
  // 至少一个种子文件确实落盘在该 root 下（防相邻文件/元数据文件误配）。
  if (!cand.strip && !st.isDirectory()) {
    const single = parsed.files.length === 1 && parsed.files[0].path === parsed.name;
    return single ? { rootDir: cand.root, strip: false } : null;
  }
  const hit = parsed.files.some((f) => {
    const rel = phys(f);
    if (!rel) return false;
    return fs.existsSync(path.join(cand.root, rel)) || resolveOnDisk(cand.root, rel) !== null;
  });
  if (!hit) return null;
  return { rootDir: cand.root, strip: cand.strip };
}

// 主入口：给 parsed（parse-torrent 结构）与 dataPath，返回 { rootDir, strip } 或 null。
function detectDataRoot(parsed, dataPath) {
  const infohash = parsed.infoHash;
  const singleFile = parsed.files.length === 1 && parsed.files[0].path === parsed.name;
  const candidates = [
    // 形态 a 优先（迅雷磁力默认）：infohash.torrent 目录 + 变体
    ...[ '', '.1', '.2', '.3', '.4' ].map((n) => ({ root: path.join(dataPath, `${infohash}${n}.torrent`), strip: true })),
    // 形态 c（单文件种子直落）：数据文件本身（非 strip）
    ...(singleFile ? [{ root: path.join(dataPath, parsed.name), strip: false }] : []),
    // 形态 b（原始布局）：<name>/ 目录，内容文件在其内（= strip 语义）
    { root: path.join(dataPath, parsed.name), strip: true },
    // 兜底：dataPath 即根，布局未剥段（如用户自摆目录）——仅多文件形态
    ...(singleFile ? [] : [{ root: dataPath, strip: false }]),
  ];
  for (const cand of candidates) {
    const probed = probeRoot(parsed, cand);
    if (probed) return probed;
  }
  return null;
}

// 建会话映射：fileMap（URL 键 = 种子原始 path）+ verifier 用的 mapped files。
function buildSessionFiles(parsed, rootDir, strip) {
  // 形态 c（单文件种子，root=数据文件本身）：physPath=''（resolveOnDisk(root,'')=root）
  const rootIsDataFile = !strip && parsed.files.length === 1 && parsed.files[0].path === parsed.name;
  const stripFile = (f) => ({ ...f, path: f.path.split('/').slice(1).join('/') });
  const mapped = (strip || rootIsDataFile)
    ? { ...parsed, files: parsed.files.map(stripFile) }
    : parsed;
  const fileMap = new Map();
  for (const file of parsed.files) {
    const phys = rootIsDataFile ? '' : (strip ? stripFile(file).path : file.path);
    // URL 键 = 种子原始 path；physPath = 磁盘相对路径（HTTP 层惰性 resolveOnDisk 用）
    fileMap.set(file.path, { file, physPath: phys });
  }
  return { mapped, fileMap };
}

module.exports = { detectDataRoot, buildSessionFiles };
