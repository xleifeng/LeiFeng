<script setup lang="ts">
import { X } from '@lucide/vue'
defineProps<{ title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <!-- mdui-dialog：M3 规范弹窗（scrim / 动效 / esc·遮罩关闭齐备）。closed 后再通知父级
       卸载，保证退场动画播完；X 按钮直接 emit（父级 v-if 卸载，跳过动画）。
       role/aria-modal/aria-label 补在宿主上：mdui-dialog 内部未带可访问角色。 -->
  <mdui-dialog open close-on-overlay-click close-on-esc role="dialog" aria-modal="true" :aria-label="title" class="modal-shell" :class="{ wide }" @closed="emit('close')">
    <div slot="headline" class="modal-shell-headline">
      <span class="modal-shell-title">{{ title }}</span>
      <mdui-button-icon class="modal-shell-close" aria-label="关闭" @click="emit('close')"><X :size="20" /></mdui-button-icon>
    </div>
    <slot />
    <div v-if="$slots.footer" slot="action" class="modal-shell-footer"><slot name="footer" /></div>
  </mdui-dialog>
</template>
