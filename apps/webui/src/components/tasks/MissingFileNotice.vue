<script setup lang="ts">
defineProps<{ message?: string }>()
const emit = defineEmits<{ redownload: []; remove: [] }>()
</script>
<template><div class="missing-file-notice"><strong>本地文件不可用</strong><span>{{ message || '任务记录仍保留，可以重新下载或移除记录。' }}</span><div><button class="secondary-button" @click="emit('redownload')">重新下载</button><button class="secondary-button danger-outline" @click="emit('remove')">移入回收站</button></div></div></template>
