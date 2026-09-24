import { privateStatusSchema, privateTasksSchema } from '../contracts/v2/private-space'
import { rpcV2 } from './client'

export async function getPrivateStatus() { return privateStatusSchema.parse(await rpcV2('thunder.ui.v2.private.getStatus')) }
export async function setupPrivateSpace(password: string, directory?: string) { return rpcV2<{ configured: boolean; directory: string; status: unknown }>('thunder.ui.v2.private.setup', [{ password, directory }]) }
export async function unlockPrivateSpace(password: string) { return rpcV2<{ sessionToken: string; expiresAt: number; status: unknown }>('thunder.ui.v2.private.unlock', [{ password }]) }
export async function lockPrivateSpace() { return rpcV2<{ locked: boolean }>('thunder.ui.v2.private.lock') }
export async function queryPrivateTasks(search = '') { return privateTasksSchema.parse(await rpcV2('thunder.ui.v2.private.queryTasks', [{ search }])) }
export async function moveTaskIntoPrivate(taskId: string, expectedRevision?: number) { return rpcV2<{ task: unknown }>('thunder.ui.v2.private.moveIn', [{ taskId, expectedRevision }]) }
export async function moveTaskOutOfPrivate(taskId: string, targetDirectory: string, expectedRevision?: number) { return rpcV2<{ task: unknown }>('thunder.ui.v2.private.moveOut', [{ taskId, targetDirectory, expectedRevision }]) }
export async function changePrivatePassword(oldPassword: string, newPassword: string) { return rpcV2<{ changed: boolean }>('thunder.ui.v2.private.changePassword', [{ oldPassword, newPassword }]) }
