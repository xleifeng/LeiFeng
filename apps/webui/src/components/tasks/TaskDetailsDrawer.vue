<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getTask, commandTasks, downloadTaskTorrent, moveQueueTasks } from '../../api/native-download/tasks'
import type { TaskCommand, TaskDetailV2 } from '../../api/contracts/v2/tasks'
import { useOverlayStore } from '../../stores/overlay'
import { taskDetailPanelContributions } from '../../app/plugins'
import TaskOverviewPanel from './TaskOverviewPanel.vue'
import TaskFilesPanel from './TaskFilesPanel.vue'
import TaskAccelerationPanel from './TaskAccelerationPanel.vue'
import MissingFileNotice from './MissingFileNotice.vue'

const props = defineProps<{ taskId: string }>()
const emit = defineEmits<{ close: [] }>()
const overlay = useOverlayStore(); const queryClient = useQueryClient()
const tab = ref<string>('overview'); const pending = ref(false); const errorMessage = ref('')
const query = useQuery({ queryKey: computed(() => ['v2-task-detail', props.taskId]), queryFn: () => getTask(props.taskId), retry: 1 })
const detail = computed<TaskDetailV2 | null>(() => query.data.value || null)
// 插件贡献的内核/桥面板（kernel-detail-panels）：按内核与桥会话存在性过滤；
// 壳只提供挂载点，面板本体由插件提供。
const pluginPanels = computed(() => {
  const d = detail.value
  if (!d) return []
  return taskDetailPanelContributions.value.filter((panel) => {
    if (panel.kernelIds?.length && !panel.kernelIds.includes(d.kernelId)) return false
    if (panel.requiresField && !d[panel.requiresField]) return false
    return true
  })
})
const activePluginPanel = computed(() => pluginPanels.value.find((panel) => panel.id === tab.value) || null)
watch(() => props.taskId, () => { tab.value = 'overview' })
async function command(commandName: TaskCommand, options: Record<string, unknown> = {}) { if (!detail.value) return; pending.value = true; errorMessage.value = ''; try { const result = await commandTasks([detail.value.taskId], commandName, { [detail.value.taskId]: detail.value.revision }, undefined, options); const failed = result.results.find((item) => !item.ok); if (failed) throw new Error(failed.error?.message || '任务操作失败'); await query.refetch(); await queryClient.invalidateQueries({ queryKey: ['v2-task-query'] }); if (commandName === 'copy-info') await navigator.clipboard?.writeText(`${detail.value.displayName}\n${detail.value.source || detail.value.savePath}`) } catch (error) { errorMessage.value = error instanceof Error ? error.message : '任务操作失败' } finally { pending.value = false } }
async function moveQueue(target: 'top' | 'up' | 'down' | 'bottom') { if (!detail.value) return; pending.value = true; errorMessage.value = ''; try { await moveQueueTasks([detail.value.taskId], target); await query.refetch(); await queryClient.invalidateQueries({ queryKey: ['v2-task-query'] }) } catch (error) { errorMessage.value = error instanceof Error ? error.message : '调整队列失败' } finally { pending.value = false } }
async function exportTorrent() { if (!detail.value) return; pending.value = true; errorMessage.value = ''; try { await downloadTaskTorrent(detail.value.taskId, detail.value.displayName) } catch (error) { errorMessage.value = error instanceof Error ? error.message : '种子导出失败' } finally { pending.value = false } }
function previewFile(payload: { fileIndex: number; displayName: string; kind: 'video' | 'audio' | 'image' | 'text' | 'download-only' }) { if (!detail.value) return; overlay.open({ type: 'media-preview', taskId: detail.value.taskId, ...payload }) }
</script>

<template>
  <div class="overlay-backdrop" @click.self="emit('close')"><aside class="task-details-panel" role="dialog" aria-modal="true" aria-labelledby="task-details-title"><header class="modal-header" style="padding: 16px 22px 12px"><h2 id="task-details-title">{{ detail?.displayName || '任务' }}</h2><mdui-button-icon class="icon-button" aria-label="关闭" @click="emit('close')"><X :size="18" /></mdui-button-icon></header><div v-if="query.isPending.value" class="details-loading">正在读取任务详情…</div><div v-else-if="query.isError.value" class="details-error">无法读取任务：{{ query.error.value?.message }}</div><div v-else-if="detail" class="details-body"><MissingFileNotice v-if="detail.lifecycle === 'missing'" :message="detail.error?.message" @redownload="command('redownload')" @remove="command('recycle')" /><nav class="detail-tabs" role="tablist"><button :class="{ active: tab === 'overview' }" @click="tab = 'overview'">概览</button><button :class="{ active: tab === 'files' }" @click="tab = 'files'">文件</button><button :class="{ active: tab === 'acceleration' }" @click="tab = 'acceleration'">加速</button><button v-for="panel in pluginPanels" :key="panel.id" :class="{ active: tab === panel.id }" :data-testid="`detail-tab-${panel.id}`" @click="tab = panel.id">{{ panel.label }}</button></nav><TaskOverviewPanel v-if="tab === 'overview'" :detail="detail" @command="command" @speed-limit="(value) => command('set-speed-limit', { speedLimitBytesPerSecond: value })" @queue-move="moveQueue" @export-torrent="exportTorrent" /><TaskFilesPanel v-else-if="tab === 'files'" :detail="detail" :pending="pending" @update="(indices) => command('update-bt-selection', { selectedFileIndices: indices, allowRecreateFallback: true })" @scheduler="(value) => command('set-bt-scheduler', { btScheduler: value, allowRecreateFallback: true })" @open="(fileIndex) => command('open', { fileIndex })" @show="(fileIndex) => command('show-in-folder', { fileIndex })" @preview="previewFile" /><TaskAccelerationPanel v-else-if="tab === 'acceleration'" :detail="detail" /><component :is="activePluginPanel.component" v-else-if="activePluginPanel" :detail="detail" /><p v-if="errorMessage" class="operation-error">{{ errorMessage }}</p></div></aside></div>
</template>
