<script setup lang="ts">
import { ref } from 'vue'
import ModalShell from '../ModalShell.vue'
import { useOverlayStore } from '../../stores/overlay'
import { useTaskCommands } from '../../composables/useTaskCommands'
import type { TaskListItemV2 } from '../../api/contracts/v2/tasks'

const props = defineProps<{ task: TaskListItemV2 }>()
const overlay = useOverlayStore(); const { execute } = useTaskCommands()
const displayName = ref(props.task.displayName); const pending = ref(false); const errorMessage = ref('')
async function submit() { if (!displayName.value.trim() || /[\\/\0]/.test(displayName.value) || displayName.value.includes('..')) { errorMessage.value = '文件名无效'; return }; pending.value = true; errorMessage.value = ''; try { await execute('rename', [props.task], { displayName: displayName.value.trim() }); overlay.close() } catch (error) { errorMessage.value = error instanceof Error ? error.message : '重命名失败' } finally { pending.value = false } }
</script>
<template><ModalShell title="重命名任务" @close="overlay.close"><div class="operation-dialog-body"><label class="create-label" for="rename-task-input">新的文件名</label><input id="rename-task-input" v-model="displayName" class="operation-input" autofocus @keyup.enter="submit" /><p v-if="errorMessage" class="operation-error">{{ errorMessage }}</p></div><template #footer><button class="secondary-button" @click="overlay.close">取消</button><button class="primary-button" :disabled="pending" @click="submit">{{ pending ? '处理中…' : '保存' }}</button></template></ModalShell></template>
