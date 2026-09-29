'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fromFileUrl } = require('../../host/src/file-url');

test('fromFileUrl：POSIX 形态与 localhost 保持原语义', { skip: process.platform === 'win32' }, () => {
  assert.equal(fromFileUrl('file:///home/yj/seed.torrent'), '/home/yj/seed.torrent');
  assert.equal(fromFileUrl('file://localhost/home/yj/seed.torrent'), '/home/yj/seed.torrent');
});

test('fromFileUrl：非 file:// 与畸形输入原样返回', { skip: process.platform === 'win32' }, () => {
  assert.equal(fromFileUrl('/plain/path.torrent'), '/plain/path.torrent');
  assert.equal(fromFileUrl('https://example.test/x'), 'https://example.test/x');
  assert.equal(fromFileUrl(''), '');
  // 带主机名的 file://（非 localhost）无本机语义，不猜路径
  assert.equal(fromFileUrl('file://nas/share/a.torrent'), 'file://nas/share/a.torrent');
  // 解码失败（坏 percent 序列）退回未解码原文，不抛
  assert.equal(fromFileUrl('file:///a%zz.torrent'), '/a%zz.torrent');
});

// win32 分隔符与盘符形态只有在该平台才可断言（CI/Linux 上跳过，不Mock platform）
test('fromFileUrl：win32 盘符形态解码为标准盘符路径', { skip: process.platform !== 'win32' }, () => {
  assert.equal(fromFileUrl('file:///C:/Users/test/dl/ubuntu.torrent'), 'C:\\Users\\test\\dl\\ubuntu.torrent');
  // percent 编码的中文与空格；正斜杠统一为反斜杠
  assert.equal(fromFileUrl('file:///D:/%E7%A7%8D%E5%AD%90/a%20b.torrent'), 'D:\\种子\\a b.torrent');
  // 宽松形态 file://C:/x（无三斜杠）同样可解
  assert.equal(fromFileUrl('file://C:/dl/a.torrent'), 'C:\\dl\\a.torrent');
  // UNC 不经此处特判：保持反斜杠形态交上层
  assert.equal(fromFileUrl('file:///C:/x/'), 'C:\\x\\');
});

test('fromFileUrl：POSIX 下盘符 URL 不转 Windows 形态', { skip: process.platform === 'win32' }, () => {
  // Linux 宿主上 file:///C:/x 是字面路径 /C:/x（wine 场景不存在此输入，保持原样即可）
  assert.equal(fromFileUrl('file:///C:/dl/a.torrent'), '/C:/dl/a.torrent');
});
