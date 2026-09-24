import { z } from 'zod'

export const capabilitySchema = z.object({
  protocols: z.array(z.string()),
  taskControl: z.boolean(),
  recycle: z.boolean(),
  recover: z.boolean(),
  rename: z.boolean(),
  move: z.boolean(),
  redownload: z.boolean(),
  perTaskRateLimit: z.boolean(),
  btFileSelection: z.boolean(),
  btSequential: z.boolean(),
  globalRateLimit: z.boolean(),
  proxy: z.boolean(),
  proxyVerify: z.boolean().optional(),
  p2pSwitch: z.boolean(),
  p2sSwitch: z.boolean().optional(),
  autoMoveLowSpeed: z.boolean().optional(),
  schedules: z.boolean().optional(),
  idleDownload: z.boolean().optional(),
  completionActions: z.boolean().optional(),
  powerActions: z.boolean().optional(),
  linkSync: z.enum(['local-only', 'verified', 'unverified']).optional(),
  superChannel: z.boolean().optional(),
  speedTrial: z.boolean().optional(),
  openOnHost: z.boolean().optional(),
  streamInBrowser: z.boolean().optional(),
  remoteNodes: z.boolean().optional(),
  cloudDrive: z.boolean(),
})

export const bootstrapV2Schema = z.object({
  apiVersion: z.literal(2),
  daemonVersion: z.string(),
  repositoryRevision: z.number().int().nonnegative(),
  serverTime: z.number(),
  capabilities: capabilitySchema,
  engine: z.object({
    transportReady: z.boolean(), sdkReady: z.boolean(), enginePid: z.number().nullable(),
    queue: z.number().nullable(), dht: z.number().nullable(), p2p: z.boolean().nullable(), p2s: z.boolean().nullable(),
    restarts: z.number(), uptimeMs: z.number(),
  }),
  account: z.object({
    valid: z.boolean(), isVip: z.boolean(), isDownloadVip: z.boolean(), isSuperVip: z.boolean(),
    isPlatinumVip: z.boolean(), isPanVip: z.boolean(), userVas: z.number(), vipType: z.number(), vipLevel: z.number(),
  }),
  policy: z.object({ revision: z.number().int().nonnegative(), desired: z.record(z.string(), z.unknown()).optional(), applied: z.record(z.string(), z.unknown()).nullable().optional(), policy: z.record(z.string(), z.unknown()).optional(), lastApplied: z.unknown().nullable().optional(), fullSpeed: z.boolean().optional() }),
  privateSpace: z.object({ configured: z.boolean(), unlocked: z.boolean(), directoryConfigured: z.boolean(), metadataEncrypted: z.boolean(), downloadContentEncrypted: z.boolean(), requiresEncryptedFilesystemForAtRest: z.boolean() }).optional(),
  media: z.object({ openOnHost: z.boolean(), streamInBrowser: z.boolean(), mediaTokenTtlMs: z.number().optional(), maxStreams: z.number().optional() }).optional(),
  security: z.object({ authRequired: z.boolean(), csrfRequired: z.boolean(), loopback: z.boolean(), csrfToken: z.string().optional(), csrfExpiresAt: z.number().optional() }),
})

export type BootstrapV2 = z.infer<typeof bootstrapV2Schema>
