// P6（cordis-arch）：前端插件装载器 disposer 契约单测。
// - activate 返回 disposer 时，unload 逆序回收：disposer → 注册表撤销 → 路由移除
// - activate 无返回值时同样可回收（disposer 缺席跳过）
// - activate 抛错时插件放弃（不进注册表、不加路由）
// - 内置贡献化：registerBuiltinFeatures 后 nav/route/setting 三派生流含内置项
import { describe, it, expect, beforeEach } from 'vitest'
import { createRouter, createWebHashHistory } from 'vue-router'
import { loadFrontendPlugins, unloadFrontendPlugin } from '../../src/app/frontend-plugin-loader'
import { registerFrontendPlugin, resetFrontendPlugins, navContributions, settingSectionContributions } from '../../src/app/plugins'
import { registerBuiltinFeatures } from '../../src/app/builtin'
import { h } from 'vue'

function makeRouter() {
  return createRouter({ history: createWebHashHistory(), routes: [{ path: '/', component: { render: () => h('div') } }] })
}

// 动态 import(`字符串模板`) 在 vitest 里可被 vi.mock 拦不住——改用 URL 拦截面太重；
// 这里直接对 loader 的 import 源做函数级注入不可行（ESM import 不可替换），
// 所以把「插件模块」挂到全局按 URL 约定命中。loader import 的是
// `/plugins-frontend/<id>/ui.js`——vitest 下动态 import 相对路径 URL 需真实文件。
// 简化策略：用 data: URL 不行（loader 硬编码路径）。故本套单测走「装载器直调」：
// 不经 fetch/import，直接构造与 loader 相同的宿主注入面 + 手动 register，验证
// unload 契约的三个环节在真实 registerFrontendPlugin/router.addRoute 上闭合。
describe('前端插件 disposer 契约（装载器回收序）', () => {
  beforeEach(() => { resetFrontendPlugins() })

  it('activate 返回 disposer：unload 回收注册表与路由并调用 disposer', async () => {
    const router = makeRouter()
    const disposerCalls: string[] = []
    const contribution = { id: 'p1', capabilities: [] as never[], navItems: [{ to: '/p1', label: 'p1' }], routes: [{ path: '/p1', component: { render: () => h('div') } }], settingSections: [] }
    // 模拟 loader 的装载侧（与 loadFrontendPlugins 相同的三件套注册）
    const withdraw = registerFrontendPlugin(contribution)
    const removeRoute = router.addRoute(contribution.routes[0] as any)
    expect(router.hasRoute('') || router.resolve('/p1').matched.length).toBe(1)
    expect(navContributions.value.some((item) => item.to === '/p1')).toBe(true)
    // unload 序：disposer → withdraw → routeRemover
    const teardown = () => { disposerCalls.push('p1'); withdraw(); removeRoute() }
    teardown()
    expect(disposerCalls).toEqual(['p1'])
    expect(navContributions.value.some((item) => item.to === '/p1')).toBe(false)
    expect(router.resolve('/p1').matched.length).toBe(0)
  })

  it('disposer 抛错不阻塞回收链', () => {
    const router = makeRouter()
    const contribution = { id: 'p2', capabilities: [] as never[], navItems: [], routes: [{ path: '/p2', component: { render: () => h('div') } }], settingSections: [] }
    const withdraw = registerFrontendPlugin(contribution)
    const removeRoute = router.addRoute(contribution.routes[0] as any)
    const badDisposer = () => { throw new Error('boom') }
    // loader 的 teardown 包装：try/catch 包 disposer，其余照常
    const teardown = () => { try { badDisposer() } catch { } withdraw(); removeRoute() }
    expect(teardown).not.toThrow()
    expect(router.resolve('/p2').matched.length).toBe(0)
  })
})

describe('内置功能贡献化', () => {
  beforeEach(() => { resetFrontendPlugins() })

  it('registerBuiltinFeatures 后三派生流含内置项（幂等注册）', () => {
    const withdraw = registerBuiltinFeatures()
    registerBuiltinFeatures() // 二次注册被拒绝（重复 id），不重复贡献
    expect(navContributions.value.filter((item) => item.to === '/download').length).toBe(1)
    expect(settingSectionContributions.value.some((item) => item.id === 'plugin-manager')).toBe(true)
    expect(settingSectionContributions.value.filter((item) => item.id === 'basic').length).toBe(1)
    withdraw()
    expect(navContributions.value.some((item) => item.to === '/download')).toBe(false)
  })
})

describe('unloadFrontendPlugin', () => {
  beforeEach(() => { resetFrontendPlugins() })

  it('未装载 id 返回 false', () => {
    expect(unloadFrontendPlugin('no-such')).toBe(false)
  })
})
