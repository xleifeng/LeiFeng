import { z } from 'zod'
import { rpcV2 } from './client'

/** daemon 管理面契约（daemon-admin 插件，leifeng.ui.v2.daemon.*） */
const daemonStatusSchema = z.object({
  pid: z.number(),
  ppid: z.number(),
  version: z.string(),
  profile: z.string(),
  uptimeMs: z.number(),
  restartPending: z.boolean(),
  memory: z.object({ rssBytes: z.number(), heapUsedBytes: z.number() }),
  engine: z.object({
    sdkReady: z.boolean(),
    enginePid: z.number().nullable(),
    restarts: z.number(),
    generation: z.number(),
  }).nullable(),
})

export type DaemonStatus = z.infer<typeof daemonStatusSchema>

export async function getDaemonStatus() {
  return daemonStatusSchema.parse(await rpcV2('leifeng.ui.v2.daemon.status'))
}

/** 请求整体重启：daemon 写标记文件后自杀，守护脚本拉起新进程——本调用后 WebUI 会短暂失联 */
export async function restartDaemon() {
  return z.object({ restarting: z.boolean(), pid: z.number() }).parse(
    await rpcV2('leifeng.ui.v2.daemon.restart'),
  )
}
