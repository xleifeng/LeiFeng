<script setup lang="ts">
import { ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import type { Schedule } from '../../api/contracts/v2/schedules'
import { cancelPendingCompletionAction, deleteSchedule, getPendingCompletionAction, querySchedules, saveSchedule } from '../../api/native-download/schedules'
import { useOverlayStore } from '../../stores/overlay'
import ModalShell from '../ModalShell.vue'
import ScheduleTaskDialog from './ScheduleTaskDialog.vue'
import ScheduleTaskList from './ScheduleTaskList.vue'

const overlay = useOverlayStore()
const queryClient = useQueryClient()
const schedules = useQuery({ queryKey: ['v2-schedules'], queryFn: querySchedules, retry: 1 })
const completion = useQuery({ queryKey: ['v2-completion-action'], queryFn: getPendingCompletionAction, refetchInterval: 1000, retry: 1 })
const editorOpen = ref(false)
const editing = ref<Schedule | null>(null)
const busy = ref(false)
const errorMessage = ref('')

function createSchedule() { editing.value = null; editorOpen.value = true }
function editSchedule(schedule: Schedule) { editing.value = schedule; editorOpen.value = true }
async function refresh() { await Promise.all([schedules.refetch(), completion.refetch()]) }
async function save(value: Partial<Schedule>) {
  busy.value = true
  errorMessage.value = ''
  try {
    await saveSchedule({ ...(editing.value || {}), ...value }, editing.value?.revision)
    editorOpen.value = false
    editing.value = null
    await queryClient.invalidateQueries({ queryKey: ['v2-schedules'] })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存计划任务失败'
  } finally {
    busy.value = false
  }
}
async function toggle(schedule: Schedule) { await saveSchedule({ ...schedule, enabled: !schedule.enabled }, schedule.revision); await schedules.refetch() }
async function remove(schedule: Schedule) { if (!window.confirm(`删除计划“${schedule.name}”？`)) return; await deleteSchedule(schedule.id, schedule.revision); await schedules.refetch() }
async function cancelCompletion() { const pending = completion.data.value; if (!pending) return; await cancelPendingCompletionAction(pending.operationId); await completion.refetch() }
function actionLabel(value: string) { return ({ 'start-all': '开始全部', 'pause-all': '暂停全部', 'enable-full-speed': '开启全速', 'restore-limits': '恢复限速', 'stop-engine': '停止引擎', suspend: '系统睡眠', poweroff: '系统关机' } as Record<string, string>)[value] || value }
</script>

<template>
  <ModalShell title="计划任务与完成动作" wide @close="overlay.close">
    <div class="schedule-manager-toolbar"><div><strong>定时下载策略</strong><span>由 daemon 按本地时区执行，可随时停用或删除。</span></div><div><button class="secondary-button" :disabled="busy" @click="refresh">刷新</button><button class="primary-button" @click="createSchedule">新建计划</button></div></div>
    <p v-if="errorMessage" class="operation-error">{{ errorMessage }}</p>
    <div v-if="schedules.isPending.value" class="inline-note">正在读取计划任务…</div>
    <div v-else-if="!schedules.data.value?.schedules.length" class="schedule-empty">尚未创建计划任务</div>
    <ScheduleTaskList v-else :schedules="schedules.data.value.schedules" @toggle="toggle" @edit="editSchedule" @remove="remove" />
    <section class="completion-action-card">
      <div><strong>下载完成动作</strong><span v-if="completion.data.value">{{ actionLabel(completion.data.value.action) }} 将于 {{ new Date(completion.data.value.expiresAt).toLocaleTimeString('zh-CN') }} 执行</span><span v-else>当前没有等待执行的完成动作</span></div>
      <button v-if="completion.data.value" class="secondary-button" @click="cancelCompletion">取消本次动作</button>
    </section>
    <ScheduleTaskDialog v-if="editorOpen" :model-value="editing" @save="save" @close="editorOpen = false" />
  </ModalShell>
</template>
