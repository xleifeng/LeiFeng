'use strict';

/**
 * 壳能力单一来源（P1 收口）：daemon 壳实现的任务操作回退能力。
 *
 * 这些操作（回收站/恢复/重命名/移动/重下/BT 选择/顺序）由壳层的 repository +
 * 文件操作实现，不依赖任何下载内核——此前在 task-shell.cjs（原 task-core）与
 * bootstrap-service.js 双处硬编码七项 true，P1 收敛到此。
 *
 * open/showInFolder/copyInfo 取决于系统集成能力（ProcessRunner），按装配传入。
 */

const SHELL_FALLBACK_OPERATIONS = Object.freeze({
  recycle: true,
  recover: true,
  rename: true,
  move: true,
  redownload: true,
  btSelection: true,
  btSequential: true,
});

/** 组装 runtime.fallbackOperations（taskQueryService 与 bootstrap 共用的形态） */
function shellFallbackOperations(systemIntegration = null) {
  return {
    ...SHELL_FALLBACK_OPERATIONS,
    open: systemIntegration?.getCapabilities?.().openOnHost === true,
    showInFolder: systemIntegration?.getCapabilities?.().showInFolder === true,
    copyInfo: true,
  };
}

module.exports = { SHELL_FALLBACK_OPERATIONS, shellFallbackOperations };
