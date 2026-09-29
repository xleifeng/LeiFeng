// webui/e2e/pixel-diff.mjs — usage: node e2e/pixel-diff.mjs <actual.png> <orig.png> <diff.png>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
const [ , , actualPath, origPath, diffPath] = process.argv
const a = PNG.sync.read(readFileSync(actualPath)); const o = PNG.sync.read(readFileSync(origPath))
if (a.width !== o.width || a.height !== o.height) { console.error(`尺寸不一致: ${a.width}x${a.height} vs ${o.width}x${o.height}`); process.exit(2) }
const diff = new PNG({ width: a.width, height: a.height })
const mismatch = pixelmatch(a.data, o.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: false })
const pct = (mismatch / (a.width * a.height)) * 100
mkdirSync(diffPath.slice(0, diffPath.lastIndexOf('/')), { recursive: true })
writeFileSync(diffPath, PNG.sync.write(diff))
console.log(JSON.stringify({ mismatchPct: +pct.toFixed(2), pass: pct <= 5 }))
process.exit(pct <= 5 ? 0 : 1)
