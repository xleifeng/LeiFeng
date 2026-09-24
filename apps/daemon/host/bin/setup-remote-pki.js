#!/usr/bin/env node
'use strict';

const os = require('node:os');
const path = require('node:path');
const { PkiService } = require('../src/remote/pki-service');

function parseArgs(argv) {
  const result = { directory: '', nodeId: '', hosts: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--directory') result.directory = path.resolve(argv[++index] || '');
    else if (value === '--node-id') result.nodeId = String(argv[++index] || '');
    else if (value === '--host') result.hosts.push(String(argv[++index] || ''));
    else throw new Error('usage: setup-remote-pki.js --directory <dir> --node-id <id> --host <dns-or-ip> [--host <dns-or-ip>]');
  }
  if (!result.directory || !result.nodeId || !result.hosts.length) throw new Error('必须提供证书目录、节点 ID 和至少一个主机名或 IP');
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(result.nodeId)) throw new Error('节点 ID 只能包含字母、数字、点、下划线和连字符');
  const root = path.parse(result.directory).root;
  const home = path.resolve(os.homedir());
  if (result.directory === root || result.directory === home) throw new Error('证书目录不能是文件系统根目录或用户主目录');
  return result;
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const result = await new PkiService({ directory: input.directory }).ensureServerCertificate({ nodeId: input.nodeId, hosts: input.hosts });
  process.stdout.write(`${JSON.stringify({ nodeId: input.nodeId, directory: input.directory, certificate: result.cert, key: result.key, ca: result.ca, fingerprint: result.fingerprint }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
