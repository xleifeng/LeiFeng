'use strict';
// RPC 注册表：壳层唯一的「方法面」持有者。全部 leifeng.ui.v2.* / daemon.v1.* 方法
// 由服务主人插件在装配期注册（docs/specs/2026-09-28-rpc-plugin-registration.md），
// 壳只留传输与注册机制。注册与插件生命周期绑定：register 返回撤销函数，由注册方
// 在 dispose 时调用；重复注册直接拒绝（防隐式覆盖——plugin-admin 时代裸 Map.set
// 会静默顶掉别人，这里是显式报错）。

const ALLOWED_PREFIXES = Object.freeze(['leifeng.ui.v2.', 'daemon.v1.']);

class RpcRegistry {
  constructor() {
    this._methods = new Map();
    this._owners = new Map();
    this._healthSections = new Map();
    this._healthOwners = new Map();
  }

  /**
   * 批量注册。entries: Map 或任意 [name, handler] 可迭代对象。
   * 返回撤销函数（撤销本次注册且未被他人接管的条目）。
   */
  register(owner, entries) {
    if (typeof owner !== 'string' || !owner) throw new Error('RpcRegistry.register 需要非空 owner（插件 id）');
    if (!entries || typeof entries[Symbol.iterator] !== 'function') throw new Error('RpcRegistry.register 需要可迭代的 [name, handler] 条目');
    const added = [];
    for (const [name, handler] of entries) {
      if (typeof name !== 'string' || !ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix)))
        throw new Error(`RPC 方法名不在受支持命名空间: ${name}`);
      if (typeof handler !== 'function') throw new Error(`RPC handler 必须是函数: ${name}`);
      if (this._methods.has(name)) throw new Error(`RPC 方法已注册: ${name}（当前 owner: ${this._owners.get(name)}）`);
      this._methods.set(name, handler);
      this._owners.set(name, owner);
      added.push(name);
    }
    return () => {
      for (const name of added) {
        if (this._owners.get(name) === owner) { this._methods.delete(name); this._owners.delete(name); }
      }
    };
  }

  has(name) { return this._methods.has(name); }
  get(name) { return this._methods.get(name); }
  ownerOf(name) { return this._owners.get(name); }
  list() { return [...this._methods.keys()].sort(); }
  get size() { return this._methods.size; }

  // 状态贡献者：health（daemon.v1.health）是传输机制方法由 rpc-host 自注册，
  // 但其 engine/ repositories 子域是注册者状态——由各插件装配期贡献，health
  // 聚合快照时逐个调用。返回撤销函数。
  provideHealthStatus(owner, section, fn) {
    if (typeof owner !== 'string' || !owner) throw new Error('provideHealthStatus 需要非空 owner');
    if (typeof section !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(section)) throw new Error('provideHealthStatus section 必须是驼峰段名');
    if (typeof fn !== 'function') throw new Error('provideHealthStatus fn 必须是函数');
    if (this._healthSections.has(section)) throw new Error(`health section 已贡献: ${section}（owner: ${this._healthOwners.get(section)}）`);
    this._healthSections.set(section, fn);
    this._healthOwners.set(section, owner);
    return () => {
      if (this._healthOwners.get(section) === owner) { this._healthSections.delete(section); this._healthOwners.delete(section); }
    };
  }

  async healthSections() {
    const out = {};
    for (const [section, fn] of this._healthSections) {
      try { out[section] = await fn(); } catch { out[section] = null; }
    }
    return out;
  }

  // 同步版：remote.hello 等非 async 场景读已注册 section 的同步快照
  //（贡献者 fn 若返回 Promise 则该段为 Promise——调用方须用 async 版）。
  healthSectionsSync() {
    const out = {};
    for (const [section, fn] of this._healthSections) {
      try { out[section] = fn(); } catch { out[section] = null; }
    }
    return out;
  }
}

module.exports = { RpcRegistry, ALLOWED_PREFIXES };
