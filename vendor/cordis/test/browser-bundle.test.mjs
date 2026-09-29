// P6（cordis-arch）：browser Cordis 验证（母文档 §8.4 第 2 步门槛）。
// vendored core 经 esbuild 打 browser IIFE 后在无头浏览器里跑 Context/plugin/
// provide/reflect.get/dispose 全链路——「现有产物即开即用」结论由本用例持续守卫。
// 依赖：仓库根 node_modules/esbuild + apps/webui 的 playwright chromium；缺任一即失败
// （两者都在 workspace 安装面内，缺席说明安装坏了，不该静默跳过）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const coreLib = join(repoRoot, 'vendor/cordis/packages/core/lib/index.js')

async function chromiumLauncher() {
  const { chromium } = await import(join(repoRoot, 'apps/webui/node_modules/playwright/index.mjs'))
  return chromium
}

test('vendored cordis core 可打进 browser bundle 且 Context 全链路可用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'leifeng-cordis-browser-'))
  try {
    // 1) esbuild browser IIFE 打包（platform:browser 遇 node 内置依赖会直接报错）
    await build({
      entryPoints: [coreLib],
      bundle: true, platform: 'browser', format: 'iife', globalName: '__cordisProbe',
      outfile: join(dir, 'probe.js'), write: true, logLevel: 'warning',
    })
    // 2) 探针页：provide/reflect.get/dispose 时序断言（与 node侧行为一致）
    const html = `<!doctype html><meta charset="utf8"><script src="probe.js"></script>
<script>
const out = [];
(async () => {
  const { Context } = window.__cordisProbe;
  const root = new Context();
  const f1 = root.plugin({ inject: [], apply(ctx) { ctx.provide('probeSvc', { v: 7 }); } });
  await f1;
  out.push('provide:' + JSON.stringify(root.reflect.get('probeSvc', false)));
  let seen = 'unset';
  const f2 = root.plugin({ inject: [], apply(ctx) { seen = ctx.reflect.get('probeSvc', false)?.v; } });
  await f2;
  out.push('apply-optional:' + seen);
  await f1.dispose();
  out.push('after-dispose:' + JSON.stringify(root.reflect.get('probeSvc', false)));
  document.title = 'PROBE_OK ' + out.join('|');
})().catch((error) => { document.title = 'PROBE_FAIL ' + error.message; });
</script>`
    await writeFile(join(dir, 'probe.html'), html)

    // 3) 无头浏览器执行
    const chromium = await chromiumLauncher()
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.goto(pathToFileURL(join(dir, 'probe.html')).href)
      await page.waitForFunction(() => document.title.startsWith('PROBE_'), null, { timeout: 5000 })
      const title = await page.title()
      assert.match(title, /^PROBE_OK/, `浏览器探针失败: ${title}`)
      assert.match(title, /provide:\{"v":7\}/)
      assert.match(title, /apply-optional:7/)
      assert.match(title, /after-dispose:undefined/)
    } finally {
      await browser.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
