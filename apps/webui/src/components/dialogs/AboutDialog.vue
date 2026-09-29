<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { ChevronDown, ChevronRight, X } from '@lucide/vue'
import { getBootstrapV2 } from '../../api/native-download/bootstrap'
import { useOverlayStore } from '../../stores/overlay'
import BrandMark from '../common/BrandMark.vue'
import noticesUrl from '../../../THIRD_PARTY_NOTICES.md?url'

const overlay = useOverlayStore()
const bootstrapQuery = useQuery({ queryKey: ['v2-bootstrap'], queryFn: getBootstrapV2, retry: 1 })
const version = computed(() => bootstrapQuery.data.value?.daemonVersion || '—')
const componentsVisible = ref(false)

function openNotices() {
  window.open(noticesUrl, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <mdui-dialog open close-on-overlay-click close-on-esc role="dialog" aria-modal="true" aria-label="关于 Leifeng" class="about-dialog" @closed="overlay.close">
    <div class="about-inner">
      <mdui-button-icon class="about-close" aria-label="关闭关于 Leifeng" @click="overlay.close"><X :size="17" :stroke-width="1.5" /></mdui-button-icon>
      <div class="about-brand">
        <BrandMark :size="44" class="about-brand-mark" />
        <div>
          <h1>Leifeng</h1>
          <p>版本 {{ version }}</p>
        </div>
      </div>
      <button class="about-component-version" :aria-expanded="componentsVisible" @click="componentsVisible = !componentsVisible">查看组件版本 <ChevronDown :size="13" :class="{ expanded: componentsVisible }" /></button>
      <dl v-if="componentsVisible" class="about-component-list"><div><dt>WebUI</dt><dd>0.1.0</dd></div><div><dt>Daemon</dt><dd>{{ version }}</dd></div><div><dt>Web API</dt><dd>JSON-RPC v2</dd></div></dl>
      <div style="margin-top: 14px"><button class="settings-inline-button" @click="openNotices">开源组件许可 <ChevronRight :size="14" /></button></div>
    </div>
  </mdui-dialog>
</template>
