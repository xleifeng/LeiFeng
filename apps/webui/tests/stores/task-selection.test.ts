import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTaskSelectionStore } from '../../src/stores/task-selection'

describe('task selection store', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('supports toggle, range, select all and visible reconciliation by task id', () => {
    const store = useTaskSelectionStore()
    store.selectOnly('task-a')
    store.selectRange('task-c', ['task-a', 'task-b', 'task-c', 'task-d'])
    expect([...store.selectedTaskIds]).toEqual(['task-a', 'task-b', 'task-c'])
    store.toggle('task-b')
    expect(store.selectedTaskIds.has('task-b')).toBe(false)
    store.selectAll(['task-c', 'task-d'])
    store.reconcileVisible(['task-d'])
    expect([...store.selectedTaskIds]).toEqual(['task-d'])
  })
})
