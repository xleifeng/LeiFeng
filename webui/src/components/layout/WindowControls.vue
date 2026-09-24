<script setup lang="ts">
// webui/src/components/layout/WindowControls.vue — 原版三键（web 形态无操作，事件上抛由 AppShell 占位）
// 对齐原版（像素实测）：36px pitch 0 间距、12px 线形图标、深色 #333；关闭 hover 红
import IconButton from '../common/IconButton.vue'
const emit = defineEmits<{ minimize: []; fullscreen: []; close: [] }>()
</script>
<template>
  <div class="window-controls">
    <IconButton label="最小化" :size="36" class="wc" @click="emit('minimize')"><span class="wc-line" /></IconButton>
    <IconButton label="全屏" :size="36" class="wc" @click="emit('fullscreen')"><span class="wc-box" /></IconButton>
    <IconButton label="关闭" :size="36" class="wc wc-close" @click="emit('close')"><span class="wc-cross" /></IconButton>
  </div>
</template>
<style scoped>
.window-controls { display: inline-flex; gap: 0; }
.window-controls :deep(.icon-button) { color: #333; border-radius: 0; }
.window-controls :deep(.icon-button:hover) { background: transparent; color: #333; }
.wc-line { display: block; width: 12px; height: 2px; background: currentColor; }
.wc-box { display: block; width: 12px; height: 12px; border: 1px solid currentColor; }
.wc-cross { position: relative; display: block; width: 12px; height: 12px; }
.wc-cross::before, .wc-cross::after { content: ''; position: absolute; left: 1px; top: 5.5px; width: 10px; height: 1px; background: currentColor; }
.wc-cross::before { transform: rotate(45deg); } .wc-cross::after { transform: rotate(-45deg); }
.window-controls :deep(.wc-close:hover) { background: #ff4d4f; color: #fff; }
</style>