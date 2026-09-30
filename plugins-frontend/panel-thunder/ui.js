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
            h('p', { class: channels ? undefined : 'kdp-empty' },
              d.seedAvailable ? '种子描述符可用——切到「概览」页可导出 .torrent。' : '该任务无可用种子描述符。'),
          ]),
          h('mdui-collapse', { class: 'kdp-collapse' }, () => [
            h('mdui-collapse-item', {
              onOpen: () => { engineOpen.value = true },
              onClose: () => { engineOpen.value = false },
            }, {
              // header slot：chevron 旋转暗示可展开（mdui collapse 本体无样式，走查抓出裸文本不像可点）
              header: () => h('span', { class: 'kdp-collapse-head' }, [
                '引擎详情',
                h('span', { class: ['kdp-chevron', engineOpen.value && 'open'], 'aria-hidden': 'true' }, '▾'),
              ]),
              default: () => h('dl', { class: 'kdp-kv' }, [
                ['任务 ID', d.taskId], ['内核', d.kernelId], ['类型', d.kind], ['生命周期', d.lifecycle],
                ['队列位置', String(d.queuePosition ?? 0)], ['修订', String(d.revision)], ['观测修订', String(d.observationRevision)],
              ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
            }),
          ]),
        ])
      }
    },
  }

  host.taskDetailPanels.push({ id: 'thunder-kernel', label: '内核', kernelIds: ['thunder'], component: ThunderKernelPanel })
}
