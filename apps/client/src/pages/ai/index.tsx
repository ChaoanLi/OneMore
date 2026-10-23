import { Text, Textarea, View } from '@tarojs/components'
import { useEffect, useState } from 'react'
import type { AiDraftResponse } from '@couju/core'
import { Page } from '../../components/Page'
import { Button, Card, Chip } from '../../components/ui'
import { ApiError, get, post } from '../../lib/api'
import { setPrefill } from '../../lib/draftStore'
import { requireUser } from '../../lib/session'
import { back, go, toast } from '../../lib/ui'

const EXAMPLES = ['这周末没事，想和几个老朋友玩 Dota、桌游或者日麻', '今晚八点四个人打日麻', '下周五晚上跑团，再找 3 个人', '周六下午大学同学来我家玩桌游']

/**
 * 一句话组局：把自然语言交给后端解析成草稿，再进入表单由用户确认。
 * AI 不会直接创建活动或邀请任何人；不可用时可以直接填表单。
 */
export default function AiDraftPage() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    get<{ provider: string }>('/api/ai/status')
      .then((r) => setProvider(r.provider))
      .catch(() => setProvider(null))
  }, [])

  const run = async () => {
    if (text.trim().length < 2) {
      toast('多说一点吧')
      return
    }
    if (!(await requireUser())) return
    setBusy(true)
    setFailed(null)
    try {
      const res = await post<AiDraftResponse>('/api/ai/draft', { text: text.trim() })
      setPrefill({ source: 'ai', provider: res.provider, text: text.trim(), suggestion: res.suggestion })
      go('/pages/event/create?from=ai')
    } catch (e) {
      setFailed(e instanceof ApiError ? e.message : 'AI 暂时不可用')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <View className='row row--between'>
        <View className='h1'>随口说一句</View>
        <Text className='link' onClick={() => back()}>
          取消
        </Text>
      </View>
      <View className='lead mt8'>想玩什么、大概什么时候、想叫谁，随便说。我先帮你把表填好，你看着改；确认之前不会通知任何人。</View>

      <Card className='mt16'>
        <Textarea className='textarea' style={{ minHeight: '120px' }} placeholder='比如：这周末没事，想和几个老朋友玩 Dota、桌游或者日麻' maxlength={300} value={text} onInput={(e) => setText(e.detail.value)} />
        <View className='row wrap gap8 mt12'>
          {EXAMPLES.map((ex) => (
            <Chip key={ex} small onClick={() => setText(ex)}>
              {ex.length > 14 ? `${ex.slice(0, 14)}…` : ex}
            </Chip>
          ))}
        </View>
      </Card>

      <Button kind='primary' block size='lg' className='mt16' loading={busy} onClick={run}>
        帮我填好
      </Button>
      <View className='muted center mt8'>
        {provider === 'deepseek' ? '由 DeepSeek 理解你的话；人和时间凑不凑得齐，由规则判断' : provider === 'mock' ? '现在是演示版（关键词规则，还没接 DeepSeek），说得越直白越准' : ''}
      </View>

      {failed && (
        <Card tone='warn' className='mt16'>
          <View className='bold'>{failed}</View>
          <View className='sub mt4'>没关系，自己填也就一分钟。</View>
          <Button size='sm' kind='primary' className='mt12' onClick={() => go('/pages/event/create')}>
            我自己填
          </Button>
        </Card>
      )}
    </Page>
  )
}
