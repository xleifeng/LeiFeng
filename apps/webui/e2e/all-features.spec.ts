import { expect, test, type Page } from '@playwright/test'

const now = Date.now()
const policy = {
  schemaVersion: 1, defaultDownloadPath: '/downloads', maxConcurrentTasks: 3,
  globalDownloadLimit: 1024 * 1024, globalUploadLimit: 512 * 1024, globalConnectionLimit: 100,
  autoResumeUnfinished: true, autoMoveSlowTaskToTail: false, slowTaskThresholdBytesPerSecond: 1024,
  p2pEnabled: true, p2sEnabled: true, proxy: { mode: 'direct', host: '', port: null, username: '', passwordRef: null, passwordPresent: false },
  idleDownload: { enabled: false, idleAfterSeconds: 300, pauseOnActivity: true }, completionAction: 'none', openOnCompleteDefault: false, scheduleIds: [], updatedAt: now,
}
const counts = { all: 0, active: 0, completed: 0, trash: 0, private: 0, repositoryRevision: 1 }
function lastRequest(requests: Array<{ method: string, input: Record<string, unknown> }>, method: string) {
  return [...requests].reverse().find((item) => item.method === method)
}
const bootstrap = {
  apiVersion: 2, daemonVersion: 'e2e', repositoryRevision: 1, serverTime: now,
  capabilities: { protocols: ['http', 'https', 'ftp', 'magnet', 'bt', 'ed2k', 'thunder'], taskControl: true, recycle: true, recover: true, rename: true, move: true, redownload: true, perTaskRateLimit: true, btFileSelection: true, btSequential: true, globalRateLimit: true, proxy: true, proxyVerify: true, p2pSwitch: true, p2sSwitch: true, autoMoveLowSpeed: true, schedules: true, idleDownload: true, completionActions: true, powerActions: false, linkSync: 'local-only', superChannel: false, speedTrial: false, openOnHost: true, streamInBrowser: true, remoteNodes: true, cloudDrive: false },
  engine: { transportReady: true, sdkReady: true, enginePid: 1, queue: 0, dht: 1, p2p: true, p2s: true, restarts: 0, uptimeMs: 1000 },
  account: { valid: false, isVip: false, isDownloadVip: false, isSuperVip: false, isPlatinumVip: false, isPanVip: false, userVas: 0, vipType: 0, vipLevel: 0 },
  policy: { revision: 1, desired: policy, applied: policy, fullSpeed: false }, privateSpace: { configured: false, unlocked: false, directoryConfigured: false, metadataEncrypted: true, downloadContentEncrypted: false, requiresEncryptedFilesystemForAtRest: true }, media: { openOnHost: true, streamInBrowser: true }, security: { authRequired: false, csrfRequired: false, loopback: true },
}

async function mockAllFeatures(page: Page, requests: Array<{ method: string, input: Record<string, unknown> }>, taskItems: Array<Record<string, unknown>> = []) {
  await page.route('**/jsonrpc', async (route) => {
    const body = route.request().postDataJSON() as { method: string, params?: Array<Record<string, unknown>> }
    const input = body.params?.[0] || {}
    requests.push({ method: body.method, input })
    let result: unknown = null
    if (body.method === 'thunder.ui.v2.bootstrap') result = bootstrap
    else if (body.method === 'thunder.ui.v2.tasks.counts') result = counts
    else if (body.method === 'thunder.ui.v2.tasks.query') {
      const items = taskItems.filter((task) => input.view === 'completed' ? task.lifecycle === 'completed' : input.view === 'trash' ? task.lifecycle === 'recycled' : !['completed', 'recycled'].includes(String(task.lifecycle)))
      result = { items, total: items.length, nextCursor: null, snapshotRevision: 1, repositoryRevision: 1, counts: { ...counts, all: taskItems.length, active: taskItems.filter((task) => !['completed', 'recycled'].includes(String(task.lifecycle))).length, completed: taskItems.filter((task) => task.lifecycle === 'completed').length } }
    }
    else if (body.method === 'thunder.ui.v2.history.query') result = { items: [] }
    else if (body.method === 'thunder.ui.v2.links.query') result = { items: [] }
    else if (body.method === 'thunder.ui.v2.links.save') result = { id: 'link-1', sourceFingerprint: String(input.source), kind: input.kind, title: input.title, source: input.source, privateSpace: false, favorite: false, revision: 1, tags: [] }
    else if (body.method === 'thunder.ui.v2.private.getStatus') result = { configured: false, unlocked: false, directoryConfigured: false, metadataEncrypted: true, downloadContentEncrypted: false, requiresEncryptedFilesystemForAtRest: true }
    else if (body.method === 'thunder.ui.v2.private.setup') result = { configured: true, directory: '/downloads/.private', status: {} }
    else if (body.method === 'thunder.ui.v2.private.queryTasks') result = { items: [] }
    else if (body.method === 'thunder.ui.v2.remote.nodes.query') result = { items: [] }
    else if (body.method === 'thunder.ui.v2.capture.clients.query' || body.method === 'thunder.ui.v2.remote.server.clients.query') result = { items: [] }
    else if (body.method === 'thunder.ui.v2.capture.startPairing') result = { pairingId: 'capture-pair', code: '123456', expiresAt: now + 60_000 }
    else if (body.method === 'thunder.ui.v2.capture.desktop.provision') result = { clientId: 'desktop', endpoint: 'http://127.0.0.1', configPath: '/tmp/e2e-config' }
    else if (body.method === 'thunder.ui.v2.remote.server.startPairing') result = { pairingId: 'remote-pair', code: '654321', expiresAt: now + 60_000, serverFingerprint: 'AA' }
    else if (body.method === 'thunder.ui.v2.remote.server.stopPairing') result = { stopped: true }
    else if (body.method === 'thunder.ui.v2.diagnostics.get') result = { apiVersion: 2, daemonVersion: 'e2e', startedAt: now - 1000, now, hostname: 'e2e', repositoryRevision: 1, counts, engine: { healthy: true }, taskDb: { writable: true }, auth: null, vip: null, privateSpace: {}, media: {}, remoteNodes: { items: [] }, settings: {}, filesystem: {}, events: [] }
    else if (body.method === 'thunder.ui.v2.diagnostics.events.query') result = []
    else if (body.method === 'thunder.ui.v2.diagnostics.checks.run') result = { ok: true, checkId: input.checkId }
    else if (body.method === 'thunder.ui.v2.diagnostics.exports.prepare') result = { exportId: 'export-1', expiresAt: now + 60_000, files: ['diagnostics.json'], warnings: [] }
    else if (body.method === 'thunder.ui.v2.policies.get') result = { revision: 1, policy, lastApplied: null, fullSpeed: false }
    else if (body.method === 'thunder.ui.v2.policies.update') result = { revision: 2, policy: input.patch, lastApplied: null, fullSpeed: false, applied: true }
    else if (body.method === 'thunder.ui.v2.schedules.getDownloadLimitWindow') result = { configured: false, enabled: false, startLocalTime: '00:00', endLocalTime: '23:59', timezone: 'Asia/Shanghai', activeNow: false, scheduleIds: [], problemCode: null, revision: 1 }
    else if (body.method === 'thunder.ui.v2.schedules.setDownloadLimitWindow') result = { configured: true, enabled: input.enabled, startLocalTime: input.startLocalTime, endLocalTime: input.endLocalTime, timezone: input.timezone, activeNow: false, scheduleIds: [], problemCode: null, revision: 2, runtime: { applied: true, reason: 'e2e' } }
    else if (body.method === 'thunder.ui.v2.account.get') result = { loginFlow: { state: 'idle' }, account: { ...bootstrap.account, checkedAt: null }, credential: { refreshTokenPresent: false, accessTokenExpiresAt: null }, session: { registered: false, lastKeepAliveAt: null }, engine: { notified: false, notifiedAt: null } }
    else if (body.method === 'thunder.ui.v2.account.startLogin') result = { verificationUrl: 'https://example.com/device-login', userCode: null, expiresIn: 300, interval: 2 }
    else if (body.method === 'thunder.ui.v2.account.cancelLogin') result = { cancelled: true }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) })
  })
}

test.beforeEach(async ({ page }, testInfo) => test.skip(testInfo.project.name !== 'desktop', 'full desktop feature matrix'))

test('all non-cloud routes render without browser errors', async ({ page }) => {
  const errors: string[] = []
  const requests: Array<{ method: string, input: Record<string, unknown> }> = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await mockAllFeatures(page, requests)
  for (const [route, heading] of [['/download', '下载中'], ['/private-space', '私人空间'], ['/history', '下载记录'], ['/links', '链接库'], ['/trash', '回收站'], ['/remote', '远程下载'], ['/settings', '下载设置'], ['/settings/integration', '系统集成'], ['/diagnostics', '下载诊断']] as const) {
    await page.goto(`/#${route}`)
    await expect(page.getByText(heading).first()).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('link library preserves protocols and rejects search text', async ({ page }) => {
  const requests: Array<{ method: string, input: Record<string, unknown> }> = []
  await mockAllFeatures(page, requests)
  await page.goto('/#/links')
  const input = page.getByPlaceholder(/粘贴 HTTP/)
  await input.fill('ftp://fixture.test/archive.zip')
  await page.getByRole('button', { name: '保存链接' }).click()
  await expect.poll(() => lastRequest(requests, 'thunder.ui.v2.links.save')?.input.kind).toBe('ftp')
  await input.fill('ordinary search text')
  await page.getByRole('button', { name: '保存链接' }).click()
  await expect(page.getByText(/请输入 HTTP/)).toBeVisible()
})

test('task selection toolbar only exposes lifecycle-valid commands', async ({ page }) => {
  const requests: Array<{ method: string, input: Record<string, unknown> }> = []
  const base = { parentTaskId: null, kind: 'http', totalBytes: 100, completedBytes: 40, downloadBytesPerSecond: 0, uploadBytesPerSecond: 0, progress: .4, etaSeconds: null, createdAt: now, completedAt: null, error: null, group: null, badges: [], pendingOperation: null, revision: 1, observationRevision: 1 }
  await mockAllFeatures(page, requests, [
    { ...base, taskId: 'paused-1', lifecycle: 'paused', displayName: 'paused.bin', capabilities: ['start', 'recycle'] },
    { ...base, taskId: 'completed-1', lifecycle: 'completed', displayName: 'completed.bin', completedBytes: 100, progress: 1, completedAt: now, capabilities: ['recycle', 'redownload'] },
  ])
  await page.goto('/#/download')
  await page.getByText('paused.bin').click()
  const toolbar = page.locator('.task-toolbar')
  await expect(toolbar.getByRole('button', { name: '开始', exact: true })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: '暂停', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /已完成 1/ }).click()
  await page.getByText('completed.bin').click()
  await expect(toolbar.getByRole('button', { name: '开始', exact: true })).toHaveCount(0)
})

test('private setup and account login render their security-critical flows', async ({ page }) => {
  const requests: Array<{ method: string, input: Record<string, unknown> }> = []
  await mockAllFeatures(page, requests)
  await page.goto('/#/private-space')
  await page.getByRole('button', { name: '启用私人空间' }).click()
  const setup = page.getByText('设置私人空间').locator('..')
  await setup.getByLabel('密码', { exact: true }).fill('e2e-password')
  await setup.getByLabel('确认密码').fill('e2e-password')
  await setup.getByRole('button', { name: '启用私人空间' }).click()
  await expect.poll(() => lastRequest(requests, 'thunder.ui.v2.private.setup')?.input.password).toBe('e2e-password')
  await page.getByRole('button', { name: '取消' }).click()
  await page.getByRole('button', { name: '账户' }).click()
  await page.getByRole('button', { name: '扫码登录' }).click()
  await expect(page.getByRole('img', { name: '迅雷登录二维码' })).toBeVisible()
})

test('limit dialog can clear both limits and about component details work', async ({ page }) => {
  const requests: Array<{ method: string, input: Record<string, unknown> }> = []
  await mockAllFeatures(page, requests)
  await page.goto('/#/download')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '基本设置', exact: true }).click()
  await page.getByRole('button', { name: '修改配置' }).click()
  const dialog = page.getByRole('dialog', { name: '限速设置' })
  const checks = dialog.locator('input[type=checkbox]')
  await checks.nth(0).uncheck()
  await checks.nth(2).uncheck()
  await expect(dialog.getByRole('button', { name: '确认' })).toBeEnabled()
  await dialog.getByRole('button', { name: '确认' }).click()
  await expect.poll(() => lastRequest(requests, 'thunder.ui.v2.policies.update')?.input.patch).toMatchObject({ globalDownloadLimit: null, globalUploadLimit: null })
  await page.getByRole('button', { name: '关于迅雷' }).click()
  const about = page.getByRole('dialog', { name: '关于迅雷' })
  await about.getByRole('button', { name: '查看组件版本' }).click()
  await expect(about.getByText('JSON-RPC v2')).toBeVisible()
})

test('integration and diagnostics actions call their real RPC surfaces', async ({ page }) => {
  const requests: Array<{ method: string, input: Record<string, unknown> }> = []
  await mockAllFeatures(page, requests)
  await page.goto('/#/settings/integration')
  await page.getByRole('button', { name: '生成扩展配对码' }).click()
  await expect(page.getByText('扩展配对码已生成')).toBeVisible()
  await page.getByRole('button', { name: '生成桌面接管凭据' }).click()
  await expect(page.getByText(/桌面接管凭据已写入/)).toBeVisible()
  await page.getByRole('button', { name: '开启配对窗口' }).click()
  await expect(page.getByText('远程设备配对窗口已开启')).toBeVisible()
  await page.getByRole('button', { name: '停止配对' }).click()
  await expect(page.getByText('远程配对窗口已关闭')).toBeVisible()
  await page.goto('/#/diagnostics')
  for (const name of ['检查引擎', '检查下载目录', '检查任务仓库', '检查媒体能力', '检查远程节点']) await page.getByRole('button', { name }).click()
  await page.getByRole('button', { name: '导出诊断' }).click()
  await expect(page.getByText('导出已准备')).toBeVisible()
})
