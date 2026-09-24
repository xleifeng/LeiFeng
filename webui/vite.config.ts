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
