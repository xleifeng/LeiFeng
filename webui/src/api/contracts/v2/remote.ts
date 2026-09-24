import { z } from 'zod'

export const remoteNodeSchema = z.object({
  id: z.string(), name: z.string(), endpoint: z.string(), certificateFingerprint: z.string(),
  permissions: z.array(z.enum(['submit', 'view', 'control', 'stream'])), state: z.enum(['online', 'offline', 'untrusted', 'incompatible']),
  capabilities: z.record(z.string(), z.boolean()), version: z.string().nullable(), lastSeenAt: z.number().nullable(), fetchedAt: z.number().nullable().optional(), problem: z.string().nullable().optional(),
})
export const remoteNodesResponseSchema = z.object({ items: z.array(remoteNodeSchema) })
export const remotePairingSchema = z.object({ pairingId: z.string(), code: z.string(), expiresAt: z.number(), serverFingerprint: z.string().nullable().optional() })
export const remoteServerClientSchema = z.object({ id: z.string(), name: z.string(), certificateFingerprint: z.string(), permissions: z.array(z.string()), createdAt: z.number(), revokedAt: z.number().nullable() }).passthrough()
export const remoteTaskSchema = z.object({
  id: z.string(), remoteNodeId: z.string(), displayName: z.string(), lifecycle: z.string(),
  totalBytes: z.number().optional(), completedBytes: z.number().optional(), downloadBytesPerSecond: z.number().optional(),
  badges: z.array(z.string()).optional(), revision: z.number().optional(),
}).passthrough()
export const remoteTasksResponseSchema = z.object({ items: z.array(remoteTaskSchema), total: z.number().optional(), nextCursor: z.unknown().nullable().optional() }).passthrough()
export type RemoteNode = z.infer<typeof remoteNodeSchema>
export type RemoteServerClient = z.infer<typeof remoteServerClientSchema>
export type RemoteTask = z.infer<typeof remoteTaskSchema>
