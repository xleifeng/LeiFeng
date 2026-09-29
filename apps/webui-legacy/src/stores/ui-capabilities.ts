import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** 与 daemon 侧 host/src/domain/ui-capabilities.js 的 KNOWN 全集对齐 */
export type ViewCapabilityId =
  | 'tasks'
  | 'settings'
  | 'diagnostics'
  | 'history'
  | 'link-library'
  | 'private-space'
  | 'media'
  | 'daemon-admin'

/**
 * 视图能力门控：数据源 = leifeng.ui.v2.bootstrap 的 capabilities.views。
 * views 缺失（旧 daemon）时不门控，全部能力视为可用（向后兼容降级）；
 * views 存在时严格门控——daemon 禁用插件后其 UI 面随之隐藏。
 */
export const useUiCapabilitiesStore = defineStore('ui-capabilities', () => {
  const views = ref<string[] | null>(null)

  /** 契约层 views 是 string[]；未知 ID 视为不可用（daemon 与 webui 能力表版本错位时保守降级） */
  function setViews(value: string[] | undefined | null) {
    views.value = value ?? null
  }

  const gating = computed(() => views.value !== null)
  const enabled = (id: ViewCapabilityId | string) => (views.value === null ? true : views.value.includes(id))

  return { views, setViews, gating, enabled }
})
