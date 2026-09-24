<script setup lang="ts">
import { X } from '@lucide/vue'
defineProps<{ title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="modal-layer" role="presentation" @mousedown.self="emit('close')">
    <section class="modal-card" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title">
      <header class="modal-header"><h2>{{ title }}</h2><button class="icon-button" aria-label="关闭" @click="emit('close')"><X :size="20" /></button></header>
      <div class="modal-body"><slot /></div>
      <footer v-if="$slots.footer" class="modal-footer"><slot name="footer" /></footer>
    </section>
  </div>
</template>
