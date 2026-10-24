import { t, useLocale, useLocaleDidShow } from '../../lib/i18n'
import { Input, Text, View } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { useRef, useState } from 'react'
import type { Circle, CirclesResponse, FriendsResponse } from '@couju/core'
import { Page } from '../../components/Page'
import { Button, Card, Chip, Empty, SectionTitle } from '../../components/ui'
import { del, get, post, put } from '../../lib/api'
import { back, confirm, toast, toastError } from '../../lib/ui'

/** 新建/编辑私人圈子（只有自己看得到，成员不会收到通知） */
export default function CircleEdit() {
  useLocale()
  const params = useRouter().params
  const id = params.id ? String(params.id) : null
  const hydrated = useRef(false)
  const edited = useRef(false)
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [friends, setFriends] = useState<FriendsResponse['friends']>([])
  const [busy, setBusy] = useState(false)

  useLocaleDidShow(() => {
    Promise.all([get<FriendsResponse>('/api/friends'), get<CirclesResponse>('/api/circles')])
      .then(([f, c]) => {
        setFriends(f.friends)
        const circle = c.circles.find((x) => x.id === id)
        if (circle && !hydrated.current && !edited.current) {
          setName(circle.name)
          setMembers(circle.memberIds)
        }
        hydrated.current = true
      })
      .catch(toastError)
  })

  const save = async () => {
    if (!name.trim()) {
      toast(t('给圈子起个名字'))
      return
    }
    setBusy(true)
    try {
      const body = { name: name.trim(), memberIds: members }
      if (id) await put<{ circle: Circle }>(`/api/circles/${id}`, body)
      else await post<{ circle: Circle }>('/api/circles', body)
      toast(t('已保存'))
      back('/pages/friends/index')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page
      footer={
        <Button kind='primary' block size='lg' loading={busy} onClick={save}>
          {t('保存')}
        </Button>
      }
    >
      <View className='row row--between'>
        <View className='h1'>{id ? t('编辑圈子') : t('新建圈子')}</View>
        <Text className='link' onClick={() => back('/pages/friends/index')}>
          {t('取消')}
        </Text>
      </View>
      <View className='sub mt4'>{t('圈子只有你自己看得到，成员不会收到通知。')}</View>
      <Card className='mt16'>
        <Input
          className='input'
          placeholder={t('比如：麻将搭子')}
          maxlength={20}
          value={name}
          onInput={(e) => {
            edited.current = true
            setName(e.detail.value)
          }}
        />
      </Card>
      <SectionTitle title={t('成员（{0}）', members.length)} />
      <Card>
        {friends.length === 0 && <Empty icon='🤝' text={t('先加几个好友')} />}
        <View className='row wrap gap8'>
          {friends.map((f) => (
            <Chip
              key={f.user.id}
              on={members.includes(f.user.id)}
              onClick={() => {
                edited.current = true
                setMembers(members.includes(f.user.id) ? members.filter((x) => x !== f.user.id) : [...members, f.user.id])
              }}
            >
              {f.user.avatar} {f.user.nickname}
            </Chip>
          ))}
        </View>
      </Card>
      {id && (
        <View className='center mt24'>
          <Text
            className='link'
            style={{ color: '#dc3c3c' }}
            onClick={async () => {
              if (!(await confirm(t('删除这个圈子？'), t('不会影响好友关系。'), t('删除')))) return
              await del(`/api/circles/${id}`).catch(toastError)
              back('/pages/friends/index')
            }}
          >
            {t('删除圈子')}
          </Text>
        </View>
      )}
    </Page>
  )
}
