import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TopBar from '../../src/components/layout/TopBar.vue'

describe('TopBar', () => {
  it('emits search updates and account/theme intents', async () => {
    const wrapper = mount(TopBar, { props: { search: '', accountLabel: '登录' } })
    await wrapper.get('input[aria-label="搜索任务"]').setValue('ubuntu')
    expect(wrapper.emitted('update:search')?.[0]).toEqual(['ubuntu'])
    await wrapper.get('button[aria-label="账户"]').trigger('click')
    expect(wrapper.emitted('account')).toHaveLength(1)
    await wrapper.get('mdui-button-icon[aria-label="切换主题"]').trigger('click')
    expect(wrapper.emitted('theme')).toHaveLength(1)
  })
})
