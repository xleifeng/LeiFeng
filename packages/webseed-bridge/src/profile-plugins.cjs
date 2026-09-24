'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createDaemonClient } = require('./daemon-client');
const { createQbitRecipient } = require('./recipient-qbit');
const { createServer } = require('./http-server');
const { createOrchestrator } = require('./orchestrator');
const { preflightBridgeInputs, runBridgeBatch } = require('./inputs');
const { createInjector } = require('./torrent-injector');
const { detectDataRoot, buildSessionFiles } = require('./data-root');
const { Verifier } = require('./verifier');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function createBridgePluginRegistry({
  daemonClientFactory = createDaemonClient,
  recipientFactory = createQbitRecipient,
  serverFactory = createServer,
  orchestratorFactory = createOrchestrator,
  logger = () => {},
} = {}) {
  const configPlugin = async (ctx, config) => {
    if (!LOOPBACK.has(config.host)) throw new Error('bridge-host 只能绑定 loopback');
    if (!['hybrid', 'serve'].includes(config.mode)) throw new Error('bridge-host mode 无效');
    if (!Array.isArray(config.inputs) || !config.inputs.length) throw new Error('bridge-host 输入为空');
    if (!config.savePath) throw new Error('bridge-host 缺少 savePath');
    const inputs = await preflightBridgeInputs(config.inputs, { defaultSavePath: config.savePath });
    if (config.mode === 'serve' && (inputs.length !== 1 || inputs[0].kind !== 'torrent' || inputs[0].error)) {
      throw new Error('serve 模式需要一个有效 .torrent');
    }
    if (inputs.every((item) => item.error)) throw new Error('bridge-host 所有输入预检失败');
    ctx.provide('bridgeConfig', { ...config, inputs });
  };
  const daemonPlugin = {
    inject: ['bridgeConfig'],
    async apply(ctx) {
      const config = ctx.bridgeConfig;
      const client = daemonClientFactory({ host: config.daemonHost, port: config.daemonPort,
        bearerToken: config.bearerToken, csrfToken: config.csrfToken, origin: config.origin, nonce: config.nonce });
      if (config.mode === 'hybrid') {
        const account = await client.rpc('thunder.ui.v2.account.refresh', [{}]);
        if (!account.account?.valid || !account.session?.registered || !account.engine?.notified) {
          throw new Error('迅雷登录验收未通过：账号、session、原生引擎通知须全部有效');
        }
      }
      ctx.provide('bridgeDaemon', client);
    },
  };
  const recipientPlugin = {
    inject: ['bridgeConfig'],
    apply(ctx) {
      const config = ctx.bridgeConfig;
      ctx.provide('recipient', recipientFactory({ host: config.qbitHost, port: config.qbitPort,
        username: config.qbitUsername, password: config.qbitPassword }));
    },
  };
  const httpPlugin = {
    inject: ['bridgeConfig', 'bridgeDaemon'],
    async apply(ctx) {
      const config = ctx.bridgeConfig;
      const sessions = new Map();
      const inputResults = [];
      const { server, port, host } = await serverFactory({ sessions, inputResults, port: config.port, host: config.host, logger });
      ctx.provide('bridgeHttp', { sessions, inputResults, server, host, port });
      return () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
  const orchestratorPlugin = {
    inject: ['bridgeConfig', 'bridgeDaemon', 'recipient', 'bridgeHttp'],
    async apply(ctx) {
      const config = ctx.bridgeConfig;
      const http = ctx.bridgeHttp;
      const orch = orchestratorFactory({ savePath: config.savePath, bridgeHost: http.host,
        bridgePort: http.port, daemonClient: ctx.bridgeDaemon, recipient: ctx.recipient,
        sessionStore: http.sessions });
      try {
        if (config.mode === 'serve') {
          const input = config.inputs[0];
          const injector = await createInjector();
          const parsed = await injector.parse(input.raw);
          const detected = detectDataRoot(parsed, input.savePath);
          const rootDir = detected?.rootDir || path.join(input.savePath, `${input.infohash}.torrent`);
          const strip = detected?.strip ?? true;
          const { mapped, fileMap } = buildSessionFiles(parsed, rootDir, strip);
          const verifier = new Verifier({ parsed: mapped, rootDir });
          verifier.verifyAll();
          http.sessions.set(input.infohash, { verifier, parsed, rootDir, fileMap });
          const baseUrl = `http://${http.host}:${http.port}/seeds/${input.infohash}/`;
          const { injected } = await injector.injectAndVerify(input.raw, baseUrl);
          const output = config.out || `${input.filePath.replace(/\.torrent$/i, '')}.webseed.torrent`;
          fs.writeFileSync(output, injected, { flag: 'wx' });
          http.inputResults.push({ index: 0, kind: 'torrent', infohash: input.infohash, ok: true, session: true });
        } else {
          http.inputResults.push(...await runBridgeBatch(config.inputs, orch, { concurrency: config.concurrency }));
          if (!http.inputResults.some((item) => item.ok)) {
            const error = new Error('bridge-host 所有输入执行失败'); error.code = 'BRIDGE_BATCH_FAILED'; throw error;
          }
        }
        ctx.provide('bridgeOrchestrator', orch);
        return () => orch.close();
      } catch (error) { orch.close(); throw error; }
    },
  };

  return {
    'runtime-config': { plugin: configPlugin, provides: ['bridgeConfig'], defaults: {
      mode: 'hybrid', host: '127.0.0.1', port: 7127, daemonHost: '127.0.0.1', daemonPort: 16800,
      qbitHost: '127.0.0.1', qbitPort: 8085, qbitUsername: '', qbitPassword: '',
      bearerToken: '', csrfToken: '', origin: '', nonce: '', savePath: '', inputs: [], concurrency: 2, out: '',
    }, configKeys: ['mode', 'host', 'port', 'daemonHost', 'daemonPort', 'qbitHost', 'qbitPort', 'qbitUsername', 'qbitPassword', 'bearerToken', 'csrfToken', 'origin', 'nonce', 'savePath', 'inputs', 'concurrency', 'out'] },
    'bridge-daemon-client': { plugin: daemonPlugin, provides: ['bridgeDaemon'], requires: ['bridgeConfig'] },
    'recipient-qbit': { plugin: recipientPlugin, provides: ['recipient'], requires: ['bridgeConfig'] },
    'bridge-seed-http': { plugin: httpPlugin, provides: ['bridgeHttp'], requires: ['bridgeConfig', 'bridgeDaemon'] },
    'bridge-orchestrator': { plugin: orchestratorPlugin, provides: ['bridgeOrchestrator'], requires: ['bridgeConfig', 'bridgeDaemon', 'recipient', 'bridgeHttp'] },
  };
}

module.exports = { createBridgePluginRegistry };
