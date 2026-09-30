// 运行期前端插件装载器：fetch /plugins-registry.json → 动态 import 插件 ui.js
// → activate(host) 宿主注入 → registerFrontendPlugin → router.addRoute。
//
// vue 采用宿主注入而非 importmap：web-api 静态面 CSP script-src 'self' 拦截
// 内联 importmap，而 HTML spec 不支持外链 importmap（src 属性直接 error 事件），
// 声明式映射两条路都堵死——插件经 activate(host) 从宿主拿同一 vue 实例引用
// （DSH 宿主注入渲染同款思路，U2 spec D1 预案）。
//
// P6（cordis-arch）：activate 增补 disposer 契约——返回的清理函数与路由 remover
// 一并保存；unloadFrontendPlugin 按装载逆序回收。activate 中途抛错时插件直接
// 放弃（贡献槽数组留在局部对象里，未进注册表，无需回滚）。
import * as vue from 'vue'
import type { Router } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { registerFrontendPlugin, type NavItemDef, type SettingSectionDef, type TaskDetailPanelDef } from './plugins'
import { rpcV2 } from '../api/native-download/client'
import type { ViewCapabilityId } from '../stores/ui-capabilities'

/** web-api 聚合的 manifest（见 apps/web-api/src/server.js serveFrontendPlugins） */
interface PluginManifest {
  id: string
  capabilities?: string[]
  /** 插件入口相对 manifest 的路径，缺省 ui.js */
  entry?: string
  navItems?: { to: string; label: string; capability?: string }[]
  settingSections?: { id: string; label: string; capability?: string }[]
  /** 任务详情面板声明（component 由 activate 经宿主槽注入） */
  taskDetailPanels?: { id: string; label: string; kernelIds?: string[]; requiresField?: 'bridge' | 'qbit' }[]
}

/**
 * 宿主注入面：插件 ui.js 导出 activate(host)，从宿主取 vue 实例引用与贡献槽。
 * 插件内组件用 `const { h, ref } = host.vue`，不得 `import 'vue'`（CSP 下不可解析）。
 * rpc：面板插件拉取内核/桥数据的唯一通道（方法缺席即内核无能力，诚实降级）。
 */
export interface PluginHost {
  vue: typeof vue
  rpc: <T = unknown>(method: string, params?: unknown[]) => Promise<T>
  navItems: NavItemDef[]
  routes: RouteRecordRaw[]
  settingSections: SettingSectionDef[]
  taskDetailPanels: TaskDetailPanelDef[]
}

interface PluginModule {
  /** 返回 disposer：装载器保留并在插件回收时调用（当前主流程常驻，供测试与宿主重载用） */
  activate?: (host: PluginHost) => void | (() => void) | Promise<void | (() => void)>
}

/** manifest 里的字符串能力 ID 保守收窄：未知 ID 原样保留（渲染点 enabled() 对未知保守降级） */
function toCapabilityIds(values: string[] | undefined): ViewCapabilityId[] {
  return [...new Set(values ?? [])] as ViewCapabilityId[]
}

/** 校验 manifest：id 必须是安全目录名（服务端已按目录名对齐，这里二次防御） */
function safePluginId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id)
}

const loadedPlugins = new Map<string, () => void>()

/**
 * 卸载一个已装载插件：disposer（activate 返回值）→ 注册表撤销 → 路由移除，
 * 与装载序对称。disposer 抛错不阻塞后续回收（各清理项独立执行）。
 * 路由移除由装载时保存的 remover 完成（P6 前 remover 被丢弃——母文档 §8.4 缺口）。
 */
export function unloadFrontendPlugin(id: string): boolean {
  const teardown = loadedPlugins.get(id)
  if (!teardown) return false
  loadedPlugins.delete(id)
  teardown()
  return true
}

/**
 * 装载全部运行期插件。幂等：已装载 id 跳过；失败插件只 console.warn，绝不
 * 阻塞主 app（插件面是增强，不是依赖）。
 */
export async function loadFrontendPlugins(router: Router, registryUrl = '/plugins-registry.json'): Promise<void> {
  let payload: { plugins?: PluginManifest[] }
  try {
    const response = await fetch(registryUrl, { cache: 'no-store' })
    if (!response.ok) return
    payload = await response.json()
  } catch {
    return // 无插件面（旧 web-api / 离线）：静默，保持核心 UI
  }
  for (const manifest of payload.plugins ?? []) {
    if (!manifest || !safePluginId(manifest.id)) continue
    if (loadedPlugins.has(manifest.id)) continue
    const contribution = {
      id: manifest.id,
      capabilities: toCapabilityIds(manifest.capabilities),
      navItems: [] as NavItemDef[],
      routes: [] as RouteRecordRaw[],
      settingSections: [] as SettingSectionDef[],
      taskDetailPanels: [] as TaskDetailPanelDef[],
    }
    let activateDisposer: (() => void) | undefined
    try {
      const entry = manifest.entry && /^[\w.-]+$/.test(manifest.entry) ? manifest.entry : 'ui.js'
      const module = (await import(/* @vite-ignore */ `/plugins-frontend/${manifest.id}/${entry}`)) as PluginModule
      if (typeof module.activate === 'function') {
        const returned = await module.activate({
          vue,
          rpc: rpcV2,
          navItems: contribution.navItems,
          routes: contribution.routes,
          settingSections: contribution.settingSections,
          taskDetailPanels: contribution.taskDetailPanels,
        })
        if (typeof returned === 'function') activateDisposer = returned
      }
    } catch (error) {
      console.warn(`[webui] 前端插件 ${manifest.id} 装载失败:`, error)
      continue
    }
    const withdraw = registerFrontendPlugin(contribution)
    const routeRemovers = contribution.routes.map((route) => router.addRoute(route))
    loadedPlugins.set(manifest.id, () => {
      try { activateDisposer?.() } catch (error) { console.warn(`[webui] 前端插件 ${manifest.id} disposer 抛错:`, error) }
      withdraw()
      for (const remove of routeRemovers) remove()
    })
    // 首次导航先于插件装载完成时（用户直达插件路由），路由表此刻才补齐——
    // 未匹配则重解析当前地址，否则停在空匹配直到下一次跳转
    if (router.currentRoute.value.matched.length === 0) await router.replace(router.currentRoute.value.fullPath).catch(() => {})
  }
}
