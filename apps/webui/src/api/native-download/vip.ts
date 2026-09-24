import { vipGlobalStateSchema, vipTaskStateSchema } from '../contracts/v2/vip'
import { rpcV2 } from './client'
export async function getVipGlobalState() { return vipGlobalStateSchema.parse(await rpcV2('thunder.ui.v2.vip.getGlobalState')) }
export async function getVipTaskState(taskId: string) { return vipTaskStateSchema.parse(await rpcV2('thunder.ui.v2.vip.getTaskState', [{ taskId }])) }
export async function setVipTaskEnabled(taskId: string, enabled: boolean, expectedRevision?: number) { return vipTaskStateSchema.parse(await rpcV2('thunder.ui.v2.vip.setTaskEnabled', [{ taskId, enabled, expectedRevision }])) }
export async function retryVipTask(taskId: string) { return rpcV2('thunder.ui.v2.vip.retryTask', [{ taskId }]) }
