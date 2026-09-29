import { defineStore } from 'pinia'
import { getDownloadPolicy, updateDownloadPolicy } from '../api/native-download/policies'
import type { DownloadPolicy } from '../api/contracts/v2/policies'

export const useDownloadPolicyFormStore = defineStore('download-policy-form', {
  state: () => ({ revision: 0, base: null as DownloadPolicy | null, draft: null as DownloadPolicy | null, loading: false, saving: false, error: '' }),
  getters: { dirty: (state) => JSON.stringify(state.base) !== JSON.stringify(state.draft) },
  actions: {
    async load() { this.loading = true; this.error = ''; try { const snapshot = await getDownloadPolicy(); this.revision = snapshot.revision; this.base = snapshot.policy; this.draft = structuredClone(snapshot.policy) } catch (error) { this.error = error instanceof Error ? error.message : '加载策略失败' } finally { this.loading = false } },
    patch(value: Partial<DownloadPolicy>) { this.draft = { ...(this.draft as DownloadPolicy), ...value } },
    async save(proxySecret?: Record<string, unknown>) { if (!this.draft) return; this.saving = true; this.error = ''; try { const response = await updateDownloadPolicy(this.revision, this.draft, proxySecret); this.revision = response.revision; this.base = response.policy; this.draft = structuredClone(response.policy); return response } catch (error) { this.error = error instanceof Error ? error.message : '保存策略失败'; throw error } finally { this.saving = false } },
  },
})
