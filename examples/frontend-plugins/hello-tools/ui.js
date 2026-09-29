// 示例前端插件：完整演示 activate(host) 宿主注入契约（U2 定稿）。
//
// 契约要点：
// - 本文件是 ESM，但【禁止 import 'vue'】——CSP 拦内联 importmap 且 HTML spec
//   不支持外链 importmap，裸名模块解析两条路都堵死；一律从 host.vue 拿宿主
//   共享实例（h / ref / onMounted / computed / …共 172 个语义导出）。
// - host.navItems / host.routes / host.settingSections 是贡献槽：push 即注册，
//   能力过滤（capabilities.views 门控）与路由守卫由宿主统一执行。
// - manifest.json 的 id 必须等于目录名；capabilities 声明本插件依赖的视图能力，
//   daemon 侧未提供时本插件整页隐藏。
export function activate(host) {
  const { h, ref, computed, onMounted } = host.vue

  // 1. 侧栏导航项（与 NativeSidebar 核心项合并渲染；可选 capability 字段参与门控）
  host.navItems.push({ to: '/hello', label: '插件页' })

  // 2. 设置弹窗分区：带 component 时点击后内容区渲染该组件（U3 起支持）
  host.settingSections.push({
    id: 'hello',
    label: '插件设置',
    component: {
      name: 'HelloSettingSection',
      setup() {
        const greeting = ref('来自前端插件的设置分区')
        return () => h('div', { class: 'hello-setting-section' }, [
          h('p', { class: 'hello-setting-hint' }, greeting.value),
          h('button', { class: 'hello-setting-button', onClick: () => { greeting.value = `点击于 ${new Date().toLocaleTimeString()}` } }, '点我试试'),
        ])
      },
    },
  })

  // 3. 路由：route.component 与设置分区 component 都是宿主 vue 能直接消费的对象组件
  host.routes.push({
    path: '/hello',
    name: 'hello-plugin',
    component: {
      name: 'HelloPluginView',
      setup() {
        const count = ref(0)
        const doubled = computed(() => count.value * 2)
        onMounted(() => { count.value = 42 })
        return () => h('div', { class: 'hello-plugin-view' }, [
          h('h2', null, '前端插件演示页'),
          h('p', null, ['共享 vue 计数: ', count.value, '（×2 = ', doubled.value, '）']),
        ])
      },
    },
  })
}
