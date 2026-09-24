# Cordis 上游来源清单

本目录仅收录 tlei 运行时需要的 Cordis 上游包。dsh 仅作为架构参考，没有复制其源码或补丁。

| 项目 | 固定值 |
|---|---|
| 上游 | https://github.com/cordiverse/cordis |
| Git commit | `56b3d4f725681cf4556c1a8695a709cc3b6eed74` |
| 上游版本 | `cordis@4.0.0-rc.7`、`@cordisjs/plugin-loader@1.0.0-rc.5`、`@cordisjs/plugin-include@1.0.4` |
| 源码包 | `https://codeload.github.com/cordiverse/cordis/tar.gz/56b3d4f725681cf4556c1a8695a709cc3b6eed74` |
| 源码包 SHA256 | `a1ee72d28c0db7367348ad6e6214f35ae4c8c62d5a220fe9013300bb1fb4f4d9` |
| 许可证 | MIT，全文见 [cordis/LICENSE](cordis/LICENSE) |

已通过 GitHub commit API 核对完整 commit，三个包均从上述同一份归档的 `packages/core`、`packages/loader`、`packages/include` 目录提取。`cosmokit`、`@standard-schema/spec`、`js-yaml` 等外部依赖由根 `package-lock.json` 锁定。

| 上游路径 | 上游版本 | 原始目录 SHA256 | 许可证 |
|---|---|---|---|
| `packages/core` | `4.0.0-rc.7` | `b2f581b2ca5e5653fa7b80a30bd8c33fd47bd3e660bfe068e10edd6357861046` | MIT |
| `packages/loader` | `1.0.0-rc.5` | `f543d12ca48cdd31d2017c84fc38c6f9b3be6b66b8d7ed7f5e387fd888b0a70b` | MIT |
| `packages/include` | `1.0.4` | `f913e2679c423f8cb48332d58d877cb639efa155a39291b111cd01095f28f21e` | MIT |

目录摘要算法：按相对路径字典序遍历上游原始目录内全部普通文件，依次把 UTF-8 相对路径、单个 NUL 字节和原始文件字节写入 SHA256。摘要针对修改前的上游源码，便于独立核对。

本地变更逐项见 [cordis/MODIFICATIONS.md](cordis/MODIFICATIONS.md)。根目录运行 `npm ci`、`npm run build:vendor`、`npm run test:vendor` 验证。构建会生成三个包的 `lib/`，包括 ESM JavaScript 和 TypeScript 声明。
