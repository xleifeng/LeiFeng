import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NativeTaskRow from '../../src/components/tasks/NativeTaskRow.vue'
import type { TaskListItemV2 } from '../../src/api/contracts/v2/tasks'

const task: TaskListItemV2 = {
  taskId: 'full-task-id-123', parentTaskId: null, kind: 'http', lifecycle: 'downloading', displayName: '<img>', totalBytes: 1024, completedBytes: 512,
  downloadBytesPerSecond: 128, uploadBytesPerSecond: 0, progress: .5, etaSeconds: 4, createdAt: 1, completedAt: null, error: null, group: null, badges: [], capabilities: ['pause', 'removeRecord'], pendingOperation: null, revision: 3, observationRevision: 2,
}

describe('NativeTaskRow', () => {
  it('emits the complete task id and renders filenames as text', async () => {
    const wrapper = mount(NativeTaskRow, { props: { task, selected: false, focused: false } })
    expect(wrapper.find('.task-name').text()).toBe('<img>')
    await wrapper.find('.task-check input').trigger('change')
    expect(wrapper.emitted('select')?.[0][0]).toEqual({ taskId: task.taskId, mode: 'only' })
    await wrapper.find('[aria-label="暂停"]').trigger('click')
    expect(wrapper.emitted('command')?.[0][0]).toEqual({ taskId: task.taskId, command: 'pause' })
  })

  it('uses the redownload operation for a failed task instead of starting the failed native id', async () => {
    const failed: TaskListItemV2 = { ...task, lifecycle: 'failed', capabilities: ['retry'], error: { code: '8', category: 'engine', message: '引擎报告任务失败', retryable: true, actions: ['retry'] } }
    const wrapper = mount(NativeTaskRow, { props: { task: failed, selected: false, focused: false } })
    await wrapper.get('[aria-label="重试"]').trigger('click')
    expect(wrapper.emitted('command')?.[0][0]).toEqual({ taskId: failed.taskId, command: 'redownload' })
  })
})
