<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MoreHorizontal, RotateCw } from '@lucide/vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { TaskCommand, TaskListItemV2, TaskQueryRequestV2 } from '../../api/contracts/v2/tasks'
import { useShellStore } from '../../stores/shell'
import { useTaskSelectionStore } from '../../stores/task-selection'
import { useOverlayStore } from '../../stores/overlay'
import { useCommandCenterStore } from '../../stores/command-center'
import { useTaskQuery } from '../../composables/useTaskQuery'
import { useTaskCommands } from '../../composables/useTaskCommands'
import { useDownloadShortcuts } from '../../composables/useDownloadShortcuts'
import { getTask } from '../../api/native-download/tasks'
import TaskCenterToolbar from '../../components/tasks/TaskCenterToolbar.vue'
import TaskSelectionToolbar from '../../components/tasks/TaskSelectionToolbar.vue'
import TaskVirtualList, { type TaskListRow } from '../../components/tasks/TaskVirtualList.vue'
import TaskListSkeleton from '../../components/tasks/TaskListSkeleton.vue'
import TaskEmptyState from '../../components/tasks/TaskEmptyState.vue'
import TaskContextMenu from '../../components/tasks/TaskContextMenu.vue'

const props = withDefaults(defineProps<{ view?: 'downloading' | 'completed' | 'trash' }>(), { view: undefined })
const route = useRoute()
const router = useRouter()
const shell = useShellStore()
const selection = useTaskSelectionStore()
const overlay = useOverlayStore()
const commandCenter = useCommandCenterStore()
const queryClient = useQueryClient()
const { execute } = useTaskCommands()
const routeTab = computed<'downloading' | 'completed'>(() => route.query.tab === 'completed' ? 'completed' : 'downloading')
const currentView = computed<'downloading' | 'completed' | 'trash'>(() => props.view || routeTab.value)
const sort = ref<NonNullable<TaskQueryRequestV2['sort']>>(currentView.value === 'completed' ? 'completed-desc' : 'created-desc')
const groupBy = ref<'none' | 'date' | 'task-group'>('date')
const viewRef = computed(() => currentView.value)
const taskQuery = useTaskQuery({ view: viewRef, search: computed(() => shell.search), sort, groupBy })
const context = ref<{ task: TaskListItemV2; x: number; y: number } | null>(null)

const visibleIds = computed(() => taskQuery.items.value.map((task) => task.taskId))
const selectedTasks = computed(() => taskQuery.items.value.filter((task) => selection.selectedTaskIds.has(task.taskId)))
const selectedCapabilities = computed(() => ({
  start: selectedTasks.value.some((task) => task.capabilities.includes('start')),
  pause: selectedTasks.value.some((task) => task.capabilities.includes('pause')),
  recycle: selectedTasks.value.some((task) => task.capabilities.includes('recycle')),
  deletePermanently: selectedTasks.value.some((task) => task.capabilities.includes('deletePermanently')),
}))
const focusedTask = computed(() => taskQuery.items.value.find((task) => task.taskId === selection.focusedTaskId) || null)
const rows = computed<TaskListRow[]>(() => {
  if (groupBy.value === 'none' || groupBy.value === 'task-group') return taskQuery.items.value
  const result: TaskListRow[] = []
  let current = ''
  let bucket: TaskListItemV2[] = []
  const flush = () => { if (bucket.length) { result.push({ type: 'group', groupId: current, label: current, count: bucket.length }); result.push(...bucket); bucket = [] } }
  for (const task of taskQuery.items.value) {
    const date = new Date(task.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    if (date !== current) { flush(); current = date }
    bucket.push(task)
  }
  flush()
  return result
})
const emptyKind = computed(() => taskQuery.isError.value && !taskQuery.items.value.length ? 'offline' : shell.search.trim() && !taskQuery.items.value.length ? 'search' : currentView.value)
const downloadingCount = computed(() => taskQuery.counts.value?.active ?? (currentView.value === 'downloading' ? taskQuery.data.value?.pages[0]?.total ?? 0 : 0))
const completedCount = computed(() => taskQuery.counts.value?.completed ?? (currentView.value === 'completed' ? taskQuery.data.value?.pages[0]?.total ?? 0 : 0))

watch(visibleIds, (value) => selection.reconcileVisible(value), { immediate: true })
watch(currentView, (value) => { sort.value = value === 'completed' ? 'completed-desc' : 'created-desc'; selection.clear(); context.value = null })

function select(payload: { taskId: string; mode: 'toggle' | 'range' | 'only' }) {
  if (payload.mode === 'range') selection.selectRange(payload.taskId, visibleIds.value)
  else if (payload.mode === 'toggle') selection.toggle(payload.taskId)
  else selection.selectOnly(payload.taskId)
}
function selectAll() {
  if (selection.count === visibleIds.value.length && visibleIds.value.length) selection.clear()
  else selection.selectAll(visibleIds.value)
}
async function command(commandName: TaskCommand, explicitTasks = selectedTasks.value) {
  if (!explicitTasks.length || commandCenter.offline) return
  if (commandName === 'remove-record' || commandName === 'recycle' || commandName === 'delete-permanently') {
    overlay.open({ type: 'confirm-command', command: commandName, tasks: explicitTasks })
    return
  }
  if (commandName === 'rename' && explicitTasks.length === 1) { overlay.open({ type: 'rename-task', task: explicitTasks[0] }); return }
  if (commandName === 'move' && explicitTasks.length === 1) { overlay.open({ type: 'move-task', task: explicitTasks[0] }); return }
  if (commandName === 'redownload' && explicitTasks.length === 1) { overlay.open({ type: 'redownload-task', task: explicitTasks[0] }); return }
  if (commandName === 'recover' && explicitTasks.length === 1) { overlay.open({ type: 'recover-task', task: explicitTasks[0] }); return }
  try {
    await execute(commandName, explicitTasks)
    selection.clear(); context.value = null
  } catch (error) {
    commandCenter.lastProblem = { code: 'TASK_COMMAND_FAILED', message: error instanceof Error ? error.message : '任务操作失败' }
  }
}
function emptyTrash() {
  if (currentView.value !== 'trash') return
  const total = taskQuery.counts.value?.trash ?? taskQuery.data.value?.pages[0]?.total ?? 0
  if (total) overlay.open({ type: 'empty-trash', total })
}
function openTask(taskId: string) { overlay.open({ type: 'task-details', taskId }) }
function openContext(payload: { taskId: string; x: number; y: number }) {
  const task = taskQuery.items.value.find((item) => item.taskId === payload.taskId)
  if (!task) return
  context.value = { task, x: payload.x || Math.max(12, window.innerWidth - 250), y: payload.y || 120 }
  selection.selectOnly(task.taskId)
}
async function copyLinks() {
  if (!selectedTasks.value.length) return
  try {
    const details = await Promise.all(selectedTasks.value.map((task) => getTask(task.taskId)))
    const links = details.map((task) => task.source).filter((source): source is string => Boolean(source)).join('\n')
    if (links) await navigator.clipboard?.writeText(links)
  } catch (error) {
    commandCenter.lastProblem = { code: 'COPY_LINKS_FAILED', message: error instanceof Error ? error.message : '复制下载链接失败' }
  }
}
function toggleSelected() {
  if (currentView.value === 'trash') return
  if (selectedTasks.value.some((task) => task.lifecycle === 'downloading')) command('pause')
  else command('start')
}
function focusSearch() { document.querySelector<HTMLInputElement>('.topbar-search input')?.focus() }
function newTask() { overlay.open({ type: 'new-task' }) }
function openDownloadSettings() { overlay.open({ type: 'settings' }) }
function openVipOverview() { overlay.open({ type: 'vip-overview' }) }
function closeOverlays() { context.value = null; if (overlay.active) overlay.close() }
function updateSort(value: string) { if (['created-desc', 'completed-desc', 'name-asc', 'size-desc', 'speed-desc', 'progress-desc', 'created-asc'].includes(value)) sort.value = value as NonNullable<TaskQueryRequestV2['sort']> }
function updateGroupBy(value: 'none' | 'date' | 'task-group') { groupBy.value = value }
function selectDownloadTab(tab: 'downloading' | 'completed') {
  if (props.view === 'trash' || routeTab.value === tab) return
  const query = { ...route.query }
  if (tab === 'completed') query.tab = 'completed'
  else delete query.tab
  router.replace({ path: '/download', query })
}
useDownloadShortcuts({ selected: selectedTasks, visibleIds, focused: focusedTask, onNewTask: newTask, onSearch: focusSearch, onSelectAll: selectAll, onCopy: copyLinks, onToggle: toggleSelected, onOpen: () => focusedTask.value && openTask(focusedTask.value.taskId), onCommand: (name) => command(name), onDetails: () => focusedTask.value && openTask(focusedTask.value.taskId), onEscape: closeOverlays, onRename: () => focusedTask.value && command('rename', [focusedTask.value]) })
</script>

<template>
  <section class="task-center-page" :class="`is-${currentView}`">
    <header v-if="currentView === 'trash'" class="task-page-header trash-page-header">
      <h1>回收站</h1>
      <button class="page-header-action" type="button" aria-label="更多操作" @click="openDownloadSettings"><MoreHorizontal :size="22" :stroke-width="2" /></button>
    </header>
    <header v-else class="task-page-header download-tabs" aria-label="下载分类">
      <button type="button" :class="{ active: currentView === 'downloading' }" @click="selectDownloadTab('downloading')">下载中 <span>{{ downloadingCount }}</span></button>
      <button type="button" :class="{ active: currentView === 'completed' }" @click="selectDownloadTab('completed')">已完成 <span>{{ completedCount }}</span></button>
      <div class="download-header-actions">
        <button type="button" aria-label="刷新任务" @click="taskQuery.refresh"><RotateCw :size="18" :stroke-width="1.7" /></button>
        <button type="button" aria-label="更多操作" @click="openDownloadSettings"><MoreHorizontal :size="21" :stroke-width="2" /></button>
      </div>
    </header>
    <div class="task-page-body">
      <TaskCenterToolbar :view="currentView" :selected-count="selection.count" :total="taskQuery.data.value?.pages[0]?.total || 0" :sort="sort" :group-by="groupBy" :busy="commandCenter.pendingCount > 0" :can-start="selectedCapabilities.start" :can-pause="selectedCapabilities.pause" :can-recycle="selectedCapabilities.recycle" :can-delete-permanently="selectedCapabilities.deletePermanently" @update:sort="updateSort" @update:group-by="updateGroupBy" @select-all="selectAll" @command="command" @empty-trash="emptyTrash" @refresh="taskQuery.refresh" @more="openDownloadSettings" @vip="openVipOverview" />
      <TaskSelectionToolbar :count="selection.count" :total="visibleIds.length" @clear="selection.clear" @select-all="selectAll" />
      <TaskListSkeleton v-if="taskQuery.isPending.value && !taskQuery.items.value.length" />
      <TaskEmptyState v-else-if="!taskQuery.items.value.length" :kind="emptyKind" @create="newTask" />
      <TaskVirtualList v-else :rows="rows" :selected-ids="selection.selectedTaskIds" :focused-id="selection.focusedTaskId" :pending-ids="new Set(Object.keys(commandCenter.pendingByTaskId))" :density="shell.density" :has-next-page="taskQuery.hasNextPage.value" :loading-more="taskQuery.isFetchingNextPage.value" @select="select" @open="openTask" @command="(payload) => command(payload.command, [taskQuery.items.value.find((task) => task.taskId === payload.taskId)!])" @contextmenu="openContext" @load-more="taskQuery.loadMore" />
    </div>
    <TaskContextMenu v-if="context" :task="context.task" :x="context.x" :y="context.y" @command="(commandName) => command(commandName, [context!.task])" @details="openTask(context.task.taskId)" @close="context = null" />
  </section>
</template>
