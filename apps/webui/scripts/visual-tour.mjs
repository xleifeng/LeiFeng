// 视觉走查截图（替代旧 pixel-diff）：mock /jsonrpc 后截取关键界面，供视觉子代理审阅。
// 用法：node scripts/visual-tour.mjs <输出目录>   （需先 npm run dev 或自动拉起）
// 产物：任务中心（明/暗）、创建任务弹窗、设置弹窗、回收站、空态。
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const outDir = resolve(process.argv[2] || 'visual-tour-output')
mkdirSync(outDir, { recursive: true })

const task = {
  taskId: 'tour-task-1', parentTaskId: null, kind: 'http', lifecycle: 'downloading', displayName: 'Leifeng-设计走查-示例文件.bin', totalBytes: 734003200, completedBytes: 293601280,
  downloadBytesPerSecond: 5242880, uploadBytesPerSecond: 0, progress: .4, etaSeconds: 84, createdAt: Date.now(), completedAt: null, error: null,
  group: null, badges: [], capabilities: ['pause', 'removeRecord'], pendingOperation: null, revision: 1, observationRevision: 1,
}
const doneTask = { ...task, taskId: 'tour-task-2', lifecycle: 'completed', displayName: '已完成的素材包.zip', progress: 1, completedBytes: 734003200, downloadBytesPerSecond: 0, etaSeconds: null, capabilities: ['removeRecord'] }
const btTask = { ...task, taskId: 'tour-task-3', kind: 'bt', lifecycle: 'paused', displayName: '纪录片.BBC.Planet.Earth.III.4K', progress: .68, downloadBytesPerSecond: 0, etaSeconds: null, badges: ['bt'], capabilities: ['start', 'removeRecord'] }

async function stubRoutes(page) {
  await page.route('**/jsonrpc', async (route) => {
    const body = route.request().postDataJSON()
    const input = body?.params?.[0] || {}
    const result =
      body.method === 'leifeng.ui.v2.bootstrap'
        ? { apiVersion: 2, daemonVersion: 'tour-0.1.0', repositoryRevision: 1, serverTime: Date.now(), capabilities: { protocols: ['http', 'magnet', 'bt'], taskControl: true, recycle: true, views: ['tasks', 'settings', 'diagnostics', 'history', 'link-library', 'private-space', 'media', 'daemon-admin'] }, engine: { transportReady: true, sdkReady: true, enginePid: 1, queue: 0, dht: 0, p2p: true, p2s: true, restarts: 0, uptimeMs: 100 }, account: { valid: false, isVip: false, vipType: 0, vipLevel: 0 }, policy: { revision: 0, desired: {}, applied: null }, security: { authRequired: false, csrfRequired: false, loopback: true } }
        : body.method === 'leifeng.ui.v2.tasks.counts'
          ? { all: 3, active: 1, completed: 1, trash: 0, private: 0, repositoryRevision: 1 }
          : body.method === 'leifeng.ui.v2.tasks.query'
            ? { items: input.view === 'completed' ? [doneTask] : input.view === 'trash' ? [] : [task, btTask], total: 2, nextCursor: null, snapshotRevision: 1, repositoryRevision: 1, counts: { all: 3, active: 1, completed: 1, trash: 0, private: 0, repositoryRevision: 1 } }
            : body.method === 'leifeng.ui.v2.plugins.list'
              ? { plugins: [] }
              : body.method === 'leifeng.ui.v2.daemon.status'
                ? { pid: 1234, ppid: 1, version: 'tour-0.1.0', profile: 'thunderd', uptimeMs: 3723000, restartPending: false, memory: { rssBytes: 268435456, heapUsedBytes: 67108864 }, engine: { sdkReady: true, enginePid: 4321, restarts: 0, generation: 1 } }
                : body.method === 'leifeng.ui.v2.policies.get'
                  ? { revision: 1, lastApplied: null, fullSpeed: true, policy: { schemaVersion: 1, autoResumeUnfinished: true, openOnCompleteDefault: false, idleDownload: { enabled: false, idleAfterSeconds: 900, pauseOnActivity: true }, autoMoveSlowTaskToTail: false, slowTaskThresholdBytesPerSecond: 102400, maxConcurrentTasks: 5, globalConnectionLimit: null, globalDownloadLimit: null, globalUploadLimit: null, defaultDownloadPath: '/downloads', p2pEnabled: true, p2sEnabled: true, proxy: { mode: 'direct', host: '', port: null, username: '', passwordRef: null }, completionAction: 'none', scheduleIds: [], updatedAt: Date.now() } }
                  : {}
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? 1, result }) })
  })
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5199'], { cwd: resolve(import.meta.dirname, '..'), stdio: 'ignore' })
await new Promise((resolve) => setTimeout(resolve, 3500))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await stubRoutes(page)

const settle = async () => { await page.mouse.move(4, 4); await page.evaluate(() => document.activeElement?.blur?.()); await page.waitForTimeout(200) }
await page.goto('http://127.0.0.1:5199/#/download')
await page.waitForSelector('[data-testid="task-row"]')
await settle()
await page.screenshot({ path: `${outDir}/01-task-center-light.png` })

// 暗色
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
await settle()
await page.screenshot({ path: `${outDir}/02-task-center-dark.png` })
await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })

// 创建任务弹窗
await page.getByRole('button', { name: '新建任务' }).click()
await page.waitForSelector('[data-testid="create-task-dialog"]')
await settle()
await page.screenshot({ path: `${outDir}/03-create-task.png` })
await page.keyboard.press('Escape')
await page.getByLabel('关闭').first().click().catch(() => {})

// 设置弹窗
await page.getByRole('button', { name: '设置', exact: true }).click()
await page.waitForSelector('[data-testid="settings-dialog"]')
await settle()
await page.screenshot({ path: `${outDir}/04-settings.png` })

// 关于弹窗（设置内入口）
await page.getByRole('button', { name: '关于 Leifeng' }).click()
await page.waitForTimeout(400)
await settle()
await page.screenshot({ path: `${outDir}/06-about.png` })
await page.getByLabel('关闭关于 Leifeng').click().catch(() => {})

// 回收站（空态）
await page.keyboard.press('Escape').catch(() => {})
await page.getByLabel('关闭设置').click().catch(() => {})
await page.goto('http://127.0.0.1:5199/#/trash')
await settle()
await page.screenshot({ path: `${outDir}/05-trash-empty.png` })

await browser.close()
server.kill()
console.log(`截图输出：${outDir}`)
