'use strict';

// file:// URL → 本机路径。Node 自带 fileURLToPath 只吃 URL 对象且校验严格（file:///C:/x 合法，
// 但部分客户端发 file://C:/x 或未编码的中文/空格路径），这里宽松解码：
// - win32: file:///C:/a%20b → C:\a b（剥前导分隔符，还原标准盘符形态）
// - POSIX: file:///home/a → /home/a
// - 非 file://、他机主机名或解码失败原样返回，交由上层 existsSync/base64 分支处理。
function fromFileUrl(value) {
  const input = String(value || '');
  if (!/^file:\/\//i.test(input)) return input;
  let rest = input.replace(/^file:\/\//i, '');
  // file://host/path：主机名非空且非 localhost、也不是宽松盘符形态（file://C:/x）时是远端资源
  if (rest && !/^localhost(?=[\\/])/i.test(rest) && !/^[/\\]?[A-Za-z]:[\\/]/.test(rest)) {
    const slash = rest.search(/[\\/]/);
    if (slash > 0) return input;
  }
  rest = rest.replace(/^localhost(?=[\\/])/i, '');
  let decoded;
  try { decoded = decodeURIComponent(rest); } catch { decoded = rest; }
  if (process.platform === 'win32') {
    // /C:/x 或 \C:\x → C:\x（标准盘符形态，剥单个前导分隔符；其余前导斜杠统一为反斜杠）
    return decoded.replace(/^[/\\](?=[A-Za-z]:[\\/])/, '').replace(/\//g, '\\');
  }
  return decoded;
}

module.exports = { fromFileUrl };
