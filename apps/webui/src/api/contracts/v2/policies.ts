import { z } from 'zod'

export const proxyPolicySchema = z.object({ mode: z.enum(['direct', 'http', 'socks5']), host: z.string(), port: z.number().int().nullable(), username: z.string(), passwordRef: z.string().nullable(), passwordPresent: z.boolean().optional() })
export const downloadPolicySchema = z.object({ schemaVersion: z.number().int(), defaultDownloadPath: z.string(), maxConcurrentTasks: z.number().int(), globalDownloadLimit: z.number().int().nullable(), globalUploadLimit: z.number().int().nullable(), globalConnectionLimit: z.number().int().nullable(), autoResumeUnfinished: z.boolean(), autoMoveSlowTaskToTail: z.boolean(), slowTaskThresholdBytesPerSecond: z.number().int(), p2pEnabled: z.boolean(), p2sEnabled: z.boolean(), proxy: proxyPolicySchema, idleDownload: z.object({ enabled: z.boolean(), idleAfterSeconds: z.number().int(), pauseOnActivity: z.boolean() }), completionAction: z.enum(['none', 'pause-all', 'stop-engine', 'suspend', 'poweroff']), openOnCompleteDefault: z.boolean(), scheduleIds: z.array(z.string()), updatedAt: z.number() })
export const policySnapshotSchema = z.object({ revision: z.number().int(), policy: downloadPolicySchema, lastApplied: z.unknown().nullable(), fullSpeed: z.boolean() })
export const policyUpdateResponseSchema = policySnapshotSchema.extend({ applied: z.boolean().optional(), applyProblems: z.array(z.unknown()).optional(), runtime: z.unknown().optional() })
export type DownloadPolicy = z.infer<typeof downloadPolicySchema>
export type PolicySnapshot = z.infer<typeof policySnapshotSchema>
