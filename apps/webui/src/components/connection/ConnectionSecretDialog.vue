<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Eye, EyeOff, KeyRound, ShieldCheck } from '@lucide/vue'
import { useQueryClient } from '@tanstack/vue-query'
import { getBootstrapV2 } from '../../api/native-download/bootstrap'
import { clearRpcSecret, RPC_AUTH_REQUIRED_EVENT, RpcProblemError, setRpcSecret } from '../../api/native-download/client'

const queryClient = useQueryClient()
const open = ref(false)
const secret = ref('')
const remember = ref(true)
const visible = ref(false)
const pending = ref(false)
const error = ref('')
const input = ref<HTMLInputElement | null>(null)
const inputType = computed(() => visible.value ? 'text' : 'password')

function focusInput() { nextTick(() => input.value?.focus()) }
function requireSecret() {
  open.value = true
  if (!pending.value) error.value = ''
  focusInput()
}

async function connect() {
  const value = secret.value.trim()
  if (!value) { error.value = '请输入 RPC 访问密钥'; focusInput(); return }
  pending.value = true
  error.value = ''
  setRpcSecret(value, remember.value)
  try {
    await getBootstrapV2()
    open.value = false
    secret.value = ''
    await queryClient.invalidateQueries()
  } catch (cause) {
    clearRpcSecret()
    error.value = cause instanceof RpcProblemError && (cause.code === '1' || /unauthorized|未授权/i.test(cause.message))
      ? '密钥无效，请检查后重试'
      : '暂时无法连接下载服务，请确认服务正在运行'
  } finally {
    pending.value = false
    if (open.value) focusInput()
  }
}

onMounted(() => window.addEventListener(RPC_AUTH_REQUIRED_EVENT, requireSecret))
onBeforeUnmount(() => window.removeEventListener(RPC_AUTH_REQUIRED_EVENT, requireSecret))
</script>

<template>
  <div v-if="open" class="modal-layer connection-secret-layer" role="presentation">
    <section class="modal-card connection-secret-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-secret-title">
      <div class="connection-secret-hero">
        <div class="connection-secret-icon"><KeyRound :size="25" /></div>
        <div>
          <h2 id="connection-secret-title">连接到下载服务</h2>
          <p>此服务已启用访问保护，输入密钥后即可继续使用。</p>
        </div>
      </div>
      <form class="connection-secret-form" @submit.prevent="connect">
        <label for="rpc-secret">RPC 访问密钥</label>
        <div class="connection-secret-input" :class="{ 'has-error': error }">
          <input id="rpc-secret" ref="input" v-model="secret" :type="inputType" autocomplete="current-password" spellcheck="false" placeholder="粘贴密钥" :disabled="pending" />
          <button type="button" :aria-label="visible ? '隐藏密钥' : '显示密钥'" @click="visible = !visible">
            <EyeOff v-if="visible" :size="18" /><Eye v-else :size="18" />
          </button>
        </div>
        <p v-if="error" class="connection-secret-error" role="alert">{{ error }}</p>
        <label class="connection-secret-remember">
          <input v-model="remember" type="checkbox" :disabled="pending" />
          <span>记住此浏览器</span>
        </label>
        <button class="primary-button connection-secret-submit" type="submit" :disabled="pending">
          <ShieldCheck :size="17" />{{ pending ? '正在验证…' : '验证并连接' }}
        </button>
      </form>
      <p class="connection-secret-help">密钥仅保存在此浏览器。可在服务主机运行 <code>cat ~/.local/state/tlei/rpc-secret</code> 查看。</p>
    </section>
  </div>
</template>
