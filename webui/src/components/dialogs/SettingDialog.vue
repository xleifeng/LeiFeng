<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
import { useRouter } from 'vue-router'
import type { DownloadPolicy } from '../../api/contracts/v2/policies'
import { enableFullSpeed, restoreLimits } from '../../api/native-download/policies'
import { useDownloadPolicyFormStore } from '../../stores/download-policy-form'
import { useOverlayStore } from '../../stores/overlay'

type Section = 'basic' | 'download' | 'tasks' | 'automation' | 'integration'

const form = useDownloadPolicyFormStore()
const overlay = useOverlayStore()
const router = useRouter()
const activeSection = ref<Section>('basic')
const notice = ref('')

const navigation: { id: Section; label: string }[] = [
  { id: 'basic', label: '基本设置' },
  { id: 'download', label: '下载设置' },
  { id: 'tasks', label: '任务管理' },
  { id: 'automation', label: '计划任务' },
  { id: 'integration', label: '系统集成' },
]

const limited = computed(() => form.draft?.globalDownloadLimit !== null)

onMounted(() => {
  if (!form.draft) void form.load()
})

function booleanValue(event: Event) { return (event.target as HTMLInputElement).checked }
function numberValue(event: Event, fallback: number) {
  const value = Number((event.target as HTMLInputElement).value)
  return Number.isFinite(value) ? value : fallback
}
function nullableNumber(event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}
function completionActionValue(event: Event) { return (event.target as HTMLSelectElement).value as DownloadPolicy['completionAction'] }

async function setFullSpeed() {
  if (!form.draft) return
  form.patch({ globalDownloadLimit: null, globalUploadLimit: null })
  try {
    await form.save()
    await enableFullSpeed()
    notice.value = '已切换为全速下载'
  } catch {}
}

function openLimitSpeed() { overlay.open({ type: 'limit-speed-settings' }) }
function openProxy() { overlay.open({ type: 'proxy-settings' }) }
function openAbout() { overlay.open({ type: 'about' }) }
function openSchedules() { overlay.open({ type: 'schedule-manager' }) }
function openVip() { overlay.open({ type: 'vip-overview' }) }
async function openPage(path: string) { overlay.close(); await router.push(path) }

async function save() {
  try {
    await form.save()
    notice.value = '设置已保存'
  } catch {}
}

async function restore() {
  try {
    const response = await restoreLimits()
    form.revision = response.revision
    form.base = response.policy
    form.draft = structuredClone(response.policy)
    notice.value = '已恢复保存的限速设置'
  } catch {}
}
</script>

<template>
  <section class="settings-window" role="dialog" aria-modal="true" aria-label="设置">
    <button class="settings-window-close" aria-label="关闭设置" @click="overlay.close"><X :size="16" :stroke-width="1.6" /></button>

    <aside class="settings-window-nav" aria-label="设置分类">
      <button v-for="item in navigation" :key="item.id" :class="{ active: activeSection === item.id }" @click="activeSection = item.id">{{ item.label }}</button>
      <span class="settings-window-nav-spacer" />
      <button class="settings-about-entry" @click="openAbout">关于迅雷</button>
    </aside>

    <main class="settings-window-main">
      <div v-if="form.loading" class="settings-window-state">正在加载下载策略…</div>
      <div v-else-if="form.error && !form.draft" class="settings-window-state is-error">
        <span>{{ form.error }}</span><button @click="form.load">重试</button>
      </div>
      <template v-else-if="form.draft">
        <section v-if="activeSection === 'basic'" class="settings-section">
          <h1>基本设置</h1>
          <h2>开机与启动</h2>
          <label class="settings-toggle-row"><input type="checkbox" :checked="form.draft.autoResumeUnfinished" @change="form.patch({ autoResumeUnfinished: booleanValue($event) })" />启动后自动开始未完成任务</label>
          <label class="settings-toggle-row"><input type="checkbox" :checked="form.draft.openOnCompleteDefault" @change="form.patch({ openOnCompleteDefault: booleanValue($event) })" />下载完成后默认打开文件</label>
          <label class="settings-toggle-row"><input type="checkbox" :checked="form.draft.idleDownload.enabled" @change="form.patch({ idleDownload: { ...form.draft!.idleDownload, enabled: booleanValue($event) } })" />空闲时自动下载</label>
          <label class="settings-toggle-row"><input type="checkbox" :checked="form.draft.idleDownload.pauseOnActivity" @change="form.patch({ idleDownload: { ...form.draft!.idleDownload, pauseOnActivity: booleanValue($event) } })" />检测到活动时暂停空闲下载</label>
          <label class="settings-toggle-row"><input type="checkbox" :checked="form.draft.autoMoveSlowTaskToTail" @change="form.patch({ autoMoveSlowTaskToTail: booleanValue($event) })" />低速任务自动移到队尾</label>

          <div class="settings-rule settings-mode-separator" />
          <h2>下载模式</h2>
          <label class="settings-radio-row"><input type="radio" name="download-mode" :checked="!limited" @change="setFullSpeed" />全速下载</label>
          <div class="settings-radio-action-row">
            <label class="settings-radio-row"><input type="radio" name="download-mode" :checked="limited" @change="openLimitSpeed" />限速下载</label>
            <button class="settings-inline-button" @click="openLimitSpeed">修改配置</button>
            <button v-if="limited" class="settings-text-button" @click="restore">恢复运行时限速</button>
          </div>

          <div class="settings-rule settings-first-section-divider" />
          <h1>下载设置</h1>
          <h2>目录与资源</h2>
          <label class="settings-field-row is-wide is-reference-row"><span>默认下载目录</span><input :value="form.draft.defaultDownloadPath" placeholder="请选择下载目录" @input="form.patch({ defaultDownloadPath: ($event.target as HTMLInputElement).value })" /></label>

          <div class="settings-rule settings-section-divider" />
          <h1>任务管理</h1>
          <h2>队列与并发</h2>
          <label class="settings-field-row"><span>同时下载最大任务数</span><input type="number" min="1" max="100" :value="form.draft.maxConcurrentTasks" @input="form.patch({ maxConcurrentTasks: Math.min(100, Math.max(1, Math.round(numberValue($event, 5)))) })" /></label>
        </section>

        <section v-else-if="activeSection === 'download'" class="settings-section">
          <h1>下载设置</h1>
          <h2>目录与资源</h2>
          <label class="settings-field-row is-wide"><span>默认下载目录</span><input :value="form.draft.defaultDownloadPath" placeholder="请选择下载目录" @input="form.patch({ defaultDownloadPath: ($event.target as HTMLInputElement).value })" /></label>
          <label class="settings-field-row"><span>同时下载最大任务数</span><input type="number" min="1" max="100" :value="form.draft.maxConcurrentTasks" @input="form.patch({ maxConcurrentTasks: Math.min(100, Math.max(1, Math.round(numberValue($event, 5)))) })" /></label>
          <label class="settings-field-row"><span>最大连接数</span><input type="number" min="1" max="10000" :value="form.draft.globalConnectionLimit ?? ''" placeholder="跟随引擎默认" @input="form.patch({ globalConnectionLimit: nullableNumber($event) })" /></label>

          <div class="settings-rule" />
          <h2>网络通道</h2>
          <label class="settings-toggle-row"><input type="checkbox" :checked="form.draft.p2pEnabled" @change="form.patch({ p2pEnabled: booleanValue($event) })" />启用 P2P 加速</label>
          <label class="settings-toggle-row"><input type="checkbox" :checked="form.draft.p2sEnabled" @change="form.patch({ p2sEnabled: booleanValue($event) })" />启用镜像 / P2S 加速</label>
          <div class="settings-sub-action"><span>代理模式：{{ form.draft.proxy.mode === 'direct' ? '不使用代理' : form.draft.proxy.mode.toUpperCase() }}</span><button class="settings-inline-button proxy-settings-trigger" @click="openProxy">代理设置</button></div>
        </section>

        <section v-else-if="activeSection === 'tasks'" class="settings-section">
          <h1>任务管理</h1>
          <h2>队列</h2>
          <label class="settings-toggle-row"><input type="checkbox" :checked="form.draft.autoMoveSlowTaskToTail" @change="form.patch({ autoMoveSlowTaskToTail: booleanValue($event) })" />低速任务自动移到队尾</label>
          <label class="settings-field-row"><span>低速判定阈值（B/s）</span><input type="number" min="0" :value="form.draft.slowTaskThresholdBytesPerSecond" @input="form.patch({ slowTaskThresholdBytesPerSecond: Math.max(0, Math.round(numberValue($event, 0))) })" /></label>
          <div class="settings-rule" />
          <h2>空闲下载</h2>
          <label class="settings-field-row"><span>空闲判定时间（秒）</span><input type="number" min="60" max="86400" :value="form.draft.idleDownload.idleAfterSeconds" @input="form.patch({ idleDownload: { ...form.draft!.idleDownload, idleAfterSeconds: Math.min(86400, Math.max(60, Math.round(numberValue($event, 900)))) } })" /></label>
          <label class="settings-toggle-row"><input type="checkbox" :checked="form.draft.idleDownload.pauseOnActivity" @change="form.patch({ idleDownload: { ...form.draft!.idleDownload, pauseOnActivity: booleanValue($event) } })" />检测到活动时暂停空闲下载</label>
        </section>

        <section v-else-if="activeSection === 'automation'" class="settings-section">
          <h1>计划任务</h1>
          <h2>定时与完成动作</h2>
          <label class="settings-field-row"><span>所有任务完成后</span><select :value="form.draft.completionAction" @change="form.patch({ completionAction: completionActionValue($event) })"><option value="none">不执行操作</option><option value="pause-all">暂停全部任务</option><option value="stop-engine">停止下载引擎</option><option value="suspend">系统睡眠</option><option value="poweroff">系统关机</option></select></label>
          <div class="settings-sub-action"><span>创建按星期和本地时间执行的下载计划</span><button class="settings-inline-button" @click="openSchedules">管理计划任务</button></div>
          <div class="settings-rule" />
          <h2>会员下载加速</h2>
          <div class="settings-sub-action"><span>查看账号、Peer ID 和任务级加速状态</span><button class="settings-inline-button" @click="openVip">查看加速状态</button></div>
        </section>

        <section v-else class="settings-section">
          <h1>系统集成</h1>
          <h2>协议接管与远程下载</h2>
          <div class="settings-sub-action"><span>管理浏览器接管、远程节点与配对凭据</span><button class="settings-inline-button" @click="openPage('/settings/integration')">打开系统集成</button></div>
          <div class="settings-rule" />
          <h2>下载诊断</h2>
          <div class="settings-sub-action"><span>运行引擎检查、查看脱敏事件并导出诊断包</span><button class="settings-inline-button" @click="openPage('/diagnostics')">打开下载诊断</button></div>
        </section>

        <footer v-if="form.dirty || form.error || notice" class="settings-window-savebar">
          <span v-if="form.error" class="settings-save-message is-error">{{ form.error }}</span>
          <span v-else-if="notice" class="settings-save-message">{{ notice }}</span>
          <button class="settings-save-button" :disabled="!form.dirty || form.saving" @click="save">{{ form.saving ? '保存中…' : '保存设置' }}</button>
        </footer>
      </template>
    </main>
  </section>
</template>
