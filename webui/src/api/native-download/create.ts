import { createCancelResponseV2Schema, createCommitResponseV2Schema, createDraftV2Schema, pathValidationV2Schema, preflightResponseV2Schema } from '../contracts/v2/create'
import { rpcV2 } from './client'

export async function preflightCreate(inputs: Array<{ kind: 'link'; value: string }>, savePath?: string, options: Record<string, unknown> = {}, signal?: AbortSignal) {
  return preflightResponseV2Schema.parse(await rpcV2('thunder.ui.v2.create.preflight', [{ inputs, savePath, options }], signal))
}
export async function getCreateDraft(draftId: string, signal?: AbortSignal) { return createDraftV2Schema.parse(await rpcV2('thunder.ui.v2.create.getDraft', [{ draftId }], signal)) }
export async function updateCreateDraft(input: { draftId: string; expectedRevision: number; selectedFileIndices?: number[]; displayName?: string; savePath?: string; duplicateResolution?: string; options?: Record<string, unknown> }) { return createDraftV2Schema.parse(await rpcV2('thunder.ui.v2.create.updateDraft', [input])) }
export async function commitCreateDrafts(draftIds: string[], expectedRevisions: Record<string, number>, idempotencyKey?: string, group?: { label?: string }) { return createCommitResponseV2Schema.parse(await rpcV2('thunder.ui.v2.create.commit', [{ draftIds, expectedRevisions, idempotencyKey, group }])) }
export async function cancelCreateDrafts(draftIds: string[], reason = 'user') { return createCancelResponseV2Schema.parse(await rpcV2('thunder.ui.v2.create.cancel', [{ draftIds, reason }])) }
export async function listRecentPaths() { const response = await rpcV2<{ paths: string[] }>('thunder.ui.v2.paths.listRecent'); return response.paths }
export async function removeRecentPath(path: string) { const response = await rpcV2<{ paths: string[] }>('thunder.ui.v2.paths.removeRecent', [{ path }]); return response.paths }
export async function clearRecentPaths() { const response = await rpcV2<{ paths: string[] }>('thunder.ui.v2.paths.clearRecent'); return response.paths }
export async function validatePath(path: string, estimatedBytes = 0) { return pathValidationV2Schema.parse(await rpcV2('thunder.ui.v2.paths.validate', [{ path, estimatedBytes }])) }
