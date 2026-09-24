import { policySnapshotSchema, policyUpdateResponseSchema, type DownloadPolicy } from '../contracts/v2/policies'
import { rpcV2 } from './client'

export async function getDownloadPolicy() { return policySnapshotSchema.parse(await rpcV2('thunder.ui.v2.policies.get')) }
export async function updateDownloadPolicy(expectedRevision: number, patch: Partial<DownloadPolicy>, proxySecret?: Record<string, unknown>) { return policyUpdateResponseSchema.parse(await rpcV2('thunder.ui.v2.policies.update', [{ expectedRevision, patch, ...(proxySecret ? { proxySecret } : {}) }])) }
export async function enableFullSpeed() { return policyUpdateResponseSchema.parse(await rpcV2('thunder.ui.v2.policies.enableFullSpeed')) }
export async function restoreLimits() { return policyUpdateResponseSchema.parse(await rpcV2('thunder.ui.v2.policies.restoreLimits')) }
export async function testProxy(candidate: Record<string, unknown>) { return rpcV2('thunder.ui.v2.proxy.test', [candidate]) }
