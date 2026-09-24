<script setup lang="ts">
import { ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { rpcV2 } from '../../api/native-download/client'
const props = defineProps<{ taskId?: string }>()
const input = ref(props.taskId || '')
const query = useQuery({ queryKey: ['v2-task-diagnostic', input], queryFn: () => rpcV2('thunder.ui.v2.diagnostics.tasks.get', [{ taskId: input.value }]), enabled: false })
function run() { if (input.value.trim()) query.refetch() }
</script>

<template>
  <section class="diagnostic-task-panel"><h2>单任务诊断</h2><div class="data-toolbar"><input v-model="input" placeholder="输入任务 ID" @keyup.enter="run" /><button class="secondary-button" :disabled="!input.trim() || query.isFetching.value" @click="run">检查</button></div><pre v-if="query.data.value">{{ JSON.stringify(query.data.value, null, 2) }}</pre><p v-if="query.error.value" class="settings-error">无法读取任务诊断</p></section>
</template>
