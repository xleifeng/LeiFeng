# Cordis 本地修改日志

上游固定为 `cordiverse/cordis@56b3d4f725681cf4556c1a8695a709cc3b6eed74`。下列变动仅用于本项目的私有 workspace 和构建，没有移植 dsh 补丁。

1. `packages/core/package.json`：包名改为私有 `@tlei/cordis`，移除可选的 Cordis 官方 peer 包声明及上游 CLI 入口；保留外部运行依赖与上游版本。对应移除 `packages/core/bin.js`，避免旧 CLI 绕过 tlei profile launcher。
2. `packages/loader/package.json`：包名改为私有 `@tlei/cordis-loader`，将 core 关系改为本地 workspace 依赖；移除上游开发依赖和可选 peer 声明。
3. `packages/include/package.json`：包名改为私有 `@tlei/cordis-include`，将 core/loader 关系改为本地 workspace 依赖；移除上游开发依赖与 peer 声明。
4. `packages/loader/src/**/*.ts`、`packages/include/src/index.ts`：只把 `cordis` 和 `@cordisjs/plugin-loader` 导入及类型扩展目标替换为上述私有包名。运行逻辑未改。
5. `tsconfig.base.json`：移除本项目不使用的上游 `@cordisjs/unyaml/types` 类型依赖；其余编译选项保持上游原值。
6. 新增 `build.mjs` 与 `test/lifecycle.test.mjs`：用 esbuild 构建 Node ESM、TypeScript 生成声明，并验证 provider 卸载、异步清理、子 Fiber 释放。

| 本地修改 | 验证 | 上游状态 |
|---|---|---|
| 1–5：包名、内部引用、CLI 与类型配置 | `npm ci`、三包 ESM 导入、`npm run build:vendor` | tlei 专用适配；未提交上游，也无需上游补丁 |
| 6：构建脚本 | 从空 `lib/` 重建 JS 与声明，`npm run build:vendor` 通过 | tlei 专用构建；未提交上游 |
| 6：生命周期用例 | `npm run test:vendor` 4/4，包括异步 setup 期间卸载 | 本地回归用例；未提交上游；未修改上游运行逻辑 |

上游原始测试随包保留；本项目的 Node 生命周期测试单独运行。`lib/` 由本地构建生成，可用固定锁文件重复生成。
