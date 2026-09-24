import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getPrivateStatus, lockPrivateSpace, unlockPrivateSpace } from '../api/native-download/private-space'
import { getPrivateSession, setPrivateSession } from '../api/native-download/client'

export const usePrivateSpaceStore = defineStore('private-space', () => {
  const sessionToken = ref(getPrivateSession())
  const expiresAt = ref<number | null>(null)
  const status = ref<Awaited<ReturnType<typeof getPrivateStatus>> | null>(null)
  const busy = ref(false)
  const error = ref('')
  const unlocked = computed(() => !!sessionToken.value)
  async function refresh() { try { status.value = await getPrivateStatus(); if (!status.value.unlocked && sessionToken.value) clearSession() } catch (cause) { error.value = cause instanceof Error ? cause.message : '私人空间状态读取失败' } }
  async function unlock(password: string) { busy.value = true; error.value = ''; try { const result = await unlockPrivateSpace(password); sessionToken.value = result.sessionToken; expiresAt.value = result.expiresAt; setPrivateSession(result.sessionToken); status.value = await getPrivateStatus(); return true } catch (cause) { error.value = cause instanceof Error ? cause.message : '私人空间解锁失败'; clearSession(); return false } finally { busy.value = false } }
  async function lock() { try { await lockPrivateSpace() } catch {} clearSession(); await refresh() }
  function clearSession() { sessionToken.value = ''; expiresAt.value = null; setPrivateSession('') }
  return { sessionToken, expiresAt, status, busy, error, unlocked, refresh, unlock, lock, clearSession }
})
