import { z } from 'zod'

export const privateStatusSchema = z.object({ configured: z.boolean(), unlocked: z.boolean(), directoryConfigured: z.boolean(), metadataEncrypted: z.boolean(), downloadContentEncrypted: z.boolean(), requiresEncryptedFilesystemForAtRest: z.boolean() })
export const privateTaskSchema = z.object({ id: z.string().optional(), taskId: z.string().optional(), displayName: z.string(), source: z.string().nullable().optional(), savePath: z.string().optional(), privateSpace: z.literal(true), lifecycle: z.string().optional(), totalBytes: z.number().optional(), completedBytes: z.number().optional(), revision: z.number().optional(), files: z.array(z.unknown()).optional() }).passthrough()
export const privateTasksSchema = z.object({ items: z.array(privateTaskSchema) })
export type PrivateStatus = z.infer<typeof privateStatusSchema>
export type PrivateTask = z.infer<typeof privateTaskSchema>
