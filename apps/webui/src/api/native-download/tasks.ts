import { z } from 'zod'
import { batchCommandResponseV2Schema, taskCountsV2Schema, taskDetailV2Schema, taskQueryResponseV2Schema, taskV2Schema, type TaskCommand } from '../contracts/v2/tasks'
import { getRpcSecret, rpcV2 } from './client'

export async function queryTasks(options: Record<string, unknown> = {}) {
  return taskQueryResponseV2Schema.parse(await rpcV2('thunder.ui.v2.tasks.query', [options]))
}

export async function getTask(taskId: string) {
  return taskDetailV2Schema.parse(await rpcV2('thunder.ui.v2.tasks.get', [{ taskId, includeFiles: true }]))
}

export async function getTaskCounts() {
  return taskCountsV2Schema.parse(await rpcV2('thunder.ui.v2.tasks.counts', [{}]))
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export async function commandTasks(taskIds: string[], command: TaskCommand, expectedRevisions: Record<string, number> = {}, idempotencyKey = newIdempotencyKey(), options: Record<string, unknown> = {}) {
  return batchCommandResponseV2Schema.parse(await rpcV2('thunder.ui.v2.tasks.command', [{ taskIds, command, expectedRevisions, idempotencyKey, options }]));
}

export async function commandTaskGroup(parentTaskId: string, command: TaskCommand, idempotencyKey = newIdempotencyKey(), options: Record<string, unknown> = {}) {
  return batchCommandResponseV2Schema.parse(await rpcV2('thunder.ui.v2.taskGroups.command', [{ parentTaskId, command, idempotencyKey, options }]));
}

export const operationV2Schema = z.object({ operationId: z.string(), idempotencyKey: z.string().optional(), taskId: z.string(), command: z.string(), state: z.string(), beforeRevision: z.number(), afterRevision: z.number().nullable(), params: z.record(z.string(), z.unknown()), evidence: z.record(z.string(), z.unknown()), problem: z.unknown().nullable(), result: z.unknown().nullable(), createdAt: z.number(), updatedAt: z.number() })
export async function getTaskOperation(operationId: string) { return operationV2Schema.parse(await rpcV2('thunder.ui.v2.tasks.operations.get', [{ operationId }])) }
export async function queryTrash(options: Record<string, unknown> = {}) { return taskQueryResponseV2Schema.parse(await rpcV2('thunder.ui.v2.trash.query', [{ ...options, view: 'trash' }])) }
export async function emptyTrash(taskIds?: string[], deleteLocalFiles = false) { return batchCommandResponseV2Schema.parse(await rpcV2('thunder.ui.v2.trash.empty', [{ ...(taskIds ? { taskIds } : {}), deleteLocalFiles, idempotencyKey: newIdempotencyKey() }])) }
export async function moveQueueTasks(taskIds: string[], target: 'top' | 'up' | 'down' | 'bottom' | number) { return rpcV2<{ changed: Array<{ taskId: string; queuePosition: number; revision: number }> }>('thunder.ui.v2.queue.move', [{ taskIds, target }]) }

export async function downloadTaskTorrent(taskId: string, displayName: string) {
  const headers: Record<string, string> = {}
  const secret = getRpcSecret()
  if (secret) headers.authorization = `Bearer ${secret}`
  const response = await fetch(`/api/v2/tasks/${encodeURIComponent(taskId)}/torrent`, { headers })
  if (!response.ok) {
    let message = `种子导出失败 (${response.status})`
    try { message = (await response.json() as { error?: { message?: string } }).error?.message || message } catch {}
    throw new Error(message)
  }
  const blobUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = `${String(displayName || 'task').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.torrent$/i, '') || 'task'}.torrent`
  link.click()
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
}

export { taskV2Schema }
