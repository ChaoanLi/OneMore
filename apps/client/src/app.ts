import { PropsWithChildren } from 'react'
import { createElement, Fragment } from 'react'
import { useLaunch } from '@tarojs/taro'
import { bootSession, useSession } from './lib/session'

import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  const session=useSession()
  useLaunch(() => {
    // 读取本地登录令牌并刷新用户资料（无令牌时保持访客未登录状态）
    void bootSession()
  })

  // children 是将要会渲染的页面
  return createElement(Fragment, {key: `${session.user?.id ?? 'guest'}:${session.activeSpace ?? 'none'}:${session.revision}`}, children)
}

export default App
