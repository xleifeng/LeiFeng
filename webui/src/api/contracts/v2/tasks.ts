import { z } from 'zod'
import { taskErrorSchema, taskVipSchema } from './common'

export const taskCapabilitySchema = z.record(z.string(), z.boolean())

export const taskListCapabilitySchema = z.enum(['start', 'pause', 'removeRecord', 'recycle', 'recover', 'retry', 'rename', 'move', 'redownload', 'deletePermanently', 'setSpeedLimit', 'updateBtSelection', 'setBtScheduler', 'open', 'showInFolder', 'copyInfo', 'perTaskRateLimit', 'btSelection', 'btSequential'])

export const taskV2Schema = z.object({
  taskId: z.string(), parentId: z.string().nullable(), kind: z.string(), lifecycle: z.enum(['preparing', 'metadata', 'queued', 'downloading', 'paused', 'completed', 'failed', 'recycled', 'missing']),
  source: z.string().nullable(), sourceFingerprint: z.string(), displayName: z.string(), savePath: z.string(),
  totalBytes: z.number(), completedBytes: z.number(), downloadBytesPerSecond: z.number(), uploadBytesPerSecond: z.number(), progress: z.number(),
  queuePosition: z.number(), taskSpeedLimit: z.number().nullable(), btScheduler: z.enum(['normal', 'sequential']).default('normal'), privateSpace: z.boolean(), createdAt: z.number(), startedAt: z.number().nullable(),
  completedAt: z.number().nullable(), recycledAt: z.number().nullable(), updatedAt: z.number(), error: taskErrorSchema.nullable(), vip: taskVipSchema.nullable(),
  seedAvailable: z.boolean().default(false),
  revision: z.number().int().positive(), observationRevision: z.number().int().positive(), fileRevision: z.number().int().positive(), capabilities: taskCapabilitySchema,
})

export const taskFileV2Schema = z.object({ index: z.number().int().nonnegative(), name: z.string(), path: z.string(), size: z.number(), offset: z.number(), selected: z.boolean() })
export const taskDetailV2Schema = taskV2Schema.extend({ files: z.array(taskFileV2Schema) })
export const taskQueryV2Schema = z.object({
  view: z.enum(['downloading', 'completed', 'search', 'all', 'trash', 'private']).optional(),
  scope: z.enum(['all', 'active', 'completed', 'trash', 'private']).optional(),
  search: z.string().optional(), query: z.string().optional(),
  sort: z.enum(['created-desc', 'completed-desc', 'name-asc', 'size-desc', 'speed-desc', 'progress-desc', 'created-asc']).optional(),
  order: z.string().optional(), groupBy: z.enum(['none', 'date', 'task-group']).optional(),
  cursor: z.union([z.string(), z.number().int().nonnegative()]).optional(), limit: z.number().int().min(1).max(200).optional(), includeFiles: z.boolean().optional(),
})
export const taskListItemV2Schema = z.object({
  taskId: z.string().min(1), parentTaskId: z.string().nullable(),
  kind: z.enum(['http', 'https', 'ftp', 'bt', 'magnet', 'ed2k', 'thunder', 'group']),
  lifecycle: z.enum(['preparing', 'metadata', 'queued', 'downloading', 'paused', 'completed', 'failed', 'recycled', 'missing']),
  displayName: z.string(), totalBytes: z.number().nonnegative(), completedBytes: z.number().nonnegative(),
  downloadBytesPerSecond: z.number().nonnegative(), uploadBytesPerSecond: z.number().nonnegative(), progress: z.number().min(0).max(1),
  etaSeconds: z.number().nonnegative().nullable(), createdAt: z.number(), completedAt: z.number().nullable(), error: taskErrorSchema.nullable(),
  group: z.object({ id: z.string(), label: z.string() }).nullable(), groupResult: z.enum(['partial-failed', 'failed']).nullable().optional(), badges: z.array(z.enum(['vip', 'private', 'remote', 'bt'])),
  capabilities: z.array(taskListCapabilitySchema), pendingOperation: z.object({ operationId: z.string(), command: z.string() }).nullable(),
  revision: z.number().int().positive(), observationRevision: z.number().int().positive(),
})
export const taskQueryResponseV2Schema = z.object({ items: z.array(taskListItemV2Schema), total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), snapshotRevision: z.number().int().nonnegative(), repositoryRevision: z.number().int().nonnegative(), counts: z.object({ all: z.number(), active: z.number(), completed: z.number(), trash: z.number(), private: z.number(), repositoryRevision: z.number() }).optional() })
export const taskCountsV2Schema = z.object({ all: z.number(), active: z.number(), completed: z.number(), trash: z.number(), private: z.number(), repositoryRevision: z.number() })
export const commandResultV2Schema = z.object({
  taskId: z.string(), ok: z.boolean(), revision: z.number().optional(), deleted: z.boolean().optional(), deletedLocal: z.boolean().optional(),
  localFileError: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).optional(),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).optional(),
})
export const batchCommandResponseV2Schema = z.object({ operationId: z.string(), acceptedAt: z.number(), results: z.array(commandResultV2Schema) })
export type TaskV2 = z.infer<typeof taskV2Schema>
export type TaskDetailV2 = z.infer<typeof taskDetailV2Schema>
export type TaskListItemV2 = z.infer<typeof taskListItemV2Schema>
export type TaskQueryRequestV2 = z.infer<typeof taskQueryV2Schema>
export type TaskCommand = 'start' | 'pause' | 'remove-record' | 'recycle' | 'recover' | 'delete-permanently' | 'redownload' | 'rename' | 'move' | 'set-speed-limit' | 'update-bt-selection' | 'set-bt-scheduler' | 'open' | 'show-in-folder' | 'copy-info'
