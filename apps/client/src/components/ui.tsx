import { Text, View } from '@tarojs/components'
import type { PropsWithChildren, ReactNode } from 'react'
import type { PublicUser } from '@couju/core'

const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

export function Button(
  props: PropsWithChildren<{
    kind?: 'primary' | 'ok' | 'ghost' | 'outline' | 'danger' | 'default'
    size?: 'sm' | 'lg'
    block?: boolean
    disabled?: boolean
    loading?: boolean
    className?: string
    onClick?: () => void
  }>,
) {
  const { kind = 'default', size, block, disabled, loading, className, onClick, children } = props
  return (
    <View
      className={cx('btn', kind !== 'default' && `btn--${kind}`, size && `btn--${size}`, block && 'btn--block', (disabled || loading) && 'btn--disabled', className)}
      onClick={() => !disabled && !loading && onClick?.()}
    >
      {loading ? '请稍候…' : children}
    </View>
  )
}

export function Chip(props: PropsWithChildren<{ on?: boolean; dashed?: boolean; small?: boolean; onClick?: () => void }>) {
  return (
    <View className={cx('chip', props.on && 'chip--on', props.dashed && 'chip--dashed', props.small && 'chip--sm')} onClick={props.onClick}>
      {props.children}
    </View>
  )
}

export function Tag(props: PropsWithChildren<{ tone?: 'brand' | 'ok' | 'warn' | 'info' | 'gray' }>) {
  return <Text className={cx('tag', props.tone && props.tone !== 'gray' && `tag--${props.tone}`)}>{props.children}</Text>
}

export function Card(props: PropsWithChildren<{ tone?: 'brand' | 'ok' | 'warn' | 'info' | 'dashed'; className?: string; onClick?: () => void }>) {
  return (
    <View className={cx('card', props.tone && `card--${props.tone}`, props.onClick && 'card--tap', props.className)} onClick={props.onClick}>
      {props.children}
    </View>
  )
}

export function SectionTitle(props: { title: string; extra?: ReactNode }) {
  return (
    <View className='section-title'>
      <Text>{props.title}</Text>
      {props.extra}
    </View>
  )
}

export function Avatar(props: { user: Pick<PublicUser, 'avatar'>; size?: 'sm' | 'lg' }) {
  return <View className={cx('avatar', props.size && `avatar--${props.size}`)}>{props.user.avatar}</View>
}

export function AvatarStack(props: { users: Pick<PublicUser, 'avatar' | 'id'>[]; max?: number }) {
  const max = props.max ?? 5
  const shown = props.users.slice(0, max)
  return (
    <View className='row'>
      <View className='avatar-stack'>
        {shown.map((u) => (
          <Avatar key={u.id} user={u} size='sm' />
        ))}
      </View>
      {props.users.length > max && <Text className='muted ml8'>+{props.users.length - max}</Text>}
    </View>
  )
}

export function Stepper(props: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <View className='stepper'>
      <View className='stepper__btn' onClick={() => props.onChange(Math.max(props.min, props.value - 1))}>
        −
      </View>
      <Text className='stepper__val'>{props.value}</Text>
      <View className='stepper__btn' onClick={() => props.onChange(Math.min(props.max, props.value + 1))}>
        +
      </View>
    </View>
  )
}

export function Segmented<T extends string>(props: { value: T; options: { value: NoInfer<T>; label: string }[]; onChange: (v: NoInfer<T>) => void }) {
  return (
    <View className='seg'>
      {props.options.map((o) => (
        <View key={o.value} className={cx('seg__item', props.value === o.value && 'seg__item--on')} onClick={() => props.onChange(o.value)}>
          {o.label}
        </View>
      ))}
    </View>
  )
}

export function Progress(props: { value: number; total: number; ok?: boolean }) {
  const pct = props.total > 0 ? Math.min(100, Math.round((props.value / props.total) * 100)) : 0
  return (
    <View className='progress'>
      <View className={cx('progress__bar', props.ok && 'progress__bar--ok')} style={{ width: `${pct}%` }} />
    </View>
  )
}

export function Sheet(props: PropsWithChildren<{ open: boolean; onClose: () => void; title?: string }>) {
  if (!props.open) return null
  return (
    <View className='sheet-mask' onClick={props.onClose} catchMove>
      <View className='sheet' onClick={(e) => e.stopPropagation()}>
        <View className='sheet__handle' />
        {props.title && <View className='h2'>{props.title}</View>}
        {props.children}
      </View>
    </View>
  )
}

export function Empty(props: { icon?: string; text: string; children?: ReactNode }) {
  return (
    <View className='empty'>
      <View className='empty__icon'>{props.icon ?? '🫧'}</View>
      <View>{props.text}</View>
      {props.children}
    </View>
  )
}

export function Loading() {
  return <Empty icon='⏳' text='加载中…' />
}

export { cx }
