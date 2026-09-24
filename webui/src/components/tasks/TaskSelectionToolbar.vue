<script setup lang="ts">
import { X } from '@lucide/vue'
defineProps<{ count: number; total: number }>()
const emit = defineEmits<{ clear: []; selectAll: [] }>()
</script>
<template><div v-if="count" class="selection-toolbar"><span>已选择 {{ count }} 项</span><button class="toolbar-button" @click="emit('selectAll')">全选当前 {{ total }} 项</button><button class="selection-clear" aria-label="清除选择" @click="emit('clear')"><X :size="15" /></button></div></template>
