<script setup lang="ts">
import { reactive } from 'vue'
import type { Schedule } from '../../api/contracts/v2/schedules'
const props = defineProps<{ modelValue?: Partial<Schedule> | null }>()
const emit = defineEmits<{ save: [value: Partial<Schedule>]; close: [] }>()
const form = reactive<Partial<Schedule>>({ name: props.modelValue?.name || '计划任务', enabled: props.modelValue?.enabled ?? true, action: props.modelValue?.action || 'start-all', daysOfWeek: props.modelValue?.daysOfWeek || [1, 2, 3, 4, 5], localTime: props.modelValue?.localTime || '22:00', timezone: props.modelValue?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone })
function toggleDay(day: number) {
  const days = form.daysOfWeek ?? (form.daysOfWeek = [])
  const index = days.indexOf(day)
  if (index >= 0) days.splice(index, 1)
  else days.push(day)
}
</script>
<template><div class="schedule-dialog"><h2>计划任务</h2><label>名称<mdui-text-field variant="outlined" :value="form.name" @input="form.name = ($event.target as HTMLInputElement).value"></mdui-text-field></label><label>时间<mdui-text-field variant="outlined" type="time" :value="form.localTime" @input="form.localTime = ($event.target as HTMLInputElement).value"></mdui-text-field></label><label>动作<mdui-select variant="outlined" :value="form.action" @change="form.action = ($event.target as HTMLInputElement).value as typeof form.action"><mdui-menu-item value="start-all">开始全部</mdui-menu-item><mdui-menu-item value="pause-all">暂停全部</mdui-menu-item><mdui-menu-item value="enable-full-speed">开启全速</mdui-menu-item><mdui-menu-item value="restore-limits">恢复限速</mdui-menu-item></mdui-select></label><div class="schedule-days"><label v-for="day in [1, 2, 3, 4, 5, 6, 0]" :key="day"><mdui-checkbox :checked="form.daysOfWeek!.includes(day)" @change="toggleDay(day)"></mdui-checkbox>{{ ['日', '一', '二', '三', '四', '五', '六'][day] }}</label></div><div class="modal-actions"><mdui-button variant="tonal" class="secondary-button" @click="emit('close')">取消</mdui-button><mdui-button variant="filled" class="primary-button" @click="emit('save', form)">保存</mdui-button></div></div></template>
