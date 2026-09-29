<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Clock3, Download, Trash2 } from '@lucide/vue'
import type { HistoryItem } from '../../api/contracts/v2/history'
import { clearHistory, createDraftFromHistory, queryHistory, removeHistory } from '../../api/native-download/history'
import { formatBytes, formatDateTime } from '../../domain/format'
import { useCreateTaskStore } from '../../stores/create-task'
import { useOverlayStore } from '../../stores/overlay'
import PageShell from '../../components/common/PageShell.vue'

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
  <PageShell title="下载记录" subtitle="记录与本地文件相互独立" class="history-page">
    <template #actions><button class="page-quiet-action" :disabled="!query.data.value?.items.length" @click="clear"><Trash2 :size="16" />清空记录</button></template>
    <template #subhead>
    <div class="filter-bar"><label class="search-box"><Clock3 :size="16" /><input v-model="search" placeholder="搜索历史" /></label><mdui-select variant="outlined" :value="result" aria-label="下载结果" @change="result = ($event.target as HTMLInputElement).value"><mdui-menu-item value="">全部结果</mdui-menu-item><mdui-menu-item value="completed">已完成</mdui-menu-item><mdui-menu-item value="failed">失败</mdui-menu-item><mdui-menu-item value="removed">已删除</mdui-menu-item></mdui-select></div>
    </template>
    <p v-if="error" class="settings-error">{{ error }}</p>
    <div v-if="query.isPending.value" class="data-loading">正在读取下载记录…</div>
    <div v-else-if="!query.data.value?.items.length" class="data-empty"><span class="data-empty-icon"><Clock3 :size="30" :stroke-width="1.6" /></span><h2>暂无下载记录</h2><p>完成、失败或删除任务后，可在这里重新创建下载。</p></div>
    <div v-else class="data-list-panel">
      <article v-for="item in query.data.value.items" :key="item.id" class="data-row history-row">
        <span class="file-icon"><Download :size="20" /></span>
        <div class="data-row-main"><strong>{{ item.locked ? '私人记录（已锁定）' : item.displayName || '未命名任务' }}</strong><span>{{ resultLabel(item.result) }} · {{ formatBytes(item.totalBytes) }} · {{ formatDateTime(item.completedAt || item.createdAt) }}</span><small v-if="!item.locked">{{ item.source || item.savePath || '本地任务' }}</small></div>
        <div class="data-row-actions"><button v-if="!item.locked" @click="redownload(item)">重新下载</button><button @click="remove(item.id)">移除</button></div>
      </article>
    </div>
  </PageShell>
</template>
