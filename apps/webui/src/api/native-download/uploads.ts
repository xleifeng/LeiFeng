import { createDraftV2Schema } from '../contracts/v2/create'
import { getCsrfToken, getRpcSecret, RpcProblemError } from './client'

export function uploadTorrent(file: File, signal?: AbortSignal, onProgress?: (progress: number) => void) {
  const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const headers: Record<string, string> = { 'content-type': 'application/x-bittorrent', 'x-thunder-filename': encodeURIComponent(file.name), 'x-idempotency-key': `torrent-upload-${requestId}` }
  const secret = getRpcSecret(); if (secret) headers.authorization = `Bearer ${secret}`
  const csrf = getCsrfToken(); if (csrf) headers['x-thunder-csrf'] = csrf
  return new Promise<ReturnType<typeof createDraftV2Schema.parse>>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); let settled = false
    const fail = (error: unknown) => { if (settled) return; settled = true; reject(error) }
    const abort = () => { try { xhr.abort() } catch {}; const error = new DOMException('Upload aborted', 'AbortError'); fail(error) }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    xhr.open('POST', '/api/v2/create-drafts/torrent')
    xhr.timeout = 120000
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total) }
    xhr.onerror = () => fail(new RpcProblemError('UPLOAD_FAILED', 'torrent 上传失败'))
    xhr.ontimeout = () => fail(new RpcProblemError('UPLOAD_TIMEOUT', 'torrent 上传或解析超时，请重试'))
    xhr.onabort = () => fail(new DOMException('Upload aborted', 'AbortError'))
    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText || '{}') as { draft?: unknown; error?: { code?: string; message?: string } }
        if (xhr.status < 200 || xhr.status >= 300 || !payload.draft) throw new RpcProblemError(payload.error?.code || 'UPLOAD_FAILED', payload.error?.message || `torrent 上传失败 (${xhr.status})`)
        settled = true; resolve(createDraftV2Schema.parse(payload.draft))
      } catch (error) { fail(error) }
    }
    xhr.send(file)
  })
}
