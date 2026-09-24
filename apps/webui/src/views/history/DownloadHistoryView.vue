<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Clock3, Download, Trash2 } from '@lucide/vue'
import emptyIllustration from '@orig/img/recent-play-empty.png'
import type { HistoryItem } from '../../api/contracts/v2/history'
import { clearHistory, createDraftFromHistory, queryHistory, removeHistory } from '../../api/native-download/history'
import { formatBytes, formatDateTime } from '../../domain/format'
import { useCreateTaskStore } from '../../stores/create-task'
import { useOverlayStore } from '../../stores/overlay'

const search = ref('')
const result = ref('')
const queryClient = useQueryClient()
const create = useCreateTaskStore()
const overlay = useOverlayStore()
const error = ref('')
const query = useQuery({ queryKey: computed(() => ['v2-history', search.value, result.value]), queryFn: () => queryHistory({ search: search.value, result: result.value || undefined }), retry: 1 })

function resultLabel(value: string) { return ({ completed: '下载完成', failed: '下载失败', removed: '已删除', active: '下载中' } as Record<string, string>)[value] || value }
async function remove(id: string) { error.value = ''; try { await removeHistory([id]); await queryClient.invalidateQueries({ queryKey: ['v2-history'] }) } catch (cause) { error.value = cause instanceof Error ? cause.message : '移除记录失败' } }
async function clear() { if (!window.confirm('只清空下载记录，不删除本地文件。继续吗？')) return; error.value = ''; try { await clearHistory(false, result.value); await queryClient.invalidateQueries({ queryKey: ['v2-history'] }) } catch (cause) { error.value = cause instanceof Error ? cause.message : '清空记录失败' } }
async function redownload(item: HistoryItem) { try { const draft = await createDraftFromHistory(item.id) as { inputs?: Array<{ value?: string }> }; const value = draft?.inputs?.[0]?.value || item.source; if (value) { create.openForLinks(value); overlay.open({ type: 'new-task' }) } } catch (cause) { error.value = cause instanceof Error ? cause.message : '重新下载失败' } }
</script>

<template>
  <section class="feature-data-page replica-data-page history-page">
    <header class="replica-page-header"><div><h1>下载记录</h1><p>记录与本地文件相互独立</p></div><button class="page-quiet-action" :disabled="!query.data.value?.items.length" @click="clear"><Trash2 :size="16" />清空记录</button></header>
    <div class="replica-filter-bar"><label class="replica-search"><Clock3 :size="16" /><input v-model="search" placeholder="搜索历史" /></label><select v-model="result" aria-label="下载结果"><option value="">全部结果</option><option value="completed">已完成</option><option value="failed">失败</option><option value="removed">已删除</option></select></div>
    <p v-if="error" class="settings-error">{{ error }}</p>
    <div v-if="query.isPending.value" class="replica-loading">正在读取下载记录…</div>
    <div v-else-if="!query.data.value?.items.length" class="replica-empty-state"><img :src="emptyIllustration" alt="" /><h2>暂无下载记录</h2><p>完成、失败或删除任务后，可在这里重新创建下载。</p></div>
    <div v-else class="replica-data-list">
      <article v-for="item in query.data.value.items" :key="item.id" class="replica-data-row history-row">
        <span class="replica-file-icon"><Download :size="20" /></span>
        <div class="replica-data-main"><strong>{{ item.locked ? '私人记录（已锁定）' : item.displayName || '未命名任务' }}</strong><span>{{ resultLabel(item.result) }} · {{ formatBytes(item.totalBytes) }} · {{ formatDateTime(item.completedAt || item.createdAt) }}</span><small v-if="!item.locked">{{ item.source || item.savePath || '本地任务' }}</small></div>
        <div class="replica-row-actions"><button v-if="!item.locked" @click="redownload(item)">重新下载</button><button @click="remove(item.id)">移除</button></div>
      </article>
    </div>
  </section>
</template>
