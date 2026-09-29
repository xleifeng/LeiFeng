<script setup lang="ts">
import { X } from '@lucide/vue'
defineProps<{ title: string; description: string }>()
defineEmits<{ close: [] }>()
</script>
<template>
  <div class="modal-layer" @mousedown.self="$emit('close')">
    <section class="modal-card" role="dialog" aria-modal="true" :aria-label="title">
      <header class="modal-header"><h2>{{ title }}</h2><button class="icon-button" aria-label="关闭" @click="$emit('close')"><X :size="18" /></button></header>
      <div class="modal-body"><p>{{ description }}</p></div>
      <footer class="modal-footer"><button class="primary-button" @click="$emit('close')">关闭</button></footer>
    </section>
  </div>
</template>
