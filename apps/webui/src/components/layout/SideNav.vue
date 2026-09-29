<script setup lang="ts">
// Leifeng Modern 侧栏：全高、品牌居顶、胶囊导航项。
// 导航只展示当前 daemon 提供的真实能力（views 门控）；P6 起经注册表贡献。
import { computed } from 'vue'
import { Settings, Trash2, X } from '@lucide/vue'
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
  <aside class="side-nav" :class="{ 'is-open': open }" data-testid="side-nav">
    <div class="side-brand">
      <BrandMark :size="30" class="side-brand-mark" />
      <span class="side-brand-word">Leifeng</span>
      <span v-if="version" class="side-brand-version">{{ version }}</span>
    </div>
    <button class="side-mobile-close" aria-label="关闭导航" @click="emit('close')"><X :size="18" /></button>
    <nav class="side-section" aria-label="主导航" @click="emit('close')">
      <RouterLink
        v-for="link in visibleLinks" :key="link.to" :to="link.to" class="side-link"
        :data-testid="`nav-${link.to.replace(/\//g, '')}`"
      >
        <component :is="link.icon" v-if="link.icon" :size="18" :stroke-width="1.9" />
        <span>{{ link.label }}</span>
        <span v-if="link.to === '/download' && counts?.active" class="side-count">{{ counts.active }}</span>
      </RouterLink>
    </nav>
    <div class="side-spacer" />
    <div class="side-footer" @click="emit('close')">
      <RouterLink to="/trash" class="side-link" data-testid="nav-trash"><Trash2 :size="18" :stroke-width="1.9" /><span>回收站</span><span v-if="counts?.trash" class="side-count">{{ counts.trash }}</span></RouterLink>
      <button type="button" class="side-link settings-link" data-testid="nav-settings" @click="emit('settings')"><Settings :size="18" :stroke-width="1.9" /><span>设置</span></button>
    </div>
  </aside>
</template>
