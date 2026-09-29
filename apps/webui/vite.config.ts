import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      // 指向 webui/src/assets/orig — 原版 renderer 解包资产（详见 src/assets/orig/NOTICE.md）
      '@orig': fileURLToPath(new URL('./src/assets/orig', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      // vue-runtime-exports 作为第二入口：entry 导出不受 tree-shaking 影响，用它把
      // 完整 vue API 面钉进共享 chunk（副作用 import 会被摇掉，entry 钉得住；
      // 见 src/vue-runtime-exports.ts 头注释）
      input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), 'vue-runtime': fileURLToPath(new URL('./src/vue-runtime-exports.ts', import.meta.url)) },
      // 纯 re-export 的 entry 默认会被 rollup 合并 + tree-shake 成空壳——strict 保留
      // entry 签名，门面导出才能钉住全量 vue 面
      preserveEntrySignatures: 'strict',
      output: {
        // minifyInternalExports:false：host.vue 整体逃逸到运行期插件，具名导出
        // （ref/computed/…）经属性访问消费，语义名必须保留——rollup 默认在 compact
        // 产物里压成 $/A 之类，插件侧 host.vue.ref 就 undefined 了
        minifyInternalExports: false,
        // vue 独立 chunk：门面与主 app 共享同一份 vue 实例（U2）
        manualChunks(id) {
          if (id.includes('/node_modules/vue/') || id.includes('/node_modules/@vue/')) return 'vue'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/jsonrpc': 'http://127.0.0.1:16800' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
