import Taro from '@tarojs/taro'
import { ApiError } from './api'

export function toast(title: string) {
  void Taro.showToast({ title, icon: 'none', duration: 2000 })
}

export function toastOk(title: string) {
  void Taro.showToast({ title, icon: 'success', duration: 1500 })
}

export function toastError(e: unknown) {
  const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : '出了点问题'
  toast(msg)
}

export async function confirm(title: string, content: string, confirmText = '确定'): Promise<boolean> {
  const r = await Taro.showModal({ title, content, confirmText, cancelText: '再想想', confirmColor: '#F2652D' })
  return r.confirm
}

export async function copyText(text: string, okMsg = '已复制') {
  try {
    await Taro.setClipboardData({ data: text })
    toast(okMsg)
  } catch {
    toast('复制失败，请长按选择文字复制')
  }
}

export const isH5 = process.env.TARO_ENV === 'h5'

/** H5 可直接打开的完整链接；小程序里返回页面路径（用于分享卡片） */
export function appUrl(path: string): string {
  if (isH5 && typeof window !== 'undefined') {
    return `${window.location.origin}${window.location.pathname}#${path}`
  }
  return path
}

export const eventPath = (code: string) => `/pages/event/detail?code=${code}`

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
  await copyText(`${text}\n${url}`, '链接已复制，发给朋友吧')
}
