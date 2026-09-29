<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import type { TaskDetailV2 } from '../../api/contracts/v2/tasks'
import { getVipTaskState, retryVipTask, setVipTaskEnabled } from '../../api/native-download/vip'
import TaskAccelerationStatus from '../vip/TaskAccelerationStatus.vue'
import SpeedComparison from '../vip/SpeedComparison.vue'
const props = defineProps<{ detail: TaskDetailV2 }>()
const queryClient = useQueryClient(); const busy = ref(false)
const query = useQuery({ queryKey: computed(() => ['v2-vip-task', props.detail.taskId]), queryFn: () => getVipTaskState(props.detail.taskId), retry: 1 })
async function toggle(enabled: boolean) { busy.value = true; try { await setVipTaskEnabled(props.detail.taskId, enabled, props.detail.revision); await query.refetch(); await queryClient.invalidateQueries({ queryKey: ['v2-task-detail', props.detail.taskId] }) } finally { busy.value = false } }
async function retry() { busy.value = true; try { await retryVipTask(props.detail.taskId); await query.refetch() } finally { busy.value = false } }
</script>
<template><section class="details-panel-section acceleration-panel"><h3>加速状态</h3><TaskAccelerationStatus :state="query.data.value || null" :busy="busy" @toggle="toggle" @retry="retry" /><SpeedComparison :vip="query.data.value?.vipReceivedBytes" :free-dcdn="query.data.value?.freeDcdnReceivedBytes" /><div class="acceleration-card"><span>资源资格</span><strong>{{ query.data.value?.resourceStatus || 'unknown' }}</strong></div><div class="acceleration-card"><span>上传速度</span><strong>{{ props.detail.uploadBytesPerSecond }} B/s</strong></div></section></template>
