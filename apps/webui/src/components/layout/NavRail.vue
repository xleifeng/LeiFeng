<script setup lang="ts">
// M3 Navigation Rail（桌面竖条；窄屏经 CSS 变底部 Navigation Bar）。
// 导航只展示当前 daemon 提供的真实能力（views 门控）；经前端插件注册表贡献。
import { computed } from 'vue'
import { Settings, Trash2 } from '@lucide/vue'
import { RouterLink } from 'vue-router'
import { useUiCapabilitiesStore } from '../../stores/ui-capabilities'
import { navContributions } from '../../app/plugins'
import BrandMark from '../common/BrandMark.vue'

defineProps<{ counts: { active: number; completed: number; trash: number; private: number } | null; version?: string; open?: boolean }>()
const emit = defineEmits<{ close: []; settings: [] }>()
const capabilities = useUiCapabilitiesStore()
const visibleLinks = computed(() => navContributions.value.filter((link) => !link.capability || capabilities.enabled(link.capability)))
</script>

<template>
  <div v-if="open" class="side-backdrop" @click="emit('close')" />
  <aside class="nav-rail" :class="{ 'is-open': open }" data-testid="side-nav">
    <div class="rail-brand" :title="`Leifeng ${version || ''}`"><BrandMark :size="34" /></div>
    <nav class="rail-items" aria-label="主导航" @click="emit('close')">
      <RouterLink
        v-for="link in visibleLinks" :key="link.to" :to="link.to" class="rail-item"
        :data-testid="`nav-${link.to.replace(/\//g, '')}`"
      >
        <span class="rail-item-icon">
          <component :is="link.icon" v-if="link.icon" :size="22" :stroke-width="1.8" />
          <span v-if="link.to === '/download' && counts?.active" class="rail-item-badge">{{ counts.active }}</span>
        </span>
        <span class="rail-item-label">{{ link.label }}</span>
      </RouterLink>
    </nav>
    <div class="rail-spacer" />
    <div class="rail-footer" @click="emit('close')">
      <RouterLink to="/trash" class="rail-item" data-testid="nav-trash">
        <span class="rail-item-icon">
          <Trash2 :size="22" :stroke-width="1.8" />
          <span v-if="counts?.trash" class="rail-item-badge">{{ counts.trash }}</span>
        </span>
        <span class="rail-item-label">回收站</span>
      </RouterLink>
      <button type="button" class="rail-item settings-link" data-testid="nav-settings" @click="emit('settings')">
        <span class="rail-item-icon"><Settings :size="22" :stroke-width="1.8" /></span>
        <span class="rail-item-label">设置</span>
      </button>
    </div>
  </aside>
</template>
