<script setup lang="ts">
import type { CreateDraftV2 } from '../../api/contracts/v2/create'
defineProps<{ drafts: CreateDraftV2[] }>()
</script>
<template><div class="draft-list"><div v-for="draft in drafts" :key="draft.draftId" class="draft-card"><div class="draft-card-head"><span class="draft-kind">{{ draft.kind.toUpperCase() }}</span><strong>{{ draft.displayName }}</strong><span class="draft-state" :class="`draft-${draft.state}`">{{ draft.state === 'ready' ? '可创建' : draft.state === 'metadata' ? '正在获取元数据' : draft.state }}</span></div><div class="draft-card-meta"><span>{{ draft.totalBytes ? `${(draft.totalBytes / 1024 / 1024).toFixed(1)} MB` : '大小待确认' }}</span><span v-if="draft.metadata.state === 'failed'" class="create-error">元数据获取失败</span><span v-if="draft.duplicate" class="duplicate-text">检测到重复任务</span></div></div></div></template>
