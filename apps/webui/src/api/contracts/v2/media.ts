import { z } from 'zod'

export const mediaCapabilitiesSchema = z.object({
  openOnHost: z.boolean(),
  streamInBrowser: z.boolean(),
  mediaTokenTtlMs: z.number().optional(),
  maxStreams: z.number().optional(),
})

export const mediaTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
  fileIndex: z.number().nullable(),
  mediaKind: z.enum(['video', 'audio', 'image', 'text', 'download-only']),
  mimeType: z.string(),
  availableBytes: z.number(),
})

export type MediaCapabilities = z.infer<typeof mediaCapabilitiesSchema>
export type MediaToken = z.infer<typeof mediaTokenSchema>
