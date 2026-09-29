<script setup lang="ts">
// Leifeng Modern 顶栏：窄条——搜索胶囊居中、新建主按钮、主题/账户居右。
// 只保留真实可用动作。
import { ChevronDown, FileUp, Link2, Menu, Moon, Plus, Search, Sun, UserRound, X } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import IconButton from '../common/IconButton.vue'

const props = defineProps<{ search: string; accountLabel: string; accountVip?: boolean; offline?: boolean; theme?: 'light' | 'dark' }>()
const emit = defineEmits<{
  'update:search': [value: string]; menu: []; 'new-link-task': []; 'new-bt-task': [file: File]; account: []; retry: []; paste: [value: string]; theme: []
}>()
const taskMenuOpen = ref(false)
const torrentInput = ref<HTMLInputElement | null>(null)
let closeTimer: number | undefined
function openTaskMenu() { if (closeTimer) window.clearTimeout(closeTimer); taskMenuOpen.value = true }
function closeTaskMenuSoon() { closeTimer = window.setTimeout(() => { taskMenuOpen.value = false }, 140) }
function chooseLinkTask() { taskMenuOpen.value = false; emit('new-link-task') }
function chooseBtTask() { taskMenuOpen.value = false; torrentInput.value?.click() }
function handleTorrent(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (file) emit('new-bt-task', file)
}
onBeforeUnmount(() => { if (closeTimer) window.clearTimeout(closeTimer) })
</script>

<template>
  <header class="top-bar" data-testid="top-bar">
    <div class="top-navgroup">
      <IconButton label="打开导航" class="top-menu-button" @click="emit('menu')"><Menu :size="17" :stroke-width="1.9" /></IconButton>
    </div>
    <div class="top-search">
      <Search :size="15" />
      <input :value="props.search" aria-label="搜索任务" placeholder="搜索任务，或粘贴链接新建" @input="emit('update:search', ($event.target as HTMLInputElement).value)" @paste="emit('paste', ($event.clipboardData?.getData('text') || '').trim())" @keydown.enter="emit('update:search', ($event.target as HTMLInputElement).value)" />
      <button v-if="props.search" class="top-search-clear" aria-label="清除搜索" @click="emit('update:search', '')"><X :size="14" /></button>
    </div>
    <div class="new-task-menu" @mouseenter="openTaskMenu" @mouseleave="closeTaskMenuSoon" @focusin="openTaskMenu" @focusout="closeTaskMenuSoon">
      <button class="primary-button new-task-button" data-testid="new-task-button" aria-label="新建任务" :aria-expanded="taskMenuOpen" aria-haspopup="menu" @click="chooseLinkTask"><Plus :size="16" :stroke-width="2.4" />新建任务<ChevronDown class="new-task-chevron" :size="13" /></button>
      <div v-if="taskMenuOpen" class="new-task-popover" role="menu" aria-label="新建任务类型">
        <button role="menuitem" @click="chooseLinkTask"><span class="new-task-option-icon"><Link2 :size="17" /></span><span><strong>链接任务</strong><small>HTTP、FTP、磁力链接</small></span></button>
        <button role="menuitem" @click="chooseBtTask"><span class="new-task-option-icon bt"><FileUp :size="17" /></span><span><strong>BT 文件任务</strong><small>选择本地 .torrent 文件</small></span></button>
      </div>
      <input ref="torrentInput" class="sr-only" type="file" accept=".torrent,application/x-bittorrent" tabindex="-1" @change="handleTorrent" />
    </div>
    <div class="top-actions">
      <IconButton label="切换主题" data-testid="theme-toggle" @click="emit('theme')"><Sun v-if="props.theme === 'dark'" :size="16" :stroke-width="1.9" /><Moon v-else :size="16" :stroke-width="1.9" /></IconButton>
      <button class="account-button" :class="{ 'is-vip': accountVip }" :title="accountLabel" aria-label="账户" data-testid="account-button" @click="emit('account')"><span class="account-avatar"><UserRound :size="15" :stroke-width="1.9" /></span></button>
    </div>
  </header>
  <div v-if="offline" class="connection-banner"><span>daemon 连接不可用，当前显示最后一次快照</span><button @click="emit('retry')">重新连接</button></div>
</template>
