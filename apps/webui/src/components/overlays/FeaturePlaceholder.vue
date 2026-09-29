<script setup lang="ts">
import ModalShell from '../ModalShell.vue'
defineProps<{ title: string; description: string }>()
defineEmits<{ close: [] }>()
</script>
<template>
  <ModalShell :title="title" @close="$emit('close')">
    <p>{{ description }}</p>
    <template #footer><mdui-button variant="filled" class="primary-button" @click="$emit('close')">关闭</mdui-button></template>
  </ModalShell>
</template>
