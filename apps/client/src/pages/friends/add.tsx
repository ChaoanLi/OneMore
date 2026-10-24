import { t, useLocale, getLocale, useLocaleDidShow } from '../../lib/i18n'
import { View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useState } from 'react'
import { zoneLabel, type PublicUser } from '@couju/core'
import { Page } from '../../components/Page'
import { Avatar, Button, Card, Empty, Loading } from '../../components/ui'
import { ApiError, get, post } from '../../lib/api'
import { requireUser, useSession } from '../../lib/session'
import { toast, toastError } from '../../lib/ui'

/** 通过链接加好友：/pages/friends/add?h=<ID> */
export default function AddFriend() {
  useLocale()
  const { user } = useSession()
  const params = useRouter().params
  const [target, setTarget] = useState<PublicUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useLocaleDidShow(() => {
    const h = String(params.h ?? '')
    get<{ user: PublicUser }>(`/api/users/${encodeURIComponent(h)}`)
      .then((r) => {
        setTarget(r.user)
        setError(null)
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'stale_context') return
        setError(e instanceof ApiError ? e.message : t('找不到这个用户'))
      })
  })

  const add = async () => {
    if (!target) return
    const me = await requireUser('先告诉大家怎么称呼你')
    if (!me) return
    if (me.id === target.id) {
      toast(t('这是你自己'))
      return
    }
    setBusy(true)
    try {
      const r = await post<{ status: string }>('/api/friends', { handle: target.handle })
      setDone(r.status === 'accepted' ? 'accepted' : 'pending')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      {error && <Empty icon='🔍' text={error} />}
      {!error && !target && <Loading />}
      {target && (
        <Card className='mt24'>
          <View className='col gap8' style={{ alignItems: 'center' }}>
            <Avatar user={target} size='lg' />
            <View className='h2'>{target.nickname}</View>
            <View className='muted'>
              ID：{target.handle} · {zoneLabel(target.timezone, getLocale())}
            </View>
          </View>
          {done ? (
            <View className='center mt16'>
              <View className='ok-text bold'>{done === 'accepted' ? t('你们已经是好友了') : t('已发送好友请求，等 TA 确认')}</View>
              <Button kind='primary' className='mt12' onClick={() => void Taro.redirectTo({ url: '/pages/friends/index' })}>
                {t('去看看')}
              </Button>
            </View>
          ) : user?.id === target.id ? (
            <View className='center sub mt16'>{t('这是你自己的加好友链接，发给朋友吧')}</View>
          ) : (
            <Button kind='primary' block size='lg' className='mt16' loading={busy} onClick={add}>
              {t('加 TA')}
            </Button>
          )}
        </Card>
      )}
    </Page>
  )
}
