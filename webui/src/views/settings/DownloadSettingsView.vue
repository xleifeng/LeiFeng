<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDownloadPolicyFormStore } from '../../stores/download-policy-form'
import { enableFullSpeed, restoreLimits, testProxy } from '../../api/native-download/policies'
import BasicDownloadSettings from '../../components/settings/BasicDownloadSettings.vue'
import SpeedSettings from '../../components/settings/SpeedSettings.vue'
import NetworkSettings from '../../components/settings/NetworkSettings.vue'
import AutomationSettings from '../../components/settings/AutomationSettings.vue'

const form = useDownloadPolicyFormStore(); const notice = ref(''); const proxySecret = ref<Record<string, unknown> | undefined>(undefined)
onMounted(() => form.load())
function patch(value: Record<string, unknown>) { form.patch(value as never) }
function setProxySecret(value: Record<string, unknown>) { proxySecret.value = value }
async function save() { try { await form.save(proxySecret.value); notice.value = '已保存并下发'; proxySecret.value = undefined } catch {} }
async function fullSpeed() { await enableFullSpeed(); notice.value = '已临时切换为全速下载' }
async function restore() { await restoreLimits(); notice.value = '已恢复限速' }
async function proxyTest() { if (!form.draft) return; try { const result = await testProxy({ ...form.draft.proxy, ...(proxySecret.value || {}) }); notice.value = result && (result as { reachable?: boolean }).reachable ? '代理连接成功' : '代理不可用' } catch (error) { notice.value = error instanceof Error ? error.message : '代理测试失败' } }
</script>
<template>
  <div class="settings-page"><div class="settings-page-heading"><div><h1>下载设置</h1><p>策略保存后由 daemon 逐项应用；未验证的 native 能力不会被伪装成已生效。</p></div><div class="settings-page-actions"><span v-if="notice" class="settings-notice">{{ notice }}</span><button class="primary-button" :disabled="!form.dirty || form.saving" @click="save">{{ form.saving ? '保存中…' : '保存设置' }}</button></div></div><div v-if="form.error" class="settings-error">{{ form.error }}</div><div v-if="form.loading" class="settings-loading">正在加载下载策略…</div><template v-else-if="form.draft"><BasicDownloadSettings :model-value="form.draft" @update:model-value="patch" /><SpeedSettings :model-value="form.draft" @update:model-value="patch" @full-speed="fullSpeed" @restore="restore" /><NetworkSettings :model-value="form.draft" @update:model-value="patch" @proxy-secret="setProxySecret" @test-proxy="proxyTest" /><AutomationSettings :model-value="form.draft" @update:model-value="patch" /></template></div>
</template>
