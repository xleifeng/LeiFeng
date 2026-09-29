import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DaemonPlugin } from '../api/contracts/v2/plugins'
import { listDaemonPlugins, setPluginEnabled } from '../api/native-download/plugins'

/**
 * 插件管理分区状态（SettingDialog 核心分区，数据面 = plugin-admin RPC）。
 * toggle 成功后本地同步权威状态；restartRequired 只提示不自动重启（重启
 * 由用户主导，防误杀在线实例）。
 */
export const usePluginManagerStore = defineStore('plugin-manager', () => {
  const plugins = ref<DaemonPlugin[]>([])
  const loading = ref(false)
  const error = ref('')
  const notice = ref('')
  const pendingId = ref('')

  async function load() {
    loading.value = true
    error.value = ''
    try {
      plugins.value = await listDaemonPlugins()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '插件列表加载失败'
    } finally {
      loading.value = false
    }
  }

  /** 开关一个 daemon 插件；成功返回 true（本地状态已同步），失败返回 false（状态未动，组件层回滚 checkbox） */
  async function toggle(id: string, enabled: boolean): Promise<boolean> {
    if (pendingId.value) return false
    pendingId.value = id
    error.value = ''
    notice.value = ''
    try {
      const result = await setPluginEnabled(id, enabled)
      const target = plugins.value.find((p) => p.id === id)
      if (target) target.enabled = result.enabled
      if (result.restartRequired) notice.value = '已保存，重启 daemon 后生效'
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '插件状态修改失败'
      return false
    } finally {
      pendingId.value = ''
    }
  }

  return { plugins, loading, error, notice, pendingId, load, toggle }
})
