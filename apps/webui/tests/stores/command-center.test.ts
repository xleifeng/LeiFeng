import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCommandCenterStore } from '../../src/stores/command-center'
import type { TaskListItemV2 } from '../../src/api/contracts/v2/tasks'

vi.mock('../../src/api/native-download/tasks', () => ({ commandTasks: vi.fn() }))
import { commandTasks } from '../../src/api/native-download/tasks'

const task: TaskListItemV2 = { taskId: 'full-id-keep', parentTaskId: null, kind: 'http', lifecycle: 'queued', displayName: 'file', totalBytes: 1, completedBytes: 0, downloadBytesPerSecond: 0, uploadBytesPerSecond: 0, progress: 0, etaSeconds: null, createdAt: 1, completedAt: null, error: null, group: null, badges: [], capabilities: ['start'], pendingOperation: null, revision: 4, observationRevision: 1 }

describe('command center', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.mocked(commandTasks).mockReset() })
  it('sends full task ids and revisions, then clears pending state', async () => {
    vi.mocked(commandTasks).mockResolvedValue({ operationId: 'op-1', acceptedAt: 1, results: [{ taskId: task.taskId, ok: true, revision: 5 }] })
    const store = useCommandCenterStore()
    await store.execute('start', [task])
    expect(commandTasks).toHaveBeenCalledWith([task.taskId], 'start', { [task.taskId]: 4 })
    expect(store.pendingCount).toBe(0)
  })
})
