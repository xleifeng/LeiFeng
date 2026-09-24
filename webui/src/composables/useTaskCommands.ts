import { useQueryClient } from '@tanstack/vue-query'
import { useCommandCenterStore } from '../stores/command-center'
import type { TaskCommand, TaskListItemV2 } from '../api/contracts/v2/tasks'

export function useTaskCommands() {
  const center = useCommandCenterStore()
  const queryClient = useQueryClient()
  async function execute(command: TaskCommand, tasks: TaskListItemV2[], commandOptions?: Record<string, unknown>) {
    const result = await center.execute(command, tasks, commandOptions ? { commandOptions } : {})
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v2-task-query'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-bootstrap'] }),
    ])
    return result
  }
  return { execute, center }
}
