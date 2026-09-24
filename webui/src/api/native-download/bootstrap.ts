import { bootstrapV2Schema, type BootstrapV2 } from '../contracts/v2/bootstrap'
import { rpcV2 } from './client'

export async function getBootstrapV2(): Promise<BootstrapV2> {
  return bootstrapV2Schema.parse(await rpcV2('thunder.ui.v2.bootstrap'))
}
