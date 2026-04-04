import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhTW from './locales/zh-TW.json'
import en from './locales/en.json'
import vi from './locales/vi.json'

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en',    label: 'English' },
  { code: 'vi',    label: 'Tiếng Việt' },
] as const

export type LangCode = 'zh-TW' | 'en' | 'vi'

function detectLang(): string {
  // 1. 優先使用使用者手動選擇的語言
  const saved = localStorage.getItem('preferred_language')
  if (saved && ['zh-TW', 'en', 'vi'].includes(saved)) return saved

  // 2. 偵測瀏覽器語言（預設繁體中文，企業系統以中文為主）
  const nav = (navigator.languages?.[0] || navigator.language || '').toLowerCase()
  if (nav.startsWith('vi')) return 'vi'
  if (nav.startsWith('en')) return 'en'
  return 'zh-TW'
}
const initLang = detectLang()

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-TW': { translation: zhTW },
      en:      { translation: en },
      vi:      { translation: vi },
    },
    lng: initLang,
    fallbackLng: 'zh-TW',
    interpolation: { escapeValue: false },
  })

export default i18n
