import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ issueMediaToken: vi.fn() }))
vi.mock('../../src/api/native-download/media', () => ({
  issueMediaToken: mocks.issueMediaToken,
  buildMediaContentUrl: (taskId: string, fileIndex: number, token: string) => `/media/${taskId}/${fileIndex}?token=${token}`,
}))

import LocalMediaPlayer from '../../src/components/player/LocalMediaPlayer.vue'

describe('LocalMediaPlayer', () => {
  beforeEach(() => {
    mocks.issueMediaToken.mockReset()
    mocks.issueMediaToken.mockResolvedValueOnce({ token: 'first' }).mockResolvedValueOnce({ token: 'second' })
  })

  it('automatically refreshes an expired token only once', async () => {
    const wrapper = mount(LocalMediaPlayer, { props: { taskId: 'task-1', fileIndex: 0, displayName: 'image.png', kind: 'image' } })
    await flushPromises()
    await wrapper.find('img').trigger('error')
    await flushPromises()
    await wrapper.find('img').trigger('error')
    await flushPromises()
    expect(mocks.issueMediaToken).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('媒体加载失败，请重试')
  })
})
