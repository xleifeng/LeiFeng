<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Link2, Search, Star, Trash2 } from '@lucide/vue'
import { useRouter } from 'vue-router'
import type { LinkItem } from '../../api/contracts/v2/links'
import { queryLinks, removeLinks, saveLink, setLinkFavorite } from '../../api/native-download/links'
import { formatBytes, formatDateTime } from '../../domain/format'
import { downloadInputKind } from '../../domain/download-input'
import PageShell from '../../components/common/PageShell.vue'

const router = useRouter()
const queryClient = useQueryClient()
const search = ref('')
const favoriteOnly = ref(false)
const linkInput = ref('')
const error = ref('')
const query = useQuery({ queryKey: computed(() => ['v2-links', search.value, favoriteOnly.value]), queryFn: () => queryLinks({ search: search.value, favorite: favoriteOnly.value || undefined }), retry: 1 })

async function save() { const value = linkInput.value.trim(); if (!value) return; error.value = ''; const kind = downloadInputKind(value); if (!kind) { error.value = '请输入 HTTP、HTTPS、FTP、磁力、ED2K、迅雷链接或种子 hash'; return } try { await saveLink({ source: value, title: value.split('/').pop() || value, kind, sourceFingerprint: value }); linkInput.value = ''; await queryClient.invalidateQueries({ queryKey: ['v2-links'] }) } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存链接失败' } }
async function favorite(item: LinkItem) { try { await setLinkFavorite(item.id, !item.favorite, item.revision); await queryClient.invalidateQueries({ queryKey: ['v2-links'] }) } catch (cause) { error.value = cause instanceof Error ? cause.message : '更新收藏失败' } }
async function remove(item: LinkItem) { try { await removeLinks([item.id]); await queryClient.invalidateQueries({ queryKey: ['v2-links'] }) } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除链接失败' } }
function details(item: LinkItem) { void router.push({ name: 'link-details', params: { id: item.id } }) }
</script>

<template>
  <PageShell title="链接库" subtitle="本地保存下载来源，便于再次下载" class="link-library-page">
    <template #actions><label class="favorite-filter"><input v-model="favoriteOnly" type="checkbox" /><Star :size="15" />只看收藏</label></template>
    <template #subhead><div class="link-save-bar" style="margin-bottom: 0; width: 100%"><input v-model="linkInput" placeholder="粘贴 HTTP、FTP、磁力、ED2K、迅雷链接或种子 hash" @keyup.enter="save" /><button class="primary-button" @click="save">保存链接</button></div></template>
    <label class="search-box standalone"><Search :size="16" /><input v-model="search" placeholder="搜索链接库" /></label>
    <p v-if="error" class="settings-error">{{ error }}</p>
    <div v-if="query.isPending.value" class="data-loading">正在读取链接库…</div>
    <div v-else-if="!query.data.value?.items.length" class="data-empty"><span class="data-empty-icon"><Link2 :size="30" :stroke-width="1.6" /></span><h2>暂无链接</h2><p>保存的下载链接会显示在这里。</p></div>
    <div v-else class="data-list-panel">
      <article v-for="item in query.data.value.items" :key="item.id" class="data-row link-row">
        <span class="file-icon"><Link2 :size="20" /></span>
        <button class="data-row-main is-button" @click="details(item)"><strong>{{ item.locked ? '私人链接（已锁定）' : item.title }}</strong><span>{{ item.kind.toUpperCase() }} · {{ formatBytes(item.totalBytes) }} · {{ formatDateTime(item.lastDownloadedAt) }}</span><small v-if="!item.locked">{{ item.source || '来源已加密' }}</small><span v-if="item.tags?.length" class="tag-list"><em v-for="tag in item.tags" :key="tag.id">{{ tag.name }}</em></span></button>
        <div class="data-row-actions"><button :aria-label="item.favorite ? '取消收藏' : '收藏'" @click="favorite(item)"><Star :size="16" :fill="item.favorite ? 'currentColor' : 'none'" /></button><button aria-label="删除链接" @click="remove(item)"><Trash2 :size="16" /></button></div>
      </article>
    </div>
  </PageShell>
</template>
