import { t, useLocale } from '../lib/i18n'
import { View } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { get, post } from '../lib/api'
import { makePageUrl } from '../lib/pageUrl'
import { refreshSpaces, requireUser, selectSpace, useSession } from '../lib/session'
import { toastError } from '../lib/ui'
import { Button } from './ui'

type Preview = { space: { id: string; name: string }; member: boolean; joinable: boolean }

/** 打开别的组的局链接：直接加入那个组，然后回到这局（带 joined=1 让详情页告诉用户） */
export function EventLinkJoin(props: { spaceId: string; code: string }) {
  useLocale()
  const { user } = useSession()
  const router = useRouter()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  const join = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (!(await requireUser('先告诉大家你是谁，再加入组'))) return
      await post(`/api/spaces/${props.spaceId}/event-links/${props.code}/join`)
      await refreshSpaces()
      await selectSpace(props.spaceId, makePageUrl(router.path, { ...router.params, joined: '1' }))
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void get<Preview>(`/api/spaces/${props.spaceId}/event-links/${props.code}`)
      .then(setPreview)
      .catch(() => setFailed(true))
  }, [props.spaceId, props.code])

  useEffect(() => {
    // 已经有身份的人直接加入，不用再点
    if (!preview?.joinable || !user || started.current) return
    started.current = true
    void join()
  }, [preview, user?.id])

  if (failed) return <View className='muted mt12'>{t('链接已失效')}</View>
  if (!preview) return <View className='muted mt12'>{t('加载中…')}</View>
  if (!preview.joinable)
    return <View className='muted mt12'>{t('这局的链接不能用来加入组，请找组里的人要邀请链接')}</View>
  return (
    <View className='mt12'>
      <View className='sub'>{t('这局在「{0}」组里。加入组就能报名，组长会收到通知。', preview.space.name)}</View>
      <Button kind='primary' className='mt16' loading={busy} onClick={() => void join()}>
        {user ? t('正在加入「{0}」…', preview.space.name) : t('加入「{0}」并查看这局', preview.space.name)}
      </Button>
    </View>
  )
}
