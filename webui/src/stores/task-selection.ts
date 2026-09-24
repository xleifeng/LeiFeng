import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useTaskSelectionStore = defineStore('task-selection', () => {
  const selectedTaskIds = ref<Set<string>>(new Set())
  const anchorTaskId = ref<string | null>(null)
  const focusedTaskId = ref<string | null>(null)

  const count = computed(() => selectedTaskIds.value.size)
  const hasSelection = computed(() => count.value > 0)

  function selectOnly(taskId: string) {
    selectedTaskIds.value = new Set([taskId])
    anchorTaskId.value = taskId
    focusedTaskId.value = taskId
  }

  function toggle(taskId: string) {
    const next = new Set(selectedTaskIds.value)
    if (next.has(taskId)) next.delete(taskId)
    else next.add(taskId)
    selectedTaskIds.value = next
    anchorTaskId.value = taskId
    focusedTaskId.value = taskId
  }

  function selectRange(taskId: string, orderedVisibleIds: string[]) {
    const anchor = anchorTaskId.value || taskId
    const from = orderedVisibleIds.indexOf(anchor)
    const to = orderedVisibleIds.indexOf(taskId)
    if (from < 0 || to < 0) return selectOnly(taskId)
    const [start, end] = from <= to ? [from, to] : [to, from]
    const next = new Set(selectedTaskIds.value)
    for (const id of orderedVisibleIds.slice(start, end + 1)) next.add(id)
    selectedTaskIds.value = next
    focusedTaskId.value = taskId
  }

  function selectAll(visibleIds: string[]) {
    selectedTaskIds.value = new Set(visibleIds)
    focusedTaskId.value = visibleIds[visibleIds.length - 1] || null
    if (!anchorTaskId.value && visibleIds.length) anchorTaskId.value = visibleIds[0]
  }

  function reconcileVisible(visibleIds: string[]) {
    const visible = new Set(visibleIds)
    selectedTaskIds.value = new Set([...selectedTaskIds.value].filter((id) => visible.has(id)))
    if (focusedTaskId.value && !visible.has(focusedTaskId.value)) focusedTaskId.value = null
  }

  function clear() {
    selectedTaskIds.value = new Set()
    anchorTaskId.value = null
    focusedTaskId.value = null
  }

  return { selectedTaskIds, anchorTaskId, focusedTaskId, count, hasSelection, selectOnly, toggle, selectRange, selectAll, reconcileVisible, clear }
})
