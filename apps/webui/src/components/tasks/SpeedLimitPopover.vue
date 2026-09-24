<script setup lang="ts">
const props = defineProps<{ value: number | null; busy?: boolean }>()
const emit = defineEmits<{ apply: [value: number | null] }>()
const presets = [null, 128 * 1024, 512 * 1024, 1024 * 1024, 5 * 1024 * 1024]
</script>
<template><div class="speed-limit-popover"><button v-for="preset in presets" :key="String(preset)" :disabled="busy" @click="emit('apply', preset)">{{ preset === null ? '跟随全局' : `${Math.round(preset / 1024)} KB/s` }}</button><input type="number" min="0" placeholder="自定义 B/s" @keydown.enter="emit('apply', Number(($event.target as HTMLInputElement).value) || null)" /></div></template>
