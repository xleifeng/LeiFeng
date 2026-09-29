import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskContextMenu from '../../src/components/tasks/TaskContextMenu.vue'
import type { TaskListItemV2 } from '../../src/api/contracts/v2/tasks'

const task: TaskListItemV2 = {
  taskId: 'task-keep-all-chars', parentTaskId: null, kind: 'http', lifecycle: 'queued', displayName: 'file.bin', totalBytes: 1, completedBytes: 0,
  downloadBytesPerSecond: 0, uploadBytesPerSecond: 0, progress: 0, etaSeconds: null, createdAt: 1, completedAt: null, error: null, group: null, badges: [], capabilities: ['start'], pendingOperation: null, revision: 1, observationRevision: 1,
}

describe('TaskContextMenu', () => {
  it('only renders declared capabilities and emits a full task command', async () => {
    const wrapper = mount(TaskContextMenu, { props: { task, x: 10, y: 10 } })
    expect(wrapper.text()).toContain('开始下载')
    expect(wrapper.text()).not.toContain('暂停下载')
    await wrapper.get('[role="menuitem"]').trigger('click')
    expect(wrapper.emitted('command')?.[0]).toEqual(['start'])
  })
})
