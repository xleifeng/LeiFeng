<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCreateTaskStore } from '../../stores/create-task'
import { useOverlayStore } from '../../stores/overlay'
import type { CreateDraftV2 } from '../../api/contracts/v2/create'
import LinkInputStep from './LinkInputStep.vue'
import LinkDraftList from './LinkDraftList.vue'
import BtFileTree from './BtFileTree.vue'
import SavePathPicker from './SavePathPicker.vue'
import { validatePath } from '../../api/native-download/create'
import brandUrl from '@orig/svg/logo-hummingbird.svg'

const create = useCreateTaskStore(); const overlay = useOverlayStore(); const pathWarnings = ref<string[]>([]); let metadataTimer: number | undefined; onMounted(() => { if (!create.open) create.openForLinks(); metadataTimer = window.setInterval(() => create.refreshMetadataDrafts(), 1000) }); onBeforeUnmount(() => { if (metadataTimer) window.clearInterval(metadataTimer) })
watch(() => create.step, (step) => { if (step === 'options') validateSavePath() })
async function validateSavePath() { if (!create.savePath) return; try { const estimate = create.drafts.reduce((sum, draft) => sum + (draft.totalBytes || 0), 0); pathWarnings.value = (await validatePath(create.savePath, estimate)).warnings } catch { pathWarnings.value = ['保存目录校验失败'] } }
async function updateSavePath(value: string) { await create.changeSavePath(value); await validateSavePath() }
function hasCollision(draft: CreateDraftV2) { const collision = draft.options?.collision; return Boolean(collision && typeof collision === 'object' && (collision as { collision?: unknown }).collision === true) }
async function close() { await create.cancelAndClose(); overlay.close() }
function updateDraftSelection(draft: CreateDraftV2, indices: number[]) { create.updateDraft(draft, { selectedFileIndices: indices }) }
</script>

<template>
  <div class="overlay-backdrop create-task-overlay" :class="{ 'is-input-step': create.step === 'input' }" @click.self="close"><section class="native-dialog create-dialog" :class="{ 'is-input-step': create.step === 'input' }" role="dialog" aria-modal="true" aria-labelledby="create-task-title"><header class="dialog-header create-dialog-header"><div class="create-dialog-brand"><img :src="brandUrl" alt="" /><h2 id="create-task-title">新建任务</h2></div><button class="dialog-close" aria-label="关闭" @click="close">×</button></header>
    <div v-if="create.step === 'input'" class="dialog-body create-input-body"><LinkInputStep v-model="create.rawInput" :busy="create.uploadState === 'uploading'" :upload-progress="create.uploadProgress" @preflight="create.preflightLinks" @file="create.uploadTorrentFile" /><div v-if="create.preflightErrors.length" class="preflight-errors"><div v-for="item in create.preflightErrors" :key="`${item.value}:${item.code}`"><strong>{{ item.value }}</strong><span>{{ item.message }}</span></div></div><p v-if="create.error" class="create-error" role="alert">{{ create.error }}</p></div>
    <div v-else-if="create.step === 'options'" class="dialog-body create-options"><LinkDraftList :drafts="create.drafts" /><div v-if="create.preflightErrors.length" class="preflight-errors"><div v-for="item in create.preflightErrors" :key="`${item.value}:${item.code}`"><strong>{{ item.value }}</strong><span>{{ item.message }}</span></div></div><SavePathPicker :model-value="create.savePath" :warnings="pathWarnings" @update:model-value="updateSavePath" @blur="validateSavePath" /><div class="create-group-setting"><label><input v-model="create.groupEnabled" type="checkbox" />同时创建任务组</label><input v-if="create.groupEnabled" v-model="create.groupLabel" aria-label="任务组名称" placeholder="任务组名称（可选）" /></div><div v-for="draft in create.drafts" :key="draft.draftId"><BtFileTree :draft="draft" @toggle="updateDraftSelection(draft, $event)" /><div v-if="draft.metadata.state === 'failed'" class="duplicate-card"><strong>磁力元数据获取失败</strong><span>可重试 metadata 任务，原始磁力链接仍保留。</span><button class="secondary-button" @click="create.updateDraft(draft, { options: { retryMetadata: true } })">重试</button></div><div v-if="hasCollision(draft)" class="duplicate-card"><strong>文件名冲突</strong><span>目标目录已有同名文件，迅雷不会静默覆盖。</span><button class="secondary-button" @click="create.updateDraft(draft, { duplicateResolution: 'rename' })">自动重命名</button></div><div v-if="draft.duplicate" class="duplicate-card"><strong>发现重复任务</strong><span>可以打开已有任务，或选择处理方式后继续。</span><button class="secondary-button" @click="create.updateDraft(draft, { duplicateResolution: 'open-existing' })">打开已有</button><button class="secondary-button" @click="create.updateDraft(draft, { duplicateResolution: 'rename' })">自动重命名</button><button class="secondary-button" @click="create.updateDraft(draft, { duplicateResolution: 'redownload' })">重新下载</button><button class="secondary-button" @click="create.updateDraft(draft, { duplicateResolution: 'skip' })">跳过</button></div></div><p v-if="create.error" class="create-error">{{ create.error }}</p></div>
    <div v-else-if="create.step === 'committing'" class="dialog-body create-progress"><div class="create-spinner">…</div><h3>正在创建任务</h3><p>daemon 正在逐项提交，已成功的任务不会被后续失败回滚。</p></div>
    <div v-else class="dialog-body create-result"><h3>创建结果</h3><div v-for="result in create.commitResults" :key="result.draftId" class="result-row"><span :class="result.ok ? 'result-ok' : 'result-fail'">{{ result.ok ? '已创建' : '失败' }}</span><span>{{ result.draftId }}</span><small v-if="result.error">{{ result.error.message }}</small></div><p v-if="create.error" class="create-error">{{ create.error }}</p></div>
    <footer v-if="create.step !== 'input'" class="dialog-footer"><button class="secondary-button" @click="close">取消</button><button v-if="create.step === 'options'" class="primary-button" :disabled="!create.readyDrafts.length" @click="create.commit">立即创建</button><button v-else-if="create.step === 'result'" class="primary-button" @click="close">完成</button></footer>
  </section></div>
</template>
