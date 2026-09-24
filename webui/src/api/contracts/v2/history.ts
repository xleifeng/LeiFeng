import { z } from 'zod'

export const historyItemSchema = z.object({ id: z.string(), taskId: z.string(), kind: z.string(), displayName: z.string().nullable().optional(), source: z.string().nullable().optional(), savePath: z.string().nullable().optional(), result: z.string(), totalBytes: z.number(), errorCode: z.string().nullable().optional(), createdAt: z.number(), startedAt: z.number().nullable().optional(), completedAt: z.number().nullable().optional(), removedAt: z.number().nullable().optional(), privateSpace: z.boolean(), locked: z.boolean().optional(), seedRef: z.string().nullable().optional() }).passthrough()
export const historyQuerySchema = z.object({ items: z.array(historyItemSchema), nextCursor: z.unknown().nullable().optional() })
export type HistoryItem = z.infer<typeof historyItemSchema>
