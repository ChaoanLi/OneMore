import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { bootSession } from './lib/session'

import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    // 读取本地登录令牌并刷新用户资料（无令牌时保持访客未登录状态）
    void bootSession()
  })

  // children 是将要会渲染的页面
  return children
}

export default App
