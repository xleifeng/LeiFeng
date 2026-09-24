import { describe, expect, it, vi } from 'vitest'
import { getRpcSecret, RPC_AUTH_REQUIRED_EVENT, rpcV2, setRpcSecret } from '../src/api/native-download/client'
import { bootstrapV2Schema } from '../src/api/contracts/v2/bootstrap'
import { downloadLimitWindowSchema } from '../src/api/contracts/v2/schedules'

describe('V2 transport', () => {
  it('uses Authorization header and never injects token params', async () => {
    setRpcSecret('v2-secret', false)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { ok: true } }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(rpcV2('thunder.ui.v2.bootstrap')).resolves.toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer v2-secret')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).params).toEqual([])
    expect(getRpcSecret()).toBe('v2-secret')
  })

  it('announces numeric unauthorized RPC responses to the interface', async () => {
    const listener = vi.fn()
    window.addEventListener(RPC_AUTH_REQUIRED_EVENT, listener)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: { code: 1, message: 'unauthorized: missing bearer secret' } }) }))
    await expect(rpcV2('thunder.ui.v2.bootstrap')).rejects.toMatchObject({ code: '1' })
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(RPC_AUTH_REQUIRED_EVENT, listener)
  })
})

describe('V2 bootstrap contract', () => {
  it('rejects non-v2 bootstrap data', () => {
    expect(() => bootstrapV2Schema.parse({ version: '0.4.0', capabilities: {} })).toThrow()
  })
})

describe('download limit window contract', () => {
  it('accepts persisted daily ranges and runtime status', () => {
    expect(downloadLimitWindowSchema.parse({ configured: true, enabled: true, startLocalTime: '22:00', endLocalTime: '06:00', timezone: 'Asia/Shanghai', activeNow: true, scheduleIds: ['download-limit-window-start', 'download-limit-window-end'], problemCode: null }).activeNow).toBe(true)
  })
})
