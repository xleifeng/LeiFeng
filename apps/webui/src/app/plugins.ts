import { computed, reactive } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import type { Component } from 'vue'
import type { ViewCapabilityId } from '../stores/ui-capabilities'

/** 侧栏导航项定义（核心项见 NativeSidebar，插件贡献追加） */
export interface NavItemDef {
  to: string
  label: string
  capability?: ViewCapabilityId
  icon?: Component
}

/** 设置弹窗分区定义（核心项见 SettingDialog，插件贡献追加）。component 缺省时渲染标题空态。 */
export interface SettingSectionDef {
  id: string
  label: string
  capability?: ViewCapabilityId
  component?: Component
}

/**
 * 任务详情抽屉贡献面板（kernel-detail-panels）：面板本体由插件提供（webui 壳
 * 不内置内核专属展示）。component 接收 props：{ detail: TaskDetailV2 }。
 * kernelIds 限定面板只对指定内核的任务出现；requiresBridge 时仅当详情带桥
 * 会话快照（detail.bridge）才出现。
 */
export interface TaskDetailPanelDef {
  id: string
  label: string
  component: Component
  kernelIds?: string[]
  requiresBridge?: boolean
}

/**
 * 前端 UI 插件注册表（运行期）。响应式：loader 在 fetch /plugins-registry.json
 * + 动态 import 后 registerFrontendPlugin，消费方（侧栏/设置/路由）经派生
 * computed 自动重渲染。
 *
 * 与 daemon 侧 UI 能力注册表（leifengUiRegistry）对齐：插件的 navItems/routes/
 * settingSections 声明各自依赖的 capability；bootstrap capabilities.views 里
 * 缺失时（daemon 侧对应插件未装载）该项不渲染。
 */
export interface UiPlugin {
  id: string
  capabilities: ViewCapabilityId[]
  navItems?: NavItemDef[]
  routes?: RouteRecordRaw[]
  settingSections?: SettingSectionDef[]
  taskDetailPanels?: TaskDetailPanelDef[]
}

const registry = reactive<{ plugins: UiPlugin[] }>({ plugins: [] })

/** 运行期注册一个前端插件（重复 id 拒绝）。返回注销函数。 */
export function registerFrontendPlugin(plugin: UiPlugin): () => void {
  if (registry.plugins.some((p) => p.id === plugin.id)) return () => {}
  registry.plugins.push(plugin)
  return () => {
    const index = registry.plugins.indexOf(plugin)
    if (index >= 0) registry.plugins.splice(index, 1)
  }
}

/** 测试辅助：清空注册表（Playwright/单测场景隔离） */
export function resetFrontendPlugins() {
  registry.plugins.length = 0
}

/** 全部插件贡献的导航项（能力过滤在渲染点做） */
export const navContributions = computed(() => registry.plugins.flatMap((p) => p.navItems ?? []))

/** 全部插件贡献的路由（能力过滤由 router.beforeEach 守卫做） */
export const routeContributions = computed(() => registry.plugins.flatMap((p) => p.routes ?? []))

/** 全部插件贡献的设置分区（能力过滤在渲染点做） */
export const settingSectionContributions = computed(() => registry.plugins.flatMap((p) => p.settingSections ?? []))

/**
 * 全部插件贡献的任务详情面板。按任务过滤（kernelIds / requiresBridge）在
 * TaskDetailsDrawer 渲染点做——此处只汇总。
 */
export const taskDetailPanelContributions = computed(() => registry.plugins.flatMap((p) => p.taskDetailPanels ?? []))
