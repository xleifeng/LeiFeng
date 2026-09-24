<script setup lang="ts">
defineProps<{ label: string; count: number }>()
</script>
<template><div class="task-group-header"><span>{{ label }}</span><span>{{ count }}</span></div></template>
