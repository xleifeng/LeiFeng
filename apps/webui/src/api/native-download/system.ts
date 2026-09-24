import { rpcV2 } from './client'

export async function getSystemCapabilities() { return rpcV2<Record<string, boolean>>('thunder.ui.v2.system.capabilities') }
export async function getMediaCapabilities() { return rpcV2<Record<string, unknown>>('thunder.ui.v2.system.mediaCapabilities') }
export async function restartDownloadEngine(force = false) { return rpcV2<{ engineGeneration: number; healthy: boolean; restarts: number }>('thunder.ui.v2.system.restartEngine', [{ force }]) }
