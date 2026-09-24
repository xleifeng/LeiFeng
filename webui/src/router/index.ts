import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/download' },
    { path: '/download', name: 'task-center', component: () => import('../views/downloads/TaskCenterPage.vue'), meta: { title: '下载', taskView: 'downloading' } },
    { path: '/download/downloading', redirect: (to) => ({ path: '/download', query: { ...to.query, tab: 'downloading' } }) },
    { path: '/download/completed', redirect: (to) => ({ path: '/download', query: { ...to.query, tab: 'completed' } }) },
    { path: '/private-space', name: 'private-space', component: () => import('../views/private-space/PrivateSpaceView.vue'), meta: { title: '私人空间' } },
    { path: '/history', name: 'history', component: () => import('../views/history/DownloadHistoryView.vue'), meta: { title: '下载记录' } },
    { path: '/links', name: 'links', component: () => import('../views/link-library/LinkLibraryView.vue'), meta: { title: '链接库' } },
    { path: '/links/:id', name: 'link-details', component: () => import('../views/link-library/LinkDetailsView.vue'), meta: { title: '链接详情' } },
    { path: '/trash', name: 'trash', component: () => import('../views/downloads/TrashView.vue'), meta: { title: '回收站', taskView: 'trash' } },
    { path: '/settings', name: 'settings', component: () => import('../views/settings/DownloadSettingsView.vue'), meta: { title: '下载设置' } },
    { path: '/settings/integration', name: 'integration-settings', component: () => import('../views/settings/IntegrationSettingsView.vue'), meta: { title: '系统集成' } },
    { path: '/remote', name: 'remote', component: () => import('../views/remote/RemoteDownloadsView.vue'), meta: { title: '远程下载' } },
    { path: '/diagnostics', name: 'diagnostics', component: () => import('../views/diagnostics/DiagnosticsView.vue'), meta: { title: '诊断' } },
    { path: '/status', redirect: '/diagnostics' },
  ],
})
