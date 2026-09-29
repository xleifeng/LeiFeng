<script setup lang="ts">
// Leifeng Modern 图标钮：32×32 圆角 10、悬停中性灰底（强调态由消费方 CSS 变量覆盖）
defineProps<{ label: string; size?: number; disabled?: boolean }>()
</script>
<template>
  <button class="icon-button" type="button" :class="[`size-${size || 32}`]" :aria-label="label" :disabled="disabled"><slot /></button>
</template>
<style scoped>
.icon-button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 10px;
  color: var(--icon-btn-color, var(--lf-text-2)); background: transparent; border: none; cursor: pointer;
  flex: 0 0 auto; transition: background .14s, color .14s;
}
.icon-button.size-36 { width: 36px; height: 36px; }
.icon-button.size-40 { width: 40px; height: 40px; }
.icon-button:hover { background: rgb(100 116 139 / 10%); color: var(--lf-text-1); }
.icon-button:disabled { opacity: 0.4; cursor: default; }
.icon-button:disabled:hover { background: transparent; color: var(--lf-text-2); }
</style>