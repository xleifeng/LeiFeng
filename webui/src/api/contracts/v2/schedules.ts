import { z } from 'zod'
export const scheduleSchema = z.object({ id: z.string(), name: z.string(), enabled: z.boolean(), action: z.enum(['start-all', 'pause-all', 'enable-full-speed', 'restore-limits']), daysOfWeek: z.array(z.number().int().min(0).max(6)), localTime: z.string(), timezone: z.string(), nextRunAt: z.number().nullable(), lastRunAt: z.number().nullable(), lastResult: z.string().nullable(), executionKey: z.string().nullable().optional(), revision: z.number().int().positive() })
export const scheduleQueryResponseSchema = z.object({ revision: z.number().int().nonnegative(), schedules: z.array(scheduleSchema) })
export const downloadLimitWindowSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  startLocalTime: z.string(),
  endLocalTime: z.string(),
  timezone: z.string(),
  activeNow: z.boolean(),
  scheduleIds: z.array(z.string()),
  problemCode: z.string().nullable(),
  revision: z.number().int().nonnegative().optional(),
  runtime: z.object({ applied: z.boolean(), reason: z.string(), mode: z.string().optional(), problem: z.object({ code: z.string(), message: z.string() }).optional(), response: z.unknown().optional() }).optional(),
})
export type Schedule = z.infer<typeof scheduleSchema>
export type DownloadLimitWindow = z.infer<typeof downloadLimitWindowSchema>
