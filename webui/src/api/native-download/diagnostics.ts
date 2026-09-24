import { diagnosticExportSchema, diagnosticsSchema, type Diagnostics } from '../contracts/v2/diagnostics'
import { rpcV2 } from './client'
export async function getDiagnostics(): Promise<Diagnostics> { return diagnosticsSchema.parse(await rpcV2('thunder.ui.v2.diagnostics.get')) }
export async function prepareDiagnosticExport() { return diagnosticExportSchema.parse(await rpcV2('thunder.ui.v2.diagnostics.exports.prepare')) }
export function diagnosticExportUrl(exportId: string) { return `/api/v2/diagnostics/exports/${encodeURIComponent(exportId)}` }
export async function queryDiagnosticEvents(limit = 100): Promise<unknown[]> { const result = await rpcV2<unknown>('thunder.ui.v2.diagnostics.events.query', [{ limit }]); return Array.isArray(result) ? result : (result as { items?: unknown[] })?.items || [] }
export async function runDiagnosticCheck(checkId: string, taskId?: string) { return rpcV2<Record<string, unknown>>('thunder.ui.v2.diagnostics.checks.run', [{ checkId, ...(taskId ? { taskId } : {}) }]) }
export async function getDiagnosticExportManifest(exportId: string) { return diagnosticExportSchema.parse(await rpcV2('thunder.ui.v2.diagnostics.exports.getManifest', [{ exportId }])) }
export async function cancelDiagnosticExport(exportId: string) { return rpcV2<{ cancelled: boolean }>('thunder.ui.v2.diagnostics.exports.cancel', [{ exportId }]) }
