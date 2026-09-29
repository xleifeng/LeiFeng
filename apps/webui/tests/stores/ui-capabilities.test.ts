import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiCapabilitiesStore } from '../../src/stores/ui-capabilities'

describe('ui-capabilities store', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('views 未设置（旧 daemon / 启动前）= 不门控，全部能力可用', () => {
    const store = useUiCapabilitiesStore()
    expect(store.gating).toBe(false)
    expect(store.enabled('history')).toBe(true)
    expect(store.enabled('remote')).toBe(true)
    expect(store.enabled('cloud-drive-unknown')).toBe(true)
  })

  it('setViews(undefined/null) 归一为不门控', () => {
    const store = useUiCapabilitiesStore()
    store.setViews(['history'])
    store.setViews(undefined)
    expect(store.gating).toBe(false)
    expect(store.enabled('remote')).toBe(true)
  })

  it('views 子集 = 严格门控', () => {
    const store = useUiCapabilitiesStore()
    store.setViews(['tasks', 'settings'])
    expect(store.gating).toBe(true)
    expect(store.enabled('tasks')).toBe(true)
    expect(store.enabled('history')).toBe(false)
  })

  it('未知能力 ID 在门控态保守降级为不可用', () => {
    const store = useUiCapabilitiesStore()
    store.setViews(['tasks'])
    expect(store.enabled('future-capability')).toBe(false)
  })
})
