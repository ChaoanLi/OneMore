import Taro from '@tarojs/taro'
import { requestContext } from './requestContext'

/**
 * HTTP 客户端。
 * H5：与 API 同源（开发时 devServer 代理 /api），TARO_APP_API_BASE 留空即可。
 * 小程序：需要 https 合法域名，或改用 CloudBase 的 wx.cloud.callContainer（尚未接入）。
 */
const BASE = process.env.TARO_APP_API_BASE || ''

export function setApiToken(t: string | null) {
  requestContext.setIdentity(t)
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const snapshot = requestContext.capture()
  const routeSpace = Taro.getCurrentInstance()?.router?.params?.space
  const isGlobal =
    path === '/api/me' ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/spaces') ||
    path.startsWith('/api/space-invites/') ||
    path === '/api/me/recovery-code' ||
    path.endsWith('/status') ||
    path === '/api/games'
  if (!isGlobal && (!snapshot.spaceId || (routeSpace && routeSpace !== snapshot.spaceId)))
    throw new ApiError(0, 'stale_context', '请先选择或加入此空间')
  let res: Taro.request.SuccessCallbackResult<any>
  try {
    res = await Taro.request({
      url: `${BASE}${path}`,
      method,
      data: body as any,
      header: {
        'Content-Type': 'application/json',
        ...(snapshot.token ? { Authorization: `Bearer ${snapshot.token}` } : {}),
        ...(!isGlobal && snapshot.spaceId ? { 'X-Space-Id': snapshot.spaceId } : {}),
      },
      dataType: 'json',
      timeout: 20000,
    })
  } catch {
    throw new ApiError(0, 'network', '网络好像不太稳定，稍后再试')
  }
  if (!requestContext.isCurrent(snapshot)) throw new ApiError(0, 'stale_context', '空间已切换')
  if (res.statusCode >= 400) {
    const data = (res.data ?? {}) as { error?: string; message?: string }
    throw new ApiError(res.statusCode, data.error ?? 'error', data.message ?? '出了点问题')
  }
  return res.data as T
}

export const get = <T>(path: string) => api<T>('GET', path)
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body ?? {})
export const put = <T>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {})
export const patch = <T>(path: string, body?: unknown) => api<T>('PATCH', path, body ?? {})
export const del = <T>(path: string) => api<T>('DELETE', path)
