import { Context } from '@tlei/cordis';
import { readFile } from 'node:fs/promises';
import { composeProfile, dumpConfig } from './config.mjs';

const DEFAULT_DISPOSE_TIMEOUT_MS = 10_000;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function bootProfile({ profile, registry, profilePatch, userPatch, context, disposeTimeoutMs = DEFAULT_DISPOSE_TIMEOUT_MS }) {
  const config = composeProfile({ profile, registry, profilePatch, userPatch });
  const root = context ?? new Context();
  const fibers = [];
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const fiber of fibers.reverse()) {
      try {
        await withTimeout(Promise.resolve(fiber.dispose()), disposeTimeoutMs, `dispose ${fiber.name}`);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'profile dispose failed');
  };
  try {
    for (const row of config.plugins) {
      const fiber = root.plugin(row.plugin, row.config);
      fibers.push(fiber);
      await fiber;
      // Cordis 日志可能吞掉 setup 错误；读取 Fiber 状态，防止下游错误开放监听面。
      if (fiber.state === 3) throw new Error(`${row.id}: plugin setup failed`);
    }
    return { context: root, config, dispose };
  } catch (error) {
    try { await dispose(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'profile boot and cleanup failed');
    }
    throw error;
  }
}

export function parseArgv(argv) {
  const options = { profile: undefined, dumpConfig: false, configPath: undefined, rest: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--profile' || arg === '--config') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new TypeError(`${arg} requires a value`);
      if (arg === '--profile') options.profile = value;
      else options.configPath = value;
    } else if (arg === '--dump-config') {
      options.dumpConfig = true;
    } else {
      options.rest.push(arg);
    }
  }
  if (!options.profile) throw new TypeError('--profile is required');
  return options;
}

export async function readUserPatch(path) {
  if (!path) return undefined;
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new TypeError('config file must contain an object');
  for (const key of Object.keys(data)) {
    if (key !== 'plugins') throw new TypeError(`config file: unknown field ${key}`);
  }
  return data.plugins;
}

/** 返回退出码；调用方可传入自己的 signal/输出端，便于隔离测试。 */
export async function runCli({ registry, argv = process.argv.slice(2), profilePatch, userPatch, parseProfileArgs, signals = process, output = process.stdout, errorOutput = process.stderr, disposeTimeoutMs }) {
  let instance;
  try {
    const args = parseArgv(argv);
    const filePatch = await readUserPatch(args.configPath);
    if (args.rest.length && !parseProfileArgs) throw new TypeError(`unknown argument: ${args.rest[0]}`);
    const argvPatch = parseProfileArgs ? await parseProfileArgs(args.rest, args.profile) : undefined;
    const patch = [...(filePatch ?? []), ...(userPatch ?? []), ...(argvPatch ?? [])];
    if (args.dumpConfig) {
      output.write(`${dumpConfig(composeProfile({ profile: args.profile, registry, profilePatch, userPatch: patch }))}\n`);
      return 0;
    }
    instance = await bootProfile({ profile: args.profile, registry, profilePatch, userPatch: patch, disposeTimeoutMs });
    return await new Promise(resolve => {
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        signals.off('SIGTERM', stop);
        signals.off('SIGINT', stop);
        try { await instance.dispose(); resolve(0); }
        catch (error) { errorOutput.write(`${error.message}\n`); resolve(1); }
      };
      signals.on('SIGTERM', stop);
      signals.on('SIGINT', stop);
    });
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    if (instance) {
      try { await instance.dispose(); } catch (cleanupError) { errorOutput.write(`${cleanupError.message}\n`); }
    }
    return 1;
  }
}
