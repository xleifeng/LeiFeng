<script setup lang="ts">
import { computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getAccountStatus, logoutAccount } from '../../api/native-download/account'
import { useOverlayStore } from '../../stores/overlay'
import AccountStatusPanel from './AccountStatusPanel.vue'
import LoginDialog from './LoginDialog.vue'
const overlay = useOverlayStore(); const queryClient = useQueryClient()
const query = useQuery({ queryKey: ['v2-account-status'], queryFn: () => getAccountStatus(), refetchInterval: 15000, retry: 1 })
const loggedIn = computed(() => !!query.data.value?.account.valid)
async function logout() { await logoutAccount().catch(() => {}); await queryClient.invalidateQueries({ queryKey: ['v2-account-status'] }); await queryClient.invalidateQueries({ queryKey: ['v2-bootstrap'] }); overlay.close() }
</script>
<template><div class="overlay-backdrop" @click.self="overlay.close"><section class="native-dialog account-dialog" role="dialog" aria-modal="true"><header class="dialog-header"><div><span class="dialog-eyebrow">迅雷账号</span><h2>{{ loggedIn ? '账号与加速' : '登录账号' }}</h2></div><button class="dialog-close" aria-label="关闭" @click="overlay.close">×</button></header><div class="dialog-body"><AccountStatusPanel v-if="query.data.value && loggedIn" :status="query.data.value" @logout="logout" @refresh="query.refetch" /><LoginDialog v-else @logged-in="query.refetch" @close="overlay.close" /></div></section></div></template>
