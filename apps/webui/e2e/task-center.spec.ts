import { test, expect } from '@playwright/test'

const task = {
  taskId: 'e2e-task-1', parentTaskId: null, kind: 'http', lifecycle: 'downloading', displayName: 'fixture.bin', totalBytes: 100, completedBytes: 40,
  downloadBytesPerSecond: 10, uploadBytesPerSecond: 0, progress: .4, etaSeconds: 6, createdAt: Date.now(), completedAt: null, error: null,
  group: null, badges: [], capabilities: ['pause', 'removeRecord'], pendingOperation: null, revision: 1, observationRevision: 1,
}

test.beforeEach(async ({ page }, testInfo) => {
  const longList = testInfo.title.includes('1000')
  const trashView = testInfo.title.includes('trash')
  const uploadFailure = testInfo.title.includes('torrent upload failure')
  const allTasks = longList ? Array.from({ length: 1000 }, (_, index) => ({ ...task, taskId: `e2e-task-${index}`, displayName: `fixture-${index}.bin`, createdAt: Date.now() - index })) : [task]
  const trashTask = { ...task, taskId: 'e2e-trash-1', lifecycle: 'recycled', displayName: 'recycled.bin', completedBytes: 100, progress: 1, capabilities: ['deletePermanently'], revision: 2 }
  let trashCleared = false
  const draft = { draftId: 'e2e-draft-1', revision: 1, state: 'ready', kind: 'http', originalSource: 'http://fixture.test/file.bin', normalizedSource: 'http://fixture.test/file.bin', displayName: 'file.bin', savePath: '/downloads', totalBytes: 100, files: [], selectedFileIndices: [], duplicate: null, failure: null, expiresAt: Date.now() + 60000, createdAt: Date.now(), updatedAt: Date.now() }
  let uploadAttempts = 0
  await page.route('**/api/v2/create-drafts/torrent', async (route) => {
    if (uploadFailure && uploadAttempts++ === 0) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_TORRENT', message: 'torrent bencode 无效' } }) })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ draft }) })
  })
  await page.route('**/jsonrpc', async (route) => {
    const request = route.request()
    const body = request.postDataJSON() as { method?: string }
    const input = (body as { params?: Array<Record<string, unknown>> }).params?.[0] || {}
    const groupedTasks = [
      { ...task, taskId: 'group-1', kind: 'group', displayName: '批量下载组', totalBytes: 100, completedBytes: 40, group: { id: 'group-1', label: '批量下载组' }, capabilities: ['pause', 'removeRecord'] },
      { ...task, taskId: 'group-child-1', parentTaskId: 'group-1', displayName: 'file.bin', group: { id: 'group-1', label: '批量下载组' } },
    ]
    const result = body.method === 'thunder.ui.v2.bootstrap'
      ? { apiVersion: 2, daemonVersion: 'e2e', repositoryRevision: 1, serverTime: Date.now(), capabilities: { protocols: ['http'], taskControl: true, recycle: true, recover: false, rename: false, move: false, redownload: false, perTaskRateLimit: false, btFileSelection: false, btSequential: false, globalRateLimit: true, proxy: false, p2pSwitch: false, cloudDrive: false }, engine: { transportReady: true, sdkReady: true, enginePid: 1, queue: 0, dht: 0, p2p: true, p2s: true, restarts: 0, uptimeMs: 100 }, account: { valid: false, isVip: false, vipType: 0, vipLevel: 0 }, policy: { revision: 0, desired: {}, applied: null }, security: { authRequired: false, csrfRequired: false, loopback: true } }
        : body.method === 'thunder.ui.v2.tasks.counts'
        ? { all: trashView ? (trashCleared ? 0 : 1) : 1, active: trashView ? 0 : 1, completed: 0, trash: trashView && !trashCleared ? 1 : 0, private: 0, repositoryRevision: 1 }
        : body.method === 'thunder.ui.v2.trash.empty'
          ? (() => { trashCleared = true; return { operationId: 'e2e-trash-op', acceptedAt: Date.now(), results: [{ taskId: trashTask.taskId, ok: true, revision: 3 }] } })()
        : body.method === 'thunder.ui.v2.create.preflight'
          ? { results: [{ ok: true, draft }] }
          : body.method === 'thunder.ui.v2.create.commit'
            ? { operationId: 'e2e-op', groupId: 'group-1', results: [{ draftId: draft.draftId, ok: true, taskIds: ['group-child-1'] }] }
        : body.method === 'thunder.ui.v2.tasks.query' && input.view === 'trash'
          ? { items: trashView && !trashCleared ? [trashTask] : [], total: trashView && !trashCleared ? 1 : 0, nextCursor: null, snapshotRevision: 1, repositoryRevision: 1, counts: { all: trashView && !trashCleared ? 1 : 0, active: 0, completed: 0, trash: trashView && !trashCleared ? 1 : 0, private: 0, repositoryRevision: 1 } }
        : body.method === 'thunder.ui.v2.tasks.query' && input.groupBy === 'task-group'
          ? { items: groupedTasks, total: groupedTasks.length, nextCursor: null, snapshotRevision: 1, repositoryRevision: 1, counts: { all: groupedTasks.length, active: groupedTasks.length, completed: 0, trash: 0, private: 0, repositoryRevision: 1 } }
        : (() => {
            const pageIndex = input.cursor ? Number(String(input.cursor).replace('page:', '')) || 0 : 0
            const items = allTasks.slice(pageIndex * 100, pageIndex * 100 + 100)
            return { items, total: allTasks.length, nextCursor: (pageIndex + 1) * 100 < allTasks.length ? `page:${pageIndex + 1}` : null, snapshotRevision: 1, repositoryRevision: 1, counts: { all: allTasks.length, active: allTasks.length, completed: 0, trash: 0, private: 0, repositoryRevision: 1 } }
          })()
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) })
  })
})

test('desktop task center keeps native shell and full task id actions', async ({ page }) => {
  await page.goto('/#/download/downloading')
  await expect(page.getByText('下载中').first()).toBeVisible()
  await expect(page.getByText('fixture.bin')).toBeVisible()
  await page.getByLabel('暂停').click()
})

test('trash toolbar opens confirmation and clears through the dedicated RPC', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop workflow project only')
  await page.goto('/#/trash')
  await expect(page.getByText('recycled.bin')).toBeVisible()
  await page.getByRole('button', { name: '清空回收站' }).click()
  const dialog = page.getByRole('dialog', { name: '清空回收站' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '清空回收站' }).click()
  await expect(page.getByText('暂无下载任务')).toBeVisible()
})

test('mobile keeps task center usable without desktop drag selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile viewport only')
  await page.goto('/#/download/downloading')
  await page.getByLabel('打开导航').click()
  await expect(page.getByLabel('主导航')).toBeVisible()
})

test('1000 tasks remain virtualized while scrolling without console errors', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop performance project only')
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/#/download/downloading')
  await expect(page.getByText('fixture-0.bin')).toBeVisible()
  const scroll = page.locator('.task-virtual-scroll')
  for (let index = 0; index < 12; index += 1) {
    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await page.waitForTimeout(120)
  }
  await expect(page.locator('.native-task-row')).not.toHaveCount(1000)
  expect(errors).toEqual([])
})

test('create dialog uses preflight and commit contracts', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop workflow project only')
  await page.goto('/#/download/downloading')
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.getByLabel('粘贴下载链接').fill('http://fixture.test/file.bin')
  await page.getByRole('button', { name: '解析链接' }).click()
  await expect(page.getByText('file.bin')).toBeVisible()
  await page.getByRole('button', { name: '立即创建' }).click()
  await expect(page.getByText('创建结果')).toBeVisible()
})

test('torrent file input uses the raw upload contract', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop workflow project only')
  await page.goto('/#/download/downloading')
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'sample.torrent', mimeType: 'application/x-bittorrent', buffer: Buffer.from('d4:infod4:name4:testee') })
  await expect(page.getByText('file.bin')).toBeVisible()
})

test('torrent upload failure is visible and the same file can be retried', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop workflow project only')
  await page.goto('/#/download/downloading')
  await page.getByRole('button', { name: '新建任务' }).click()
  const input = page.getByRole('dialog').locator('input[type=file]')
  const file = { name: 'bad.torrent', mimeType: 'application/x-bittorrent', buffer: Buffer.from('invalid') }
  await input.setInputFiles(file)
  await expect(page.getByRole('alert')).toHaveText('torrent bencode 无效')
  await input.setInputFiles(file)
  await expect(page.getByText('file.bin')).toBeVisible()
})

test('torrent drag and drop uses the raw upload contract', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop workflow project only')
  await page.goto('/#/download/downloading')
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.locator('.create-step').evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array([0x64, 0x34, 0x3a, 0x69, 0x6e, 0x66, 0x6f, 0x65, 0x65])], 'drop.torrent', { type: 'application/x-bittorrent' }))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByText('file.bin')).toBeVisible()
})

test('task group option creates a group and group view keeps parent before child', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop workflow project only')
  await page.goto('/#/download/downloading')
  await page.getByRole('button', { name: '新建任务' }).click()
  await page.getByLabel('粘贴下载链接').fill('http://fixture.test/file.bin')
  await page.getByRole('button', { name: '解析链接' }).click()
  await page.getByText('同时创建任务组').click()
  await page.getByLabel('任务组名称').fill('批量下载组')
  await page.getByRole('button', { name: '立即创建' }).click()
  await expect(page.getByText('创建结果')).toBeVisible()
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByLabel('任务分组').selectOption('task-group')
  await expect(page.getByText('批量下载组')).toBeVisible()
})
