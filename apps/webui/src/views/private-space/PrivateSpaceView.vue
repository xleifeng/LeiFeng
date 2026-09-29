<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { FolderLock, LockKeyhole, Search, ShieldCheck } from '@lucide/vue'
import emptyIllustration from '@orig/img/general.png'
import type { PrivateTask } from '../../api/contracts/v2/private-space'
import { moveTaskOutOfPrivate, queryPrivateTasks } from '../../api/native-download/private-space'
import { formatBytes } from '../../domain/format'
import { usePrivateSpaceStore } from '../../stores/private-space'
import PrivateChangePasswordDialog from '../../components/private-space/PrivateChangePasswordDialog.vue'
import PrivateSetupDialog from '../../components/private-space/PrivateSetupDialog.vue'
import PrivateUnlockDialog from '../../components/private-space/PrivateUnlockDialog.vue'

const store = usePrivateSpaceStore()
const queryClient = useQueryClient()
const search = ref('')
const showUnlock = ref(false)
const showSetup = ref(false)
const showPassword = ref(false)
const targetDirectory = ref('')
const error = ref('')
const notice = ref('')

const statusQuery = useQuery({ queryKey: ['v2-private-status'], queryFn: async () => { await store.refresh(); return store.status }, retry: 1 })
const tasksQuery = useQuery({
  queryKey: computed(() => ['v2-private-tasks', store.sessionToken, search.value]),
  queryFn: () => queryPrivateTasks(search.value),
  enabled: computed(() => store.unlocked),
  retry: 1,
})

async function unlockDone() {
  showUnlock.value = false
  await queryClient.invalidateQueries({ queryKey: ['v2-private-tasks'] })
  await statusQuery.refetch()
}
async function setupDone() {
  showSetup.value = false
  await statusQuery.refetch()
  showUnlock.value = true
}
async function lock() {
  await store.lock()
  targetDirectory.value = ''
  notice.value = '私人空间已锁定'
}
async function moveOut(task: PrivateTask) {
  if (!targetDirectory.value.trim()) { error.value = '请先填写普通下载目录'; return }
  error.value = ''
  notice.value = ''
  try {
    await moveTaskOutOfPrivate(task.id || task.taskId || '', targetDirectory.value.trim(), task.revision)
    notice.value = `已将“${task.displayName}”移出私人空间`
    await queryClient.invalidateQueries({ queryKey: ['v2-private-tasks'] })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '移出失败'
  }
}
</script>

<template>
  <section class="feature-data-page replica-data-page private-space-page">
    <header class="replica-page-header">
      <div><h1>私人空间</h1><p>锁定后隐藏任务名称、来源和保存路径</p></div>
      <div class="settings-page-actions">
        <button v-if="store.unlocked" class="secondary-button" @click="showPassword = true">修改密码</button>
        <button v-if="store.unlocked" class="primary-button" @click="lock">锁定</button>
        <button v-else-if="store.status?.configured" class="primary-button" @click="showUnlock = true">解锁</button>
        <button v-else class="primary-button" @click="showSetup = true">启用私人空间</button>
      </div>
    </header>

    <div class="private-status-strip">
      <ShieldCheck v-if="store.status?.metadataEncrypted" :size="22" />
      <LockKeyhole v-else :size="22" />
      <div><strong>{{ store.status?.configured ? (store.unlocked ? '私人空间已解锁' : '私人空间已锁定') : '尚未启用私人空间' }}</strong><span>任务元数据：{{ store.status?.metadataEncrypted ? '已加密' : '未设置' }} · 文件内容：{{ store.status?.downloadContentEncrypted ? '已加密' : '取决于磁盘加密' }}</span></div>
      <span>{{ store.status?.directoryConfigured ? '独立目录已配置' : '使用默认私人目录' }}</span>
    </div>

    <p v-if="error" class="settings-error">{{ error }}</p>
    <p v-if="notice" class="settings-notice">{{ notice }}</p>

    <div v-if="statusQuery.isPending.value" class="replica-loading">正在读取私人空间状态…</div>
    <div v-else-if="!store.status?.configured" class="replica-empty-state"><img :src="emptyIllustration" alt="" /><h2>尚未设置私人空间</h2><p>设置密码和独立目录后，可将下载任务移入此处。</p></div>
    <div v-else-if="!store.unlocked" class="replica-empty-state"><img :src="emptyIllustration" alt="" /><h2>私人空间已锁定</h2><p>解锁后才能读取和管理私人下载任务。</p></div>
    <template v-else>
      <div class="private-tools">
        <label class="replica-search"><Search :size="16" /><input v-model="search" placeholder="搜索私人任务" /></label>
        <label class="private-path-control"><input v-model="targetDirectory" placeholder="移出到普通下载目录" /></label>
      </div>
      <div v-if="tasksQuery.isPending.value" class="replica-loading">正在读取私人任务…</div>
      <div v-else-if="!tasksQuery.data.value?.items.length" class="replica-empty-state"><img :src="emptyIllustration" alt="" /><h2>私人空间暂无任务</h2><p>在下载任务菜单中选择“移入私人空间”。</p></div>
      <div v-else class="private-task-list">
        <article v-for="task in tasksQuery.data.value.items" :key="task.id || task.taskId" class="private-task-row">
          <span class="replica-file-icon"><FolderLock :size="20" /></span>
          <div class="replica-data-main"><strong>{{ task.displayName }}</strong><span>{{ task.lifecycle || '任务' }} · {{ formatBytes(task.completedBytes) }} / {{ formatBytes(task.totalBytes) }}</span><small>{{ task.savePath || '私人下载目录' }}</small></div>
          <button class="secondary-button" :disabled="!targetDirectory.trim()" @click="moveOut(task)">移出</button>
        </article>
      </div>
    </template>

    <div v-if="showUnlock" class="overlay-backdrop" @click.self="showUnlock = false"><section class="native-dialog"><PrivateUnlockDialog @unlocked="unlockDone" @close="showUnlock = false" /></section></div>
    <div v-if="showSetup" class="overlay-backdrop" @click.self="showSetup = false"><section class="native-dialog"><PrivateSetupDialog @setup="setupDone" @close="showSetup = false" /></section></div>
    <div v-if="showPassword" class="overlay-backdrop" @click.self="showPassword = false"><section class="native-dialog"><PrivateChangePasswordDialog @changed="showPassword = false; notice = '私人空间密码已更新'" @close="showPassword = false" /></section></div>
  </section>
</template>
