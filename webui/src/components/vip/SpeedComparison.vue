<script setup lang="ts">
defineProps<{ vip?: number; freeDcdn?: number }>()
</script>
<template><div class="speed-comparison"><span>VIP / 免费 DCDN 接收</span><strong>{{ (vip || 0).toLocaleString() }} B / {{ (freeDcdn || 0).toLocaleString() }} B</strong><small>只展示 daemon 可观测字节，不虚构速度对比。</small></div></template>
