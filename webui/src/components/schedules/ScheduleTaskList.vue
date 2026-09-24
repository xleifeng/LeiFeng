<script setup lang="ts">
import type { Schedule } from '../../api/contracts/v2/schedules'
defineProps<{ schedules: Schedule[] }>()
const emit = defineEmits<{ toggle: [schedule: Schedule]; edit: [schedule: Schedule]; remove: [schedule: Schedule] }>()
</script>
<template><div class="schedule-list"><div v-for="schedule in schedules" :key="schedule.id" class="schedule-row"><label class="settings-check"><input type="checkbox" :checked="schedule.enabled" @change="emit('toggle', schedule)" />{{ schedule.name }}</label><span>{{ schedule.localTime }} · {{ schedule.action }}</span><button @click="emit('edit', schedule)">编辑</button><button @click="emit('remove', schedule)">删除</button></div></div></template>
