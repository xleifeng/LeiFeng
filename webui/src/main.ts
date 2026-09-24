import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router/index'
import './styles/tokens.css'
import './styles/tokens-orig.css' // 原版令牌覆盖层，必须在 tokens.css 之后以保证 cascade 胜出
import './styles/base.css'
import './styles/native-shell.css'
import './styles/task-center.css'
import './styles/settings-dialogs.css'
import './styles/feature-pages.css'

createApp(App).use(createPinia()).use(VueQueryPlugin, { queryClientConfig: { defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, structuralSharing: true }, mutations: { retry: 0 } } } }).use(router).mount('#app')
