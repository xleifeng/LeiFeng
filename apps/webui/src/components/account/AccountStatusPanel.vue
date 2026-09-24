<script setup lang="ts">
import { computed } from 'vue'
import type { AccountStatus } from '../../api/contracts/v2/account'
const props = defineProps<{ status: AccountStatus }>()
defineEmits<{ logout: []; refresh: [] }>()
const memberLabel = computed(() => {
  const account = props.status.account
  if (account.isSuperVip) return `超级会员 Lv.${account.vipLevel}`
  if (account.isPlatinumVip) return `白金会员 Lv.${account.vipLevel}`
  if (account.isPanVip) return `网盘会员 Lv.${account.vipLevel}`
  return account.isVip ? `迅雷 VIP Lv.${account.vipLevel}` : '迅雷账号'
})
const memberType = computed(() => {
  const account = props.status.account
  if (account.isSuperVip) return '超级会员'
  if (account.isPlatinumVip) return '白金会员'
  if (account.isPanVip) return '网盘会员'
  return account.isVip ? `类型 ${account.vipType}` : '普通用户'
})
</script>
<template>
  <div class="account-status-panel">
    <div class="account-status-hero"><span class="account-avatar">{{ status.account.isVip ? 'V' : 'T' }}</span><div><strong>{{ memberLabel }}</strong><p>{{ status.account.valid ? '账号已连接' : '账号不可用' }}</p></div></div>
    <dl class="account-status-grid"><div><dt>会员类型</dt><dd>{{ memberType }}</dd></div><div><dt>凭据刷新</dt><dd>{{ status.credential.refreshTokenPresent ? '已配置' : '未配置' }}</dd></div><div><dt>会话注册</dt><dd>{{ status.session.registered ? '已注册' : '未注册' }}</dd></div><div><dt>引擎通知</dt><dd>{{ status.engine.notified ? '已通知' : '待通知' }}</dd></div></dl>
    <p v-if="status.session.problemCode || status.engine.problemCode" class="settings-error">{{ status.session.problemCode || status.engine.problemCode }}</p>
    <footer class="modal-actions"><button class="secondary-button" @click="$emit('refresh')">刷新状态</button><button class="primary-button" @click="$emit('logout')">退出登录</button></footer>
  </div>
</template>
