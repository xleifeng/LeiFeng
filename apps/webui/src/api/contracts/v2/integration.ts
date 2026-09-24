import { z } from 'zod'
export const capturePairingSchema = z.object({ pairingId: z.string(), code: z.string(), expiresAt: z.number() })
export const captureClientSchema = z.object({ id: z.string(), origin: z.string(), name: z.string(), permissions: z.array(z.string()), createdAt: z.number(), lastUsedAt: z.number().nullable(), revokedAt: z.number().nullable() })
export const desktopCaptureProvisionSchema = z.object({ clientId: z.string(), endpoint: z.string(), configPath: z.string() })
export type CaptureClient = z.infer<typeof captureClientSchema>
