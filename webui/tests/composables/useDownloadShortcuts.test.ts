import { defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { useDownloadShortcuts } from '../../src/composables/useDownloadShortcuts'
import type { TaskListItemV2 } from '../../src/api/contracts/v2/tasks'

const task: TaskListItemV2 = { taskId: 'shortcut-task', parentTaskId: null, kind: 'http', lifecycle: 'queued', displayName: 'a', totalBytes: 1, completedBytes: 0, downloadBytesPerSecond: 0, uploadBytesPerSecond: 0, progress: 0, etaSeconds: null, createdAt: 1, completedAt: null, error: null, group: null, badges: [], capabilities: ['start'], pendingOperation: null, revision: 1, observationRevision: 1 }

describe('useDownloadShortcuts', () => {
  it('does not hijack editable fields but handles command shortcuts elsewhere', async () => {
    const calls: string[] = []
    const Wrapper = defineComponent({
      setup() {
        const selected = ref([task]); const visibleIds = ref([task.taskId]); const focused = ref(task)
        useDownloadShortcuts({ selected, visibleIds, focused, onNewTask: () => calls.push('new'), onSearch: () => calls.push('search'), onSelectAll: () => calls.push('all'), onCopy: () => calls.push('copy'), onToggle: () => calls.push('toggle'), onOpen: () => calls.push('open'), onCommand: (command) => calls.push(command), onDetails: () => calls.push('details'), onEscape: () => calls.push('escape'), onRename: () => calls.push('rename') })
        return () => h('input')
      },
    })
    const wrapper = mount(Wrapper)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
    await nextTick()
    expect(calls).toContain('new')
    await wrapper.get('input').trigger('keydown', { key: 'Delete' })
    expect(calls.filter((item) => item === 'remove-record')).toHaveLength(0)
  })
})
