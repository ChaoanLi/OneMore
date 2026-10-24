import { Button as TaroButton } from '@tarojs/components'
import { useShareAppMessage } from '@tarojs/taro'
import type { PropsWithChildren } from 'react'
import { APP_NAME } from '../lib/brand'

/**
 * 小程序里“复制链接”发给朋友没用（复制出来只是页面路径），改用分享卡片。
 * 按钮把要分享的路径和标题放在 data-* 上，页面用 useShareFromButton 读出来。
 * 使用的页面需要在 *.config.ts 里打开 enableShareAppMessage。
 */
export function ShareButton(props: PropsWithChildren<{ path: string; title: string; className?: string }>) {
  return (
    <TaroButton className={`btn btn--primary btn--block ${props.className ?? ''}`} openType='share' data-path={props.path} data-title={props.title}>
      {props.children}
    </TaroButton>
  )
}

/** 页面级分享：点 ShareButton 时分享按钮上的路径，点右上角菜单时分享 fallback */
export function useShareFromButton(fallback: () => { title: string; path: string } = () => ({ title: APP_NAME, path: '/pages/index/index' })) {
  useShareAppMessage((res) => {
    const data = (res.target as { dataset?: { path?: string; title?: string } } | undefined)?.dataset
    if (res.from === 'button' && data?.path) return { title: data.title || APP_NAME, path: data.path }
    return fallback()
  })
}
