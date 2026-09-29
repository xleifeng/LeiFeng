<script setup lang="ts">
import { X } from '@lucide/vue'
defineProps<{ url: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <div class="modal-layer" @mousedown.self="$emit('close')">
    <section class="modal-card" role="dialog" aria-modal="true" aria-label="导出诊断">
      <header class="modal-header"><h2>导出已准备</h2><button class="icon-button" aria-label="关闭" @click="$emit('close')"><X :size="18" /></button></header>
      <div class="modal-body"><p>导出包只包含诊断 JSON，不包含 token、密码、证书、下载文件或私人明文。</p></div>
      <footer class="modal-footer"><a class="primary-button" :href="url" download>下载 ZIP</a></footer>
    </section>
  </div>
</template>
