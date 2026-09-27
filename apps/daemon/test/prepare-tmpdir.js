'use strict';
// 测试前置：确保 os.tmpdir() 存在（Linux 配额 tmpfs 偶发缺失时 mkdtemp 会炸）。
// npm scripts 里 POSIX 一行（mkdir -p "${TMPDIR:-$HOME/tmp}"）在 Windows 无对应物，
// 用 Node 做平台中立。TMPDIR 未设且家目录可用时，Linux 上回落到家目录 tmp/（绕配额）；
// Windows 直接用系统 TEMP（%TEMP% 恒存在）。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'win32' && !process.env.TMPDIR) {
  const fallback = path.join(os.homedir(), 'tmp');
  try { fs.mkdirSync(fallback, { recursive: true }); process.env.TMPDIR = fallback; } catch { /* 家目录不可写：维持系统默认 */ }
} else {
  const dir = os.tmpdir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 已存在或无权限：交由测试自身报错 */ }
}
