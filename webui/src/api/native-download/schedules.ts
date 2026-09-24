import { downloadLimitWindowSchema, scheduleQueryResponseSchema, type Schedule } from '../contracts/v2/schedules'
import { rpcV2 } from './client'
export async function querySchedules() { return scheduleQueryResponseSchema.parse(await rpcV2('thunder.ui.v2.schedules.query')) }
export async function saveSchedule(schedule: Partial<Schedule>, expectedRevision?: number) { return rpcV2('thunder.ui.v2.schedules.save', [{ schedule, expectedRevision }]) }
export async function deleteSchedule(scheduleId: string, expectedRevision?: number) { return rpcV2('thunder.ui.v2.schedules.delete', [{ scheduleId, expectedRevision }]) }
export async function getDownloadLimitWindow() { return downloadLimitWindowSchema.parse(await rpcV2('thunder.ui.v2.schedules.getDownloadLimitWindow')) }
export async function setDownloadLimitWindow(input: { enabled: boolean; startLocalTime: string; endLocalTime: string; timezone: string }) { return downloadLimitWindowSchema.parse(await rpcV2('thunder.ui.v2.schedules.setDownloadLimitWindow', [input])) }
export interface PendingCompletionAction { operationId: string; action: string; createdAt: number; expiresAt: number; cancelled: boolean }
export async function getPendingCompletionAction() { return rpcV2<PendingCompletionAction | null>('thunder.ui.v2.system.completion.get') }
export async function cancelPendingCompletionAction(operationId: string) { return rpcV2<{ cancelled: boolean }>('thunder.ui.v2.system.cancelCompletionAction', [{ operationId }]) }
