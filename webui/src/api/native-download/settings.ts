import { downloadSettingsV2Schema } from '../contracts/v2/settings'
import { rpcV2 } from './client'

export async function getDownloadSettings() { return downloadSettingsV2Schema.parse(await rpcV2('thunder.ui.v2.settings.get')) }
export async function updateDownloadSettings(patch: Record<string, unknown>, expectedRevision?: number) {
  return downloadSettingsV2Schema.parse(await rpcV2('thunder.ui.v2.settings.update', [{ patch, expectedRevision }]))
}
