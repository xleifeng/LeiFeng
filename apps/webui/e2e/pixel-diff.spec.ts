// webui/e2e/pixel-diff.spec.ts
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

export const SCENES = [
  { name: 'download', route: '/#/download', orig: 'orig-main-download-clean.png' },
  { name: 'completed', route: '/#/download?tab=completed', orig: 'orig-main-completed.png' },
  { name: 'trash', route: '/#/trash', orig: 'orig-main-trash.png' },
  { name: 'create-task', route: '/#/download', orig: 'orig-modal-createtask.png', action: 'create' },
  { name: 'settings', route: '/#/download', orig: 'orig-modal-setting.png', action: 'settings' },
  { name: 'limit-speed', route: '/#/download', orig: 'orig-modal-limitspeed.png', action: 'limit-speed' },
  { name: 'proxy', route: '/#/download', orig: 'orig-modal-addproxy.png', action: 'proxy' },
  { name: 'about', route: '/#/download', orig: 'orig-modal-about.png', action: 'about' },
] // 各视图任务向此数组追加场景；orig 参照在 docs/ui-reference/

// V2 RPC mock fixtures — method-aware + jsonrpc 2.0 envelope.
// 真实 webui 启动仅触发 bootstrap / tasks.counts / tasks.query（console 观察确认）。
// 响应体严格匹配 webui/src/api/contracts/v2/* zod schema，确保 zod parse 成功、
// `bootstrapQuery.isError === false`、banner 消失、渲染真空态。
const BOOTSTRAP = {
  apiVersion: 2,
  daemonVersion: 'pixel-mock',
  repositoryRevision: 1,
  serverTime: 0,
  capabilities: {
    protocols: ['http', 'https', 'bt', 'magnet', 'ed2k', 'thunder'],
    taskControl: true, recycle: true, recover: true, rename: true, move: true, redownload: true,
    perTaskRateLimit: true, btFileSelection: true, btSequential: true, globalRateLimit: true,
    proxy: true, p2pSwitch: true, cloudDrive: false,
  },
  engine: { transportReady: true, sdkReady: true, enginePid: 1, queue: 0, dht: 0, p2p: true, p2s: true, restarts: 0, uptimeMs: 1 },
  account: { valid: false, isVip: false, vipType: 0, vipLevel: 0 },
  policy: { revision: 0, desired: {}, applied: null },
  security: { authRequired: false, csrfRequired: false, loopback: true },
}
const COUNTS = { all: 0, active: 0, completed: 0, trash: 0, private: 0, repositoryRevision: 1 }
const TASKS_QUERY = { items: [], total: 0, nextCursor: null, snapshotRevision: 1, repositoryRevision: 1, counts: COUNTS }
const POLICY = {
  schemaVersion: 1,
  defaultDownloadPath: '/home/pixel/Downloads',
  maxConcurrentTasks: 5,
  globalDownloadLimit: null,
  globalUploadLimit: null,
  globalConnectionLimit: 500,
  autoResumeUnfinished: true,
  autoMoveSlowTaskToTail: false,
  slowTaskThresholdBytesPerSecond: 16384,
  p2pEnabled: true,
  p2sEnabled: true,
  proxy: { mode: 'direct', host: '', port: null, username: '', passwordRef: null, passwordPresent: false },
  idleDownload: { enabled: false, idleAfterSeconds: 900, pauseOnActivity: true },
  completionAction: 'none',
  openOnCompleteDefault: false,
  scheduleIds: [],
  updatedAt: 0,
} as const
const POLICY_SNAPSHOT = { revision: 1, policy: POLICY, lastApplied: null, fullSpeed: false }

function mockRpc(method: string | undefined): unknown {
  switch (method) {
    case 'thunder.ui.v2.bootstrap': return BOOTSTRAP
    case 'thunder.ui.v2.tasks.counts': return COUNTS
    case 'thunder.ui.v2.tasks.query': return TASKS_QUERY
    case 'thunder.ui.v2.policies.get': return POLICY_SNAPSHOT
    case 'thunder.ui.v2.policies.update': return { ...POLICY_SNAPSHOT, revision: 2, applied: true, applyProblems: [] }
    case 'thunder.ui.v2.policies.enableFullSpeed': return { ...POLICY_SNAPSHOT, revision: 2, fullSpeed: true, applied: true, applyProblems: [] }
    case 'thunder.ui.v2.policies.restoreLimits': return { ...POLICY_SNAPSHOT, revision: 2, applied: true, applyProblems: [] }
    case 'thunder.ui.v2.schedules.getDownloadLimitWindow': return { configured: false, enabled: false, startLocalTime: '00:00', endLocalTime: '23:59', timezone: 'Asia/Shanghai', activeNow: false, scheduleIds: [], problemCode: null }
    case 'thunder.ui.v2.schedules.setDownloadLimitWindow': return { configured: false, enabled: false, startLocalTime: '00:00', endLocalTime: '23:59', timezone: 'Asia/Shanghai', activeNow: false, scheduleIds: [], problemCode: null, revision: 0 }
    case 'thunder.ui.v2.proxy.test': return { reachable: true, elapsedMs: 12 }
    default: return null
  }
}

test('pixel diff against originals', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  test.skip(testInfo.project.name !== 'desktop', 'pixel diff only runs on desktop viewport (1200x760)')
  await page.setViewportSize({ width: 1200, height: 760 })
  await page.route('**/jsonrpc', async (route) => {
    const body = route.request().postDataJSON() as { method?: string; id?: number } | null
    const result = mockRpc(body?.method)
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? 1, result }) })
  })
  const out = 'pixel-report'; mkdirSync(out, { recursive: true })
  const report = []
  for (const s of SCENES) {
    const hash = s.route.startsWith('/#') ? s.route.slice(1) : s.route
    await page.goto(`http://127.0.0.1:5173/?pixel=${encodeURIComponent(s.name)}${hash}`)
    if ('action' in s) {
      if (s.action === 'create') await page.locator('.new-task-button').click()
      if (s.action === 'settings') await page.locator('.settings-link').click()
      if (s.action === 'limit-speed') {
        await page.locator('.settings-link').click()
        await page.getByRole('button', { name: '修改配置' }).click()
      }
      if (s.action === 'proxy') {
        await page.locator('.settings-link').click()
        await page.getByRole('button', { name: '下载设置' }).click()
        await page.locator('.proxy-settings-trigger').click()
      }
      if (s.action === 'about') {
        await page.locator('.settings-link').click()
        await page.getByRole('button', { name: '关于迅雷' }).click()
      }
    }
    await page.evaluate(async () => { await document.fonts.ready })
    await page.waitForTimeout(600) // 空态动画结束
    const actual = `${out}/${s.name}.png`
    await page.screenshot({ path: actual })
    const orig = `../docs/ui-reference/${s.orig}`
    if (!existsSync(orig)) { report.push({ name: s.name, skipped: 'no-orig' }); continue }
    const diff = `${out}/${s.name}-diff.png`
    try {
      const res = execFileSync('node', ['e2e/pixel-diff.mjs', actual, orig, diff]).toString()
      report.push(JSON.parse(res))
    } catch (e) { report.push({ name: s.name, mismatchPct: 999, pass: false, error: String(e) }) }
  }
  console.log('PIXEL_REPORT=' + JSON.stringify(report))
  const failed = report.filter((r) => r.pass === false)
  expect(failed, JSON.stringify(report, null, 2)).toEqual([])
})
