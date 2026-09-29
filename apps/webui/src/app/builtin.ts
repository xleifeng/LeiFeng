// P6（cordis-arch）：内置功能贡献化——侧栏导航、路由表、设置分区改经
// registerFrontendPlugin 同一贡献面注册（id 固定 'builtin'），与运行期前端插件
// 单轨合并；NativeSidebar / router / SettingDialog 不再各持一份本地清单。
// 响应式注册表保证消费方（computed 派生）自动重渲染，行为与双轨时代一致。
import { Download } from '@lucide/vue'
import type { RouteRecordRaw } from 'vue-router'
import { registerFrontendPlugin } from './plugins'
import type { ViewCapabilityId } from '../stores/ui-capabilities'

/** 内置路由（原 router/index.ts coreRoutes 原样迁移） */
export const builtinRoutes: RouteRecordRaw[] = [
  { path: '/', redirect: '/download' },
  { path: '/download', name: 'task-center', component: () => import('../views/downloads/TaskCenterPage.vue'), meta: { title: '下载', taskView: 'downloading' } },
  { path: '/download/downloading', redirect: (to) => ({ path: '/download', query: { ...to.query, tab: 'downloading' } }) },
  { path: '/download/completed', redirect: (to) => ({ path: '/download', query: { ...to.query, tab: 'completed' } }) },
  { path: '/private-space', name: 'private-space', component: () => import('../views/private-space/PrivateSpaceView.vue'), meta: { title: '私人空间', capability: 'private-space' } },
  { path: '/history', name: 'history', component: () => import('../views/history/DownloadHistoryView.vue'), meta: { title: '下载记录', capability: 'history' } },
  { path: '/links', name: 'links', component: () => import('../views/link-library/LinkLibraryView.vue'), meta: { title: '链接库', capability: 'link-library' } },
  { path: '/links/:id', name: 'link-details', component: () => import('../views/link-library/LinkDetailsView.vue'), meta: { title: '链接详情', capability: 'link-library' } },
  { path: '/trash', name: 'trash', component: () => import('../views/downloads/TrashView.vue'), meta: { title: '回收站', taskView: 'trash' } },
  { path: '/settings', name: 'settings', component: () => import('../views/settings/DownloadSettingsView.vue'), meta: { title: '下载设置' } },
  { path: '/settings/integration', name: 'integration-settings', component: () => import('../views/settings/IntegrationSettingsView.vue'), meta: { title: '系统集成' } },
  { path: '/remote', name: 'remote', component: () => import('../views/remote/RemoteDownloadsView.vue'), meta: { title: '远程下载', capability: 'remote' } },
  { path: '/diagnostics', name: 'diagnostics', component: () => import('../views/diagnostics/DiagnosticsView.vue'), meta: { title: '诊断' } },
  { path: '/status', redirect: '/diagnostics' },
]

/** 内置侧栏导航（原 NativeSidebar links 原样迁移） */
const builtinNavItems = [
  { to: '/download', label: '下载', icon: Download },
  { to: '/private-space', label: '私人空间', trashActive: true, capability: 'private-space' as ViewCapabilityId },
  { to: '/history', label: '下载记录', trashActive: true, capability: 'history' as ViewCapabilityId },
  { to: '/links', label: '链接库', trashActive: true, capability: 'link-library' as ViewCapabilityId },
]

/** 内置设置分区（原 SettingDialog navigation 迁移；component 缺省——核心分区由模板内联渲染） */
const builtinSettingSections = [
  { id: 'basic', label: '基本设置' },
  { id: 'download', label: '下载设置' },
  { id: 'tasks', label: '任务管理' },
  { id: 'automation', label: '计划任务' },
  { id: 'integration', label: '系统集成' },
  { id: 'plugin-manager', label: '插件管理' },
]

/** 幂等注册（main.ts 与测试各自调用一次）。返回注销函数供测试隔离。 */
export function registerBuiltinFeatures(): () => void {
  return registerFrontendPlugin({
    id: 'builtin',
    capabilities: [],
    navItems: builtinNavItems,
    routes: builtinRoutes,
    settingSections: builtinSettingSections,
  })
}
