<script setup lang="ts">
const emit = defineEmits<{ move: [target: 'top' | 'up' | 'down' | 'bottom'] }>()
</script>
<template><div class="queue-position-menu"><button @click="emit('move', 'top')">移到顶部</button><button @click="emit('move', 'up')">上移</button><button @click="emit('move', 'down')">下移</button><button @click="emit('move', 'bottom')">移到底部</button></div></template>
