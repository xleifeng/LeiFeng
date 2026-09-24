import { z } from 'zod'

export const downloadSettingsV2Schema = z.object({
  revision: z.number().int().nonnegative(),
  desired: z.object({ downloadLimit: z.number(), uploadLimit: z.number(), connectionLimit: z.number(), maxTasks: z.number(), downloadDir: z.string(), oneKey: z.object({ mode: z.enum(['always-preflight', 'by-size', 'always-silent']), maxSilentBytes: z.number().nonnegative(), allowedKinds: z.array(z.string()), pathMode: z.enum(['default', 'last-used', 'fixed']), fixedPath: z.string().nullable() }).optional() }),
  applied: z.object({ downloadLimit: z.number(), uploadLimit: z.number(), connectionLimit: z.number(), maxTasks: z.number(), downloadDir: z.string(), oneKey: z.object({ mode: z.enum(['always-preflight', 'by-size', 'always-silent']), maxSilentBytes: z.number().nonnegative(), allowedKinds: z.array(z.string()), pathMode: z.enum(['default', 'last-used', 'fixed']), fixedPath: z.string().nullable() }).optional() }).nullable(),
  source: z.enum(['desired', 'applied-cache']),
})

export type DownloadSettingsV2 = z.infer<typeof downloadSettingsV2Schema>
