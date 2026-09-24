import { RpcProblemError } from './native-download/client'

export interface ApiProblem { code: string; message: string; category: string; retryable: boolean; details?: unknown }

export function normalizeProblem(error: unknown): ApiProblem {
  if (error instanceof RpcProblemError) {
    const code = String(error.code)
    return { code, message: error.message, category: code.startsWith('AUTH') ? 'auth' : code.includes('NETWORK') ? 'network' : 'daemon', retryable: ['ENGINE_UNAVAILABLE', 'REMOTE_NODE_OFFLINE', 'REVISION_CONFLICT', 'HTTP_ERROR'].includes(code), details: error.details }
  }
  if (error instanceof Error) return { code: 'CLIENT_ERROR', message: error.message, category: 'client', retryable: false }
  return { code: 'UNKNOWN_ERROR', message: '请求失败，请稍后重试', category: 'client', retryable: false }
}
