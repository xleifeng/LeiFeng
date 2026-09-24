import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useShellStore = defineStore('shell', () => {
  const search = ref('')
  const navOpen = ref(false)
  const density = ref<'comfortable' | 'compact'>((localStorage.getItem('ThunderNativeUI.Density.v1') as 'comfortable' | 'compact') || 'comfortable')
  const theme = ref<'light' | 'dark'>((localStorage.getItem('ThunderNativeUI.Theme.v1') as 'light' | 'dark') || 'light')
  watch(density, (value) => localStorage.setItem('ThunderNativeUI.Density.v1', value), { immediate: true })
  watch(theme, (value) => { document.documentElement.dataset.theme = value; localStorage.setItem('ThunderNativeUI.Theme.v1', value) }, { immediate: true })
  function clearSearch() { search.value = '' }
  return { search, navOpen, density, theme, clearSearch }
})
