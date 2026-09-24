import { mediaTokenSchema, type MediaToken } from '../contracts/v2/media'
import { getCsrfToken, getPrivateSession, getRpcSecret } from './client'

export async function issueMediaToken(taskId: string, fileIndex?: number, disposition: 'inline' | 'attachment' = 'inline'): Promise<MediaToken> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const secret = getRpcSecret(); if (secret) headers.authorization = `Bearer ${secret}`
  const session = getPrivateSession(); if (session) headers['x-thunder-private-session'] = session
  const csrf = getCsrfToken(); if (csrf) headers['x-thunder-csrf'] = csrf
  const response = await fetch(`/api/v2/tasks/${encodeURIComponent(taskId)}/files/${String(fileIndex ?? 0)}/media-token`, { method: 'POST', headers, body: JSON.stringify({ disposition }) })
  const payload = await response.json() as { error?: { code?: string, message?: string }, [key: string]: unknown }
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `媒体令牌请求失败 (${response.status})`)
  return mediaTokenSchema.parse(payload)
}

export function buildMediaContentUrl(taskId: string, fileIndex: number | undefined, token: string): string {
  const encodedTask = encodeURIComponent(taskId)
  const encodedIndex = String(fileIndex ?? 0)
  return `/api/v2/tasks/${encodedTask}/files/${encodedIndex}/content?token=${encodeURIComponent(token)}`
}
