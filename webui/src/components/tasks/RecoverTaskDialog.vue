<script setup lang="ts">
import { ref } from 'vue'
import type { TaskListItemV2 } from '../../api/contracts/v2/tasks'
import { useTaskCommands } from '../../composables/useTaskCommands'
import { useOverlayStore } from '../../stores/overlay'
import ModalShell from '../ModalShell.vue'

const props = defineProps<{ task: TaskListItemV2 }>()
const overlay = useOverlayStore()
const { execute } = useTaskCommands()
const startAfterRecover = ref(false)
const pending = ref(false)
const errorMessage = ref('')

async function submit() {
  pending.value = true
  errorMessage.value = ''
  try {
    const result = await execute('recover', [props.task], { allowRecreateFallback: true, start: startAfterRecover.value })
    const failed = result?.results.find((item) => !item.ok)
    if (failed) throw new Error(failed.error?.message || '恢复任务失败')
    overlay.close()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '恢复任务失败'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <ModalShell title="恢复下载任务" @close="overlay.close">
    <div class="operation-dialog-body"><p>优先恢复原生任务；若当前 SDK 不支持恢复，将根据原始链接或已保存种子重建任务，并保留现有文件用于校验。</p><label class="operation-choice"><input v-model="startAfterRecover" type="checkbox" />恢复后立即开始下载</label><p v-if="errorMessage" class="operation-error">{{ errorMessage }}</p></div>
    <template #footer><button class="secondary-button" @click="overlay.close">取消</button><button class="primary-button" :disabled="pending" @click="submit">{{ pending ? '恢复中…' : '确认恢复' }}</button></template>
  </ModalShell>
</template>
