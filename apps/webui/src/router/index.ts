import { createRouter, createWebHashHistory } from 'vue-router'
import { useUiCapabilitiesStore } from '../stores/ui-capabilities'
import { routeContributions } from '../app/plugins'
import { builtinRoutes, registerBuiltinFeatures } from '../app/builtin'

// P6（cordis-arch）：内置功能贡献化——路由表不再本地持 coreRoutes，builtin 插件
// 经 registerFrontendPlugin 贡献（与运行期前端插件同一面）；注册表响应式派生
// routeContributions 即初始路由表。模块级一次性注册（幂等）。
registerBuiltinFeatures()

export const router = createRouter({
  history: createWebHashHistory(),
  // capability 缺省（旧 daemon / 未门控）时全量生效。
  routes: [...routeContributions.value],
})

// 能力守卫：目标路由声明了不可用能力时回退到任务中心。
// 守卫内惰性取 store（router 创建先于组件体系，pinia 已在 main.ts 先行挂载）。
router.beforeEach((to) => {
  const capability = to.meta.capability as string | undefined
  if (!capability) return true
  const capabilities = useUiCapabilitiesStore()
  return capabilities.enabled(capability as never) ? true : '/download'
})

export { navContributions } from '../app/plugins'
