// 任务详情 · webseed 输血桥面板（kernel-detail-panels，2026-09-30）
// 数据源：tasks.get 详情聚合的 bridge 快照（daemon bridge-status 内存库）+
// 面板自身 5s 轮询 bridge.sessions 保持实时（详情 query 不自动刷新）。
// 仅当任务关联桥会话时出现（requiresBridge）。
export function activate(host) {
  const { h, ref, onMounted, onBeforeUnmount } = host.vue

  function bytes(value) {
    if (!value) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let size = value; let unit = 0
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
    return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
  }
  const speed = (v) => (v > 0 ? `${bytes(v)}/s` : '—')

  const BridgePanel = {
    name: 'BridgeSessionPanel',
    props: { detail: { type: Object, required: true } },
    setup(props) {
      const session = ref(props.detail.bridge)
      const detailOpen = ref(false)
      let timer = null
      async function pull() {
        const current = session.value || props.detail.bridge
        if (!current || !current.infohash) return
        try {
          const data = await host.rpc('leifeng.ui.v2.bridge.sessions', [])
          const hit = (data && Array.isArray(data.sessions) ? data.sessions : [])
            .find((s) => s.infohash === current.infohash)
          if (hit) session.value = hit
        } catch { /* daemon 瞬断：保留上一快照，stale 标志诚实呈现 */ }
      }
      onMounted(() => { timer = setInterval(pull, 5000) })
      onBeforeUnmount(() => { if (timer) clearInterval(timer) })
      return () => {
        const s = session.value
        if (!s) return h('div', { class: 'kdp-panel' }, [h('p', { class: 'kdp-empty' }, '桥会话已结束。')])
        const pct = s.totalPieces > 0 ? Math.min(100, Math.round((s.verifiedPieces / s.totalPieces) * 100)) : 0
        return h('div', { class: 'kdp-panel' }, [
          h('section', { class: 'kdp-card' }, [
            h('h3', { class: 'kdp-title' }, `输血桥 · ${s.lifecycle === 'seeding' ? '供种中' : '校验注入中'}`),
            h('div', { class: 'kdp-stat-grid' }, [
              [`${s.verifiedPieces} / ${s.totalPieces}（${pct}%）`, '已校验分片'],
              [bytes(s.verifiedBytes), '已校验字节'],
              [speed(s.serveRateBps), '当前供出速率'],
              [bytes(s.serveBytesTotal), '累计供出'],
            ].map(([v, label]) => h('div', { class: 'kdp-stat' }, [h('b', null, v), h('span', null, label)]))),
            h('mdui-linear-progress', { max: 100, value: pct, style: 'margin-top:10px' }),
            s.stale
              ? h('p', { class: 'kdp-stale' }, `桥已失联——最后上报 ${new Date(s.updatedAt).toLocaleTimeString()}`)
              : h('p', { class: 'kdp-empty', style: 'margin-top:8px' }, `最近上报 ${new Date(s.updatedAt).toLocaleTimeString()}`),
          ]),
          h('mdui-collapse', { class: 'kdp-collapse' }, () => [
            h('mdui-collapse-item', {
              onOpen: () => { detailOpen.value = true },
              onClose: () => { detailOpen.value = false },
            }, {
              header: () => h('span', { class: 'kdp-collapse-head' }, [
                '会话详情',
                h('span', { class: ['kdp-chevron', detailOpen.value && 'open'], 'aria-hidden': 'true' }, '▾'),
              ]),
              default: () => h('dl', { class: 'kdp-kv' }, [
                ['InfoHash', s.infohash], ['关联任务', s.taskId || '（未关联）'], ['会话状态', s.lifecycle],
              ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
            }),
          ]),
        ])
      }
    },
  }

  host.taskDetailPanels.push({ id: 'bridge-session', label: '输血桥', requiresBridge: true, component: BridgePanel })
}
