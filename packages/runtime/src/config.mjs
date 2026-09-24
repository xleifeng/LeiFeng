import { PROFILES } from './profiles.mjs';

const ROW_KEYS = new Set(['id', 'enabled', 'config']);
const ENTRY_KEYS = new Set(['plugin', 'provides', 'requires', 'defaults', 'schema', 'configKeys']);
const SECRET_KEY = /(?:secret|token|password|passkey|session|peer.?id|user.?code|auth|cookie|credential|private.?key)/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label}: unknown field ${key}`);
  }
}

function merge(base, patch) {
  if (!isRecord(base) || !isRecord(patch)) return structuredClone(patch);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    result[key] = key in result ? merge(result[key], value) : structuredClone(value);
  }
  return result;
}

function validateSchema(schema, value, id) {
  if (!schema) return value;
  const validate = schema['~standard']?.validate;
  if (typeof validate !== 'function') throw new TypeError(`${id}: invalid Standard Schema`);
  const result = validate(value);
  if (result && typeof result.then === 'function') throw new TypeError(`${id}: async schema is unsupported`);
  if (result?.issues?.length) {
    throw new TypeError(`${id}: invalid config: ${result.issues.map(issue => issue.message).join('; ')}`);
  }
  return result.value;
}

function normalizeRegistry(registry) {
  const entries = registry instanceof Map ? [...registry] : Object.entries(registry ?? {});
  const result = new Map();
  for (const [id, definition] of entries) {
    if (result.has(id)) throw new TypeError(`duplicate plugin ID: ${id}`);
    if (!isRecord(definition)) throw new TypeError(`${id}: expected plugin definition`);
    assertKeys(definition, ENTRY_KEYS, id);
    if (!definition.plugin) throw new TypeError(`${id}: missing plugin`);
    for (const field of ['provides', 'requires']) {
      if (definition[field] !== undefined &&
          (!Array.isArray(definition[field]) || definition[field].some(name => typeof name !== 'string' || !name))) {
        throw new TypeError(`${id}: ${field} must be an array of service names`);
      }
    }
    if (definition.configKeys !== undefined &&
        (!Array.isArray(definition.configKeys) || definition.configKeys.some(key => typeof key !== 'string' || !key))) {
      throw new TypeError(`${id}: configKeys must be an array of field names`);
    }
    result.set(id, definition);
  }
  return result;
}

function serviceNames(value) {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value;
  return Object.keys(value);
}

function applyPatch(rows, patch, label) {
  if (patch === undefined) return;
  if (!Array.isArray(patch)) throw new TypeError(`${label} must be an array`);
  const seen = new Set();
  for (const item of patch) {
    if (!isRecord(item)) throw new TypeError(`${label}: expected patch row`);
    assertKeys(item, ROW_KEYS, label);
    if (typeof item.id !== 'string' || !item.id) throw new TypeError(`${label}: missing ID`);
    if (seen.has(item.id)) throw new TypeError(`${label}: duplicate plugin ID: ${item.id}`);
    seen.add(item.id);
    const row = rows.get(item.id);
    if (!row) throw new TypeError(`${label}: unknown plugin ID: ${item.id}`);
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') {
      throw new TypeError(`${label}: ${item.id}.enabled must be boolean`);
    }
    if (item.config !== undefined) {
      if (!isRecord(item.config)) throw new TypeError(`${label}: ${item.id}.config must be an object`);
      row.config = merge(row.config, item.config);
    }
    if (item.enabled !== undefined) row.enabled = item.enabled;
  }
}

/** 合成顺序：base → 形态 → profile patch → 用户 patch。 */
export function composeProfile({ profile, registry, profilePatch, userPatch }) {
  const ids = PROFILES[profile];
  if (!ids) throw new TypeError(`unknown profile: ${profile}`);
  const definitions = normalizeRegistry(registry);
  const rows = new Map();
  for (const id of ids) {
    if (rows.has(id)) throw new TypeError(`duplicate plugin ID in profile: ${id}`);
    const definition = definitions.get(id);
    if (!definition) throw new TypeError(`${profile}: missing plugin ${id}`);
    rows.set(id, {
      id,
      enabled: true,
      config: structuredClone(definition.defaults ?? {}),
      provides: serviceNames(definition.provides ?? definition.plugin.provide),
      requires: serviceNames(definition.requires ?? definition.plugin.inject),
      plugin: definition.plugin,
      schema: definition.schema ?? definition.plugin.Config,
      configKeys: definition.configKeys,
    });
  }
  applyPatch(rows, profilePatch, 'profile patch');
  applyPatch(rows, userPatch, 'user patch');
  const active = [...rows.values()].filter(row => row.enabled);
  const providers = new Map();
  for (const row of active) {
    if (row.configKeys) assertKeys(row.config, new Set(row.configKeys), `${row.id}.config`);
    row.config = validateSchema(row.schema, row.config, row.id);
    for (const service of row.provides) {
      if (providers.has(service)) throw new TypeError(`multiple providers for ${service}: ${providers.get(service)}, ${row.id}`);
      providers.set(service, row.id);
    }
  }
  for (const row of active) {
    for (const service of row.requires) {
      if (!providers.has(service)) throw new TypeError(`${row.id}: missing provider for ${service}`);
      if (active.findIndex(item => item.id === providers.get(service)) >= active.indexOf(row)) {
        throw new TypeError(`${row.id}: provider for ${service} must start earlier`);
      }
    }
  }
  return { profile, plugins: active };
}

export function redact(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    if (/magnet:\?/i.test(value)) return '[REDACTED MAGNET]';
    return value;
  }
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return value;
}

export function dumpConfig(config) {
  return JSON.stringify(redact({
    profile: config.profile,
    plugins: config.plugins.map(({ id, config: options, provides, requires }) => ({ id, config: options, provides, requires })),
  }), null, 2);
}
