import { z } from 'zod'

/** daemon 装配面的单个插件描述（plugin-admin.cjs 的 plugins.list 返回项） */
export const daemonPluginSchema = z.object({
  id: z.string(),
  provides: z.array(z.string()),
  requires: z.array(z.string()),
  ui: z.object({ capabilities: z.array(z.string()) }),
  enabled: z.boolean(),
})

/** plugins.setEnabled 返回（重启生效） */
export const pluginSetEnabledResultSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  restartRequired: z.boolean(),
})

export type DaemonPlugin = z.infer<typeof daemonPluginSchema>
export type PluginSetEnabledResult = z.infer<typeof pluginSetEnabledResultSchema>
