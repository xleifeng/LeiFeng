import { z } from 'zod'

export const accountStatusSchema = z.object({
  loginFlow: z.object({ state: z.enum(['idle', 'awaiting-scan', 'completing', 'failed']), problemCode: z.string().optional() }),
  account: z.object({
    valid: z.boolean(), isVip: z.boolean(), isDownloadVip: z.boolean(), isSuperVip: z.boolean(),
    isPlatinumVip: z.boolean(), isPanVip: z.boolean(), userVas: z.number(), vipType: z.number(),
    vipLevel: z.number(), checkedAt: z.number().nullable(),
  }),
  credential: z.object({ refreshTokenPresent: z.boolean(), accessTokenExpiresAt: z.number().nullable() }),
  session: z.object({ registered: z.boolean(), lastKeepAliveAt: z.number().nullable(), problemCode: z.string().optional() }),
  engine: z.object({ notified: z.boolean(), notifiedAt: z.number().nullable(), problemCode: z.string().optional() }),
})
export const loginStartSchema = z.object({ verificationUrl: z.string().nullable().optional(), userCode: z.string().nullable().optional(), expiresIn: z.number().optional(), interval: z.number().optional() })
export type AccountStatus = z.infer<typeof accountStatusSchema>
export type LoginStart = z.infer<typeof loginStartSchema>
