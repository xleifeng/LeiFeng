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
<template><ModalShell title="移动任务到" @close="overlay.close"><div class="operation-dialog-body"><label class="create-label" for="move-task-input">目标下载目录</label><input id="move-task-input" v-model="targetDirectory" class="operation-input" placeholder="/path/to/downloads" autofocus @keyup.enter="submit" /><p class="create-hint">任务会先暂停，文件校验完成后再按原状态恢复。</p><p v-if="errorMessage" class="operation-error">{{ errorMessage }}</p></div><template #footer><button class="secondary-button" @click="overlay.close">取消</button><button class="primary-button" :disabled="pending" @click="submit">{{ pending ? '处理中…' : '移动' }}</button></template></ModalShell></template>
