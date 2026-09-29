<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { Plus } from '@lucide/vue'
import { getBootstrapV2 } from '../api/native-download/bootstrap'
import { getTaskCounts } from '../api/native-download/tasks'
import { useShellStore } from '../stores/shell'
import { useOverlayStore } from '../stores/overlay'
import { useCommandCenterStore } from '../stores/command-center'
import { useCreateTaskStore } from '../stores/create-task'
import { useUiCapabilitiesStore } from '../stores/ui-capabilities'
import { isDownloadInput } from '../domain/download-input'
import NavRail from '../components/layout/NavRail.vue'
import TopBar from '../components/layout/TopBar.vue'

const shell = useShellStore()
const overlay = useOverlayStore()
const commandCenter = useCommandCenterStore()
const createTask = useCreateTaskStore()
const uiCapabilities = useUiCapabilitiesStore()
const route = useRoute()
const router = useRouter()
const bootstrapQuery = useQuery({ queryKey: ['v2-bootstrap'], queryFn: getBootstrapV2, refetchInterval: 15000, refetchOnWindowFocus: true, retry: 1 })
// bootstrap 每 15s 重拉，views 能力集合随之刷新（daemon 侧插件装载状态 → UI 门控）
watch(() => bootstrapQuery.data.value?.capabilities.views, (views) => uiCapabilities.setViews(views), { immediate: true })
// 门控激活时刻（views 从缺省到到达）重新评估当前路由：守卫只挡新导航，已落在
// 不可用能力页上的直达导航（含运行期插件路由）需在此回退
watch(() => uiCapabilities.gating, (gated) => {
  if (!gated) return
  const capability = route.meta.capability as string | undefined
  if (capability && !uiCapabilities.enabled(capability)) router.replace('/download')
})
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
const taskSurface = computed(() => route.path === '/download' || route.path.startsWith('/download/') || route.path === '/trash')
function openAccount() { overlay.open({ type: 'account' }) }
function openNewTask() { createTask.openForLinks(); overlay.open({ type: 'new-task' }) }
function openSettings() { overlay.open({ type: 'settings' }) }
function retry() { bootstrapQuery.refetch(); countsQuery.refetch() }
function handlePaste(value: string) { if (isDownloadInput(value)) { shell.search = ''; createTask.openForLinks(value); overlay.open({ type: 'new-task' }) } }
function handleTheme() { shell.theme = shell.theme === 'light' ? 'dark' : 'light' }
</script>

<template>
  <div class="app-shell" data-testid="app-shell">
    <NavRail :counts="countsQuery.data.value || null" :version="bootstrapQuery.data.value?.daemonVersion" @settings="openSettings" />
    <div class="app-main">
      <TopBar :search="shell.search" :account-label="accountLabel" :account-vip="bootstrapQuery.data.value?.account.isVip" :offline="offline" :theme="shell.theme" @update:search="shell.search = $event" @account="openAccount" @retry="retry" @paste="handlePaste" @theme="handleTheme" />
      <main class="app-content" :class="{ 'is-task-surface': taskSurface }"><RouterView /></main>
    </div>
    <mdui-fab class="fab-new-task" data-testid="new-task-button" extended aria-label="新建任务" @click="openNewTask"><Plus slot="icon" :size="22" :stroke-width="2.2" />新建任务</mdui-fab>
  </div>
</template>
