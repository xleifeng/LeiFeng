<script setup lang="ts">
import { computed } from 'vue'
import { useOverlayStore } from '../stores/overlay'
import CreateTaskDialog from './create-task/CreateTaskDialog.vue'
import TaskDetailsDrawer from './tasks/TaskDetailsDrawer.vue'
import FeaturePlaceholder from './overlays/FeaturePlaceholder.vue'
import DeleteTaskDialog from './tasks/DeleteTaskDialog.vue'
import EmptyTrashDialog from './tasks/EmptyTrashDialog.vue'
import RenameTaskDialog from './tasks/RenameTaskDialog.vue'
import MoveTaskDialog from './tasks/MoveTaskDialog.vue'
import RedownloadDialog from './tasks/RedownloadDialog.vue'
import RecoverTaskDialog from './tasks/RecoverTaskDialog.vue'
import AccountPopover from './account/AccountPopover.vue'
import MediaPreviewDialog from './player/MediaPreviewDialog.vue'
import SettingDialog from './dialogs/SettingDialog.vue'
import LimitSpeedDialog from './dialogs/LimitSpeedDialog.vue'
import ProxyDialog from './dialogs/ProxyDialog.vue'
import AboutDialog from './dialogs/AboutDialog.vue'
import ScheduleManagerDialog from './schedules/ScheduleManagerDialog.vue'
import VipOverviewDialog from './vip/VipOverviewDialog.vue'

const overlay = useOverlayStore()
const active = computed(() => overlay.active)
</script>

<template>
  <CreateTaskDialog v-if="active?.type === 'new-task'" />
  <SettingDialog v-else-if="active?.type === 'settings'" />
  <LimitSpeedDialog v-else-if="active?.type === 'limit-speed-settings'" />
  <ProxyDialog v-else-if="active?.type === 'proxy-settings'" />
  <AboutDialog v-else-if="active?.type === 'about'" />
  <ScheduleManagerDialog v-else-if="active?.type === 'schedule-manager'" />
  <VipOverviewDialog v-else-if="active?.type === 'vip-overview'" />
  <TaskDetailsDrawer v-else-if="active?.type === 'task-details'" :task-id="active.taskId" @close="overlay.close" />
  <DeleteTaskDialog v-else-if="active?.type === 'confirm-command'" :tasks="active.tasks" :initial-command="active.command" />
  <EmptyTrashDialog v-else-if="active?.type === 'empty-trash'" :total="active.total" />
  <RenameTaskDialog v-else-if="active?.type === 'rename-task'" :task="active.task" />
  <MoveTaskDialog v-else-if="active?.type === 'move-task'" :task="active.task" />
  <RedownloadDialog v-else-if="active?.type === 'redownload-task'" :task="active.task" />
  <RecoverTaskDialog v-else-if="active?.type === 'recover-task'" :task="active.task" />
  <AccountPopover v-else-if="active?.type === 'account'" />
  <MediaPreviewDialog v-else-if="active?.type === 'media-preview'" :task-id="active.taskId" :file-index="active.fileIndex" :display-name="active.displayName" :kind="active.kind" />
  <FeaturePlaceholder v-else-if="active?.type === 'feature'" :title="active.title" :description="active.description" @close="overlay.close" />
</template>
