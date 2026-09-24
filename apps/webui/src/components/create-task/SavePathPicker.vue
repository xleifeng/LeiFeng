<script setup lang="ts">
const props = defineProps<{ modelValue: string; warnings?: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; blur: [] }>()
</script>
<template><label class="create-path-field"><span>保存到</span><input :value="modelValue" placeholder="使用 daemon 默认下载目录" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @blur="emit('blur')" /></label><p v-for="warning in props.warnings" :key="warning" class="path-warning">{{ warning }}</p></template>
