<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { KeyRound, ShieldCheck } from '@lucide/vue'
import { useQueryClient } from '@tanstack/vue-query'
import { getBootstrapV2 } from '../../api/native-download/bootstrap'
import { clearRpcSecret, RPC_AUTH_REQUIRED_EVENT, RpcProblemError, setRpcSecret } from '../../api/native-download/client'

const queryClient = useQueryClient()
const open = ref(false)
const secret = ref('')
const remember = ref(true)
const pending = ref(false)
const error = ref('')
const input = ref<HTMLInputElement | null>(null)

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
  <!-- 鉴权墙：不可经遮罩/Esc 关闭（必须输入密钥），故不带 close-on-* -->
  <mdui-dialog v-if="open" open role="dialog" aria-modal="true" aria-labelledby="connection-secret-title" class="connection-secret-dialog">
    <div class="connection-secret-body">
      <div class="connection-secret-hero">
        <div class="connection-secret-icon"><KeyRound :size="25" /></div>
        <div>
          <h2 id="connection-secret-title">连接到下载服务</h2>
          <p>此服务已启用访问保护，输入密钥后即可继续使用。</p>
        </div>
      </div>
      <form class="connection-secret-form" @submit.prevent="connect">
        <label for="rpc-secret">RPC 访问密钥</label>
        <mdui-text-field id="rpc-secret" ref="input" variant="outlined" type="password" toggle-password autocomplete="current-password" spellcheck="false" placeholder="粘贴密钥" :disabled="pending" :value="secret" @input="secret = ($event.target as HTMLInputElement).value" @keyup.enter="connect"></mdui-text-field>
        <p v-if="error" class="connection-secret-error" role="alert">{{ error }}</p>
        <label class="connection-secret-remember">
          <mdui-checkbox :checked="remember" @change="remember = $event.target.checked" :disabled="pending" ></mdui-checkbox>
          <span>记住此浏览器</span>
        </label>
        <mdui-button variant="filled" class="primary-button connection-secret-submit" :disabled="pending" @click="connect">
          <ShieldCheck :size="17" />{{ pending ? '正在验证…' : '验证并连接' }}
        </mdui-button>
      </form>
      <p class="connection-secret-help">密钥仅保存在此浏览器。可在服务主机运行 <code>cat ~/.local/state/leifeng/rpc-secret</code> 查看。</p>
    </div>
  </mdui-dialog>
</template>
