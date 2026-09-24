import { z } from 'zod'

export const taskOperationSchema = z.object({
  operationId: z.string(), idempotencyKey: z.string().optional(), taskId: z.string(), command: z.string(), state: z.string(),
  beforeRevision: z.number(), afterRevision: z.number().nullable(), params: z.record(z.string(), z.unknown()),
  nativeGeneration: z.number().optional(), evidence: z.record(z.string(), z.unknown()), problem: z.unknown().nullable(), result: z.unknown().nullable(), createdAt: z.number(), updatedAt: z.number(),
})
export type TaskOperation = z.infer<typeof taskOperationSchema>
