<script setup lang="ts">
import { ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import ModalShell from '../ModalShell.vue'
import { emptyTrash } from '../../api/native-download/tasks'
import { useOverlayStore } from '../../stores/overlay'

const props = defineProps<{ total: number }>()
const overlay = useOverlayStore()
const queryClient = useQueryClient()
const deleteLocalFiles = ref(false)
const pending = ref(false)
const errorMessage = ref('')
const warningMessage = ref('')
const completed = ref(false)

async function confirm() {
  pending.value = true
  errorMessage.value = ''; warningMessage.value = ''
  try {
    const response = await emptyTrash(undefined, deleteLocalFiles.value)
    const failed = response.results.filter((item) => !item.ok)
    if (failed.length) throw new Error(failed[0].error?.message || '部分任务清空失败')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v2-task-query'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-task-counts'] }),
      queryClient.invalidateQueries({ queryKey: ['v2-bootstrap'] }),
    ])
    const skippedLocalFiles = response.results.filter((item) => item.localFileError).length
    if (skippedLocalFiles) {
      warningMessage.value = `回收站记录已清除，但有 ${skippedLocalFiles} 个本地文件因路径不在允许的下载目录内而未删除。`
      completed.value = true
    } else overlay.close()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '清空回收站失败'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <ModalShell title="清空回收站" @close="overlay.close">
    <div class="operation-dialog-body">
      <p>回收站中有 {{ props.total }} 个任务。此操作不可撤销。</p>
      <label class="operation-choice"><input v-model="deleteLocalFiles" type="checkbox" />同时永久删除本地文件</label>
      <p v-if="errorMessage" class="operation-error">{{ errorMessage }}</p>
      <p v-if="warningMessage" class="operation-warning">{{ warningMessage }}</p>
    </div>
    <template #footer>
      <button class="secondary-button" :disabled="pending" @click="overlay.close">{{ completed ? '关闭' : '取消' }}</button>
      <button v-if="!completed" class="primary-button danger-action" :disabled="pending" @click="confirm">{{ pending ? '处理中…' : '清空回收站' }}</button>
    </template>
  </ModalShell>
</template>
