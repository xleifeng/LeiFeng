'use strict';
// kernel-hub：下载内核聚合槽（kernel-any-only，2026-09-29）。内核插件启动时把
// 标准形状的 slot 注册进来（register 返回 withdraw，随插件生命周期撤销），
// 消费方（task-shell / product-services）只面向 hub.default()——不再硬编码
// 'leifengKernel:thunder'，任意内核可独立成在（qbit-only 等）。
// 默认内核解析：显式 defaultKernelId > KERNEL_PROTOCOL_ROUTES 表序中第一个
// 已注册内核 > null。
const { KERNEL_PROTOCOL_ROUTES } = require('../src/domain/create-router');
const { plugin } = require('./shared.cjs');

const kernelHub = plugin('leifeng-kernel-hub', ['leifengConfig'], (ctx, options = {}) => {
  const slots = new Map();
  const explicitDefault = typeof options.defaultKernelId === 'string' && options.defaultKernelId
    ? options.defaultKernelId : null;

  function register(slot) {
    if (!slot || typeof slot !== 'object') throw new TypeError('kernel-hub: slot must be an object');
    if (typeof slot.kernelId !== 'string' || !slot.kernelId) throw new TypeError('kernel-hub: slot.kernelId is required');
    if (!slot.kernel) throw new TypeError('kernel-hub: slot.kernel (KernelPort) is required');
    if (slots.has(slot.kernelId)) throw new Error(`kernel-hub: duplicate kernel ${slot.kernelId}`);
    slots.set(slot.kernelId, slot);
    return () => { if (slots.get(slot.kernelId) === slot) slots.delete(slot.kernelId); };
  }

  function defaultSlot() {
    if (explicitDefault) {
      const slot = slots.get(explicitDefault);
      if (slot) return slot;
      throw new Error(`kernel-hub: defaultKernelId "${explicitDefault}" is not registered`);
    }
    for (const kernelId of Object.keys(KERNEL_PROTOCOL_ROUTES)) {
      const slot = slots.get(kernelId);
      if (slot) return slot;
    }
    return null;
  }

  const get = (id) => slots.get(id) || null;
  const list = () => [...slots.values()];
  ctx.provide('leifengKernelHub', { register, default: defaultSlot, get, list });
  return () => { slots.clear(); };
});

module.exports = { kernelHub };
