<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { MonitorDown, RefreshCw, Trash2 } from '@lucide/vue'
import { useRouter } from 'vue-router'
import emptyIllustration from '@orig/img/general.png'
import type { RemoteTask } from '../../api/contracts/v2/remote'
import { commandRemoteTasks, queryRemoteNodes, queryRemoteTasks, removeRemoteNode } from '../../api/native-download/remote'
import { formatBytes, formatSpeed } from '../../domain/format'
import { useNodeContextStore } from '../../stores/node-context'

const router = useRouter()
const queryClient = useQueryClient()
const nodeContext = useNodeContextStore()
const selectedNodeId = ref('')
const search = ref('')
const error = ref('')
const notice = ref('')
const busyTaskId = ref('')

const nodesQuery = useQuery({ queryKey: ['v2-remote-nodes'], queryFn: queryRemoteNodes, refetchInterval: 15000, retry: 1 })
const selectedNode = computed(() => nodesQuery.data.value?.find((node) => node.id === selectedNodeId.value) || null)
const tasksQuery = useQuery({
  queryKey: computed(() => ['v2-remote-tasks', selectedNodeId.value]),
  queryFn: () => queryRemoteTasks(selectedNodeId.value, { view: 'all', limit: 200 }),
  enabled: computed(() => selectedNode.value?.state === 'online'),
  refetchInterval: 3000,
  retry: 1,
})
const visibleTasks = computed(() => {
  const value = search.value.trim().toLowerCase()
  const items = tasksQuery.data.value?.items || []
  return value ? items.filter((task) => task.displayName.toLowerCase().includes(value)) : items
})

watch(() => nodesQuery.data.value, (nodes) => {
  nodeContext.nodes = nodes || []
  if (!selectedNodeId.value || !(nodes || []).some((node) => node.id === selectedNodeId.value)) selectedNodeId.value = nodes?.[0]?.id || ''
}, { immediate: true })
onMounted(() => void nodesQuery.refetch())

function progress(task: RemoteTask) { return task.totalBytes ? Math.min(100, Math.max(0, (task.completedBytes || 0) / task.totalBytes * 100)) : 0 }
function stateLabel(value: string) { return ({ online: '在线', offline: '离线', untrusted: '证书不可信', incompatible: '版本不兼容' } as Record<string, string>)[value] || value }
async function refresh() { error.value = ''; await Promise.all([nodesQuery.refetch(), selectedNodeId.value ? tasksQuery.refetch() : Promise.resolve()]) }
async function command(task: RemoteTask, value: string) {
  busyTaskId.value = task.id
  error.value = ''
  notice.value = ''
  try {
    const result = await commandRemoteTasks([task.id], value)
    const failed = result.results.find((item) => !item.ok)
    if (failed) throw new Error(failed.error?.message || '远程任务操作失败')
    notice.value = '远程任务操作已提交'
    await queryClient.invalidateQueries({ queryKey: ['v2-remote-tasks', selectedNodeId.value] })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '远程任务操作失败'
  } finally {
    busyTaskId.value = ''
  }
}
async function removeNode() {
  const node = selectedNode.value
  if (!node || !window.confirm(`移除远程节点“${node.name}”？本机不会删除远端任务。`)) return
  await removeRemoteNode(node.id)
  selectedNodeId.value = ''
  await nodesQuery.refetch()
}
</script>

<template>
  <section class="feature-data-page replica-data-page remote-download-page">
    <header class="replica-page-header"><div><h1>远程下载</h1><p>通过 HTTPS/mTLS 管理另一台已配对设备的下载任务</p></div><div class="settings-page-actions"><button class="secondary-button" @click="refresh"><RefreshCw :size="14" />刷新</button><button class="primary-button" @click="router.push('/settings/integration')">配对设备</button></div></header>
    <p v-if="error" class="settings-error">{{ error }}</p><p v-if="notice" class="settings-notice">{{ notice }}</p>
    <div v-if="nodesQuery.isPending.value" class="replica-loading">正在读取远程节点…</div>
    <div v-else-if="nodesQuery.isError.value" class="settings-error">无法读取远程节点：{{ nodesQuery.error.value?.message }}</div>
    <div v-else-if="!nodesQuery.data.value?.length" class="replica-empty-state"><img :src="emptyIllustration" alt="" /><h2>尚未配对远程设备</h2><p>在系统集成中配置证书，然后输入另一台设备的配对码。</p><button class="primary-button" @click="router.push('/settings/integration')">前往配对</button></div>
    <div v-else class="remote-layout">
      <aside class="remote-node-list">
        <div class="remote-node-list-header"><strong>我的设备</strong><button @click="router.push('/settings/integration')">添加</button></div>
        <button v-for="node in nodesQuery.data.value" :key="node.id" class="remote-node-button" :class="{ active: selectedNodeId === node.id }" @click="selectedNodeId = node.id">
          <span class="remote-node-icon"><MonitorDown :size="19" /></span><span class="remote-node-copy"><strong>{{ node.name }}</strong><span>{{ stateLabel(node.state) }} · {{ node.version || '版本未知' }}</span></span><i class="remote-node-dot" :class="node.state" />
        </button>
      </aside>
      <main class="remote-task-panel">
        <div class="remote-task-toolbar"><div><strong>{{ selectedNode?.name }}</strong><span>{{ selectedNode?.endpoint }}<template v-if="selectedNode?.problem"> · {{ selectedNode.problem }}</template></span></div><div class="settings-inline-actions"><label v-if="selectedNode?.state === 'online'" class="replica-search"><input v-model="search" placeholder="搜索远程任务" /></label><button class="page-quiet-action" title="移除此节点" @click="removeNode"><Trash2 :size="15" /></button></div></div>
        <div v-if="selectedNode?.state !== 'online'" class="remote-empty-panel"><img :src="emptyIllustration" alt="" /><strong>设备当前离线</strong><span>确认远端 daemon、证书与网络监听均可用后再刷新。</span></div>
        <div v-else-if="tasksQuery.isPending.value" class="replica-loading">正在读取远程任务…</div>
        <div v-else-if="tasksQuery.isError.value" class="remote-empty-panel"><strong>无法读取远程任务</strong><span>{{ tasksQuery.error.value?.message }}</span></div>
        <div v-else-if="!visibleTasks.length" class="remote-empty-panel"><img :src="emptyIllustration" alt="" /><strong>远程设备暂无任务</strong><span>可在远端新建下载，或使用远程提交接口。</span></div>
        <div v-else class="remote-task-list">
          <article v-for="task in visibleTasks" :key="task.id" class="remote-task-row"><span class="replica-file-icon"><MonitorDown :size="18" /></span><div class="remote-task-main"><strong>{{ task.displayName }}</strong><span>{{ task.lifecycle }} · {{ formatBytes(task.completedBytes) }} / {{ formatBytes(task.totalBytes) }} · {{ formatSpeed(task.downloadBytesPerSecond) }}</span><div class="remote-task-progress"><i :style="{ width: `${progress(task)}%` }" /></div></div><div class="remote-task-actions"><button :disabled="busyTaskId === task.id" @click="command(task, task.lifecycle === 'downloading' ? 'pause' : 'start')">{{ task.lifecycle === 'downloading' ? '暂停' : '开始' }}</button><button :disabled="busyTaskId === task.id" @click="command(task, 'recycle')">删除</button></div></article>
        </div>
      </main>
    </div>
  </section>
</template>
