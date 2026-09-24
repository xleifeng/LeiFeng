<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { buildMediaContentUrl, issueMediaToken } from '../../api/native-download/media'

const props = withDefaults(defineProps<{ taskId: string, fileIndex?: number, displayName?: string, kind?: 'video' | 'audio' | 'image' | 'text' }>(), { fileIndex: 0, kind: 'video' })
const loading = ref(false)
const problem = ref('')
const token = ref('')
const currentTime = ref(0)
const media = ref<HTMLMediaElement | null>(null)
const automaticRetryUsed = ref(false)
const source = computed(() => token.value ? buildMediaContentUrl(props.taskId, props.fileIndex, token.value) : '')

async function load() {
  loading.value = true; problem.value = ''
  try { const result = await issueMediaToken(props.taskId, props.fileIndex); token.value = result.token }
  catch (error) { problem.value = error instanceof Error ? error.message : '媒体不可用'; token.value = '' }
  finally { loading.value = false }
}
function retryOnce() { const time = Number(media.value?.currentTime || currentTime.value); load().then(() => { if (media.value && time > 0) media.value.currentTime = time }) }
function retryManually() { automaticRetryUsed.value = false; void load() }
function onError() { if (token.value && !automaticRetryUsed.value) { automaticRetryUsed.value = true; retryOnce(); return } problem.value = '媒体加载失败，请重试'; token.value = '' }
function onTimeUpdate(event: Event) { currentTime.value = Number((event.target as HTMLMediaElement).currentTime || 0) }
watch(() => [props.taskId, props.fileIndex], () => { automaticRetryUsed.value = false; void load() }, { immediate: true })
onBeforeUnmount(() => { if (media.value) { media.value.pause(); media.value.removeAttribute('src'); media.value.load() } })
</script>

<template>
  <div class="media-player">
    <div v-if="loading" class="inline-note">正在准备播放…</div>
    <div v-else-if="problem" class="inline-error">{{ problem }} <button class="secondary-button" @click="retryManually">重试</button></div>
    <video v-else-if="kind === 'video'" ref="media" class="media-player-element" controls playsinline :src="source" @error="onError" @timeupdate="onTimeUpdate" />
    <audio v-else-if="kind === 'audio'" ref="media" class="media-player-element" controls :src="source" @error="onError" />
    <img v-else-if="kind === 'image'" class="media-player-image" :src="source" :alt="displayName || '下载文件'" @error="onError" />
    <iframe v-else-if="kind === 'text'" class="media-player-text" :src="source" title="文本预览" />
    <div v-else class="inline-note">该文件类型不支持浏览器预览，请在主机打开或下载。</div>
  </div>
</template>
