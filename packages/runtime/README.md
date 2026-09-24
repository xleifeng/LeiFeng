# tlei profile launcher

`src/index.mjs` 导出 `composeProfile`、`dumpConfig`、`bootProfile`、`runCli`。三个固定 profile 为 `thunderd`、`thunderd-core` 和 `bridge-host`。

注册表可用对象或 `Map`：

```js
const registry = {
  'runtime-config': {
    plugin: runtimeConfig,
    provides: ['tleiConfig'],
    requires: [],
    defaults: {},
    configKeys: ['env'],
  },
};
```

`plugin` 是 Cordis 的函数或含 `apply` 的对象。`provides` 和 `requires` 在启动前检查唯一 provider、缺失依赖和顺序；插件仍须在自己的 Fiber 中调用 `ctx.provide()`。如有配置结构，请声明 Standard Schema `schema`，或用 `configKeys` 限制顶层字段。覆写数组只接受 `{ id, enabled?, config? }`，顺序为 profile 默认、profile patch、用户 patch。`--dump-config` 只组合与脱敏，不建立 Cordis Context，也不获取 daemon lock。

`bootProfile()` 返回 `{ context, config, dispose }`，逐个等待插件激活，失败时逆序回收已安装 Fiber。`runCli()` 处理 `--profile`、`--config`、`--dump-config`、SIGTERM/SIGINT 和有界释放；产品形态的额外参数可由 `parseProfileArgs(rest, profile)` 转为覆写数组。
