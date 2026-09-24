'use strict';

const { detectNativeCapabilities } = require('./native-capabilities');

const SIDE_EFFECT_CAPABILITIES = new Set(['recycle', 'recover', 'rename', 'move', 'redownload', 'perTaskRateLimit', 'bt.updateSelection', 'bt.sequential', 'bt.getSeed', 'network.proxy', 'network.proxyVerify', 'network.p2pSwitch', 'network.p2sSwitch', 'network.autoMoveLowSpeed']);

function probeNativeCapabilities({ tm, NativeTaskInterface, NativeDkHelper, sdkVersion, allowDestructive = false } = {}) {
  const report = detectNativeCapabilities({ tm, NativeTaskInterface, NativeDkHelper, sdkVersion });
  const result = JSON.parse(JSON.stringify(report));
  if (!allowDestructive) {
    for (const name of SIDE_EFFECT_CAPABILITIES) {
      if (result.flat[name] === 'present') result.flat[name] = 'not-probed';
    }
  }
  result.probe = { mode: allowDestructive ? 'destructive-enabled' : 'safe-presence-only', checkedAt: Date.now(), sideEffectCapabilities: [...SIDE_EFFECT_CAPABILITIES] };
  return result;
}

module.exports = { probeNativeCapabilities, SIDE_EFFECT_CAPABILITIES };
