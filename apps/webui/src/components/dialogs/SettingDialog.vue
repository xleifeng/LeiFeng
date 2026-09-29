<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import type { DownloadPolicy } from '../../api/contracts/v2/policies'
import { enableFullSpeed, restoreLimits } from '../../api/native-download/policies'
import { getDaemonStatus, restartDaemon } from '../../api/native-download/daemon-admin'
import { useDownloadPolicyFormStore } from '../../stores/download-policy-form'
import { useOverlayStore } from '../../stores/overlay'
import { usePluginManagerStore } from '../../stores/plugin-manager'
import { useUiCapabilitiesStore } from '../../stores/ui-capabilities'
import { settingSectionContributions } from '../../app/plugins'

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}
function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h} 小时 ${m} 分` : m > 0 ? `${m} 分 ${s % 60} 秒` : `${s} 秒`
}

// P6：核心分区 id 集（builtin 贡献）——内容区分支判断用（核心走内联模板，插件走 component）
type Section = 'basic' | 'download' | 'tasks' | 'automation' | 'integration' | 'plugin-manager' | 'daemon-admin'

const form = useDownloadPolicyFormStore()
const overlay = useOverlayStore()
const router = useRouter()
const capabilities = useUiCapabilitiesStore()
const pluginManager = usePluginManagerStore()
const activeSection = ref<Section | string>('basic')
const notice = ref('')

// P6：核心分区已贡献化（builtin 插件经 registerFrontendPlugin），本组件只消费注册表派生流
const visibleNavigation = computed(() => settingSectionContributions.value.filter((item) => !item.capability || capabilities.enabled(item.capability)))

// activeSection 命中插件贡献分区时（id 非核心枚举），内容区渲染其 component；
// builtin 贡献的核心 6 分区无 component，须排除在本分支外（否则落「未提供内容组件」空态）
const coreSectionIds: readonly string[] = ['basic', 'download', 'tasks', 'automation', 'integration', 'plugin-manager', 'daemon-admin']
const activePluginSection = computed(() => coreSectionIds.includes(activeSection.value) ? undefined : settingSectionContributions.value.find((section) => section.id === activeSection.value))

watch(activeSection, (section) => {
  // 插件管理分区的数据面独立于下载策略 form：进入即拉取（幂等，失败可重试）
  if (section === 'plugin-manager' && !pluginManager.plugins.length) void pluginManager.load()
})

async function togglePlugin(event: Event) {
  const input = event.target as HTMLInputElement
  const ok = await pluginManager.toggle(input.dataset.pluginId ?? '', input.checked)
  // 状态未变时 Vue 不 patch :checked，失败路径须手动回滚 DOM
  if (!ok) input.checked = !input.checked
}

const limited = computed(() => form.draft?.globalDownloadLimit !== null)

// 守护进程分区：状态 5s 轮询（分区进入才挂 query——useQuery 在 setup 顶层无条件执行，
// 但 queryKey 稳定 + refetchInterval 只在文档可见时跑，开销可忽略；重启用独立 pending 态）
const daemonStatusQuery = useQuery({ queryKey: ['v2-daemon-status'], queryFn: getDaemonStatus, refetchInterval: 5000, retry: 1 })
const daemonRestarting = ref(false)
const daemonNotice = ref('')
async function restartDaemonProcess() {
  if (!window.confirm('将整体重启 daemon 进程（含下载引擎与 Web API），页面会短暂失联后自动恢复。继续吗？')) return
  daemonRestarting.value = true
  daemonNotice.value = ''
  try {
    await restartDaemon()
    daemonNotice.value = '重启请求已发出，daemon 正在退出并等待守护脚本拉起…'
  } catch (cause) {
    daemonNotice.value = cause instanceof Error ? cause.message : '重启请求失败'
    daemonRestarting.value = false
  }
}

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
      <button v-for="item in visibleNavigation" :key="item.id" :class="{ active: activeSection === item.id }" @click="activeSection = item.id">{{ item.label }}</button>
      <span class="settings-window-nav-spacer" />
      <button class="settings-about-entry" @click="openAbout">关于 Leifeng</button>
    </aside>

    <main class="settings-window-main">
      <!-- 插件管理分区独立于下载策略 form（数据面不同，form 加载失败不影响本分区） -->
      <section v-if="activeSection === 'plugin-manager'" class="settings-section plugin-manager-section">
        <h1>插件管理</h1>
        <h2>daemon 装配插件</h2>
        <p v-if="pluginManager.notice" class="plugin-manager-message">{{ pluginManager.notice }} <button class="settings-text-button" :disabled="daemonRestarting" @click="restartDaemonProcess">{{ daemonRestarting ? '重启中…' : '立即重启' }}</button></p>
        <p v-else-if="pluginManager.error" class="plugin-manager-message is-error">{{ pluginManager.error }} <button class="settings-text-button" @click="pluginManager.load">重试</button></p>
        <div v-if="pluginManager.loading" class="settings-window-state">正在加载插件列表…</div>
        <template v-else-if="pluginManager.plugins.length">
          <label v-for="plugin in pluginManager.plugins" :key="plugin.id" class="settings-toggle-row plugin-manager-row" :class="{ 'is-locked': plugin.id === 'runtime-config' }">
            <input
              type="checkbox"
              :checked="plugin.enabled"
              :disabled="plugin.id === 'runtime-config' || pluginManager.pendingId !== ''"
              :data-plugin-id="plugin.id"
              :title="plugin.id === 'runtime-config' ? '基础插件，不可禁用' : undefined"
              @change="togglePlugin"
            />
            <span class="plugin-manager-label">
              <span class="plugin-manager-id">{{ plugin.id }}</span>
              <span class="plugin-manager-provides">
                提供 {{ plugin.provides.join(' / ') || '—' }}
                <template v-if="plugin.defaultEnabled === false && plugin.enabled">（默认关，已显式启用）</template>
                <template v-else-if="plugin.defaultEnabled === false">（默认关）</template>
                <template v-else-if="plugin.explicit === true">（已显式启用）</template>
                <template v-else-if="plugin.explicit === false">（已显式禁用）</template>
              </span>
            </span>
          </label>
        </template>
      </section>

      <!-- 守护进程分区：daemon 状态实时快照 + 整体重启（daemon-admin 插件面） -->
      <section v-else-if="activeSection === 'daemon-admin'" class="settings-section daemon-admin-section">
        <h1>守护进程</h1>
        <h2>运行状态</h2>
        <div v-if="daemonStatusQuery.isPending.value" class="settings-window-state">正在读取 daemon 状态…</div>
        <div v-else-if="daemonStatusQuery.isError.value" class="settings-window-state is-error">
          <span>{{ daemonStatusQuery.error.value?.message || '状态不可用' }}</span>
          <button @click="daemonStatusQuery.refetch()">重试</button>
        </div>
        <dl v-else-if="daemonStatusQuery.data.value" class="daemon-admin-grid">
          <div><dt>PID</dt><dd>{{ daemonStatusQuery.data.value.pid }}</dd></div>
          <div><dt>版本</dt><dd>{{ daemonStatusQuery.data.value.version }}</dd></div>
          <div><dt>Profile</dt><dd>{{ daemonStatusQuery.data.value.profile || '—' }}</dd></div>
          <div><dt>运行时长</dt><dd>{{ formatUptime(daemonStatusQuery.data.value.uptimeMs) }}</dd></div>
          <div><dt>内存</dt><dd>{{ formatBytes(daemonStatusQuery.data.value.memory.rssBytes) }}（堆 {{ formatBytes(daemonStatusQuery.data.value.memory.heapUsedBytes) }}）</dd></div>
          <div>
            <dt>下载引擎</dt>
            <dd>
              <template v-if="daemonStatusQuery.data.value.engine">
                {{ daemonStatusQuery.data.value.engine.sdkReady ? '就绪' : '未就绪' }}
                · PID {{ daemonStatusQuery.data.value.engine.enginePid ?? '—' }}
                · 代际 {{ daemonStatusQuery.data.value.engine.generation }}
                · 重启 {{ daemonStatusQuery.data.value.engine.restarts }} 次
              </template>
              <template v-else>未装配内核</template>
            </dd>
          </div>
        </dl>
        <p v-if="daemonStatusQuery.data.value?.restartPending" class="plugin-manager-message">重启已请求，等待进程退出…</p>
        <p v-if="daemonNotice" class="plugin-manager-message">{{ daemonNotice }}</p>
        <h2>重启</h2>
        <p class="settings-hint">整体重启 daemon 进程：插件开关等需要重装配的变更在此生效。进程退出后由守护脚本拉起新进程，页面会短暂失联。</p>
        <button class="secondary-button" :disabled="daemonRestarting || daemonStatusQuery.data.value?.restartPending" @click="restartDaemonProcess">{{ daemonRestarting ? '重启中…' : '重启 daemon' }}</button>
      </section>

      <section v-else-if="activePluginSection" :key="activePluginSection.id" class="settings-section settings-plugin-section">
        <h1>{{ activePluginSection.label }}</h1>
        <component :is="activePluginSection.component" v-if="activePluginSection.component" />
        <p v-else class="plugin-manager-message">该插件分区未提供内容组件</p>
      </section>

      <div v-else-if="form.loading" class="settings-window-state">正在加载下载策略…</div>
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

        <section v-else-if="activeSection === 'integration'" class="settings-section">
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
