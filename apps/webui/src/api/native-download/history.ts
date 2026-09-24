import { historyQuerySchema, historyItemSchema } from '../contracts/v2/history'
import { rpcV2 } from './client'

export async function queryHistory(options: Record<string, unknown> = {}) { return historyQuerySchema.parse(await rpcV2('thunder.ui.v2.history.query', [options])) }
export async function getHistory(historyId: string) { return historyItemSchema.parse(await rpcV2('thunder.ui.v2.history.get', [{ historyId }])) }
export async function removeHistory(historyIds: string[], privateMode = false) { return rpcV2<{ deleted: number }>('thunder.ui.v2.history.remove', [{ historyIds, privateMode }]) }
export async function clearHistory(privateMode = false, result = '') { return rpcV2<{ deleted: number }>('thunder.ui.v2.history.clear', [{ privateMode, result }]) }
export async function createDraftFromHistory(historyId: string) { return rpcV2('thunder.ui.v2.history.createDraft', [{ historyId }]) }
