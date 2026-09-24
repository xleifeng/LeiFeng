'use strict';

function classifyVipAccount(account = {}) {
  const isVip = account.isVip === true;
  const userVas = Number(account.userVas) || 0;
  const vipType = Number(account.vipType) || 0;
  const vipLevel = Number(account.vipLevel) || 0;
  const legacy = userVas === 0;
  const isSuperVip = isVip && (
    (userVas === 2 && vipType === 5)
    || (userVas === 306 && vipType === 10)
    || (legacy && (vipType === 5 || vipType === 10))
  );
  const isPlatinumVip = isVip && (
    (userVas === 2 && (vipType === 2 || vipType === 3))
    || (legacy && (vipType === 2 || vipType === 3))
  );
  const isPanVip = isVip && userVas === 306 && vipType === 5;
  const isDownloadVip = isSuperVip || isPlatinumVip;
  return {
    isVip,
    userVas,
    vipType,
    vipLevel,
    isSuperVip,
    isPlatinumVip,
    isPanVip,
    isDownloadVip,
    channel: isDownloadVip ? 'super-channel' : 'none',
  };
}

module.exports = { classifyVipAccount };
