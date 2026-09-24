import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { commandTaskGroup, commandTasks } from '../api/native-download/tasks'
import type { TaskCommand, TaskListItemV2 } from '../api/contracts/v2/tasks'
import type { RpcProblem } from '../api/contracts/v2/common'

interface PendingOperation { operationId: string; command: TaskCommand }

export const useCommandCenterStore = defineStore('command-center', () => {
  const pendingByTaskId = ref<Record<string, PendingOperation>>({})
  const lastProblem = ref<RpcProblem | null>(null)
  const offline = ref(false)
  const pendingCount = computed(() => Object.keys(pendingByTaskId.value).length)

  function setPending(taskIds: string[], operationId: string, command: TaskCommand) {
    const next = { ...pendingByTaskId.value }
    for (const taskId of taskIds) next[taskId] = { operationId, command }
    pendingByTaskId.value = next
  }

  function clearPending(taskIds: string[]) {
    const next = { ...pendingByTaskId.value }
    for (const taskId of taskIds) delete next[taskId]
    pendingByTaskId.value = next
  }

  function isPending(taskId: string) { return !!pendingByTaskId.value[taskId] }

  async function execute(command: TaskCommand, tasks: TaskListItemV2[], options: { force?: boolean; commandOptions?: Record<string, unknown> } = {}) {
    if (offline.value) throw new Error('daemon 当前离线')
    const capability = ({ 'remove-record': 'removeRecord', 'delete-permanently': 'deletePermanently', 'set-speed-limit': 'setSpeedLimit', 'update-bt-selection': 'updateBtSelection', 'set-bt-scheduler': 'setBtScheduler', 'show-in-folder': 'showInFolder', 'copy-info': 'copyInfo' } as Record<string, string>)[command] || command
    const targets = tasks.filter((task) => !isPending(task.taskId) && (options.force || task.capabilities.includes(capability as never)))
    if (!targets.length) return null
    const taskIds = targets.map((task) => task.taskId)
    const expectedRevisions = Object.fromEntries(targets.filter((task) => task.kind !== 'group').map((task) => [task.taskId, task.revision]))
    const localOperationId = globalThis.crypto?.randomUUID?.() || `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    setPending(taskIds, localOperationId, command)
    try {
      const responses = []
      const regular = targets.filter((task) => task.kind !== 'group')
      if (regular.length) responses.push(options.commandOptions ? await commandTasks(regular.map((task) => task.taskId), command, expectedRevisions, undefined, options.commandOptions) : await commandTasks(regular.map((task) => task.taskId), command, expectedRevisions))
      for (const group of targets.filter((task) => task.kind === 'group')) responses.push(options.commandOptions ? await commandTaskGroup(group.taskId, command, undefined, options.commandOptions) : await commandTaskGroup(group.taskId, command))
      const response = { operationId: responses.map((item) => item.operationId).join(','), acceptedAt: Date.now(), results: responses.flatMap((item) => item.results) }
      setPending(taskIds, response.operationId, command)
      lastProblem.value = null
      const failed = response.results.filter((result) => !result.ok)
      if (failed.length) lastProblem.value = { code: failed[0].error?.code || 'TASK_COMMAND_FAILED', message: failed[0].error?.message || '部分任务操作失败', details: failed }
      return response
    } finally {
      clearPending(taskIds)
    }
  }

  function setOffline(value: boolean) { offline.value = value }
  function clearProblem() { lastProblem.value = null }

  return { pendingByTaskId, pendingCount, lastProblem, offline, isPending, execute, setOffline, clearProblem }
})
