<script setup lang="ts">
// webui/src/components/common/IconButton.vue — 32×32 圆角 6、悬停底 var(--xl-blue) 12%
// 尺寸可由 size prop 覆盖（WindowControls 用 40px 热区对齐原版三键 40px pitch）
defineProps<{ label: string; size?: number; disabled?: boolean }>()
</script>
<template>
  <button class="icon-button" type="button" :class="[`size-${size || 32}`]" :aria-label="label" :disabled="disabled"><slot /></button>
</template>
<style scoped>
.icon-button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 6px;
  color: var(--icon-btn-color, var(--xl-text-secondary)); background: transparent; border: none; cursor: pointer;
  flex: 0 0 auto;
}
.icon-button.size-36 { width: 36px; height: 36px; }
.icon-button.size-40 { width: 40px; height: 40px; }
.icon-button:hover { background: rgba(34, 109, 245, 0.12); color: var(--xl-blue); }
.icon-button:disabled { opacity: 0.4; cursor: default; }
.icon-button:disabled:hover { background: transparent; color: var(--xl-text-secondary); }
</style>