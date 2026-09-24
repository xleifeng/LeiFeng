<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ArrowLeft, Download } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import { createDraftFromLink, getLink, setLinkTags } from '../../api/native-download/links'
import { formatBytes, formatDateTime } from '../../domain/format'
import { useCreateTaskStore } from '../../stores/create-task'
import { useOverlayStore } from '../../stores/overlay'

const route = useRoute()
const router = useRouter()
const overlay = useOverlayStore()
const create = useCreateTaskStore()
const queryClient = useQueryClient()
const tags = ref('')
const error = ref('')
const notice = ref('')
const query = useQuery({ queryKey: computed(() => ['v2-link', route.params.id]), queryFn: () => getLink(String(route.params.id)), retry: 1 })

watch(() => query.data.value?.tags, (value) => { tags.value = (value || []).map((item) => item.name).join(', ') }, { immediate: true })

async function saveTags() {
  if (!query.data.value) return
  error.value = ''
  try {
    await setLinkTags(query.data.value.id, tags.value.split(',').map((value) => value.trim()).filter(Boolean), query.data.value.revision)
    notice.value = '标签已保存'
    await queryClient.invalidateQueries({ queryKey: ['v2-link', route.params.id] })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '标签保存失败'
  }
}
async function redownload() {
  if (!query.data.value) return
  try {
    const draft = await createDraftFromLink(query.data.value.id) as { inputs?: Array<{ value?: string }> }
    const value = draft?.inputs?.[0]?.value || query.data.value.source
    if (value) { create.openForLinks(value); overlay.open({ type: 'new-task' }) }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '重新下载失败'
  }
}
</script>

<template>
  <section class="feature-data-page replica-data-page link-detail-page">
    <button class="page-quiet-action link-detail-back" @click="router.back"><ArrowLeft :size="16" />返回链接库</button>
    <div v-if="query.isPending.value" class="replica-loading">正在读取链接详情…</div>
    <div v-else-if="query.isError.value" class="settings-error">链接详情不可用：{{ query.error.value?.message }}</div>
    <article v-else-if="query.data.value" class="link-detail-card">
      <div class="link-detail-summary"><div><h1>{{ query.data.value.title }}</h1><p>{{ query.data.value.kind.toUpperCase() }} · {{ formatBytes(query.data.value.totalBytes) }} · 最近下载 {{ formatDateTime(query.data.value.lastDownloadedAt) }}</p></div><button class="primary-button" :disabled="query.data.value.locked" @click="redownload"><Download :size="15" />重新下载</button></div>
      <section class="link-detail-section"><h2>下载来源</h2><code class="link-source">{{ query.data.value.source || '私人链接已加密，解锁私人空间后可见' }}</code></section>
      <section class="link-detail-section"><h2>标签</h2><div class="link-detail-tags"><input v-model="tags" placeholder="多个标签用逗号分隔" @keyup.enter="saveTags" /><button class="secondary-button" @click="saveTags">保存标签</button></div></section>
      <section v-if="query.data.value.files?.length" class="link-detail-section"><h2>种子文件（{{ query.data.value.files.length }}）</h2><div class="link-file-list"><div v-for="file in query.data.value.files" :key="file.index" class="link-file-row"><span>{{ file.path }}</span><small>{{ formatBytes(file.size) }}</small></div></div></section>
      <p v-if="error" class="settings-error">{{ error }}</p><p v-if="notice" class="settings-notice">{{ notice }}</p>
    </article>
  </section>
</template>
