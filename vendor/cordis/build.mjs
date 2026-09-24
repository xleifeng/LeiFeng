import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = dirname(fileURLToPath(import.meta.url))
for (const name of ['core', 'loader', 'include']) {
  const directory = join(root, 'packages', name)
  await rm(join(directory, 'lib'), { recursive: true, force: true })
  await rm(join(directory, 'tsconfig.tsbuildinfo'), { force: true })
  await mkdir(join(directory, 'lib'), { recursive: true })
  await build({
    entryPoints: [join(directory, 'src/index.ts')],
    outfile: join(directory, 'lib/index.js'),
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: false,
    logLevel: 'warning',
  })
  execFileSync(process.execPath, [join(root, '..', '..', 'node_modules/typescript/bin/tsc'), '-p', join(directory, 'tsconfig.json')], { stdio: 'inherit' })
}
