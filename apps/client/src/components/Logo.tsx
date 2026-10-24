import { useLocale } from '../lib/i18n'
import { Image } from '@tarojs/components'

/**
 * 手绘感 Logo：歪歪的方框 + 一只举起的手（“算我一个”）+ 红色手写字。
 * 用 SVG data URI 渲染，H5 与小程序都能显示。
 */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 120 120">
<g fill="none" stroke="#141414" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<path d="M9 14 C40 11 80 9 109 8 C110 40 112 80 111 109 C80 111 40 110 10 108 C9 80 10 40 9 14 Z" fill="#fff"/>
<path d="M2 119 L29 76"/>
<path d="M14 120 L38 81"/>
<path d="M29 76 C25 68 26 60 30 55 L32 41 C32.5 37.5 36.5 37.5 36.5 41 L36.5 53 L38.5 35 C39 31.5 43 31.5 43 35 L42 53 L45 38 C45.5 34.5 49.5 35 49 38.5 L47 55 L51 46 C52 43 55.5 44 54.5 47 L50 63 C48 72 44 78 38 81"/>
<path d="M21 46 L16 42"/>
<path d="M23 37 L20 31"/>
<path d="M30 31 L30 25"/>
</g>
<g fill="#FF2B2B" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-weight="900">
<text x="58" y="52" font-size="25" transform="rotate(-7 74 44)">算我</text>
<text x="62" y="84" font-size="25" transform="rotate(4 78 76)">一个</text>
</g>
</svg>`

const sources = {
  'zh-CN': `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`,
  en: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    SVG.replace('>算我<', '>ONE<')
      .replace('>一个<', '>MORE<')
      .replace(/font-size="25"/g, 'font-size="18"'),
  )}`,
}

/** 尺寸用 CSS 类（Taro H5 会二次换算行内样式里的 px） */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const locale = useLocale()
  return <Image src={sources[locale]} aria-label='OneMore' className={`logo logo--${size}`} mode='scaleToFill' />
}
