import { z } from 'zod'

export const rpcProblemSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})

export const taskErrorSchema = z.object({
  code: z.string(),
  nativeCode: z.number().optional(),
  category: z.enum(['network', 'source', 'filesystem', 'permission', 'engine', 'account', 'policy', 'unknown']),
  message: z.string(),
  retryable: z.boolean(),
  actions: z.array(z.enum(['retry', 'change-source', 'change-path', 'login', 'diagnose'])),
})

export const taskVipSchema = z.object({
  enabled: z.boolean(),
  state: z.string(),
  receivedBytes: z.number(),
  freeDcdnReceivedBytes: z.number(),
  nextRefreshAt: z.number(),
  lastErrorCode: z.string().nullable(),
})

export type RpcProblem = z.infer<typeof rpcProblemSchema>
export type TaskError = z.infer<typeof taskErrorSchema>
