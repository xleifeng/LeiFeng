import { daemonPluginSchema, pluginSetEnabledResultSchema } from '../contracts/v2/plugins'
import { rpcV2 } from './client'

export async function listDaemonPlugins() {
  return daemonPluginSchema.array().parse(await rpcV2('leifeng.ui.v2.plugins.list'))
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  return pluginSetEnabledResultSchema.parse(await rpcV2('leifeng.ui.v2.plugins.setEnabled', [{ id, enabled }]))
}
