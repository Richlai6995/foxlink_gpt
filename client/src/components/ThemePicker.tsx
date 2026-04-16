import { useState, useRef, useEffect } from 'react'
import { Palette, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme, THEMES } from '../context/ThemeContext'

/**
 * Sidebar 底部使用的主題切換按鈕。
 * 點擊後跳出小 popover，跟語言切換一樣的互動模式。
 */
export default function ThemePicker({ title }: { title?: string }) {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title={title || t('sidebar.theme', '切換主題')}
        className="text-slate-500 hover:text-sky-400 transition"
      >
        <Palette size={15} />
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 z-50 rounded-xl border p-2 w-52 shadow-2xl"
          style={{
            backgroundColor: 'var(--t-bg-card)',
            borderColor: 'var(--t-border)',
            color: 'var(--t-text)',
          }}
        >
          <div
            className="text-[10px] font-semibold uppercase px-2 py-1 mb-1"
            style={{ color: 'var(--t-text-dim)' }}
          >
            {t('theme.title', '主題風格')}
          </div>
          {THEMES.map(it => (
            <button
              key={it.id}
              onClick={() => { setTheme(it.id); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-xs transition hover:opacity-80"
              style={{
                backgroundColor: theme === it.id ? 'var(--t-accent-subtle)' : 'transparent',
                color: 'var(--t-text)',
              }}
            >
              <div
                className={`w-5 h-5 rounded-full border-2 ${it.preview} shrink-0`}
                style={{ borderColor: theme === it.id ? 'var(--t-accent)' : 'var(--t-border)' }}
              />
              <div className="flex-1 text-left">
                <div className="font-medium">{t(it.labelKey)}</div>
                <div className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>{t(it.descKey)}</div>
              </div>
              {theme === it.id && <Check size={13} style={{ color: 'var(--t-accent)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
