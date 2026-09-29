// vue 共享 chunk 的全量导出门面：loader 的 `import * as vue from 'vue'`（宿主
// 注入给运行期插件的 host.vue）必须是完整 vue API——没有这个门面 entry，
// rollup tree-shaking 只保留主 app 恰好用到的导出（Teleport / watchEffect / …
// 被摇掉），插件侧 host.vue.xxx 就 undefined 了（U2）。
export * from 'vue'
