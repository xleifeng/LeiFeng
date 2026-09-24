<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { Link2, MonitorSmartphone, Puzzle, ShieldCheck } from '@lucide/vue'
import type { CaptureClient } from '../../api/contracts/v2/integration'
import type { RemoteServerClient } from '../../api/contracts/v2/remote'
import { provisionDesktopCapture, queryCaptureClients, revokeCaptureClient, startCapturePairing } from '../../api/native-download/integration'
import { acceptRemotePairing, queryRemoteServerClients, revokeRemoteServerClient, startRemotePairing, stopRemotePairing } from '../../api/native-download/remote'

const capturePairing = ref<{ pairingId: string; code: string; expiresAt: number } | null>(null)
const remotePairing = ref<{ pairingId: string; code: string; expiresAt: number; serverFingerprint?: string | null } | null>(null)
const error = ref('')
const notice = ref('')
const busy = ref('')
const remoteForm = reactive({ name: '', endpoint: '', serverFingerprint: '', pairingId: '', code: '' })
const captureClients = useQuery<CaptureClient[]>({ queryKey: ['v2-capture-clients'], queryFn: queryCaptureClients, retry: 1 })
const remoteClients = useQuery<RemoteServerClient[]>({ queryKey: ['v2-remote-server-clients'], queryFn: queryRemoteServerClients, retry: 1 })

function fail(cause: unknown, fallback: string) { error.value = cause instanceof Error ? cause.message : fallback }
async function pairCapture() {
  busy.value = 'capture'; error.value = ''; notice.value = ''
  try { capturePairing.value = await startCapturePairing(); notice.value = '扩展配对码已生成'; await captureClients.refetch() } catch (cause) { fail(cause, '生成配对码失败') } finally { busy.value = '' }
}
async function configureDesktopCapture() {
  busy.value = 'desktop-capture'; error.value = ''; notice.value = ''
  try { const result = await provisionDesktopCapture(); notice.value = `桌面接管凭据已写入 ${result.configPath}；安装协议处理器后即可打开磁力、ED2K、迅雷链接和 torrent 文件`; await captureClients.refetch() } catch (cause) { fail(cause, '生成桌面接管凭据失败') } finally { busy.value = '' }
}
async function pairRemoteServer() {
  busy.value = 'remote-server'; error.value = ''; notice.value = ''
  try { remotePairing.value = await startRemotePairing(); notice.value = '远程设备配对窗口已开启'; await remoteClients.refetch() } catch (cause) { fail(cause, '生成远程配对码失败') } finally { busy.value = '' }
}
async function stopPairing() {
  if (!remotePairing.value) return
  await stopRemotePairing(remotePairing.value.pairingId)
  remotePairing.value = null
  notice.value = '远程配对窗口已关闭'
}
async function connectRemote() {
  busy.value = 'remote-client'; error.value = ''; notice.value = ''
  try {
    const node = await acceptRemotePairing({
      name: remoteForm.name.trim() || '远程下载设备',
      endpoint: remoteForm.endpoint.trim(),
      serverFingerprint: remoteForm.serverFingerprint.trim(),
      pairingId: remoteForm.pairingId.trim(),
      code: remoteForm.code.trim(),
      requestedPermissions: ['view', 'submit', 'control'],
    })
    notice.value = `已配对“${node.name}”，可前往远程下载查看任务`
    remoteForm.pairingId = ''; remoteForm.code = ''
  } catch (cause) { fail(cause, '远程节点配对失败') } finally { busy.value = '' }
}
async function revokeCapture(client: CaptureClient) { await revokeCaptureClient(client.id); await captureClients.refetch() }
async function revokeRemote(client: RemoteServerClient) { await revokeRemoteServerClient(client.id); await remoteClients.refetch() }
</script>

<template>
  <section class="settings-page replica-data-page">
    <header class="replica-page-header"><div><h1>系统集成</h1><p>浏览器接管与远程下载均需显式配对，不包含云盘同步</p></div></header>
    <p v-if="error" class="settings-error">{{ error }}</p><p v-if="notice" class="settings-notice">{{ notice }}</p>
    <div class="integration-grid">
      <section class="settings-card integration-card"><Puzzle :size="24" color="#226df5" /><h2>浏览器与桌面下载接管</h2><p>浏览器扩展使用一次性配对码；桌面凭据用于系统协议处理器接收磁力、ED2K、迅雷链接和 torrent 文件。两者只能提交下载，不会读取账号密码或私人空间。</p><div class="integration-actions"><button class="primary-button" :disabled="busy === 'capture'" @click="pairCapture">生成扩展配对码</button><button class="secondary-button" :disabled="busy === 'desktop-capture'" @click="configureDesktopCapture">生成桌面接管凭据</button></div><div v-if="capturePairing" class="integration-pairing"><strong>{{ capturePairing.code }}</strong><small>有效期至 {{ new Date(capturePairing.expiresAt).toLocaleTimeString('zh-CN') }}</small></div><div v-for="client in captureClients.data.value" :key="client.id" class="integration-client"><span>{{ client.name }} · {{ client.origin }}</span><button class="secondary-button" @click="revokeCapture(client)">撤销</button></div></section>
      <section class="settings-card integration-card"><ShieldCheck :size="24" color="#226df5" /><h2>允许其他设备连接</h2><p>本机配置 mTLS 监听证书后，可生成六位配对码供另一台设备连接。</p><div class="integration-actions"><button class="primary-button" :disabled="busy === 'remote-server'" @click="pairRemoteServer">开启配对窗口</button><button v-if="remotePairing" class="secondary-button" @click="stopPairing">停止配对</button></div><div v-if="remotePairing" class="integration-pairing"><strong>{{ remotePairing.code }}</strong><small>Pairing ID：{{ remotePairing.pairingId }}</small><small>服务端指纹：{{ remotePairing.serverFingerprint || '尚未配置远程监听证书' }}</small></div><div v-for="client in remoteClients.data.value" :key="client.id" class="integration-client"><span>{{ client.name }} · {{ client.permissions.join('、') }}</span><button class="secondary-button" @click="revokeRemote(client)">撤销</button></div></section>
      <section class="settings-card integration-card"><MonitorSmartphone :size="24" color="#226df5" /><h2>连接远程下载设备</h2><p>填写远端 HTTPS 地址、证书指纹和对方生成的配对信息。连接成功后可查询、开始、暂停和删除远端任务。</p><form class="integration-form" @submit.prevent="connectRemote"><label>设备名称<input v-model="remoteForm.name" placeholder="客厅下载机" /></label><label>HTTPS 地址<input v-model="remoteForm.endpoint" placeholder="https://192.168.1.10:17400" /></label><label>服务端证书 SHA-256 指纹<input v-model="remoteForm.serverFingerprint" placeholder="64 位十六进制" /></label><label>Pairing ID<input v-model="remoteForm.pairingId" /></label><label>六位配对码<input v-model="remoteForm.code" inputmode="numeric" maxlength="6" /></label><button class="primary-button" :disabled="busy === 'remote-client' || !remoteForm.endpoint || !remoteForm.serverFingerprint || !remoteForm.pairingId || !remoteForm.code">{{ busy === 'remote-client' ? '正在配对…' : '连接设备' }}</button></form></section>
      <section class="settings-card integration-card"><Link2 :size="24" color="#226df5" /><h2>协议与安全边界</h2><p>WebUI 可创建 HTTP、HTTPS、FTP、磁力、BT、ED2K 和迅雷链接下载。远程节点只交换任务控制信息，不同步本机文件、私人空间或云盘内容。</p><p>FTP、代理、账号令牌与证书由 daemon 分区保存；诊断导出会进行脱敏。</p></section>
    </div>
  </section>
</template>
