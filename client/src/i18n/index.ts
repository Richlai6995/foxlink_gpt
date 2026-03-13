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

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-TW': { translation: zhTW },
      en:      { translation: en },
      vi:      { translation: vi },
    },
    lng: 'zh-TW',
    fallbackLng: 'zh-TW',
    interpolation: { escapeValue: false },
  })

export default i18n
