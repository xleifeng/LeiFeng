import { flushPromises, mount } from '@vue/test-utils'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getBootstrapV2: vi.fn() }))
vi.mock('../../src/api/native-download/bootstrap', () => ({ getBootstrapV2: mocks.getBootstrapV2 }))

import { getRpcSecret, RPC_AUTH_REQUIRED_EVENT } from '../../src/api/native-download/client'
import ConnectionSecretDialog from '../../src/components/connection/ConnectionSecretDialog.vue'

describe('ConnectionSecretDialog', () => {
  beforeEach(() => mocks.getBootstrapV2.mockResolvedValue({ ok: true }))

  it('opens on an authorization challenge and stores a verified secret', async () => {
    const wrapper = mount(ConnectionSecretDialog, { attachTo: document.body, global: { plugins: [VueQueryPlugin] } })
    window.dispatchEvent(new CustomEvent(RPC_AUTH_REQUIRED_EVENT))
    await nextTick()
    expect(wrapper.get('[role="dialog"]').isVisible()).toBe(true)
    await wrapper.get('#rpc-secret').setValue('browser-secret')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.getBootstrapV2).toHaveBeenCalledOnce()
    expect(getRpcSecret()).toBe('browser-secret')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
