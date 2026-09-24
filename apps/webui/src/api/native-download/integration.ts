import { captureClientSchema, capturePairingSchema, desktopCaptureProvisionSchema, type CaptureClient } from '../contracts/v2/integration'
import { rpcV2 } from './client'

export async function startCapturePairing() { return capturePairingSchema.parse(await rpcV2('thunder.ui.v2.capture.startPairing', [{}])) }
export async function queryCaptureClients(): Promise<CaptureClient[]> { const result = await rpcV2<{ items: unknown[] }>('thunder.ui.v2.capture.clients.query'); return result.items.map((item) => captureClientSchema.parse(item)) }
export async function revokeCaptureClient(clientId: string) { await rpcV2('thunder.ui.v2.capture.clients.revoke', [{ clientId }]) }
export async function provisionDesktopCapture() { return desktopCaptureProvisionSchema.parse(await rpcV2('thunder.ui.v2.capture.desktop.provision', [{}])) }
