import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { setTheme } from 'mdui/functions/setTheme.js'

export const useShellStore = defineStore('shell', () => {
  const search = ref('')
  const navOpen = ref(false)
  const density = ref<'comfortable' | 'compact'>((localStorage.getItem('leifeng.ui.density.v1') as 'comfortable' | 'compact') || 'comfortable')
  const theme = ref<'light' | 'dark'>((localStorage.getItem('leifeng.ui.theme.v1') as 'light' | 'dark') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  watch(density, (value) => localStorage.setItem('leifeng.ui.density.v1', value), { immediate: true })
  // data-theme 驱动手书样式（--md-* 暗色覆盖），mdui-theme-* 驱动 mdui 组件——两轨同步
  watch(theme, (value) => { document.documentElement.dataset.theme = value; setTheme(value); localStorage.setItem('leifeng.ui.theme.v1', value) }, { immediate: true })
  function clearSearch() { search.value = '' }
  return { search, navOpen, density, theme, clearSearch }
})
