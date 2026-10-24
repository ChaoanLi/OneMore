import { t } from './i18n'
import Taro from '@tarojs/taro'
import { ApiError } from './api'
import { requestContext } from './requestContext'

export function toast(title: string) {
  void Taro.showToast({ title, icon: 'none', duration: 2000 })
}

export function toastOk(title: string) {
  void Taro.showToast({ title, icon: 'success', duration: 1500 })
}

export function toastError(e: unknown) {
  if (e instanceof ApiError && e.code === 'stale_context') return
  const msg = e instanceof ApiError ? e.message : e instanceof Error ? t(e.message) : t('出了点问题')
  toast(msg)
}

export async function confirm(title: string, content: string, confirmText = t('确定')): Promise<boolean> {
  const r = await Taro.showModal({ title, content, confirmText, cancelText: t('再想想'), confirmColor: '#FF2B2B' })
  return r.confirm
}

export async function copyText(text: string, okMsg = t('已复制')) {
  try {
    await Taro.setClipboardData({ data: text })
    toast(okMsg)
  } catch {
    toast(t('复制失败，请长按选择文字复制'))
  }
}

export const isH5 = process.env.TARO_ENV === 'h5'

/** H5 可直接打开的完整链接；小程序里返回页面路径（用于分享卡片） */
export function appUrl(path: string): string {
  if (!path.startsWith('/pages/spaces/') && requestContext.capture().spaceId && !/[?&]space=/.test(path))
    path += `${path.includes('?') ? '&' : '?'}space=${requestContext.capture().spaceId}`
  if (isH5 && typeof window !== 'undefined') {
    return `${window.location.origin}${window.location.pathname}#${path}`
  }
  return path
}

export const eventPath = (code: string) => `/pages/event/detail?code=${code}&space=${requestContext.capture().spaceId ?? ''}`

export function go(url: string) {
  void Taro.navigateTo({ url })
}

export function back(fallback = '/pages/index/index') {
  const pages = Taro.getCurrentPages()
  if (pages.length > 1) void Taro.navigateBack()
  else void Taro.redirectTo({ url: fallback })
}

/** 用系统分享（手机浏览器支持时），否则复制文字 */
export async function shareText(title: string, text: string, url: string) {
  const nav = isH5 && typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : null
  if (nav?.share) {
    try {
      await nav.share({ title, text, url })
      return
    } catch {
      // 用户取消或不支持，退回复制
    }
  }
  await copyText(`${text}\n${url}`, t('链接已复制，发给朋友吧'))
}
