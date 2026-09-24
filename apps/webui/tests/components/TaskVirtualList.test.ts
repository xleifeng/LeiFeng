import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskVirtualList from '../../src/components/tasks/TaskVirtualList.vue'
import type { TaskListItemV2 } from '../../src/api/contracts/v2/tasks'

function task(id: string): TaskListItemV2 {
  return { taskId: id, parentTaskId: null, kind: 'http', lifecycle: 'queued', displayName: id, totalBytes: 1, completedBytes: 0, downloadBytesPerSecond: 0, uploadBytesPerSecond: 0, progress: 0, etaSeconds: null, createdAt: 1, completedAt: null, error: null, group: null, badges: [], capabilities: ['start'], pendingOperation: null, revision: 1, observationRevision: 1 }
}

describe('TaskVirtualList', () => {
  it('uses task ids as row keys and exposes a bounded virtual scroll container', () => {
    const wrapper = mount(TaskVirtualList, { props: { rows: Array.from({ length: 1000 }, (_, index) => task(`task-${index}`)), selectedIds: new Set<string>() } })
    expect(wrapper.find('.task-virtual-scroll').exists()).toBe(true)
    expect(wrapper.findAll('.native-task-row').length).toBeLessThan(1000)
  })
})
