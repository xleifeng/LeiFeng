// 任务详情 · thunder 内核面板（kernel-detail-panels，2026-09-30）
// 数据源：tasks.get 详情富化（channels = TaskDb 通道归因直读）。
// 诚实纪律：thunder SDK 无 peers/上传统计面——本面板不渲染这些区块（非置灰，是不存在）。
// 宿主注入：不 import 'vue'（CSP），一切经 host。
export function activate(host) {
  const { h, ref } = host.vue

  function bytes(value) {
    if (!value) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let size = value; let unit = 0
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
    return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
  }

  const CHANNEL_DEFS = [
    ['p2p', 'P2P'], ['p2s', 'P2S 镜像'], ['origin', '原始地址'], ['vip', '会员加速'], ['freeDcdn', '免费 CDN'],
  ]
  const SEG_CLASS = ['kdp-seg-1', 'kdp-seg-2', 'kdp-seg-3', 'kdp-seg-4', 'kdp-seg-5']

  const ThunderKernelPanel = {
    name: 'ThunderKernelPanel',
    props: { detail: { type: Object, required: true } },
    setup(props) {
      const engineOpen = ref(false)
      const seedFeedback = ref('')
      let feedbackTimer = null
      const note = (text) => {
        seedFeedback.value = text
        clearTimeout(feedbackTimer)
        feedbackTimer = setTimeout(() => { seedFeedback.value = '' }, 2500)
      }
      async function exportTorrent() {
        const d = props.detail
        try {
          const response = await fetch(`/api/v2/tasks/${encodeURIComponent(d.taskId)}/torrent`)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const blobUrl = URL.createObjectURL(await response.blob())
          const link = document.createElement('a')
          link.href = blobUrl
          link.download = `${String(d.displayName || 'task').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.torrent$/i, '') || 'task'}.torrent`
          link.click()
          setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
          note('已导出 .torrent')
        } catch (error) { note(`导出失败：${error.message}`) }
      }
      async function copyMagnet() {
        const d = props.detail
        if (!d.infoHash) return
        try {
          await navigator.clipboard.writeText(`magnet:?xt=urn:btih:${d.infoHash}`)
          note('磁链已复制')
        } catch { note('复制失败') }
      }
      return () => {
        const d = props.detail
        const channels = d.channels && typeof d.channels === 'object' ? d.channels : null
        const entries = CHANNEL_DEFS.map(([key, label], i) => ({
          label, cls: SEG_CLASS[i], value: channels ? Math.max(0, Number(channels[key]) || 0) : 0,
        }))
        const total = entries.reduce((sum, e) => sum + e.value, 0)
        return h('div', { class: 'kdp-panel' }, [
          h('section', { class: 'kdp-card' }, [
            h('h3', { class: 'kdp-title' }, '下载通道分布'),
            !channels
              ? h('p', { class: 'kdp-empty' }, '该任务暂无通道归因数据（引擎未记账或非下载期）。')
              : [
                  total > 0
                    ? h('div', { class: 'kdp-channel-bar' }, entries.filter((e) => e.value > 0)
                        .map((e) => h('span', { class: ['kdp-seg', e.cls], style: `width:${(e.value / total * 100).toFixed(2)}%` })))
                    : h('p', { class: 'kdp-empty' }, '尚无下载字节入账。'),
                  h('ul', { class: 'kdp-legend' }, entries.map((e) => h('li', { key: e.label }, [
                    h('i', { class: ['kdp-dot', e.cls] }),
                    `${e.label} ${bytes(e.value)}${total > 0 ? `（${Math.round(e.value / total * 100)}%）` : ''}`,
                  ]))),
                ],
          ]),
          h('section', { class: 'kdp-card' }, [
            h('h3', { class: 'kdp-title' }, '种子'),
            d.infoHash
              ? h('p', { class: 'kdp-hash', title: d.infoHash }, `infohash：${d.infoHash}`)
              : null,
            h('div', { class: 'kdp-actions' }, [
              d.seedAvailable
                ? h('mdui-button', { variant: 'tonal', onClick: exportTorrent }, () => '导出 .torrent')
                : h('span', { class: 'kdp-empty' }, '无可用种子描述符'),
              d.infoHash
                ? h('mdui-button', { variant: 'text', onClick: copyMagnet }, () => '复制磁链')
                : null,
            ]),
            seedFeedback.value ? h('p', { class: 'kdp-feedback' }, seedFeedback.value) : null,
          ].filter(Boolean)),
          h('mdui-collapse', { class: 'kdp-collapse' }, () => [
            h('mdui-collapse-item', {
              onOpen: () => { engineOpen.value = true },
              onClose: () => { engineOpen.value = false },
            }, [
              // 自定义元素无 Vue slot 对象语义——slot 内容必须带 slot 属性的子节点
              h('span', { slot: 'header', class: 'kdp-collapse-head' }, [
                '引擎详情',
                h('span', { class: ['kdp-chevron', engineOpen.value && 'open'], 'aria-hidden': 'true' }, '▾'),
              ]),
              h('dl', { class: 'kdp-kv' }, [
                ['任务 ID', d.taskId], ['内核', d.kernelId], ['类型', d.kind], ['生命周期', d.lifecycle],
                ['队列位置', String(d.queuePosition ?? 0)], ['修订', String(d.revision)], ['观测修订', String(d.observationRevision)],
              ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
            ]),
          ]),
        ])
      }
    },
  }

  host.taskDetailPanels.push({ id: 'thunder-kernel', label: '内核', kernelIds: ['thunder'], component: ThunderKernelPanel })
}
