<script setup lang="ts">
// 品牌、历史导航、搜索、新建、主题、导航与账户只保留真实可用动作。
import { ChevronDown, ChevronLeft, ChevronRight, FileUp, Link2, Menu, Plus, RotateCw, Search, Shirt, UserRound, X } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import IconButton from '../common/IconButton.vue'
import brandUrl from '@orig/svg/logo-hummingbird.svg'

defineProps<{ search: string; accountLabel: string; accountVip?: boolean; offline?: boolean }>()
const emit = defineEmits<{
  'update:search': [value: string]; menu: []; 'new-link-task': []; 'new-bt-task': [file: File]; account: []; retry: []; paste: [value: string]
  back: []; forward: []; refresh: []; theme: []; drawer: []
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
  <header class="native-topbar">
    <div class="topbar-brand">
      <img class="brand-bird" :src="brandUrl" alt="迅雷" width="28" height="28" />
      <span class="brand-word">迅雷</span>
    </div>
    <div class="topbar-navgroup">
      <IconButton label="后退" @click="emit('back')"><ChevronLeft :size="16" :stroke-width="2" /></IconButton>
      <IconButton label="前进" @click="emit('forward')"><ChevronRight :size="16" :stroke-width="2" /></IconButton>
      <IconButton label="刷新" class="nav-refresh" @click="emit('refresh')"><RotateCw :size="16" :stroke-width="2" /></IconButton>
    </div>
    <div class="topbar-search">
      <Search :size="16" />
      <input :value="search" aria-label="搜索任务" placeholder="搜文件、贴链接" @input="emit('update:search', ($event.target as HTMLInputElement).value)" @paste="emit('paste', ($event.clipboardData?.getData('text') || '').trim())" @keydown.enter="$emit('update:search', ($event.target as HTMLInputElement).value)" />
      <button v-if="search" class="clear-search" aria-label="清除搜索" @click="emit('update:search', '')"><X :size="15" /></button>
    </div>
    <div class="new-task-menu" @mouseenter="openTaskMenu" @mouseleave="closeTaskMenuSoon" @focusin="openTaskMenu" @focusout="closeTaskMenuSoon">
      <button class="primary-button new-task-button" aria-label="新建任务" :aria-expanded="taskMenuOpen" aria-haspopup="menu" @click="chooseLinkTask"><Plus :size="16" :stroke-width="2.2" />新建<ChevronDown class="new-task-chevron" :size="13" /></button>
      <div v-if="taskMenuOpen" class="new-task-popover" role="menu" aria-label="新建任务类型">
        <button role="menuitem" @click="chooseLinkTask"><span class="new-task-option-icon"><Link2 :size="17" /></span><span><strong>链接任务</strong><small>HTTP、FTP、磁力链接</small></span></button>
        <button role="menuitem" @click="chooseBtTask"><span class="new-task-option-icon bt"><FileUp :size="17" /></span><span><strong>BT 文件任务</strong><small>选择本地 .torrent 文件</small></span></button>
      </div>
      <input ref="torrentInput" class="sr-only" type="file" accept=".torrent,application/x-bittorrent" tabindex="-1" @change="handleTorrent" />
    </div>
    <div class="topbar-actions">
      <IconButton label="切换主题" class="tb-act" @click="emit('theme')"><Shirt :size="16" :stroke-width="1.8" /></IconButton>
      <IconButton label="打开导航" class="tb-act topbar-menu" @click="emit('menu'); emit('drawer')"><Menu :size="16" :stroke-width="1.8" /></IconButton>
      <button class="account-button" :class="{ vip: accountVip }" :title="accountLabel" aria-label="账户" @click="emit('account')"><span class="account-avatar"><UserRound :size="14" :stroke-width="1.8" /></span></button>
    </div>
  </header>
  <div v-if="offline" class="connection-banner"><span>daemon 连接不可用，当前显示最后一次快照</span><button @click="emit('retry')">重新连接</button></div>
</template>
