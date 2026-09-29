import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useUiCapabilitiesStore } from '../stores/ui-capabilities'
import { navContributions, routeContributions } from '../app/plugins'

// 核心路由 + 插件注册表贡献合并；capability 缺省（旧 daemon / 未门控）时全量生效。
const coreRoutes: RouteRecordRaw[] = [
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

export const router = createRouter({
  history: createWebHashHistory(),
  // 编译期只有核心路由；插件路由由 loader 在运行期 router.addRoute（响应式注册表）
  routes: [...coreRoutes],
})

// 能力守卫：目标路由声明了不可用能力时回退到任务中心。
// 守卫内惰性取 store（router 创建先于组件体系，pinia 已在 main.ts 先行挂载）。
router.beforeEach((to) => {
  const capability = to.meta.capability as string | undefined
  if (!capability) return true
  const capabilities = useUiCapabilitiesStore()
  return capabilities.enabled(capability as never) ? true : '/download'
})

export { coreRoutes, navContributions }
