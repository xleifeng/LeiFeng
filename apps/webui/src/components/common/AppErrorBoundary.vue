<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

const error = ref<Error | null>(null)
onErrorCaptured((cause) => { error.value = cause instanceof Error ? cause : new Error(String(cause)); return false })
function reload() { error.value = null; window.location.reload() }
</script>

<template>
  <slot v-if="!error" />
  <section v-else class="app-error-boundary"><h1>页面出现问题</h1><p>{{ error.message }}</p><button class="primary-button" @click="reload">重新加载</button></section>
</template>
