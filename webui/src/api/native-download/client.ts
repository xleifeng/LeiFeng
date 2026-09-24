import { rpcProblemSchema } from '../contracts/v2/common'

const SECRET_SESSION_KEY = 'ThunderNativeUI.RpcSecret.Session.v1'
const SECRET_LOCAL_KEY = 'ThunderNativeUI.RpcSecret.v1'
const PRIVATE_SESSION_KEY = 'ThunderNativeUI.PrivateSession.v1'
const CSRF_SESSION_KEY = 'ThunderNativeUI.CsrfSession.v1'
export const RPC_AUTH_REQUIRED_EVENT = 'thunder:rpc-auth-required'

export class RpcProblemError extends Error {
  readonly code: string
  readonly details: unknown
  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'RpcProblemError'
    this.code = code
    this.details = details
  }
}

export function getRpcSecret(): string {
  return sessionStorage.getItem(SECRET_SESSION_KEY) || localStorage.getItem(SECRET_LOCAL_KEY) || ''
}

export function setRpcSecret(secret: string, remember: boolean): void {
  sessionStorage.removeItem(SECRET_SESSION_KEY)
  localStorage.removeItem(SECRET_LOCAL_KEY)
  if (!secret) return
  ;(remember ? localStorage : sessionStorage).setItem(remember ? SECRET_LOCAL_KEY : SECRET_SESSION_KEY, secret)
}

export function clearRpcSecret(): void { setRpcSecret('', false) }
export function getPrivateSession(): string { return sessionStorage.getItem(PRIVATE_SESSION_KEY) || '' }
export function setPrivateSession(token: string): void { if (token) sessionStorage.setItem(PRIVATE_SESSION_KEY, token); else sessionStorage.removeItem(PRIVATE_SESSION_KEY) }
export function getCsrfToken(): string { return sessionStorage.getItem(CSRF_SESSION_KEY) || '' }
export function setCsrfToken(token: string): void { if (token) sessionStorage.setItem(CSRF_SESSION_KEY, token); else sessionStorage.removeItem(CSRF_SESSION_KEY) }

let nextId = 1

function isUnauthorizedProblem(code: string, message: string): boolean {
  const normalized = code.toUpperCase()
  return code === '1' || normalized === 'UNAUTHORIZED' || normalized === 'AUTH_REQUIRED' || /unauthorized|未授权/i.test(message)
}

function throwRpcProblem(code: string, message: string, details?: unknown): never {
  if (isUnauthorizedProblem(code, message) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RPC_AUTH_REQUIRED_EVENT, { detail: { code, message } }))
  }
  throw new RpcProblemError(code, message, details)
}

export async function rpcV2<T>(method: string, params: unknown[] = [], signal?: AbortSignal): Promise<T> {
  const secret = getRpcSecret()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (secret) headers.authorization = `Bearer ${secret}`
  const privateSession = getPrivateSession()
  if (privateSession) headers['x-thunder-private-session'] = privateSession
  const csrf = getCsrfToken()
  if (csrf) headers['x-thunder-csrf'] = csrf
  const response = await fetch('/jsonrpc', {
    method: 'POST', signal, headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
  if (!response.ok) throw new RpcProblemError('HTTP_ERROR', `daemon HTTP ${response.status}`)
  const payload = await response.json() as { result?: T; error?: unknown }
  if (payload.error) {
    const problem = rpcProblemSchema.safeParse(payload.error)
    if (problem.success) throwRpcProblem(problem.data.code, problem.data.message, problem.data.details)
    const fallbackError = payload.error as { code?: string | number; message?: string }
    throwRpcProblem(String(fallbackError.code || 'RPC_ERROR'), fallbackError.message || 'RPC 请求失败')
  }
  const result = payload.result as T
  if (method === 'thunder.ui.v2.bootstrap') {
    const security = (result as { security?: { csrfToken?: string } } | null)?.security
    if (security?.csrfToken) setCsrfToken(security.csrfToken)
  }
  return result
}
