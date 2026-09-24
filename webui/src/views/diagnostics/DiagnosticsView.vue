<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { Download, RefreshCw, RotateCcw } from '@lucide/vue'
import { diagnosticExportUrl, getDiagnostics, prepareDiagnosticExport, queryDiagnosticEvents, runDiagnosticCheck } from '../../api/native-download/diagnostics'
import { restartDownloadEngine } from '../../api/native-download/system'
import DiagnosticExportDialog from '../../components/diagnostics/DiagnosticExportDialog.vue'
import SystemHealthGrid from '../../components/diagnostics/SystemHealthGrid.vue'
import TaskDiagnosticPanel from '../../components/diagnostics/TaskDiagnosticPanel.vue'

const query = useQuery({ queryKey: ['v2-diagnostics'], queryFn: getDiagnostics, refetchInterval: 5000, retry: 1 })
const events = useQuery({ queryKey: ['v2-diagnostic-events'], queryFn: () => queryDiagnosticEvents(100), refetchInterval: 3000, retry: 1 })
const exportUrl = ref('')
const error = ref('')
const notice = ref('')
const showExport = ref(false)
const checkResult = ref<Record<string, unknown> | null>(null)
const activeCheck = ref('')
const restarting = ref(false)
const eventRows = computed(() => (events.data.value || []) as Array<Record<string, unknown>>)

async function exportDiagnostics() {
  error.value = ''
  try { const result = await prepareDiagnosticExport(); exportUrl.value = diagnosticExportUrl(result.exportId); showExport.value = true } catch (cause) { error.value = cause instanceof Error ? cause.message : '准备诊断包失败' }
}
async function check(checkId: string) {
  activeCheck.value = checkId
  error.value = ''
  try { checkResult.value = await runDiagnosticCheck(checkId) } catch (cause) { error.value = cause instanceof Error ? cause.message : '诊断检查失败' } finally { activeCheck.value = '' }
}
async function restartEngine() {
  if (!window.confirm('只重启本次 daemon 管理的下载引擎，不会停止其他下载进程。继续吗？')) return
  restarting.value = true
  error.value = ''
  try { const result = await restartDownloadEngine(); notice.value = `下载引擎已重启，代际 ${result.engineGeneration}`; await query.refetch() } catch (cause) { error.value = cause instanceof Error ? cause.message : '重启下载引擎失败' } finally { restarting.value = false }
}
function eventTime(value: unknown) { return typeof value === 'number' ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' }
</script>

<template>
  <section class="feature-data-page replica-data-page diagnostics-page">
    <header class="replica-page-header"><div><h1>下载诊断</h1><p>检查下载引擎、目录、任务仓库、媒体与远程节点，导出内容会严格脱敏</p></div><div class="settings-page-actions"><button class="secondary-button" :disabled="restarting" @click="restartEngine"><RotateCcw :size="14" />{{ restarting ? '重启中…' : '重启引擎' }}</button><button class="secondary-button" @click="query.refetch(); events.refetch()"><RefreshCw :size="14" />刷新</button><button class="primary-button" @click="exportDiagnostics"><Download :size="14" />导出诊断</button></div></header>
    <p v-if="error" class="settings-error">{{ error }}</p><p v-if="notice" class="settings-notice">{{ notice }}</p>
    <div v-if="query.isPending.value" class="replica-loading">正在读取诊断…</div>
    <div v-else-if="query.isError.value" class="settings-error">诊断不可用：{{ query.error.value?.message }}</div>
    <template v-else-if="query.data.value">
      <SystemHealthGrid :diagnostics="query.data.value" />
      <div class="diagnostic-checks"><button v-for="item in [{ id: 'engine', label: '检查引擎' }, { id: 'filesystem', label: '检查下载目录' }, { id: 'task-repository', label: '检查任务仓库' }, { id: 'media', label: '检查媒体能力' }, { id: 'remote', label: '检查远程节点' }]" :key="item.id" :disabled="activeCheck === item.id" @click="check(item.id)">{{ activeCheck === item.id ? '检查中…' : item.label }}</button></div>
      <pre v-if="checkResult" class="diagnostic-result">{{ JSON.stringify(checkResult, null, 2) }}</pre>
      <TaskDiagnosticPanel />
      <section class="diagnostic-events"><h2>最近事件</h2><div v-if="!eventRows.length" class="inline-note">暂无诊断事件</div><div v-else class="diagnostic-event-list"><article v-for="event in eventRows" :key="String(event.id || event.sequence)" class="diagnostic-event-row"><strong>{{ event.message || event.code || event.type }}</strong><span>{{ eventTime(event.at) }} · {{ event.level || 'info' }} · {{ event.category || 'daemon' }}</span></article></div></section>
    </template>
    <DiagnosticExportDialog v-if="showExport && exportUrl" :url="exportUrl" @close="showExport = false" />
  </section>
</template>
