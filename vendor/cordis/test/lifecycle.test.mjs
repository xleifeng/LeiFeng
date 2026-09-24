import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, FiberState } from '@tlei/cordis'

test('provider unload releases dependent plugin', async () => {
  const root = new Context()
  const released = []
  const provider = await root.plugin(ctx => {
    ctx.provide('tleiProbe', {})
  })
  const consumer = await root.plugin({ inject: ['tleiProbe'], apply() { return () => released.push('consumer') } })
  assert.equal(consumer.state, FiberState.ACTIVE)
  await provider.dispose()
  assert.equal(consumer.state, FiberState.PENDING)
  assert.deepEqual(released, ['consumer'])
  await root.fiber.dispose()
})

test('async cleanup completes before dispose resolves', async () => {
  const root = new Context()
  const released = []
  const fiber = await root.plugin(() => async () => {
    await new Promise(resolve => setTimeout(resolve, 10))
    released.push('done')
  })
  await fiber.dispose()
  assert.deepEqual(released, ['done'])
  await root.fiber.dispose()
})

test('unload during async setup waits for returned cleanup', async () => {
  const root = new Context()
  const released = []
  let releaseSetup
  const setupGate = new Promise(resolve => { releaseSetup = resolve })
  const fiber = root.plugin(async () => {
    await setupGate
    return async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      released.push('cleanup')
    }
  })
  assert.equal(fiber.state, FiberState.LOADING)
  const disposing = fiber.dispose()
  assert.deepEqual(released, [])
  releaseSetup()
  await disposing
  assert.deepEqual(released, ['cleanup'])
  assert.equal(fiber.state, FiberState.DISPOSED)
  await root.fiber.dispose()
})

test('disposing parent disposes child fiber', async () => {
  const root = new Context()
  const released = []
  const parent = await root.plugin(async ctx => {
    await ctx.plugin(() => () => released.push('child'))
    return () => released.push('parent')
  })
  await parent.dispose()
  assert.deepEqual([...released].sort(), ['child', 'parent'])
  await root.fiber.dispose()
})
