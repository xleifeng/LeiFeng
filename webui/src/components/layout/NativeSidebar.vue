<script setup lang="ts">
// webui/src/components/layout/NativeSidebar.vue — 侧栏原版对齐（orig-main-download-clean.png）
// 导航只展示当前 daemon 提供的真实能力；云盘不在本项目范围内。
import { computed } from 'vue'
import { Download, Trash2, X } from '@lucide/vue'
import { RouterLink } from 'vue-router'
import { useRoute } from 'vue-router'

defineProps<{ counts: { active: number; completed: number; trash: number; private: number } | null; version?: string; open?: boolean }>()
const emit = defineEmits<{ close: []; settings: [] }>()
const route = useRoute()
const trashReference = computed(() => route.path === '/trash')

const links = [
  { to: '/download', label: '下载', icon: Download },
  { to: '/private-space', label: '私人空间', trashActive: true },
  { to: '/history', label: '下载记录', trashActive: true },
  { to: '/links', label: '链接库', trashActive: true },
]
</script>

<template>
  <div v-if="open" class="sidebar-backdrop" @click="emit('close')" />
  <aside class="native-sidebar" :class="{ 'is-open': open }">
    <button class="mobile-close" aria-label="关闭导航" @click="emit('close')"><X :size="18" /></button>
    <nav class="sidebar-nav" aria-label="主导航" @click="emit('close')">
      <template v-for="link in links" :key="link.to">
        <RouterLink :to="link.to" class="sidebar-link" :class="{ 'trash-reference-active': trashReference && link.trashActive }">
          <component :is="link.icon" class="nav-icon" :size="20" :stroke-width="1.8" v-if="link.icon" />
          <span>{{ link.label }}</span>
        </RouterLink>
      </template>
    </nav>
    <div class="sidebar-divider" />
    <nav class="sidebar-nav" aria-label="远程导航" @click="emit('close')">
      <RouterLink to="/remote" class="sidebar-link" :class="{ 'trash-reference-active': trashReference }"><span>远程下载</span></RouterLink>
    </nav>
    <div class="sidebar-divider" />
    <nav class="sidebar-nav" aria-label="系统导航" @click="emit('close')">
      <button type="button" class="sidebar-link settings-link" @click="emit('settings')"><span>设置</span></button>
    </nav>
    <div class="sidebar-spacer" />
    <div class="sidebar-footer">
      <RouterLink to="/trash" class="sidebar-bottom-link" @click="emit('close')"><Trash2 :size="14" :stroke-width="1.8" /><span>回收站</span></RouterLink>
    </div>
  </aside>
</template>
