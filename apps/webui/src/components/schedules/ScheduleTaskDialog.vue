<script setup lang="ts">
import { reactive } from 'vue'
import type { Schedule } from '../../api/contracts/v2/schedules'
const props = defineProps<{ modelValue?: Partial<Schedule> | null }>()
const emit = defineEmits<{ save: [value: Partial<Schedule>]; close: [] }>()
const form = reactive<Partial<Schedule>>({ name: props.modelValue?.name || '计划任务', enabled: props.modelValue?.enabled ?? true, action: props.modelValue?.action || 'start-all', daysOfWeek: props.modelValue?.daysOfWeek || [1, 2, 3, 4, 5], localTime: props.modelValue?.localTime || '22:00', timezone: props.modelValue?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone })
</script>
<template><div class="schedule-dialog"><h2>计划任务</h2><label>名称<input v-model="form.name" /></label><label>时间<input v-model="form.localTime" type="time" /></label><label>动作<select v-model="form.action"><option value="start-all">开始全部</option><option value="pause-all">暂停全部</option><option value="enable-full-speed">开启全速</option><option value="restore-limits">恢复限速</option></select></label><div class="schedule-days"><label v-for="day in [1, 2, 3, 4, 5, 6, 0]" :key="day"><input v-model="form.daysOfWeek" type="checkbox" :value="day" />{{ ['日', '一', '二', '三', '四', '五', '六'][day] }}</label></div><div class="modal-actions"><button class="secondary-button" @click="emit('close')">取消</button><button class="primary-button" @click="emit('save', form)">保存</button></div></div></template>
