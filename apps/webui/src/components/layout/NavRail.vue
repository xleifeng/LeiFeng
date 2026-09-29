<script setup lang="ts">
// M3 导航：桌面 Navigation Rail / 窄屏 Navigation Bar（mdui 规范件——激活 pill、ripple、角标齐备）。
// 项用 href="#/path" 走 hash 路由原生跳转（插件贡献项同样成立）；激活态由 rail/bar 的
// value 驱动（最长前缀匹配，覆盖详情页等子路由）。设置是动作不是目的地：桌面放 rail
// bottom 槽（不参与激活管理），窄屏作为 bar 项（点击瞬态高亮，路由变化自愈）。
// 导航只展示当前 daemon 提供的真实能力（views 门控）；经前端插件注册表贡献。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Settings, Trash2 } from '@lucide/vue'
import { useUiCapabilitiesStore } from '../../stores/ui-capabilities'
import { navContributions } from '../../app/plugins'
import BrandMark from '../common/BrandMark.vue'

defineProps<{ counts: { active: number; completed: number; trash: number; private: number } | null; version?: string }>()
const emit = defineEmits<{ settings: [] }>()
const route = useRoute()
const capabilities = useUiCapabilitiesStore()
const visibleLinks = computed(() => navContributions.value.filter((link) => !link.capability || capabilities.enabled(link.capability)))
const activeValue = computed(() => {
  const candidates = [...visibleLinks.value.map((link) => link.to), '/trash']
  return candidates.filter((to) => route.path === to || route.path.startsWith(`${to}/`)).sort((a, b) => b.length - a.length)[0] ?? ''
})
// 桌面 rail 与窄屏 bar 互斥渲染：同批 data-testid 不同时存在于 DOM
const isMobile = ref(false)
let mq: MediaQueryList | undefined
const onMqChange = (event: MediaQueryListEvent) => { isMobile.value = event.matches }
onMounted(() => { mq = window.matchMedia('(max-width: 760px)'); isMobile.value = mq.matches; mq.addEventListener('change', onMqChange) })
onBeforeUnmount(() => mq?.removeEventListener('change', onMqChange))
</script>

<template>
  <aside v-if="!isMobile" class="nav-rail" data-testid="side-nav">
    <mdui-navigation-rail class="rail-items" aria-label="主导航" :value="activeValue">
      <div slot="top" class="rail-brand" :title="`Leifeng ${version || ''}`"><BrandMark :size="34" /></div>
      <mdui-navigation-rail-item
        v-for="link in visibleLinks" :key="link.to" :value="link.to" :href="`#${link.to}`"
        class="rail-item" :data-testid="`nav-${link.to.replace(/\//g, '')}`"
      >
        <component :is="link.icon" v-if="link.icon" slot="icon" :size="22" :stroke-width="1.8" />
        <mdui-badge v-if="link.to === '/download' && counts?.active" slot="badge">{{ counts.active }}</mdui-badge>
        {{ link.label }}
      </mdui-navigation-rail-item>
      <mdui-navigation-rail-item value="/trash" href="#/trash" class="rail-item" data-testid="nav-trash">
        <Trash2 slot="icon" :size="22" :stroke-width="1.8" />
        <mdui-badge v-if="counts?.trash" slot="badge">{{ counts.trash }}</mdui-badge>
        回收站
      </mdui-navigation-rail-item>
      <mdui-navigation-rail-item slot="bottom" class="rail-item settings-link" data-testid="nav-settings" @click="emit('settings')">
        <Settings slot="icon" :size="22" :stroke-width="1.8" />
        设置
      </mdui-navigation-rail-item>
    </mdui-navigation-rail>
  </aside>
  <mdui-navigation-bar v-else class="nav-bar-mobile" aria-label="主导航" :value="activeValue" data-testid="side-nav">
    <mdui-navigation-bar-item
      v-for="link in visibleLinks" :key="link.to" :value="link.to" :href="`#${link.to}`"
      :data-testid="`nav-${link.to.replace(/\//g, '')}`"
    >
      <component :is="link.icon" v-if="link.icon" slot="icon" :size="22" :stroke-width="1.8" />
      <mdui-badge v-if="link.to === '/download' && counts?.active" slot="badge">{{ counts.active }}</mdui-badge>
      {{ link.label }}
    </mdui-navigation-bar-item>
    <mdui-navigation-bar-item value="/trash" href="#/trash" data-testid="nav-trash">
      <Trash2 slot="icon" :size="22" :stroke-width="1.8" />
      <mdui-badge v-if="counts?.trash" slot="badge">{{ counts.trash }}</mdui-badge>
      回收站
    </mdui-navigation-bar-item>
    <mdui-navigation-bar-item class="settings-link" data-testid="nav-settings" @click="emit('settings')">
      <Settings slot="icon" :size="22" :stroke-width="1.8" />
      设置
    </mdui-navigation-bar-item>
  </mdui-navigation-bar>
</template>
