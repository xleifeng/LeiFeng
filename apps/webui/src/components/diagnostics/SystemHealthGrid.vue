<script setup lang="ts">
defineProps<{ diagnostics: { engine: Record<string, unknown>; counts: Record<string, number>; media: Record<string, unknown>; remoteNodes: { items: unknown[] } } }>()
</script>

<template>
  <div class="diagnostics-grid">
    <article class="settings-card"><h2>引擎</h2><strong>{{ diagnostics.engine.healthy ? '运行中' : '未连接' }}</strong><span>PID {{ diagnostics.engine.pid || '—' }} · 重启 {{ diagnostics.engine.restarts || 0 }}</span></article>
    <article class="settings-card"><h2>任务</h2><strong>{{ diagnostics.counts.total || 0 }} 个任务</strong><span>下载中 {{ diagnostics.counts.active || 0 }} · 完成 {{ diagnostics.counts.completed || 0 }} · 失败 {{ diagnostics.counts.failed || 0 }}</span></article>
    <article class="settings-card"><h2>媒体</h2><strong>{{ diagnostics.media.streamInBrowser ? '浏览器播放可用' : '不可用' }}</strong><span>主机打开：{{ diagnostics.media.openOnHost ? '可用' : '不可用' }}</span></article>
    <article class="settings-card"><h2>远程节点</h2><strong>{{ diagnostics.remoteNodes.items.length }} 个节点</strong><span>仅显示节点状态，不同步私人空间。</span></article>
  </div>
</template>
