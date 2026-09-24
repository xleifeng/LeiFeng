import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import NativeTopbar from '../../src/components/layout/NativeTopbar.vue'

describe('NativeTopbar new task menu', () => {
  it('reveals link and BT task choices on hover', async () => {
    vi.useFakeTimers()
    const wrapper = mount(NativeTopbar, { props: { search: '', accountLabel: '登录' } })
    await wrapper.get('.new-task-menu').trigger('mouseenter')
    expect(wrapper.get('[role="menu"]').text()).toContain('链接任务')
    expect(wrapper.get('[role="menu"]').text()).toContain('BT 文件任务')
    await wrapper.findAll('[role="menuitem"]')[0].trigger('click')
    expect(wrapper.emitted('new-link-task')).toHaveLength(1)
    wrapper.unmount()
    vi.useRealTimers()
  })
})
