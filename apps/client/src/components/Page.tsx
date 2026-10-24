import { t, useLocale, getLocale, setLocale } from '../lib/i18n'
import { Button as NativeButton, Input, Picker, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react'
import { COMMON_TIMEZONES, DEFAULT_TIMEZONE, zoneLabel } from '@couju/core'
import { deviceTimezone, signupGuest, selectSpace, useIdentityRequest, useSession } from '../lib/session'
import { shouldSelectLinkedSpace } from '../lib/pageVisibility'
import { makePageUrl } from '../lib/pageUrl'
import { toastError } from '../lib/ui'
import { Button, Sheet, cx } from './ui'
import { Logo } from './Logo'
import { EventLinkJoin } from './EventLinkJoin'
import { FAINT, INK, Icon, type IconName } from './Icon'

const PAGE_TITLES: Record<string, string> = {
  'pages/index/index': 'OneMore',
  'pages/calendar/index': '日历',
  'pages/friends/index': '朋友',
  'pages/friends/add': '加好友',
  'pages/me/index': '账号',
  'pages/spaces/index': '我的空间',
  'pages/event/create': '我来组一局',
  'pages/event/detail': '活动详情',
  'pages/interest/create': '举手',
  'pages/circle/edit': '圈子',
  'pages/ai/index': '随口说一句',
  'pages/notifications/index': '通知',
}

type NavKey = 'home' | 'calendar' | 'friends' | 'me'

/** 页面外壳：统一边距、底部导航、底部操作栏，以及“怎么称呼你”弹层 */
export function Page(props: PropsWithChildren<{ nav?: NavKey; footer?: ReactNode; className?: string; global?: boolean }>) {
  const locale = useLocale()
  const [languageBusy, setLanguageBusy] = useState(false)
  const visible = useRef(false)
  const session = useSession()
  const router = useRouter()
  const updateTitle = () => {
    if (!visible.current) return
    const title = PAGE_TITLES[makePageUrl(router.path, {}).replace(/^\//, '')] ?? 'OneMore'
    void Taro.setNavigationBarTitle({ title: t(title) })
    if (typeof document !== 'undefined') document.documentElement.lang = locale
  }
  useEffect(updateTitle, [locale, router.path])
  const chooseLanguage = async (next: 'zh-CN' | 'en') => {
    if (languageBusy) return
    setLanguageBusy(true)
    try {
      await setLocale(next)
    } catch (error) {
      toastError(error)
    } finally {
      setLanguageBusy(false)
    }
  }
  const linked = router.params.space
  const global = props.global || props.nav === 'me'
  const allowed = !session.switching && (global || (!!session.activeSpace && (!linked || linked === session.activeSpace)))
  const denied = !!linked && session.ready && !session.spaces.some((s) => s.id === linked)
  const selectLinkedSpace = () => {
    if (
      shouldSelectLinkedSpace({
        visible: visible.current,
        switching: session.switching,
        global,
        ready: session.ready,
        linked,
        activeSpace: session.activeSpace,
        memberSpaceIds: session.spaces.map((s) => s.id),
      })
    ) {
      void selectSpace(linked!, makePageUrl(router.path, router.params)).catch(toastError)
    }
  }
  useDidShow(() => {
    visible.current = true
    updateTitle()
    selectLinkedSpace()
  })
  useDidHide(() => {
    visible.current = false
  })
  useEffect(selectLinkedSpace, [linked, session.activeSpace, session.ready, session.switching, session.spaces, global])
  return (
    <View className={cx('page', props.nav && 'page--nav', !!props.footer && 'page--footer', props.className)}>
      <View className='shell-topbar'>
        <Text className='shell-wordmark'>
          OneMore<Text className='shell-wordmark__dot'>.</Text>
        </Text>
        <View className='locale-switch' aria-label={t('界面语言')}>
          <NativeButton
            disabled={languageBusy || undefined}
            aria-disabled={languageBusy}
            className={cx('locale-switch__button', locale === 'zh-CN' && 'locale-switch__button--on')}
            aria-label='中文'
            aria-pressed={locale === 'zh-CN'}
            onClick={() => void chooseLanguage('zh-CN')}
          >
            中文
          </NativeButton>
          <NativeButton
            disabled={languageBusy || undefined}
            aria-disabled={languageBusy}
            className={cx('locale-switch__button', locale === 'en' && 'locale-switch__button--on')}
            aria-label='English'
            aria-pressed={locale === 'en'}
            onClick={() => void chooseLanguage('en')}
          >
            EN
          </NativeButton>
        </View>
      </View>
      {session.ready && session.user && !props.global && (
        <View className='space-bar row row--between' onClick={() => void Taro.navigateTo({ url: '/pages/spaces/index' })}>
          <View>
            <Text className='muted small'>{t('当前空间 ·')}</Text>
            <Text>{session.spaces.find((s) => s.id === session.activeSpace)?.name ?? t('尚未选择')}</Text>
          </View>
          <Text className='link small'>{t('切换 / 管理')}</Text>
        </View>
      )}
      {!session.ready ? (
        <View className='empty'>{t('正在加载账号…')}</View>
      ) : allowed ? (
        props.children
      ) : (
        <View className='empty space-gate'>
          <Logo size='lg' />
          <View className='space-gate__tagline'>{t('把「下次一定」变成这次。')}</View>
          {denied && router.params.code ? (
            <EventLinkJoin spaceId={linked!} code={String(router.params.code)} />
          ) : (
            <>
              <View className='h2'>{denied ? t('无法访问这个空间') : t('先选择一个空间')}</View>
              <View className='muted mt12'>
                {denied ? t('活动仅向已加入该空间的成员开放。') : t('每个空间的朋友、活动和通知独立。创建空间，或通过朋友的邀请链接加入。')}
              </View>
            </>
          )}
          <Button className='mt16' onClick={() => void Taro.navigateTo({ url: '/pages/spaces/index' })}>
            {t('创建或选择空间')}
          </Button>
          {!session.user && (
            <Button className='mt12' kind='ghost' onClick={() => void Taro.navigateTo({ url: '/pages/me/index?restore=1' })}>
              {t('恢复已有账号')}
            </Button>
          )}
        </View>
      )}

      {allowed && !!props.footer && (
        <View className='footer-bar'>
          <View className='footer-bar__inner'>{props.footer}</View>
        </View>
      )}
      {props.nav && <BottomNav active={props.nav} />}
      <IdentitySheet />
    </View>
  )
}

const NAV: { key: NavKey; label: string; icon: IconName; url: string }[] = [
  { key: 'home', label: '首页', icon: 'home', url: '/pages/index/index' },
  { key: 'calendar', label: '日历', icon: 'calendar', url: '/pages/calendar/index' },
  { key: 'friends', label: '朋友', icon: 'users', url: '/pages/friends/index' },
  { key: 'me', label: '我', icon: 'user', url: '/pages/me/index' },
]

function BottomNav({ active }: { active: NavKey }) {
  useLocale()
  const { unread } = useSession()
  return (
    <View className='nav'>
      <View className='nav__inner'>
        {NAV.map((n) => (
          <View
            key={n.key}
            className={cx('nav__item', n.key === active && 'nav__item--on')}
            onClick={() => n.key !== active && void Taro.redirectTo({ url: n.url })}
          >
            <Icon name={n.icon} color={n.key === active ? INK : FAINT} />
            <Text className='nav__label'>{t(n.label)}</Text>
            {n.key === 'home' && unread > 0 && n.key !== active && (
              <View className='dot' style={{ position: 'absolute', top: '6px', left: '58%' }}>
                {unread}
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  )
}

/** 低门槛身份：只要一个昵称，时区自动识别 */
function IdentitySheet() {
  useLocale()
  const { request, finish } = useIdentityRequest()
  const [name, setName] = useState('')
  const [tz, setTz] = useState(DEFAULT_TIMEZONE)
  const device = deviceTimezone()
  const [busy, setBusy] = useState(false)
  const zones = COMMON_TIMEZONES.includes(tz) ? COMMON_TIMEZONES : [tz, ...COMMON_TIMEZONES]

  useEffect(() => {
    if (request) setTz(DEFAULT_TIMEZONE)
  }, [request])

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const user = await signupGuest(name.trim(), tz)
      setName('')
      finish(user)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={!!request} onClose={() => finish(null)}>
      <View className='row gap12'>
        <Logo size='sm' />
        <View className='flex1'>
          <View className='h2'>{t('怎么称呼你？')}</View>
          <View className='sub'>{request?.reason ? t(request.reason) : t('朋友们会看到这个名字')}</View>
        </View>
      </View>
      <View className='muted mt8'>{t('不用注册、不要手机号。叫什么都行，之后随时能改。')}</View>
      <View className='field'>
        <Input
          className='input'
          placeholder={t('比如：阿杰、老王、大佐')}
          maxlength={20}
          value={name}
          focus
          onInput={(e) => setName(e.detail.value)}
          onConfirm={submit}
        />
      </View>
      <Picker
        mode='selector'
        range={zones.map((z) => `${zoneLabel(z, getLocale())}（${z}）`)}
        value={Math.max(0, zones.indexOf(tz))}
        onChange={(e) => setTz(zones[Number(e.detail.value)] ?? tz)}
      >
        <View className='row mt12 gap8'>
          <Text className='muted'>{t('时间按{0}显示', zoneLabel(tz, getLocale()))}</Text>
          <Text className='link small'>{t('改时区')}</Text>
        </View>
      </Picker>
      {device !== tz && (
        <View className='muted mt4'>
          {t('你的设备在 {0}。', zoneLabel(device, getLocale()))}
          <Text className='link small' onClick={() => setTz(device)}>
            {t('改用{0}', zoneLabel(device, getLocale()))}
          </Text>
        </View>
      )}
      <Button kind='primary' block size='lg' className='mt16' disabled={!name.trim()} loading={busy} onClick={submit}>
        {t('就叫这个')}
      </Button>
      <View
        className='center muted mt12'
        onClick={() => {
          finish(null)
          void Taro.navigateTo({ url: '/pages/me/index?restore=1' })
        }}
      >
        {t('在别的设备用过？')}
        <Text className='link small'>{t('恢复账号')}</Text>
      </View>
    </Sheet>
  )
}
