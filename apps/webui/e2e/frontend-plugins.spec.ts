import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath, URL } from 'node:url'
import { createWebRequestHandler } from '../../../apps/web-api/src/server.js'

/**
 * 运行期前端插件装载验收（U2）：
 * - web-api 静态面（dist + plugins-frontend 目录）起真 HTTP 服务（含真实 CSP）
 * - 插件 ui.js 经 activate(host) 宿主注入拿共享 vue 实例（host.vue.ref / host.vue.h）
 * - 侧栏导航项出现、路由可达、设置分区合并渲染、能力门控（views 缺失能力时隐藏）
 */

const pluginId = 'hello-tools'
// 宿主注入契约：不 import 'vue'（CSP script-src 'self' 拦内联 importmap + spec 不支持
// 外链 importmap，裸名模块解析两条路都堵死），从 host.vue 取实例引用
const uiJs = `export function activate(host) {
  const { h, ref, onMounted } = host.vue
  host.navItems.push({ to: '/hello', label: '插件页' })
  host.settingSections.push({ id: 'hello', label: '插件设置', component: { name: 'HelloSettingSection', setup() {
    const greeting = ref('来自前端插件的设置分区')
    return () => h('div', { class: 'hello-setting-section' }, [h('p', { class: 'hello-setting-hint' }, greeting.value)])
  } } })
  host.routes.push({ path: '/hello', name: 'hello-plugin', component: { name: 'HelloPluginView', setup() {
    const count = ref(0)
    onMounted(() => { count.value = 42 })
    return () => h('div', { class: 'hello-plugin-view' }, [h('h2', null, '前端插件演示页'), h('p', null, ['共享 vue 计数: ', count.value])])
  } } })
}
`
// gated variant：navItem 声明 capability 'media'（bootstrap views 不含 → 隐藏）
const uiJsGated = `export function activate(host) {
  const { h } = host.vue
  host.navItems.push({ to: '/gated', label: '门控页', capability: 'media' })
  host.routes.push({ path: '/gated', name: 'gated-plugin', meta: { capability: 'media' }, component: { name: 'GatedView', setup() {
    return () => h('div', { class: 'gated-plugin-view' }, '门控页')
  } } })
}
`
// 契约必填字段全给（capabilitySchema 有十多个必填布尔，缺了整包 parse 失败 → views 不生效）
const bootstrapResult = { apiVersion: 2, daemonVersion: 'e2e', repositoryRevision: 1, serverTime: Date.now(), capabilities: { protocols: ['http'], taskControl: true, recycle: true, recover: false, rename: false, move: false, redownload: false, perTaskRateLimit: false, btFileSelection: false, btSequential: false, globalRateLimit: true, proxy: false, p2pSwitch: false, cloudDrive: false, views: ['tasks', 'settings', 'diagnostics'] }, engine: { transportReady: true, sdkReady: true, enginePid: 1, queue: 0, dht: 0, p2p: true, p2s: true, restarts: 0, uptimeMs: 100 }, account: { valid: false, isVip: false, isDownloadVip: false, isSuperVip: false, isPlatinumVip: false, isPanVip: false, userVas: 0, vipType: 0, vipLevel: 0 }, policy: { revision: 0, desired: {}, applied: null }, security: { authRequired: false, csrfRequired: false, loopback: true } }

function makePluginsDir() {
  const pluginsDir = fs.mkdtempSync(path.join(process.env.HOME || '/home/yj', 'tmp/leifeng-plugfe-e2e-'))
  const pluginDir = path.join(pluginsDir, pluginId)
  fs.mkdirSync(pluginDir)
  fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({ id: pluginId, navItems: [{ to: '/hello', label: '插件页' }] }))
  fs.writeFileSync(path.join(pluginDir, 'ui.js'), uiJs)
  return pluginsDir
}

test.describe('运行期前端插件（U2）', () => {
  let port: number
  let server: http.Server
  let pluginsDir: string

  test.beforeAll(async () => {
    const e2eDir = path.dirname(fileURLToPath(import.meta.url))
    pluginsDir = makePluginsDir()
    // dist 已由 npm run build 产出（vue 共享 chunk + 宿主注入 loader）
    const staticDir = path.resolve(e2eDir, '..', 'dist')
    server = http.createServer(createWebRequestHandler({ client: { invoke: async () => ({}) }, staticDir, frontendPluginsDir: pluginsDir }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
  })
  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    server.closeAllConnections?.()
    fs.rmSync(pluginsDir, { recursive: true, force: true })
  })

  test.beforeEach(async ({ page }) => {
    // RPC mock：views = tasks/settings/diagnostics（不含 media / private-space 等）
    await page.route('**/jsonrpc', async (route) => {
      const body = route.request().postDataJSON() as { method?: string }
      const result = body.method === 'leifeng.ui.v2.bootstrap' ? bootstrapResult
        : body.method === 'leifeng.ui.v2.tasks.counts' ? { all: 0, active: 0, completed: 0, trash: 0, private: 0, repositoryRevision: 1 }
        : {}
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) })
    })
  })

  test('插件导航项出现且路由可达（共享 vue 渲染）', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}/#/hello`)
    await expect(page.locator('.hello-plugin-view')).toBeVisible()
    await expect(page.locator('.hello-plugin-view p')).toContainText('共享 vue 计数: 42')
    await expect(page.locator('aside.nav-rail nav.rail-items a[href="#/hello"]')).toHaveCount(1)
    await expect(page.locator('aside.nav-rail nav.rail-items a[href="#/hello"]')).toContainText('插件页')
  })

  test('能力门控：views 缺失能力时插件导航隐藏、路由守卫回退', async ({ page }) => {
    // 换 gated fixture：navItem capability='media'，views 不含 media
    const gatedDir = path.join(pluginsDir, pluginId)
    fs.writeFileSync(path.join(gatedDir, 'ui.js'), uiJsGated)
    try {
      await page.goto(`http://127.0.0.1:${port}/#/gated`)
      // 路由守卫回退到任务中心
      await expect(page.locator('.gated-plugin-view')).toHaveCount(0)
      await expect(page.locator('.app-main')).toBeVisible()
      // 导航项被能力过滤
      await expect(page.locator('aside.nav-rail nav.rail-items a[href="#/gated"]')).toHaveCount(0)
    } finally {
      fs.writeFileSync(path.join(gatedDir, 'ui.js'), uiJs)
    }
  })

  test('设置弹窗合并插件分区', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}/#/download`)
    // 原生路径：顶栏菜单开侧栏抽屉 → 侧栏「设置」
    await page.locator('.rail-item.settings-link').click()
    await expect(page.locator('.settings-window')).toBeVisible()
    await expect(page.locator('.settings-window-nav button', { hasText: '插件设置' })).toHaveCount(1)
    // U3：插件分区带 component 时内容区渲染（此前只有导航项、点击落入「系统集成」兜底）
    await page.locator('.settings-window-nav button', { hasText: '插件设置' }).click()
    await expect(page.locator('.settings-plugin-section h1')).toHaveText('插件设置')
    await expect(page.locator('.hello-setting-section .hello-setting-hint')).toContainText('来自前端插件的设置分区')
  })

  test('插件管理分区：列表渲染、基础插件置灰、开关提示重启生效（U3）', async ({ page }) => {
    // mock plugins.list / setEnabled（daemon 侧真面已由 e2e sup1 覆盖，这里验 UI 交互）
    await page.route('**/jsonrpc', async (route) => {
      const body = route.request().postDataJSON() as { method?: string }
      let result: unknown = {}
      if (body.method === 'leifeng.ui.v2.bootstrap') result = bootstrapResult
      else if (body.method === 'leifeng.ui.v2.tasks.counts') result = { all: 0, active: 0, completed: 0, trash: 0, private: 0, repositoryRevision: 1 }
      else if (body.method === 'leifeng.ui.v2.plugins.list') result = [
        { id: 'runtime-config', provides: ['config'], requires: [], ui: { capabilities: [] }, enabled: true },
        { id: 'web-api-process', provides: ['webApi'], requires: ['rpc'], ui: { capabilities: [] }, enabled: true },
        { id: 'media-library', provides: ['media'], requires: ['tasks'], ui: { capabilities: ['media'] }, enabled: false },
      ]
      else if (body.method === 'leifeng.ui.v2.plugins.setEnabled') result = { id: 'web-api-process', enabled: false, restartRequired: true }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) })
    })
    await page.goto(`http://127.0.0.1:${port}/#/download`)
    await page.locator('.rail-item.settings-link').click()
    await expect(page.locator('.settings-window')).toBeVisible()
    // 核心分区「插件管理」存在且可点入
    await page.locator('.settings-window-nav button', { hasText: '插件管理' }).click()
    // 三行插件：runtime-config 置灰禁用、web-api-process 可开关、media-library 初始关闭
    const locked = page.locator('.plugin-manager-row.is-locked')
    await expect(locked).toHaveCount(1)
    await expect(locked.locator('input')).toBeDisabled()
    const rows = page.locator('.plugin-manager-row input[data-plugin-id="web-api-process"]')
    await expect(rows).toBeChecked()
    // 开关（true → false）→ setEnabled 成功 → 本地同步 + 重启提示
    await rows.uncheck()
    await expect(page.locator('.plugin-manager-message')).toContainText('重启 daemon 后生效')
    await expect(rows).not.toBeChecked()
  })
})
