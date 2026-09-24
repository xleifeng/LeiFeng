import { z } from 'zod'

export const linkItemSchema = z.object({ id: z.string(), sourceFingerprint: z.string().optional(), kind: z.string(), title: z.string(), source: z.string().nullable().optional(), infoHash: z.string().nullable().optional(), seedRef: z.string().nullable().optional(), totalBytes: z.number().optional(), privateSpace: z.boolean(), locked: z.boolean().optional(), favorite: z.boolean(), autoSaved: z.boolean().optional(), lastDownloadedAt: z.number().nullable().optional(), revision: z.number(), dirty: z.boolean().optional(), files: z.array(z.object({ index: z.number(), path: z.string(), size: z.number() }).passthrough()).optional(), tags: z.array(z.object({ id: z.string(), name: z.string() })).optional() }).passthrough()
export const linkQuerySchema = z.object({ items: z.array(linkItemSchema) })
export type LinkItem = z.infer<typeof linkItemSchema>
