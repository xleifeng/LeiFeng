import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router/index'
import { loadFrontendPlugins } from './app/frontend-plugin-loader'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/tasks.css'
import './styles/dialogs.css'
import './styles/views.css'

createApp(App).use(createPinia()).use(VueQueryPlugin, { queryClientConfig: { defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, structuralSharing: true }, mutations: { retry: 0 } } } }).use(router).mount('#app')
// 运行期前端插件装载：不阻塞首屏（fetch 失败/无插件面时静默保持核心 UI）
void loadFrontendPlugins(router)
