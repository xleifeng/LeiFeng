<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getAccountStatus } from '../../api/native-download/account'
import { getVipGlobalState } from '../../api/native-download/vip'
import { useOverlayStore } from '../../stores/overlay'
import ModalShell from '../ModalShell.vue'

const overlay = useOverlayStore()
const globalState = useQuery({ queryKey: ['v2-vip-global'], queryFn: getVipGlobalState, refetchInterval: 3000, retry: 1 })
const account = useQuery({ queryKey: ['v2-account-status'], queryFn: () => getAccountStatus(false), retry: 1 })
function login() { overlay.open({ type: 'account' }) }
const memberLabel = computed(() => {
  const state = globalState.data.value
  const level = account.data.value?.account.vipLevel || state?.vipLevel || 0
  if (state?.isSuperVip) return `超级会员 Lv.${level}`
  if (state?.isPlatinumVip) return `白金会员 Lv.${level}`
  if (state?.isPanVip) return `网盘会员 Lv.${level}`
  return state?.isVip ? `迅雷会员 Lv.${level}` : '迅雷会员加速'
})
const channelLabel = computed(() => {
  const state = globalState.data.value
  if (state?.isDownloadVip) return '下载会员权益已具备'
  if (state?.isPanVip) return '网盘权益不含下载加速'
  return state?.featureCapabilities.superChannel ? '需超级或白金会员' : '不可用'
})
</script>

<template>
  <ModalShell title="会员下载加速" @close="overlay.close">
    <div class="vip-overview-hero"><span class="vip-overview-mark">VIP</span><div><strong>{{ memberLabel }}</strong><p>{{ globalState.data.value?.availability === 'available' ? '账号与会员加速前置条件已就绪' : globalState.data.value?.availability === 'not-vip' ? '当前账号没有下载会员权益' : '登录后才能请求会员加速' }}</p></div></div>
    <div class="vip-overview-grid">
      <div><span>账号会话</span><strong>{{ globalState.data.value?.accountReady ? '已连接' : '待登录' }}</strong></div>
      <div><span>会员身份</span><strong>{{ globalState.data.value?.isVip ? '有效' : '不可用' }}</strong></div>
      <div><span>SDK Peer ID</span><strong>{{ globalState.data.value?.peerIdReady ? '已就绪' : '等待中' }}</strong></div>
      <div><span>加速管理器</span><strong>{{ globalState.data.value?.enabled ? '已启用' : '已关闭' }}</strong></div>
      <div><span>超级通道</span><strong>{{ channelLabel }}</strong></div>
      <div><span>限时试用</span><strong>{{ globalState.data.value?.featureCapabilities.speedTrial ? '可用' : '未接入促销流程' }}</strong></div>
    </div>
    <p class="vip-overview-note">每个任务的实际状态和 VIP 接收字节在“任务详情 → 加速”中查看。只有观察到 VIP 字节增长才标记为实际生效；证书注入成功会显示为“加速已开启”。</p>
    <template #footer><button v-if="!globalState.data.value?.accountReady" class="primary-button" @click="login">登录迅雷账号</button><button class="secondary-button" @click="overlay.close">关闭</button></template>
  </ModalShell>
</template>
