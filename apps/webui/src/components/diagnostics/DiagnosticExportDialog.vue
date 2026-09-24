<script setup lang="ts">
defineProps<{ url: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <div class="overlay-backdrop" @click.self="$emit('close')"><section class="native-dialog feature-dialog" role="dialog" aria-modal="true"><header class="dialog-header"><div><span class="dialog-eyebrow">脱敏诊断</span><h2>导出已准备</h2></div><button class="dialog-close" aria-label="关闭" @click="$emit('close')">×</button></header><div class="dialog-body"><p>导出包只包含诊断 JSON，不包含 token、密码、证书、下载文件或私人明文。</p><a class="primary-button" :href="url" download>下载 ZIP</a></div></section></div>
</template>
