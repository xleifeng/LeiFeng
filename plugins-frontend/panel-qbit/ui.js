// 任务详情 · qbit 内核面板（kernel-detail-panels，2026-09-30）
// 数据源：kernel-qbit 插件注册的 leifeng.ui.v2.tasks.peers / tasks.seeding
// （qBittorrent Web API 透传）。5s 轮询，组件卸载停表。
export function activate(host) {
  const { h, ref, onMounted, onBeforeUnmount } = host.vue

  function bytes(value) {
    if (!value) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let size = value; let unit = 0
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
    return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
  }
  const speed = (v) => (v > 0 ? `${bytes(v)}/s` : '—')
  function duration(seconds) {
    if (!seconds) return '0 秒'
    const d = Math.floor(seconds / 86400); const h2 = Math.floor((seconds % 86400) / 3600); const m = Math.floor((seconds % 3600) / 60)
    return d ? `${d} 天 ${h2} 小时` : h2 ? `${h2} 小时 ${m} 分` : m ? `${m} 分 ${Math.floor(seconds % 60)} 秒` : `${Math.floor(seconds)} 秒`
  }

  const QbitKernelPanel = {
    name: 'QbitKernelPanel',
    props: { detail: { type: Object, required: true } },
    setup(props) {
      const peers = ref([])
      const seeding = ref(null)
      const failed = ref(false)
      let timer = null
      async function pull() {
        try {
          const [p, s] = await Promise.all([
            host.rpc('leifeng.ui.v2.tasks.peers', [{ taskId: props.detail.taskId }]),
            host.rpc('leifeng.ui.v2.tasks.seeding', [{ taskId: props.detail.taskId }]),
          ])
          peers.value = (p && Array.isArray(p.peers) && p.peers) || []
          seeding.value = s && typeof s === 'object' ? s : null
          failed.value = false
        } catch { failed.value = true }
      }
      onMounted(() => { pull(); timer = setInterval(pull, 5000) })
      onBeforeUnmount(() => { if (timer) clearInterval(timer) })
      return () => {
        if (failed.value) return h('div', { class: 'kdp-panel' }, [h('p', { class: 'kdp-empty' }, 'qbit 内核数据暂不可达（内核未启用或离线）。')])
        const sections = []
        const sd = seeding.value
        if (sd) {
          sections.push(h('section', { class: 'kdp-card' }, [
            h('h3', { class: 'kdp-title' }, '做种'),
            h('div', { class: 'kdp-stat-grid' }, [
              [duration(sd.seedingSeconds), '做种时长'], [sd.ratio.toFixed(2), '分享率'],
              [bytes(sd.uploadedBytes), '累计上传'], [speed(sd.uploadBytesPerSecond), '上传速度'],
              [String(sd.seedsConnected), '种子'], [String(sd.peersConnected), '下载方'],
            ].map(([v, label]) => h('div', { class: 'kdp-stat' }, [h('b', null, v), h('span', null, label)]))),
          ]))
        }
        sections.push(h('section', { class: 'kdp-card' }, [
          h('h3', { class: 'kdp-title' }, `同伴（${peers.value.length}）`),
          peers.value.length === 0
            ? h('p', { class: 'kdp-empty' }, '当前没有已连接的同伴。')
            : h('table', { class: 'kdp-table' }, [
                h('thead', null, h('tr', null, ['地址', '客户端', '进度', '↓ 速度', '↑ 速度', '标志'].map((c) => h('th', null, c)))),
                h('tbody', null, peers.value.map((p) => h('tr', { key: p.endpoint }, [
                  h('td', null, p.endpoint),
                  h('td', null, p.client || '—'),
                  h('td', null, `${Math.round((p.progress || 0) * 100)}%`),
                  h('td', null, speed(p.downloadBytesPerSecond)),
                  h('td', null, speed(p.uploadBytesPerSecond)),
                  h('td', { title: p.connection || '' }, p.flags || '—'),
                ]))),
              ]),
        ]))
        return h('div', { class: 'kdp-panel' }, sections)
      }
    },
  }

  // 挂载条件=详情带 qbit 字段（daemon enrichDetail 按 infoHash 探测 qbit 槽命中才注入）：
  // qbit 内核任务恒有；thunder 任务在 hybrid 输血（qbit 同 hash 副本做种）时也有——
  // 跨内核呈现正是本面板的价值。peers/seeding RPC 经壳层 taskId→infoHash 解析，双内核任务通吃。
  host.taskDetailPanels.push({ id: 'qbit-seeding', label: 'qbit 做种', requiresField: 'qbit', component: QbitKernelPanel })
}
