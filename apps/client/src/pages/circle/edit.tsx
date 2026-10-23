import { Input, Text, View } from '@tarojs/components'
import { useLoad } from '@tarojs/taro'
import { useState } from 'react'
import type { Circle, CirclesResponse, FriendsResponse } from '@couju/core'
import { Page } from '../../components/Page'
import { Button, Card, Chip, Empty, SectionTitle } from '../../components/ui'
import { del, get, post, put } from '../../lib/api'
import { back, confirm, toast, toastError } from '../../lib/ui'

/** 新建/编辑私人圈子（只有自己看得到，成员不会收到通知） */
export default function CircleEdit() {
  const [id, setId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [friends, setFriends] = useState<FriendsResponse['friends']>([])
  const [busy, setBusy] = useState(false)

  useLoad((params) => {
    const cid = params?.id ? String(params.id) : null
    setId(cid)
    Promise.all([get<FriendsResponse>('/api/friends'), get<CirclesResponse>('/api/circles')])
      .then(([f, c]) => {
        setFriends(f.friends)
        const circle = c.circles.find((x) => x.id === cid)
        if (circle) {
          setName(circle.name)
          setMembers(circle.memberIds)
        }
      })
      .catch(toastError)
  })

  const save = async () => {
    if (!name.trim()) {
      toast('给圈子起个名字')
      return
    }
    setBusy(true)
    try {
      const body = { name: name.trim(), memberIds: members }
      if (id) await put<{ circle: Circle }>(`/api/circles/${id}`, body)
      else await post<{ circle: Circle }>('/api/circles', body)
      toast('已保存')
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
          保存
        </Button>
      }
    >
      <View className='row row--between'>
        <View className='h1'>{id ? '编辑圈子' : '新建圈子'}</View>
        <Text className='link' onClick={() => back('/pages/friends/index')}>
          取消
        </Text>
      </View>
      <View className='sub mt4'>圈子只有你自己看得到，成员不会收到通知。</View>
      <Card className='mt16'>
        <Input className='input' placeholder='比如：麻将搭子' maxlength={20} value={name} onInput={(e) => setName(e.detail.value)} />
      </Card>
      <SectionTitle title={`成员（${members.length}）`} />
      <Card>
        {friends.length === 0 && <Empty icon='🤝' text='先加几个好友' />}
        <View className='row wrap gap8'>
          {friends.map((f) => (
            <Chip key={f.user.id} on={members.includes(f.user.id)} onClick={() => setMembers(members.includes(f.user.id) ? members.filter((x) => x !== f.user.id) : [...members, f.user.id])}>
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
              if (!(await confirm('删除这个圈子？', '不会影响好友关系。', '删除'))) return
              await del(`/api/circles/${id}`).catch(toastError)
              back('/pages/friends/index')
            }}
          >
            删除圈子
          </Text>
        </View>
      )}
    </Page>
  )
}
