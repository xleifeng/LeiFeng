<script setup lang="ts">
import { ref } from 'vue'
import ModalShell from '../ModalShell.vue'
import { useOverlayStore } from '../../stores/overlay'
import { useTaskCommands } from '../../composables/useTaskCommands'
import type { TaskListItemV2 } from '../../api/contracts/v2/tasks'

const props = defineProps<{ task: TaskListItemV2 }>()
const overlay = useOverlayStore(); const { execute } = useTaskCommands()
const targetDirectory = ref(''); const pending = ref(false); const errorMessage = ref('')
async function submit() { if (!targetDirectory.value.trim()) { errorMessage.value = '目标目录不能为空'; return }; pending.value = true; errorMessage.value = ''; try { await execute('move', [props.task], { targetDirectory: targetDirectory.value.trim() }); overlay.close() } catch (error) { errorMessage.value = error instanceof Error ? error.message : '移动失败' } finally { pending.value = false } }
</script>
<template><ModalShell title="移动任务到" @close="overlay.close"><div class="operation-dialog-body"><label class="create-label" for="move-task-input">目标下载目录</label><mdui-text-field id="move-task-input" variant="outlined" class="operation-input" placeholder="/path/to/downloads" :value="targetDirectory" autofocus @input="targetDirectory = ($event.target as HTMLInputElement).value" @keyup.enter="submit"></mdui-text-field><p class="create-hint">任务会先暂停，文件校验完成后再按原状态恢复。</p><p v-if="errorMessage" class="operation-error">{{ errorMessage }}</p></div><template #footer><mdui-button variant="tonal" class="secondary-button" @click="overlay.close">取消</mdui-button><mdui-button variant="filled" class="primary-button" :disabled="pending" @click="submit">{{ pending ? '处理中…' : '移动' }}</mdui-button></template></ModalShell></template>
