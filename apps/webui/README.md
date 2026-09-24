# 迅雷 Linux WebUI

这是面向 `thunderd` 的独立 Vue 3 WebUI，采用迅雷桌面端的布局和交互语言重新实现，不依赖 Electron renderer，也不再包含 AriaNg、AngularJS、jQuery 或 iframe。

## 当前实现

界面已切换为迅雷原生式壳层和下载中心：`#/download/downloading`、`#/download/completed` 使用 V2 tasks query、稳定 cursor、虚拟列表、任务选择/范围选择、能力驱动右键菜单、快捷键、离线快照和任务详情。创建链路支持 raw torrent 上传、链接/BT 预检与提交、磁力 metadata 轮询、重复任务处理、保存目录草稿更新和任务组视图。任务操作、回收站、重命名/移动/重下载对话框、BT 文件详情、种子导出、下载策略、限速/全速、P2P/P2S/代理、队列、计划任务、账号/VIP、私人空间、下载记录、链接库、媒体预览、系统集成、通知、浏览器接管、远程节点和诊断页均已接入。

## 已接入能力

- 全部、下载中、已完成、回收站四类任务视图。
- HTTP/HTTPS、磁力、BT、eD2k、thunder 链接和多行批量预检/创建。
- 暂停、恢复、移入回收站、永久删除、重命名、移动、重下载和能力驱动的任务菜单。
- V2 任务列表字段、进度、速度、剩余时间、错误和 BT 标签。
- 链接批量预检、raw torrent 上传、BT 文件选择、磁力 metadata 状态和重复任务处理。
- 保存目录校验、最近目录持久化、one-key 安全回退策略和任务组字节聚合基础。
- 下载设置：并发/全局限速/全速快照、通道开关、代理秘密引用、空闲下载、完成动作与计划任务。
- 媒体令牌和 Range 播放、主机打开/定位、浏览器扩展配对、远程节点状态、脱敏诊断 ZIP 导出。

真实 native recycle/recover/rename/move/redownload、网络代理出口与 BT 运行中子文件能力仍以 daemon 探针结果为准；native 缺失时仅使用明确标注的安全 fallback。当前未接入能力不会伪装成可用按钮。

云盘、片库和云端播放不属于本项目范围；远程 mTLS listener、超级通道、试用加速和账号链接同步在未配置/未探针时保持 capability 关闭。

## 开发与构建

```bash
npm --prefix webui install
npm --prefix webui test
npm --prefix webui run build
```

构建输出在 `webui/dist/`，由 daemon 同端口提供：

```text
http://127.0.0.1:16800/
```

开发服务器默认监听 5173，并把 `/jsonrpc` 代理到 `127.0.0.1:16800`：

```bash
npm --prefix webui run dev
```

完整验证：

```bash
npm --prefix webui run typecheck
npm --prefix webui test
npm --prefix webui run test:e2e
node --test daemon/test/unit/*.test.js daemon/test/architecture/*.test.js
```

真实 BT/magnet 矩阵（需要本机 Wine/SDK，测试只使用 loopback tracker/seeder 和 `/tmp`）：

```bash
THUNDERD_RUN_CREATE_V2_BT_IT=1 THUNDERD_CREATE_V2_BT_PORT=16921 \
  node --test daemon/test/integration/create-v2-bt.it.test.js
THUNDERD_RUN_TASK_OPERATIONS_IT=1 THUNDERD_TASK_OPERATIONS_PORT=16945 \
  node --test daemon/test/integration/task-operations-v2.it.test.js
```

## 资源与许可

正式构建不导入 `recon/C-asar/tree/main-renderer` 中的迅雷 Electron bundle、原 CSS 或专有图片。界面由本项目重新实现，第三方依赖见 `THIRD_PARTY_NOTICES.md`。
