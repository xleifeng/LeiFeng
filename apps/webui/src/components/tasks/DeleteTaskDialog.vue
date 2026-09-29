<script setup lang="ts">
import { ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import ModalShell from '../ModalShell.vue'
import { useOverlayStore } from '../../stores/overlay'
import { useTaskCommands } from '../../composables/useTaskCommands'
import type { TaskCommand, TaskListItemV2 } from '../../api/contracts/v2/tasks'

const props = defineProps<{ tasks: TaskListItemV2[]; initialCommand: TaskCommand }>()
const overlay = useOverlayStore()
const queryClient = useQueryClient()
const { execute } = useTaskCommands()
const command = ref<TaskCommand>(props.initialCommand === 'remove-record' ? 'recycle' : props.initialCommand)
const deleteLocalFiles = ref(false)
const pending = ref(false)
const errorMessage = ref('')

async function confirm() {
  pending.value = true; errorMessage.value = ''
  try {
    await execute(command.value, props.tasks, { deleteLocalFiles: deleteLocalFiles.value })
    overlay.close()
    await queryClient.invalidateQueries({ queryKey: ['v2-task-query'] })
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : '任务操作失败' }
  finally { pending.value = false }
}
</script>

<template>
  <ModalShell :title="command === 'delete-permanently' ? '彻底删除任务' : '移入回收站'" @close="overlay.close">
    <div class="operation-dialog-body">
      <p>已选择 {{ props.tasks.length }} 个任务。请确认要执行的本地文件策略。</p>
      <label v-if="command !== 'delete-permanently'" class="operation-choice"><input v-model="command" type="radio" value="recycle" />仅移入回收站，保留本地文件</label>
      <label v-if="command !== 'delete-permanently'" class="operation-choice"><input v-model="deleteLocalFiles" type="checkbox" />同时删除本地文件</label>
      <label v-if="command === 'delete-permanently'" class="operation-choice"><input v-model="deleteLocalFiles" type="checkbox" />同时永久删除本地文件</label>
      <p v-if="errorMessage" class="operation-error">{{ errorMessage }}</p>
    </div>
    <template #footer><button class="secondary-button" :disabled="pending" @click="overlay.close">取消</button><button class="primary-button danger-action" :disabled="pending" @click="confirm">{{ pending ? '处理中…' : command === 'delete-permanently' ? '彻底删除' : '移入回收站' }}</button></template>
  </ModalShell>
</template>
