'use strict';

const MAX_CERTS = 64;
const MAX_TOKEN_LENGTH = 16384;

function safeIndex(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) >= -1 ? Number(value) : null;
}

function validateCerts(certs) {
  if (!Array.isArray(certs) || certs.length < 1 || certs.length > MAX_CERTS) throw new Error('invalid cert batch');
  const seen = new Set();
  return certs.map((item) => {
    if (!item || safeIndex(item.fileIndex) === null || typeof item.token !== 'string' || item.token.length < 1 || item.token.length > MAX_TOKEN_LENGTH || /[\r\n]/.test(item.token))
      throw new Error('invalid cert item');
    const fileIndex = safeIndex(item.fileIndex);
    if (seen.has(fileIndex)) throw new Error('duplicate file index');
    seen.add(fileIndex);
    return { fileIndex, token: item.token };
  });
}

function validateEngineId(value) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error('invalid engine id');
  return Number(value);
}

function validateFileIndices(fileIndices) {
  if (!Array.isArray(fileIndices) || fileIndices.length > MAX_CERTS) throw new Error('invalid file index batch');
  const seen = new Set();
  return fileIndices.map((value) => {
    const index = safeIndex(value);
    if (index === null || seen.has(index)) throw new Error('invalid or duplicate file index');
    seen.add(index);
    return index;
  });
}

function createVipHandlers({ tm, NativeTaskInterface }) {
  if (!tm || !NativeTaskInterface) throw new Error('VIP native dependencies missing');
  const findHandle = (engineId) => {
    const id = validateEngineId(engineId);
    const task = tm.findTaskById(id);
    if (!task || task.t === undefined || task.t === null) throw new Error('task handle unavailable');
    return task.t;
  };
  return {
    enableVipDcdn: ({ engineId, certs }) => {
      const handle = findHandle(engineId);
      const items = [];
      for (const cert of validateCerts(certs)) {
        let invoked = false;
        let errorCode = '';
        let token = cert.token;
        try {
          NativeTaskInterface.enableDcdnWithVipCert(handle, token, cert.fileIndex);
          invoked = true; // wrapper 返回 undefined 仍表示同步调用完成，不命名为 authorized/success。
        } catch { errorCode = 'native-throw'; }
        token = null;
        items.push({ fileIndex: cert.fileIndex, invoked, errorCode });
      }
      return { ok: items.every((item) => item.invoked), items };
    },
    disableVipDcdn: ({ engineId, fileIndices }) => {
      const handle = findHandle(engineId);
      const items = [];
      for (const fileIndex of validateFileIndices(fileIndices)) {
        let invoked = false;
        let errorCode = '';
        try {
          NativeTaskInterface.disableDcdnWithVipCert(handle, fileIndex);
          invoked = true;
        } catch { errorCode = 'native-throw'; }
        items.push({ fileIndex, invoked, errorCode });
      }
      return { ok: items.every((item) => item.invoked), items };
    },
  };
}

module.exports = { createVipHandlers, validateCerts, validateFileIndices, validateEngineId, MAX_CERTS, MAX_TOKEN_LENGTH };
