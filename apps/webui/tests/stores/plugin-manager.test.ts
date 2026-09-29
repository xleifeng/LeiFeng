import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../src/api/native-download/plugins', () => ({
  listDaemonPlugins: vi.fn(),
  setPluginEnabled: vi.fn(),
}))

import { listDaemonPlugins, setPluginEnabled } from '../../src/api/native-download/plugins'
import { usePluginManagerStore } from '../../src/stores/plugin-manager'

const pluginA = { id: 'engine-driver', provides: ['engine'], requires: ['repositories'], ui: { capabilities: [] }, enabled: true }
const pluginB = { id: 'web-api-process', provides: ['webApi'], requires: ['rpc'], ui: { capabilities: [] }, enabled: true }

describe('plugin-manager store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(listDaemonPlugins).mockReset()
    vi.mocked(setPluginEnabled).mockReset()
  })

  it('load 成功填充插件列表', async () => {
    vi.mocked(listDaemonPlugins).mockResolvedValue([pluginA, pluginB])
    const store = usePluginManagerStore()
    await store.load()
    expect(store.plugins).toHaveLength(2)
    expect(store.loading).toBe(false)
    expect(store.error).toBe('')
  })

  it('load 失败置 error 不留半成品', async () => {
    vi.mocked(listDaemonPlugins).mockRejectedValue(new Error('daemon 不可达'))
    const store = usePluginManagerStore()
    await store.load()
    expect(store.error).toBe('daemon 不可达')
    expect(store.plugins).toHaveLength(0)
  })

  it('toggle 成功同步本地状态并提示重启生效', async () => {
    vi.mocked(listDaemonPlugins).mockResolvedValue([pluginA, pluginB])
    vi.mocked(setPluginEnabled).mockResolvedValue({ id: 'web-api-process', enabled: false, restartRequired: true })
    const store = usePluginManagerStore()
    await store.load()
    const ok = await store.toggle('web-api-process', false)
    expect(ok).toBe(true)
    expect(store.plugins.find((p) => p.id === 'web-api-process')?.enabled).toBe(false)
    expect(store.notice).toBe('已保存，重启 daemon 后生效')
    expect(store.error).toBe('')
  })

  it('toggle 失败不改本地状态并置 error', async () => {
    vi.mocked(listDaemonPlugins).mockResolvedValue([pluginA, pluginB])
    vi.mocked(setPluginEnabled).mockRejectedValue(new Error('plugins.setEnabled: runtime-config 是基础插件，不可禁用'))
    const store = usePluginManagerStore()
    await store.load()
    const ok = await store.toggle('runtime-config', false)
    expect(ok).toBe(false)
    expect(store.plugins.find((p) => p.id === 'runtime-config')).toBeUndefined()
    expect(store.error).toContain('不可禁用')
  })
})
