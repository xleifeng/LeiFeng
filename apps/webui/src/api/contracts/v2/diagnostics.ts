import { z } from 'zod'
export const diagnosticsSchema = z.object({
  apiVersion: z.number(), daemonVersion: z.string(), startedAt: z.number(), now: z.number(), hostname: z.string(), repositoryRevision: z.number(),
  counts: z.record(z.string(), z.number()), engine: z.record(z.string(), z.unknown()), taskDb: z.record(z.string(), z.unknown()).optional(),
  auth: z.record(z.string(), z.unknown()).nullable().optional(), vip: z.record(z.string(), z.unknown()).nullable().optional(),
  privateSpace: z.record(z.string(), z.unknown()), media: z.record(z.string(), z.unknown()), remoteNodes: z.object({ items: z.array(z.unknown()) }),
  settings: z.record(z.string(), z.unknown()), filesystem: z.record(z.string(), z.unknown()).optional(), events: z.array(z.unknown()),
}).passthrough()
export const diagnosticExportSchema = z.object({ exportId: z.string(), expiresAt: z.number(), format: z.string().optional(), contentType: z.string().optional(), files: z.array(z.string()), warnings: z.array(z.string()) })
export type Diagnostics = z.infer<typeof diagnosticsSchema>
