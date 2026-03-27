/**
 * ColorPicker — 標準色盤 (100 色) + 自訂輸入
 * Usage: <ColorPicker value="#cc0000" onChange={hex => ...} disabled={...} />
 */
import { useState, useRef, useEffect } from 'react'

// ── 100-color palette ────────────────────────────────────────────────────────
const PALETTE: string[] = [
  // Grays / neutrals (12)
  '#000000','#1a1a1a','#333333','#4d4d4d','#666666','#808080',
  '#999999','#b3b3b3','#cccccc','#e0e0e0','#f2f2f2','#ffffff',
  // Reds (8)
  '#5c0000','#990000','#cc0000','#ff0000','#ff3333','#ff6666','#ff9999','#ffcccc',
  // Oranges (8)
  '#5c2200','#993d00','#cc5200','#ff6600','#ff8533','#ffa366','#ffbf99','#ffd9cc',
  // Yellows (8)
  '#5c4a00','#997a00','#ccaa00','#ffcc00','#ffd633','#ffe066','#ffeb99','#fff5cc',
  // Yellow-greens (8)
  '#2e4000','#4d6b00','#6b9900','#88cc00','#aadd33','#bbee66','#ccf099','#ddffcc',
  // Greens (8)
  '#002200','#004400','#006600','#008800','#00bb00','#33dd33','#66ee66','#aaffaa',
  // Teal / Cyan (8)
  '#002222','#004444','#006666','#008888','#00bbbb','#00dddd','#66eeee','#aaffff',
  // Sky blues (8)
  '#001133','#002266','#003399','#0055cc','#0077ff','#3399ff','#66bbff','#aaddff',
  // Blues (8)
  '#000044','#000088','#0000cc','#0000ff','#3333ff','#6666ff','#9999ff','#ccccff',
  // Purples (8)
  '#220044','#440088','#6600cc','#8800ff','#aa33ff','#cc66ff','#ddaaff','#eeccff',
  // Violets / Magentas (8)
  '#440044','#770077','#aa00aa','#cc00cc','#ff00ff','#ff44ff','#ff99ff','#ffccff',
  // Pinks / Roses (8)
  '#550022','#880044','#bb0066','#ee0088','#ff44aa','#ff77bb','#ffaacc','#ffd5e5',
  // Browns (8)
  '#2b1200','#552200','#884400','#aa6600','#cc8800','#ddaa44','#eeccaa','#f7e8d5',
]

interface Props {
  value: string
  onChange: (hex: string) => void
  disabled?: boolean
  className?: string
}

export default function ColorPicker({ value, onChange, disabled, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(value)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Sync custom input when value changes externally
  useEffect(() => { setCustom(value) }, [value])

  const select = (hex: string) => {
    onChange(hex)
    setOpen(false)
  }

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      {/* Trigger: colored swatch */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className="w-6 h-6 rounded border border-slate-300 shadow-sm disabled:opacity-40"
        style={{ background: value || '#000000' }}
        title={value}
      />

      {/* Palette popover */}
      {open && (
        <div className="absolute z-50 left-0 top-8 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-[228px]">
          {/* Color grid */}
          <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(12, 1fr)' }}>
            {PALETTE.map(hex => (
              <button
                key={hex}
                type="button"
                title={hex}
                onClick={() => select(hex)}
                className="w-4 h-4 rounded-sm border border-transparent hover:scale-125 hover:border-slate-400 transition-transform"
                style={{ background: hex, outline: value === hex ? '2px solid #3b82f6' : 'none', outlineOffset: '1px' }}
              />
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-slate-100 my-2" />

          {/* Custom hex input */}
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded border border-slate-300 shrink-0" style={{ background: custom }} />
            <input
              type="text"
              className="flex-1 border rounded px-1.5 py-0.5 text-xs font-mono"
              placeholder="#rrggbb"
              value={custom}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const hex = custom.trim()
                  if (/^#[0-9a-fA-F]{6}$/.test(hex)) select(hex)
                }
              }}
            />
            <button
              type="button"
              className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
              onClick={() => {
                const hex = custom.trim()
                if (/^#[0-9a-fA-F]{6}$/.test(hex)) select(hex)
              }}
            >
              確認
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
