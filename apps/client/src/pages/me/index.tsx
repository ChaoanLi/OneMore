import { Input, Picker, Switch, Text, View } from '@tarojs/components'
import Taro, { useDidShow, useLoad } from '@tarojs/taro'
import { useEffect, useState, type ReactNode } from 'react'
import { COMMON_TIMEZONES, zoneLabel, type EmailSettingsResponse, type User } from '@couju/core'
import { GamesSheet, useMyGames } from '../../components/Games'
import { FAINT, Icon, type IconName } from '../../components/Icon'
import { Page } from '../../components/Page'
import { Avatar, Button, Card, Sheet } from '../../components/ui'
import { del, get, patch, post } from '../../lib/api'
import { APP_NAME } from '../../lib/brand'
import { deviceTimezone, logout, requireUser, restoreAccount, setUser, useSession } from '../../lib/session'
import { confirm, copyText, go, toast, toastError, toastOk } from '../../lib/ui'

const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐧', '🦉', '🐙', '🦄', '🐳', '🐱', '🐶', '🐹', '🐨', '🦁', '🐰', '🐻', '🐵', '🐲', '👾', '🎮', '🀄', '🎲', '⚔️', '🌸']

type SheetName = 'profile' | 'games' | 'email' | 'account' | 'restore' | 'about' | null

function Row(props: { icon: IconName; label: string; value?: ReactNode; onClick?: () => void; children?: ReactNode }) {
  return (
    <View className='list-row' onClick={props.onClick}>
      <Icon name={props.icon} />
      <Text className='flex1'>{props.label}</Text>
      {props.children ?? (
        <>
          {props.value !== undefined && <Text className='sub'>{props.value}</Text>}
          <Icon name='right' size='sm' color={FAINT} />
        </>
      )}
    </View>
  )
}

export default function Me() {
  const { user, ready } = useSession()
  const { games, isSet } = useMyGames()
  const [sheet, setSheet] = useState<SheetName>(null)
  const [email, setEmail] = useState<EmailSettingsResponse | null>(null)

  useLoad((params) => {
    if (params?.restore === '1') setSheet('restore')
    if (params?.email === '1') setSheet('email')
  })
  useDidShow(() => {
    if (user) get<EmailSettingsResponse>('/api/me/email').then(setEmail).catch(() => undefined)
  })

  const save = async (body: Partial<Pick<User, 'timezone' | 'roles' | 'avatar'>>, msg = '好了') => {
    try {
      const r = await patch<{ user: User }>('/api/me', body)
      setUser(r.user)
      toastOk(msg)
    } catch (e) {
      toastError(e)
    }
  }

  if (ready && !user) {
    return (
      <Page nav='me'>
        <View className='h1 mt8'>我</View>
        <Card className='mt16'>
          <View className='h3'>还没起名字</View>
          <Button kind='primary' className='mt12' onClick={() => void requireUser()}>
            起个名字
          </Button>
        </Card>
        <View className='center mt16'>
          <Text className='link' onClick={() => setSheet('restore')}>
            恢复账号
          </Text>
        </View>
        <RestoreSheet open={sheet === 'restore'} onClose={() => setSheet(null)} hasUnboundGuest={false} />
      </Page>
    )
  }
  if (!user) return <Page nav='me' />

  const zones = [...new Set([user.timezone, deviceTimezone(), ...COMMON_TIMEZONES])]
  const emailText = email?.email ? (email.enabled ? '开着' : '关了') : email?.pending ? '待验证' : '没设置'

  return (
    <Page nav='me'>
      <View className='row gap12 mt8' onClick={() => setSheet('profile')}>
        <Avatar user={user} size='lg' />
        <View className='flex1'>
          <View className='h2'>{user.nickname}</View>
          <View className='sub'>ID：{user.handle}</View>
        </View>
        <Icon name='edit' color={FAINT} />
      </View>

      <Card className='mt24'>
        <Row icon='gamepad' label='我的游戏' value={isSet ? `${games.length} 个` : '还没选'} onClick={() => setSheet('games')} />
        <Row icon='hand' label='我能当 KP/GM'>
          <Switch color='#FF2B2B' checked={user.roles.includes('gm')} onChange={(e) => void save({ roles: e.detail.value ? ['gm'] : [] })} />
        </Row>
        <Picker mode='selector' range={zones.map((z) => `${zoneLabel(z)}（${z}）`)} value={Math.max(0, zones.indexOf(user.timezone))} onChange={(e) => void save({ timezone: zones[Number(e.detail.value)]! }, '时区改好了')}>
          <Row icon='globe' label='时区' value={zoneLabel(user.timezone)} />
        </Picker>
      </Card>

      <Card className='mt12'>
        <Row icon='mail' label='邮件提醒' value={emailText} onClick={() => setSheet('email')} />
        <Row icon='calendar' label='订阅到手机日历' onClick={() => go('/pages/calendar/index')} />
        <Row icon='key' label='账号' value={user.account.kind === 'bound' ? '已绑定' : '只在这台设备'} onClick={() => setSheet('account')} />
      </Card>

      <View className='center mt24'>
        <Text className='muted' onClick={() => setSheet('about')}>
          关于这个版本
        </Text>
      </View>

      <ProfileSheet open={sheet === 'profile'} user={user} onClose={() => setSheet(null)} />
      <GamesSheet open={sheet === 'games'} onClose={() => setSheet(null)} />
      <EmailSheet open={sheet === 'email'} onClose={() => setSheet(null)} onChange={setEmail} />
      <AccountSheet open={sheet === 'account'} user={user} onClose={() => setSheet(null)} onRestore={() => setSheet('restore')} />
      <RestoreSheet open={sheet === 'restore'} onClose={() => setSheet(null)} hasUnboundGuest={user.account.kind === 'guest'} />
      <Sheet open={sheet === 'about'} onClose={() => setSheet(null)} title='还没接上的'>
        <View className='sub mt8'>· 微信登录和小程序版本</View>
        <View className='sub mt4'>· 微信消息推送（现在有站内通知和邮件）</View>
        <View className='sub mt4'>· DeepSeek（没配置时“随口说一句”用的是关键词规则）</View>
        <View className='sub mt4'>· 腾讯云 CloudBase（现在数据存在自己的服务器上）</View>
      </Sheet>
    </Page>
  )
}

function ProfileSheet(props: { open: boolean; user: User; onClose: () => void }) {
  const [nickname, setNickname] = useState(props.user.nickname)
  const [handle, setHandle] = useState(props.user.handle)
  const [avatar, setAvatar] = useState(props.user.avatar)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (props.open) {
      setNickname(props.user.nickname)
      setHandle(props.user.handle)
      setAvatar(props.user.avatar)
    }
  }, [props.open])
  const saveAll = async () => {
    setBusy(true)
    try {
      const r = await patch<{ user: User }>('/api/me', { nickname: nickname.trim(), handle: handle.trim().toLowerCase(), avatar })
      setUser(r.user)
      toastOk('好了')
      props.onClose()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={props.open} onClose={props.onClose} title='我的资料'>
      <View className='row wrap gap8 mt12'>
        {AVATARS.map((a) => (
          <View key={a} className={a === avatar ? 'emoji-pick emoji-pick--on' : 'emoji-pick'} onClick={() => setAvatar(a)}>
            {a}
          </View>
        ))}
      </View>
      <Input className='input mt12' placeholder='昵称' maxlength={20} value={nickname} onInput={(e) => setNickname(e.detail.value)} />
      <Input className='input mt8' placeholder='ID（朋友用它加你）' maxlength={20} value={handle} onInput={(e) => setHandle(e.detail.value.toLowerCase())} />
      <Button kind='primary' block className='mt16' loading={busy} disabled={!nickname.trim()} onClick={saveAll}>
        保存
      </Button>
    </Sheet>
  )
}

/** 邮件提醒：留邮箱 → 验证码 → 开关 */
function EmailSheet(props: { open: boolean; onClose: () => void; onChange: (s: EmailSettingsResponse) => void }) {
  const [s, setS] = useState<EmailSettingsResponse | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (props.open) get<EmailSettingsResponse>('/api/me/email').then(setS).catch(toastError)
  }, [props.open])

  const run = async (fn: () => Promise<EmailSettingsResponse>, ok?: string) => {
    setBusy(true)
    try {
      const r = await fn()
      setS(r)
      props.onChange(r)
      if (r.devCode) setDevCode(r.devCode)
      if (ok) toastOk(ok)
      return r
    } catch (e) {
      toastError(e)
      return null
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title='邮件提醒'>
      {!s ? null : s.email ? (
        <>
          <View className='switch-row mt8'>
            <Text className='bold flex1'>{s.email}</Text>
            <Switch color='#FF2B2B' checked={s.enabled} onChange={(e) => void run(() => patch('/api/me/email', { enabled: e.detail.value }))} />
          </View>
          <View className='muted'>成团、差人、取消时发邮件。夜里不发。</View>
          <View className='mt12'>
            <Text className='link small' onClick={() => void run(() => del('/api/me/email')).then(() => setEmail(''))}>
              换个邮箱
            </Text>
          </View>
        </>
      ) : !s.pending ? (
        <>
          <View className='sub mt8'>成团、差人、取消时发邮件告诉你。</View>
          <Input className='input mt12' placeholder='你的邮箱' value={email} onInput={(e) => setEmail(e.detail.value)} />
          <Button kind='primary' block className='mt12' loading={busy} disabled={!email.trim()} onClick={() => void run(() => post('/api/me/email', { email: email.trim() }))}>
            发验证码
          </Button>
        </>
      ) : (
        <>
          <View className='sub mt8'>验证码发到 {s.pending} 了</View>
          {devCode && s.transport === 'console' && <View className='code-box mt8'>{devCode}</View>}
          <Input className='input mt12' type='number' maxlength={6} placeholder='6 位验证码' value={code} onInput={(e) => setCode(e.detail.value)} />
          <Button kind='primary' block className='mt12' loading={busy} disabled={code.trim().length !== 6} onClick={() => void run(() => post('/api/me/email/verify', { code: code.trim() }), '好了').then((r) => r && setCode(''))}>
            验证
          </Button>
          <View className='row gap12 mt12'>
            <Text className='link small' onClick={() => s.pending && void run(() => post('/api/me/email', { email: s.pending }), '重新发了')}>
              重发
            </Text>
            <Text className='link small' onClick={() => void run(() => del('/api/me/email'))}>
              换个邮箱
            </Text>
          </View>
        </>
      )}
      {s?.transport === 'console' && <View className='muted mt12'>演示模式：还没配置发信邮箱，邮件不会真的发出。</View>}
    </Sheet>
  )
}

function AccountSheet(props: { open: boolean; user: User; onClose: () => void; onRestore: () => void }) {
  const [code, setCode] = useState<string | null>(null)
  const bound = props.user.account.kind === 'bound'
  useEffect(() => {
    if (!props.open) setCode(null)
  }, [props.open])

  const generate = async () => {
    if (bound && !(await confirm('重新生成恢复码？', '旧的会失效。'))) return
    try {
      const r = await post<{ recoveryCode: string; user: User }>('/api/me/recovery-code')
      setUser(r.user)
      setCode(r.recoveryCode)
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title='账号'>
      {code ? (
        <>
          <View className='sub mt8'>只显示这一次，截图保存。换手机时用 ID + 恢复码找回。</View>
          <View className='sub mt8'>
            ID：<Text className='bold'>{props.user.handle}</Text>
          </View>
          <View className='code-box mt8'>{code}</View>
          <Button kind='primary' block className='mt16' onClick={() => void copyText(`${APP_NAME} ID：${props.user.handle}\n恢复码：${code}`, '复制好了')}>
            复制
          </Button>
        </>
      ) : (
        <>
          <View className='sub mt8'>{bound ? '已绑定恢复码，换手机也能找回。' : '现在只存在这台设备上。生成恢复码，换手机也能找回。'}</View>
          <Button kind='outline' block className='mt12' onClick={generate}>
            {bound ? '重新生成恢复码' : '生成恢复码'}
          </Button>
          <View className='row row--between mt16'>
            <Text className='link' onClick={props.onRestore}>
              切换账号
            </Text>
            <Text
              className='muted'
              onClick={async () => {
                if (await confirm('退出？', bound ? '之后用 ID + 恢复码登录。' : '还没生成恢复码，退出后找不回这个身份。', '退出')) {
                  logout()
                  props.onClose()
                  toast('已退出')
                }
              }}
            >
              退出
            </Text>
          </View>
        </>
      )}
    </Sheet>
  )
}

function RestoreSheet(props: { open: boolean; onClose: () => void; hasUnboundGuest: boolean }) {
  const [handle, setHandle] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (props.hasUnboundGuest && !(await confirm('切换账号？', '当前身份还没生成恢复码，切换后找不回。', '仍然切换'))) return
    setBusy(true)
    try {
      const u = await restoreAccount(handle.trim().toLowerCase(), code.trim())
      toastOk(`欢迎回来，${u.nickname}`)
      props.onClose()
      void Taro.redirectTo({ url: '/pages/index/index' })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={props.open} onClose={props.onClose} title='恢复账号'>
      <Input className='input mt12' placeholder='ID' value={handle} onInput={(e) => setHandle(e.detail.value)} />
      <Input className='input mt8' placeholder='恢复码' value={code} onInput={(e) => setCode(e.detail.value)} onConfirm={submit} />
      <Button kind='primary' block size='lg' className='mt16' loading={busy} disabled={!handle.trim() || code.trim().length < 8} onClick={submit}>
        恢复
      </Button>
    </Sheet>
  )
}
