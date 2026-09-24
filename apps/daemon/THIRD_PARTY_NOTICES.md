# Third-party notices

本地资料库使用 `better-sqlite3@13.0.2`（MIT，https://github.com/WiseLibs/better-sqlite3）。
计划任务使用 `luxon@3.7.2`（MIT，https://github.com/moment/luxon）。
诊断 ZIP 导出使用 `archiver@8.0.0`（MIT，https://github.com/archiverjs/node-archiver）。

当前开发环境没有安装 native binding 时，`SqliteDatabase` 使用系统 `sqlite3` CLI 作为可验证的开发/恢复后备；生产部署应执行 `npm --prefix daemon ci` 安装锁定依赖。
