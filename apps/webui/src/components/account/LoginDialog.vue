<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { toDataURL } from 'qrcode'
import { cancelAccountLogin, getAccountStatus, startAccountLogin } from '../../api/native-download/account'
const emit = defineEmits<{ loggedIn: []; close: [] }>()
type LoginPayload = { verificationUrl?: string | null; userCode?: string | null; expiresIn?: number; interval?: number }
const login = ref<LoginPayload | null>(null)
const qrDataUrl = ref(''); const qrError = ref('')
const error = ref(''); const starting = ref(false)
const statusQuery = useQuery({ queryKey: ['v2-account-status'], queryFn: () => getAccountStatus(), refetchInterval: computed(() => login.value ? 2000 : false), retry: 1 })
const flow = computed(() => statusQuery.data.value?.loginFlow.state || 'idle')
watch(() => statusQuery.data.value?.account.valid, (valid) => { if (valid) emit('loggedIn') })
async function renderQr(url: string | null | undefined) {
  qrDataUrl.value = ''
  qrError.value = ''
  if (!url) return
  try {
    qrDataUrl.value = await toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 220 })
  } catch (cause) {
    qrError.value = cause instanceof Error ? cause.message : '二维码生成失败'
  }
}
async function start() {
  starting.value = true; error.value = ''; qrError.value = ''
  try {
    if (login.value && (flow.value === 'awaiting-scan' || flow.value === 'completing')) await cancelAccountLogin().catch(() => {})
    const payload = await startAccountLogin()
    login.value = payload
    await renderQr(payload.verificationUrl)
    await statusQuery.refetch()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '登录启动失败' } finally { starting.value = false }
}
async function cancel() { await cancelAccountLogin().catch(() => {}); login.value = null; qrDataUrl.value = ''; qrError.value = ''; await statusQuery.refetch() }
onBeforeUnmount(() => { if (flow.value === 'awaiting-scan' || flow.value === 'completing') cancelAccountLogin().catch(() => {}) })
</script>
<template>
  <div class="account-login-panel">
    <div v-if="!login" class="account-login-empty">
      <div class="account-login-icon">⌁</div><h3>登录迅雷账号</h3>
      <p>登录后可使用会员下载加速；账号凭据只保存在 daemon 钱包内。</p>
      <button class="primary-button" :disabled="starting" @click="start">{{ starting ? '正在准备…' : '扫码登录' }}</button>
    </div>
    <div v-else class="account-login-active">
      <span class="dialog-eyebrow">设备登录</span><h3>请使用迅雷 App 扫码</h3>
      <div v-if="qrDataUrl" class="login-qr-card">
        <img class="login-qr" :src="qrDataUrl" alt="迅雷登录二维码" />
        <span>二维码有效期内请完成扫码</span>
      </div>
      <div v-else-if="login.verificationUrl" class="login-qr-loading" aria-live="polite">正在生成二维码…</div>
      <div v-else class="login-qr-loading">服务端未返回二维码链接，请使用验证码登录</div>
      <a v-if="login.verificationUrl" class="login-url" :href="login.verificationUrl" target="_blank" rel="noreferrer">打开验证页面</a>
      <code v-if="login.userCode">验证码：{{ login.userCode }}</code>
      <p v-if="qrError" class="settings-error">二维码生成失败，请点击“打开验证页面”：{{ qrError }}</p>
      <p v-if="flow === 'awaiting-scan'">等待扫码确认…</p><p v-else-if="flow === 'completing'">正在完成登录…</p>
      <p v-else-if="flow === 'failed'" class="settings-error">登录失败：{{ statusQuery.data.value?.loginFlow.problemCode === 'register-upstream' ? '会话注册失败' : statusQuery.data.value?.loginFlow.problemCode === 'profile-upstream' ? '账号资料获取失败' : statusQuery.data.value?.loginFlow.problemCode === 'completion-upstream' ? '登录信息保存失败' : statusQuery.data.value?.loginFlow.problemCode || '上游服务错误' }}</p>
      <div class="modal-actions"><button class="secondary-button" @click="cancel">取消</button><button class="primary-button" @click="start">刷新二维码</button></div>
    </div>
    <p v-if="error" class="settings-error">{{ error }}</p><p v-if="statusQuery.isError.value" class="settings-error">账号状态暂不可用</p>
  </div>
</template>
