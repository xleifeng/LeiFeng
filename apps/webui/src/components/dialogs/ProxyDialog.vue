<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
import { testProxy } from '../../api/native-download/policies'
import { useDownloadPolicyFormStore } from '../../stores/download-policy-form'
import { useOverlayStore } from '../../stores/overlay'

const form = useDownloadPolicyFormStore()
const overlay = useOverlayStore()
const proxyName = ref('')
const host = ref('')
const port = ref(80)
const mode = ref<'http' | 'socks5'>('http')
const username = ref('')
const password = ref('')
const testing = ref(false)
const notice = ref('')
const errorMessage = ref('')

function hydrate() {
  const proxy = form.draft?.proxy
  if (!proxy) return
  host.value = proxy.host
  port.value = proxy.port ?? 80
  mode.value = proxy.mode === 'socks5' ? 'socks5' : 'http'
  username.value = proxy.username
}

onMounted(async () => {
  if (!form.draft) await form.load()
  hydrate()
})

function backToSettings() { overlay.open({ type: 'settings' }) }
function candidate() {
  return {
    mode: mode.value,
    host: host.value.trim(),
    port: Math.min(65535, Math.max(1, Math.round(port.value || 80))),
    username: username.value,
    passwordRef: form.draft?.proxy.passwordRef ?? null,
    ...(password.value ? { password: password.value } : {}),
  }
}
function validate() {
  if (!host.value.trim()) return '请输入代理服务器地址'
  if (!Number.isFinite(port.value) || port.value < 1 || port.value > 65535) return '端口应为 1–65535'
  return ''
}

async function runTest() {
  errorMessage.value = validate()
  notice.value = ''
  if (errorMessage.value) return
  testing.value = true
  try {
    const result = await testProxy(candidate()) as { reachable?: boolean; ok?: boolean; elapsedMs?: number }
    notice.value = result.reachable || result.ok ? `代理连接成功${result.elapsedMs === undefined ? '' : `（${result.elapsedMs}ms）`}` : '代理不可用'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '代理测试失败'
  } finally {
    testing.value = false
  }
}

async function confirm() {
  errorMessage.value = validate()
  notice.value = ''
  if (errorMessage.value || !form.draft) return
  form.patch({ proxy: { ...form.draft.proxy, mode: mode.value, host: host.value.trim(), port: Math.round(port.value), username: username.value } })
  const proxySecret = password.value ? { action: 'replace', username: username.value, password: password.value } : undefined
  try {
    await form.save(proxySecret)
    backToSettings()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '代理设置保存失败'
  }
}
</script>

<template>
  <mdui-dialog open close-on-overlay-click close-on-esc role="dialog" aria-modal="true" aria-label="代理设置" class="proxy-dialog" @closed="backToSettings">
    <div slot="headline" class="modal-shell-headline">
      <span class="modal-shell-title">添加代理/编辑代理</span>
      <mdui-button-icon aria-label="关闭代理设置" @click="backToSettings"><X :size="16" :stroke-width="1.6" /></mdui-button-icon>
    </div>

    <label class="proxy-field is-name"><span>代理名称</span><mdui-text-field variant="outlined" :value="proxyName" placeholder="请输入" @input="proxyName = ($event.target as HTMLInputElement).value"></mdui-text-field></label>
    <label class="proxy-field is-host"><span>服务器</span><mdui-text-field variant="outlined" :value="host" placeholder="请输入" @input="host = ($event.target as HTMLInputElement).value"></mdui-text-field></label>
    <label class="proxy-field is-port"><span>端口</span><mdui-text-field variant="outlined" type="number" min="1" max="65535" :value="String(port)" @input="port = Number(($event.target as HTMLInputElement).value)"></mdui-text-field></label>
    <fieldset class="proxy-type"><legend>类型</legend><div class="proxy-type-options"><label><mdui-radio :checked="mode === 'http'" @change="mode = 'http'"></mdui-radio>HTTP</label><label><mdui-radio :checked="mode === 'socks5'" @change="mode = 'socks5'"></mdui-radio>SOCKS5</label></div></fieldset>
    <div class="proxy-auth"><span>验证</span><mdui-text-field variant="outlined" :value="username" autocomplete="username" placeholder="请输入" aria-label="代理用户名" @input="username = ($event.target as HTMLInputElement).value"></mdui-text-field><mdui-text-field variant="outlined" type="password" :value="password" autocomplete="new-password" placeholder="请输入" aria-label="代理密码" @input="password = ($event.target as HTMLInputElement).value"></mdui-text-field><mdui-button variant="tonal" :disabled="testing" @click="runTest">{{ testing ? '测试中' : '测试' }}</mdui-button></div>

    <p v-if="errorMessage" class="subdialog-error">{{ errorMessage }}</p>
    <p v-else-if="notice" class="subdialog-notice">{{ notice }}</p>
    <div slot="action" class="modal-shell-footer">
      <mdui-button variant="tonal" class="secondary-button" @click="backToSettings">取消</mdui-button>
      <mdui-button variant="filled" class="primary-button" :disabled="form.saving" @click="confirm">{{ form.saving ? '保存中…' : '确认' }}</mdui-button>
    </div>
  </mdui-dialog>
</template>
