<script setup lang="ts">
defineProps<{ title: string; description: string }>()
defineEmits<{ close: [] }>()
</script>
<template><div class="overlay-backdrop" @click.self="$emit('close')"><section class="native-dialog feature-dialog" role="dialog" aria-modal="true"><header class="dialog-header"><div><span class="dialog-eyebrow">迅雷原生 WebUI</span><h2>{{ title }}</h2></div><button class="dialog-close" aria-label="关闭" @click="$emit('close')">×</button></header><div class="dialog-body"><p>{{ description }}</p></div><footer class="dialog-footer"><button class="primary-button" @click="$emit('close')">关闭</button></footer></section></div></template>
