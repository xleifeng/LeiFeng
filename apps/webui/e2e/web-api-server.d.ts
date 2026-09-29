// e2e 直驱 web-api 静态面（apps/web-api 是 CJS 无类型）的本地声明（U2 验收用）
declare module '*/apps/web-api/src/server.js' {
  import type { Server } from 'node:http'
  export interface WebRequestOptions {
    client: { invoke: (method: string, params?: unknown) => Promise<unknown> }
    host?: string
    port?: number
    staticDir?: string | null
    maxBodyBytes?: number
    routes?: unknown[]
    frontendPluginsDir?: string | null
  }
  export function createWebRequestHandler(options: WebRequestOptions): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>
  export function createWebApiServer(options: WebRequestOptions): Server
  export function staticFilePath(staticDir: string, requestUrl: string): string | null
}
