# 示例前端插件

面向插件作者的活样例。`hello-tools` 演示 `activate(host)` 宿主注入契约的三个贡献面：
侧栏导航项、设置弹窗分区（带内容组件）、路由页面。

## 启用方法

把插件目录拷贝或软链到运行时前端插件目录（gitignored，web-api 默认读仓库根的
`plugins-frontend/`，可用 `THUNDERD_FRONTEND_PLUGINS_DIR` 覆盖）：

```sh
mkdir -p plugins-frontend
ln -s ../examples/frontend-plugins/hello-tools plugins-frontend/hello-tools
```

浏览器刷新即生效（web-api 静态面每次请求实时扫盘，无需重启 daemon）。

## 目录约定

```
plugins-frontend/<id>/manifest.json   # id 必须等于目录名；capabilities 声明依赖的视图能力
plugins-frontend/<id>/ui.js           # ESM，导出 activate(host)；【禁止 import 'vue'】
```

## host 面

`{ vue, rpc, navItems, routes, settingSections, taskDetailPanels }`——`vue` 为宿主共享实例
（172 个语义导出：h / ref / computed / onMounted / Teleport / watchEffect / …）；
`rpc(method, params)` 直调 daemon JSON-RPC 面；其余数组是贡献槽，push 即注册。
`taskDetailPanels` 项形如 `{ id, label, component, kernelIds?, requiresBridge? }`——
任务详情抽屉按内核/桥会话过滤挂载（参考仓库根 plugins-frontend/panel-* 产品面板）。
注意：mdui 等自定义元素在 h() 里**没有 Vue slot 对象语义**，slot 内容用带
`slot` 属性的子节点（`h('span', { slot: 'header' }, ...)`）。能力门控（bootstrap `capabilities.views`）与路由守卫由宿主
统一执行，插件不用关心。

完整契约与实施背景见 `docs/specs/2026-09-28-pluggable-frontend-u2-design.md`（§5）
与 `docs/reports/2026-09-28-pluggable-frontend-u2-verification.md`。

## daemon 插件管理界面

设置弹窗 →「插件管理」分区可开关 daemon 装配插件（`thunder.ui.v2.plugins.*`
RPC，重启 daemon 后生效）；`runtime-config` 是基础插件，界面置灰不可禁用。
