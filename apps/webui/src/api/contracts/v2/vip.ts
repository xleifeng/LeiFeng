import { z } from 'zod'
export const vipTaskStateSchema = z.object({
  taskId: z.string(), availability: z.enum(['account-required', 'not-vip', 'available']), state: z.string(),
  vipReceivedBytes: z.number(), freeDcdnReceivedBytes: z.number(), lastAttemptAt: z.number(), nextRetryAt: z.number(),
  problemCode: z.string().nullable(), resourceStatus: z.enum(['unknown', 'eligible', 'partial', 'cold', 'blocked']),
  resourceProblemCode: z.string().nullable(), accelerationChannel: z.enum(['none', 'member-acceleration', 'super-channel']),
  superChannelEligible: z.boolean(), enabled: z.boolean(),
})
export const vipGlobalStateSchema = z.object({
  enabled: z.boolean(),
  availability: z.enum(['account-required', 'not-vip', 'available']),
  accountReady: z.boolean(),
  isVip: z.boolean(),
  isDownloadVip: z.boolean(),
  userVas: z.number(),
  vipType: z.number(),
  vipLevel: z.number(),
  isSuperVip: z.boolean(),
  isPlatinumVip: z.boolean(),
  isPanVip: z.boolean(),
  accelerationChannel: z.enum(['none', 'member-acceleration', 'super-channel']),
  peerIdReady: z.boolean(),
  featureCapabilities: z.object({
    superChannel: z.boolean(),
    speedTrial: z.boolean(),
    source: z.string().optional(),
  }).passthrough(),
})
export type VipTaskState = z.infer<typeof vipTaskStateSchema>
export type VipGlobalState = z.infer<typeof vipGlobalStateSchema>
