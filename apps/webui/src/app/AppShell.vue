<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { getBootstrapV2 } from '../api/native-download/bootstrap'
import { getTaskCounts } from '../api/native-download/tasks'
import { useShellStore } from '../stores/shell'
import { useOverlayStore } from '../stores/overlay'
import { useCommandCenterStore } from '../stores/command-center'
import { useCreateTaskStore } from '../stores/create-task'
import { isDownloadInput } from '../domain/download-input'
import NativeSidebar from '../components/layout/NativeSidebar.vue'
import NativeTopbar from '../components/layout/NativeTopbar.vue'

const shell = useShellStore()
const overlay = useOverlayStore()
const commandCenter = useCommandCenterStore()
const createTask = useCreateTaskStore()
const route = useRoute()
const router = useRouter()
const bootstrapQuery = useQuery({ queryKey: ['v2-bootstrap'], queryFn: getBootstrapV2, refetchInterval: 15000, refetchOnWindowFocus: true, retry: 1 })
const countsQuery = useQuery({ queryKey: ['v2-task-counts'], queryFn: getTaskCounts, refetchInterval: 3000, refetchOnWindowFocus: true, retry: 1 })
const offline = computed(() => bootstrapQuery.isError.value && !bootstrapQuery.data.value)
watch(offline, (value) => commandCenter.setOffline(value), { immediate: true })
const accountLabel = computed(() => {
  const account = bootstrapQuery.data.value?.account
  if (!account?.valid) return '登录'
  if (account.isSuperVip) return `超级会员 Lv.${account.vipLevel || 0}`
  if (account.isPlatinumVip) return `白金会员 Lv.${account.vipLevel || 0}`
  if (account.isPanVip) return `网盘会员 Lv.${account.vipLevel || 0}`
  return account.isVip ? `VIP Lv.${account.vipLevel || 0}` : '已登录'
})
const routeTitle = computed(() => String(route.meta.title || '迅雷下载中心'))
const taskSurface = computed(() => route.path === '/download' || route.path.startsWith('/download/') || route.path === '/trash')
function openAccount() { overlay.open({ type: 'account' }) }
function openNewLinkTask() { createTask.openForLinks(); overlay.open({ type: 'new-task' }) }
function openNewBtTask(file: File) { createTask.openForLinks(); overlay.open({ type: 'new-task' }); createTask.uploadTorrentFile(file) }
function openSettings() { overlay.open({ type: 'settings' }) }
function retry() { bootstrapQuery.refetch(); countsQuery.refetch() }
function handlePaste(value: string) { if (isDownloadInput(value)) { shell.search = ''; createTask.openForLinks(value); overlay.open({ type: 'new-task' }) } }
function handleBack() { router.back() }
function handleForward() { router.forward() }
function handleRefresh() { retry() }
function handleTheme() { shell.theme = shell.theme === 'light' ? 'dark' : 'light' }
</script>

<template>
  <div class="native-app-shell">
    <NativeTopbar :search="shell.search" :account-label="accountLabel" :account-vip="bootstrapQuery.data.value?.account.isVip" :offline="offline" @update:search="shell.search = $event" @new-link-task="openNewLinkTask" @new-bt-task="openNewBtTask" @account="openAccount" @retry="retry" @paste="handlePaste" @menu="shell.navOpen = true" @drawer="shell.navOpen = true" @back="handleBack" @forward="handleForward" @refresh="handleRefresh" @theme="handleTheme" />
    <div class="native-shell-body">
      <NativeSidebar :open="shell.navOpen" :counts="countsQuery.data.value || null" :version="bootstrapQuery.data.value?.daemonVersion" @close="shell.navOpen = false" @settings="openSettings" />
      <main class="native-main-area" :class="{ 'is-task-surface': taskSurface }">
        <div v-if="!taskSurface" class="native-breadcrumb"><span>{{ routeTitle }}</span><span v-if="bootstrapQuery.data.value?.engine.sdkReady" class="engine-dot"><i />引擎已连接</span></div>
        <div class="native-content-scroll" :class="{ 'is-task-surface': taskSurface }"><RouterView /></div>
      </main>
    </div>
  </div>
</template>
