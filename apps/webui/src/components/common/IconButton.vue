<script setup lang="ts">
// M3 标准图标钮：40×40 圆形 state-layer hover
defineProps<{ label: string; size?: number; disabled?: boolean }>()
</script>
<template>
  <button class="icon-button" type="button" :class="[`size-${size || 40}`]" :aria-label="label" :disabled="disabled"><slot /></button>
</template>
<style scoped>
.icon-button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 999px;
  color: var(--icon-btn-color, var(--md-on-surface-variant)); background: transparent; border: none; cursor: pointer;
  flex: 0 0 auto; transition: background 150ms cubic-bezier(.2, 0, 0, 1), color 150ms cubic-bezier(.2, 0, 0, 1);
}
.icon-button.size-32 { width: 32px; height: 32px; }
.icon-button.size-36 { width: 36px; height: 36px; }
.icon-button:hover { background: color-mix(in srgb, var(--md-on-surface) 8%, transparent); color: var(--md-on-surface); }
.icon-button:disabled { opacity: 0.38; cursor: default; }
.icon-button:disabled:hover { background: transparent; color: var(--md-on-surface-variant); }
</style>