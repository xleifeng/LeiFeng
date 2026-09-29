<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { ChevronDown, ChevronRight, X } from '@lucide/vue'
import { getBootstrapV2 } from '../../api/native-download/bootstrap'
import { useOverlayStore } from '../../stores/overlay'
import aboutArtwork from '../../assets/generated/about-open-box.png'
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
  <div class="about-canvas">
    <section class="about-window" role="dialog" aria-modal="true" aria-label="关于 Leifeng">
      <button class="about-close" aria-label="关闭关于 Leifeng" @click="overlay.close"><X :size="17" :stroke-width="1.5" /></button>
      <div class="about-copy">
        <h1>Leifeng</h1>
        <p>版本：{{ version }}</p>
        <button class="about-component-version" :aria-expanded="componentsVisible" @click="componentsVisible = !componentsVisible">查看组件版本 <ChevronDown :size="13" :class="{ expanded: componentsVisible }" /></button>
        <dl v-if="componentsVisible" class="about-component-list"><div><dt>WebUI</dt><dd>0.1.0</dd></div><div><dt>Daemon</dt><dd>{{ version }}</dd></div><div><dt>Web API</dt><dd>JSON-RPC v2</dd></div></dl>
        <button class="about-update-button" disabled>检测更新</button>
        <div class="about-copyright">
          <p>Leifeng 是迅雷 Linux 下载栈的逆向移植项目，仅供个人学习使用</p>
          <p>迅雷及相关商标归其权利人所有</p>
        </div>
      </div>
      <div class="about-artwork">
        <img :src="aboutArtwork" alt="" />
        <button @click="openNotices">开源组件许可 <ChevronRight :size="17" /></button>
      </div>
    </section>
  </div>
</template>
