<script setup lang="ts">
const props = defineProps<{ value: number | null; busy?: boolean }>()
const emit = defineEmits<{ apply: [value: number | null] }>()
const presets = [null, 128 * 1024, 512 * 1024, 1024 * 1024, 5 * 1024 * 1024]
function applyCustom(event: KeyboardEvent) { emit('apply', Number((event.target as HTMLInputElement).value) || null) }
</script>
<template>
  <mdui-menu class="speed-limit-popover">
    <mdui-menu-item v-for="preset in presets" :key="String(preset)" :disabled="busy" @click="emit('apply', preset)">{{ preset === null ? '跟随全局' : `${Math.round(preset / 1024)} KB/s` }}</mdui-menu-item>
    <div class="speed-limit-custom"><mdui-text-field variant="outlined" type="number" min="0" label="自定义 B/s" @keydown.enter="applyCustom"></mdui-text-field></div>
  </mdui-menu>
</template>
