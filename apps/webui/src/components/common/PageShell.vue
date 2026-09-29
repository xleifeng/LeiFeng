<script setup lang="ts">
// PageShell：全站统一页面壳——居中限宽列 + 大标题 + 可选副标题/操作/次级行。
// fill 模式给自撑高内容（任务虚拟列表）：body flex 撑满、页面不滚动。
defineProps<{ title: string; subtitle?: string; fill?: boolean }>()
</script>

<template>
  <section class="page-shell" :class="{ 'is-fill': fill }">
    <header class="page-shell-header">
      <div class="page-shell-heading">
        <h1>{{ title }}</h1>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="page-shell-actions"><slot name="actions" /></div>
    </header>
    <div v-if="$slots.subhead" class="page-shell-subhead"><slot name="subhead" /></div>
    <div class="page-shell-body"><slot /></div>
  </section>
</template>
