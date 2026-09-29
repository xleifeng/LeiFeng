<script setup lang="ts">
import { computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getAccountStatus, logoutAccount } from '../../api/native-download/account'
import { useOverlayStore } from '../../stores/overlay'
import ModalShell from '../ModalShell.vue'
import AccountStatusPanel from './AccountStatusPanel.vue'
import LoginDialog from './LoginDialog.vue'
const overlay = useOverlayStore(); const queryClient = useQueryClient()
const query = useQuery({ queryKey: ['v2-account-status'], queryFn: () => getAccountStatus(), refetchInterval: 15000, retry: 1 })
const loggedIn = computed(() => !!query.data.value?.account.valid)
async function logout() { await logoutAccount().catch(() => {}); await queryClient.invalidateQueries({ queryKey: ['v2-account-status'] }); await queryClient.invalidateQueries({ queryKey: ['v2-bootstrap'] }); overlay.close() }
</script>
<template>
  <ModalShell :title="loggedIn ? '账号与加速' : '登录账号'" @close="overlay.close">
    <AccountStatusPanel v-if="query.data.value && loggedIn" :status="query.data.value" @logout="logout" @refresh="query.refetch" />
    <LoginDialog v-else @logged-in="query.refetch" @close="overlay.close" />
  </ModalShell>
</template>
