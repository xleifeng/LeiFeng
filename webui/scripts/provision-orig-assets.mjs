#!/usr/bin/env node
// webui/scripts/provision-orig-assets.mjs
// 幂等：从原版 renderer 解包目录复制资产到 webui/src/assets/orig/。
// 字体若为 otf/woff/ttf 任意扩展名都尝试；缺失文件 / 缺失目录 / nav_bar SVG 缺失时优雅降级并打印 WARN。
// 蜂鸟 logo：尝试从 main-renderer/index.html 提取 <path fill="#3F85FF">；若不存在则退化为拷贝 static/svg/xunlei-bird.svg。
// fontTools (pyftsubset) 缺失时仍可复制其他资产，仅 D-DIN-PRO.woff2 步骤报 WARN。
import { cpSync, mkdirSync, readdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC = process.env.ORIG_TREE || '/tmp/orig-ui-serve'
const DST = resolve(__dirname, '../src/assets/orig')

// --- 准备目录 ---
for (const sub of ['css', 'fonts', 'img', 'svg']) {
  mkdirSync(`${DST}/${sub}`, { recursive: true })
}

const log = (...a) => console.log('[provision]', ...a)
const warn = (msg) => console.warn('[provision] WARN:', msg)

// --- 1) 字体子集化 D-DIN-PRO（数字+拉丁）---
// 原版解包常见：D-DIN-PRO-700-Bold.ttf（只有 Bold 子文件），也可能是 D-DIN-PRO.ttf / .otf / .woff / .woff2
const fontCandidates = [
  `${SRC}/static/font/D-DIN-PRO.ttf`,
  `${SRC}/static/font/D-DIN-PRO-700-Bold.ttf`,
  `${SRC}/static/font/D-DIN-PRO.otf`,
  `${SRC}/static/font/D-DIN-PRO.woff`,
  `${SRC}/static/font/D-DIN-PRO.woff2`,
]
const fontSrc = fontCandidates.find((p) => existsSync(p))
const fontOut = `${DST}/fonts/D-DIN-PRO.woff2`

if (!fontSrc) {
  warn(`未找到 D-DIN-PRO 字体（尝试过 ${fontCandidates.length} 个候选路径），跳过字体子集化。请确认原版 renderer 解包目录 ${SRC}/static/font/。`)
} else {
  // 检查 fontTools 是否可用
  let pyftsubsetOk = false
  try {
    execFileSync('python3', ['-c', 'import fontTools.subset'], { stdio: 'pipe' })
    pyftsubsetOk = true
  } catch {
    warn('fontTools (python3 -m fontTools.subset) 不可用，跳过 D-DIN-PRO.woff2 子集化。安装: pip3 install fonttools')
  }
  if (pyftsubsetOk) {
    try {
      const subsetText = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz%.,:/-_()[] '
      execFileSync(
        'python3',
        [
          '-m', 'fontTools.subset',
          fontSrc,
          `--text=${subsetText}`,
          `--output-file=${fontOut}`,
          '--flavor=woff2',
          '--layout-features=*',
          '--no-hinting',
        ],
        { stdio: 'inherit' },
      )
      log(`font subset ok: ${basename(fontSrc)} -> ${fontOut}`)
    } catch (e) {
      warn(`pyftsubset 失败 (${e.message}); 跳过字体子集化。`)
    }
  }
}

// --- 2) 原版插画 PNG 白名单拷贝（缺失跳过，不报错）---
const IMGS = [
  'download-default.png',
  'trash-empty.png',
  'trash-empty-dark.png',
  'setting-svip.png',
  'network-error.png',
  'network-error-dark.png',
  'file_empty.png',
  'newlink_empty.png',
  'im-empty.png',
  'im-empty-dark.png',
  'recent-play-empty.png',
  'private-down.png',
  'general.png',
]
let imgCopied = 0
for (const f of IMGS) {
  const p = `${SRC}/static/image/${f}`
  if (existsSync(p)) {
    cpSync(p, `${DST}/img/${f}`)
    imgCopied++
  } else {
    warn(`image missing (skip): ${f}`)
  }
}
log(`images copied: ${imgCopied}/${IMGS.length}`)

// --- 3) 原版导航 SVG 图标 ---
// brief 提到 2025_ic_nav_bar_*；若该命名不存在则尝试任何 *_nav_*.svg / nav*.svg
const svgDir = `${SRC}/static/svg`
let navCopied = 0
if (existsSync(svgDir)) {
  const all = readdirSync(svgDir).filter((f) => f.endsWith('.svg'))
  const navFiles = all.filter((f) => /nav_bar|nav-bar|ic_nav|nav_/i.test(f))
  if (navFiles.length === 0) {
    warn('未找到任何 nav_bar/nav 相关 SVG，原版 renderer 可能未携带导航图标资产。Task 2 起需要补图时再来校对。')
  }
  for (const f of navFiles) {
    cpSync(`${svgDir}/${f}`, `${DST}/svg/${f}`)
    navCopied++
  }
} else {
  warn(`SVG 目录不存在: ${svgDir}`)
}
log(`nav SVGs copied: ${navCopied}`)

// --- 4) 蜂鸟 logo ---
// 优先从 main-renderer/index.html 提取内联 <path fill="#3F85FF">；
// 退化：拷贝 static/svg/xunlei-bird.svg。
const logoOut = `${DST}/svg/logo-hummingbird.svg`
const indexCandidates = [
  `${SRC}/main-renderer/index.html`,
  `${SRC}/index.html`,
]
const indexPath = indexCandidates.find((p) => existsSync(p))
let logoExtracted = false

if (indexPath) {
  try {
    const html = readFileSync(indexPath, 'utf8')
    // 匹配 <svg ...>...<path ... fill="#3F85FF" .../>...</svg>
    const m = html.match(/<svg[\s\S]*?fill="#3F85FF"[\s\S]*?<\/svg>/)
    if (m) {
      writeFileSync(logoOut, m[0])
      logoExtracted = true
      log(`hummingbird logo extracted from ${basename(indexPath)} -> ${logoOut}`)
    }
  } catch (e) {
    warn(`提取蜂鸟 logo 失败: ${e.message}`)
  }
}

if (!logoExtracted) {
  const fallback = `${SRC}/static/svg/xunlei-bird.svg`
  if (existsSync(fallback)) {
    cpSync(fallback, logoOut)
    log(`hummingbird logo fallback copy from static/svg/xunlei-bird.svg`)
  } else {
    warn('蜂鸟 logo 提取失败且 static/svg/xunlei-bird.svg 不存在；Task 2 接入时需要重新校对来源。')
  }
}

log('provision done ->', DST)
