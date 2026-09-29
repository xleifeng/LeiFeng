<script setup lang="ts">
import { ref } from 'vue'
import ModalShell from '../ModalShell.vue'
import { useOverlayStore } from '../../stores/overlay'
import { useTaskCommands } from '../../composables/useTaskCommands'
import type { TaskListItemV2 } from '../../api/contracts/v2/tasks'

const props = defineProps<{ task: TaskListItemV2 }>()
const overlay = useOverlayStore(); const { execute } = useTaskCommands()
const deleteLocalFiles = ref(false); const pending = ref(false); const errorMessage = ref('')
async function submit() { pending.value = true; errorMessage.value = ''; try { await execute('redownload', [props.task], { deleteLocalFiles: deleteLocalFiles.value }); overlay.close() } catch (error) { errorMessage.value = error instanceof Error ? error.message : '重新下载失败' } finally { pending.value = false } }
</script>
<template><ModalShell title="重新下载" @close="overlay.close"><div class="operation-dialog-body"><p>将根据任务原始来源重新创建下载任务，旧记录会保留在回收站中。</p><label class="operation-choice"><input v-model="deleteLocalFiles" type="checkbox" />删除现有本地文件后重新下载</label><p v-if="errorMessage" class="operation-error">{{ errorMessage }}</p></div><template #footer><button class="secondary-button" @click="overlay.close">取消</button><button class="primary-button danger-action" :disabled="pending" @click="submit">{{ pending ? '处理中…' : '重新下载' }}</button></template></ModalShell></template>
