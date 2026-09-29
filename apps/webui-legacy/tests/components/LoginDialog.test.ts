import { flushPromises, mount } from '@vue/test-utils'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAccountStatus: vi.fn(),
  startAccountLogin: vi.fn(),
  cancelAccountLogin: vi.fn(),
  toDataURL: vi.fn(),
}))

vi.mock('../../src/api/native-download/account', () => ({
  getAccountStatus: mocks.getAccountStatus,
  startAccountLogin: mocks.startAccountLogin,
  cancelAccountLogin: mocks.cancelAccountLogin,
}))
vi.mock('qrcode', () => ({ toDataURL: mocks.toDataURL }))

import LoginDialog from '../../src/components/account/LoginDialog.vue'

describe('LoginDialog', () => {
  beforeEach(() => {
    mocks.getAccountStatus.mockResolvedValue({
      loginFlow: { state: 'idle' }, account: { valid: false, isVip: false, vipType: 0, vipLevel: 0, checkedAt: null },
      credential: { refreshTokenPresent: false, accessTokenExpiresAt: null }, session: { registered: false, lastKeepAliveAt: null }, engine: { notified: false, notifiedAt: null },
    })
    mocks.startAccountLogin.mockResolvedValue({ verificationUrl: 'https://login.example.test/device?code=UC-1', userCode: 'UC-1', expiresIn: 120, interval: 2 })
    mocks.cancelAccountLogin.mockResolvedValue({ cancelled: true })
    mocks.toDataURL.mockResolvedValue('data:image/png;base64,qr')
  })

  it('renders a generated QR image after starting device login', async () => {
    const wrapper = mount(LoginDialog, { global: { plugins: [VueQueryPlugin] } })
    await wrapper.find('button.primary-button').trigger('click')
    await flushPromises()
    expect(mocks.toDataURL).toHaveBeenCalledWith('https://login.example.test/device?code=UC-1', expect.objectContaining({ width: 220 }))
    expect(wrapper.find('img.login-qr').attributes('src')).toBe('data:image/png;base64,qr')
    expect(wrapper.find('.login-url').attributes('href')).toBe('https://login.example.test/device?code=UC-1')
  })
})
