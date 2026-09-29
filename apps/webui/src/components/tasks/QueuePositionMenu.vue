<script setup lang="ts">
const emit = defineEmits<{ move: [target: 'top' | 'up' | 'down' | 'bottom'] }>()
</script>
<template>
  <mdui-menu class="queue-position-menu">
    <mdui-menu-item @click="emit('move', 'top')">移到顶部</mdui-menu-item>
    <mdui-menu-item @click="emit('move', 'up')">上移</mdui-menu-item>
    <mdui-menu-item @click="emit('move', 'down')">下移</mdui-menu-item>
    <mdui-menu-item @click="emit('move', 'bottom')">移到底部</mdui-menu-item>
  </mdui-menu>
</template>
