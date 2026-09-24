import { z } from 'zod'

export const draftFileV2Schema = z.object({ index: z.number().int().nonnegative(), relativePath: z.string(), displayName: z.string(), sizeBytes: z.number().nonnegative(), offsetBytes: z.number().nonnegative(), selected: z.boolean(), parentPath: z.string() })
export const duplicateDraftV2Schema = z.object({ taskId: z.string(), lifecycle: z.string(), samePath: z.boolean(), allowedResolutions: z.array(z.enum(['open-existing', 'redownload', 'rename', 'skip'])) })
export const createDraftV2Schema = z.object({ draftId: z.string(), revision: z.number().int().positive(), state: z.enum(['probing', 'metadata', 'ready', 'committing', 'committed', 'failed', 'cancelled', 'expired']), kind: z.enum(['http', 'https', 'ftp', 'ed2k', 'thunder', 'magnet', 'bt']), originalSource: z.string().nullable(), normalizedSource: z.string().nullable(), displayName: z.string(), savePath: z.string(), totalBytes: z.number().nonnegative().nullable(), files: z.array(draftFileV2Schema), selectedFileIndices: z.array(z.number().int().nonnegative()), duplicate: duplicateDraftV2Schema.nullable(), metadata: z.object({ state: z.enum(['none', 'fetching', 'ready', 'failed']), progress: z.number().min(0).max(1).optional() }).default({ state: 'none' }), failure: z.unknown().nullable(), expiresAt: z.number(), createdAt: z.number(), updatedAt: z.number(), options: z.record(z.string(), z.unknown()).optional() })
export const preflightResultV2Schema = z.object({ ok: z.boolean(), draft: createDraftV2Schema.optional(), error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).optional() })
export const preflightResponseV2Schema = z.object({ results: z.array(preflightResultV2Schema) })
export const createCommitResultV2Schema = z.object({ draftId: z.string(), ok: z.boolean(), taskIds: z.array(z.string()).optional(), error: z.object({ code: z.string(), message: z.string() }).optional() })
export const createCommitResponseV2Schema = z.object({ operationId: z.string(), groupId: z.string().optional(), results: z.array(createCommitResultV2Schema) })
export const createCancelResponseV2Schema = z.object({ results: z.array(z.object({ draftId: z.string(), ok: z.boolean(), draft: createDraftV2Schema.optional(), error: z.object({ code: z.string(), message: z.string() }).optional() })) })
export const pathValidationV2Schema = z.object({ normalizedPath: z.string(), exists: z.boolean(), creatable: z.boolean(), writable: z.boolean(), availableBytes: z.number().nullable(), maxFileBytes: z.number(), warnings: z.array(z.string()) })
export type CreateDraftV2 = z.infer<typeof createDraftV2Schema>
export type DraftFileV2 = z.infer<typeof draftFileV2Schema>
export type CreateStep = 'input' | 'preflight' | 'options' | 'committing' | 'result'
