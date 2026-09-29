<script setup lang="ts">
// M3 顶栏：大圆角搜索条居中 + 主题/账户。新建任务入口在 FAB（AppShell）。
import { Moon, Search, Sun, UserRound, X } from '@lucide/vue'
import IconButton from '../common/IconButton.vue'

const props = defineProps<{ search: string; accountLabel: string; accountVip?: boolean; offline?: boolean; theme?: 'light' | 'dark' }>()
const emit = defineEmits<{
  'update:search': [value: string]; account: []; retry: []; paste: [value: string]; theme: []
}>()
</script>

<template>
  <header class="top-bar" data-testid="top-bar">
    <div class="top-search">
      <Search :size="18" />
      <input :value="props.search" aria-label="搜索任务" placeholder="搜索任务，或粘贴链接新建" @input="emit('update:search', ($event.target as HTMLInputElement).value)" @paste="emit('paste', ($event.clipboardData?.getData('text') || '').trim())" @keydown.enter="emit('update:search', ($event.target as HTMLInputElement).value)" />
      <button v-if="props.search" class="top-search-clear" aria-label="清除搜索" @click="emit('update:search', '')"><X :size="16" /></button>
    </div>
    <div class="top-actions">
      <IconButton label="切换主题" data-testid="theme-toggle" @click="emit('theme')"><Sun v-if="props.theme === 'dark'" :size="18" :stroke-width="1.9" /><Moon v-else :size="18" :stroke-width="1.9" /></IconButton>
      <button class="account-button" :class="{ 'is-vip': accountVip }" :title="accountLabel" aria-label="账户" data-testid="account-button" @click="emit('account')"><span class="account-avatar"><UserRound :size="17" :stroke-width="1.9" /></span></button>
    </div>
  </header>
  <div v-if="offline" class="connection-banner"><span>daemon 连接不可用，当前显示最后一次快照</span><button @click="emit('retry')">重新连接</button></div>
</template>
