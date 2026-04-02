import { useState } from 'react'
import { Palette, Check } from 'lucide-react'
import { useTrainingTheme, THEMES, type TrainingTheme } from './TrainingThemeContext'

export default function ThemePicker() {
  const { theme, setTheme } = useTrainingTheme()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="t-text-muted hover:t-text flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition"
        style={{ color: 'var(--t-text-muted)' }}
        title="切換主題"
      >
        <Palette size={15} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 rounded-xl border p-2 w-44"
            style={{
              backgroundColor: 'var(--t-bg-card)',
              borderColor: 'var(--t-border)',
              boxShadow: 'var(--t-shadow), 0 10px 25px rgba(0,0,0,0.15)'
            }}>
            <div className="text-[10px] font-semibold uppercase px-2 py-1 mb-1"
              style={{ color: 'var(--t-text-dim)' }}>
              主題風格
            </div>
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => { setTheme(t.id); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-xs transition hover:opacity-80"
                style={{
                  backgroundColor: theme === t.id ? 'var(--t-accent-subtle)' : 'transparent',
                  color: 'var(--t-text)'
                }}
              >
                <div className={`w-5 h-5 rounded-full border-2 ${t.preview} shrink-0`}
                  style={{ borderColor: theme === t.id ? 'var(--t-accent)' : 'var(--t-border)' }} />
                <div className="flex-1 text-left">
                  <div className="font-medium">{t.label}</div>
                  <div className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>{t.desc}</div>
                </div>
                {theme === t.id && <Check size={13} style={{ color: 'var(--t-accent)' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
