/**
 * ColorPickerInput — 替代 <input type="color"> 的自訂色彩選擇器
 *
 * 功能：
 *  - 光譜模式：24 色相 × 9 明度層（216 色）+ 24 色灰階 = 240 色
 *  - 常用模式：40 標準色格（品牌 / Office 色調）
 *  - 手動輸入 Hex 代碼
 *  - 顯示當前 Hex + RGB，可一鍵複製
 *  - 點擊外部關閉
 */
import { useState, useRef, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'

// ── HSL → Hex ────────────────────────────────────────────────────────────────
function hslToHex(h: number, s: number, l: number): string {
  l /= 100
  const a = s * Math.min(l, 1 - l) / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// ── 全彩光譜（24 色相 × 9 明度層）──────────────────────────────────────────
const HUE_COUNT = 24
const HUES = Array.from({ length: HUE_COUNT }, (_, i) => Math.round(i * 360 / HUE_COUNT))

// 每列 [saturation, lightness] — 由淺至深 + 柔和層
const SPECTRUM_ROWS: string[][] = [
  HUES.map(h => hslToHex(h, 100, 93)),  // 極淺 pastel
  HUES.map(h => hslToHex(h, 100, 82)),
  HUES.map(h => hslToHex(h, 100, 70)),
  HUES.map(h => hslToHex(h, 100, 58)),
  HUES.map(h => hslToHex(h, 100, 46)),  // 純色
  HUES.map(h => hslToHex(h, 100, 34)),
  HUES.map(h => hslToHex(h, 100, 22)),  // 極深
  HUES.map(h => hslToHex(h, 65,  55)),  // 柔和中飽
  HUES.map(h => hslToHex(h, 35,  78)),  // 低飽粉彩
]

// 灰階（24 格，與光譜欄對齊）
const GRAYS = Array.from({ length: HUE_COUNT }, (_, i) => {
  const v = Math.round(i * 255 / (HUE_COUNT - 1)).toString(16).padStart(2, '0')
  return `#${v}${v}${v}`
})

// ── 常用 40 色（Office / 品牌風格）──────────────────────────────────────────
const STANDARD_COLORS = [
  // Grays
  '#000000', '#1c1c1c', '#3d3d3d', '#666666', '#888888', '#aaaaaa', '#cccccc', '#ffffff',
  // Blues
  '#0d2b5e', '#0c4a8f', '#0984e3', '#2563eb', '#118DFF', '#0093D5', '#60a5fa', '#bfdbfe',
  // Greens
  '#014421', '#025e2e', '#007700', '#009E49', '#00B294', '#10893E', '#6ee7b7', '#a7f3d0',
  // Reds / Oranges / Yellows
  '#7f0000', '#b00020', '#d41c00', '#E66C37', '#D9B300', '#F5B300', '#fbbf24', '#fde68a',
  // Purples / Teals
  '#2d0057', '#5004a6', '#6d28d9', '#744EC2', '#8764B8', '#0099BC', '#038387', '#00B4D8',
]

// ── 工具函式 ─────────────────────────────────────────────────────────────────
function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  if (h.length !== 6) return null
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function isValidHex(s: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(s)
}

function sanitize(hex: string, fallback = '#888888') {
  if (!hex) return fallback
  const s = hex.startsWith('#') ? hex : '#' + hex
  return isValidHex(s) ? s : fallback
}

interface Props {
  value: string
  onChange: (hex: string) => void
  title?: string
  size?: 'sm' | 'md'   // sm = w-6 h-6（預設）, md = w-7 h-7
}

type PickerTab = 'spectrum' | 'standard'

export default function ColorPickerInput({ value, onChange, title, size = 'sm' }: Props) {
  const safeVal = sanitize(value)
  const [open, setOpen] = useState(false)
  const [hexInput, setHexInput] = useState(safeVal.replace('#', ''))
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<PickerTab>('spectrum')
  const ref = useRef<HTMLDivElement>(null)

  // 外部 value 變化時同步 input
  useEffect(() => {
    setHexInput(sanitize(value).replace('#', ''))
  }, [value])

  // 點擊外部關閉
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function selectColor(hex: string) {
    onChange(hex)
    setHexInput(hex.replace('#', ''))
  }

  function handleHexInput(raw: string) {
    const cleaned = raw.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6)
    setHexInput(cleaned)
    if (cleaned.length === 6) onChange('#' + cleaned)
  }

  function applyHexInput() {
    const padded = hexInput.padEnd(6, '0').slice(0, 6)
    if (isValidHex('#' + padded)) {
      onChange('#' + padded)
      setHexInput(padded)
    }
  }

  function copyHex() {
    navigator.clipboard.writeText(safeVal.toUpperCase()).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const rgb = hexToRgb(safeVal)
  const swatchSize = size === 'md' ? 'w-7 h-7' : 'w-6 h-6'

  function spectrumCls(c: string) {
    const active = safeVal.toLowerCase() === c.toLowerCase()
    return `w-full h-3 rounded-[2px] border-0 transition-transform hover:scale-125 hover:z-10 relative outline-none
      ${active ? 'ring-2 ring-blue-500 ring-offset-[1px] scale-110 z-10' : ''}`
  }

  function standardCls(c: string) {
    const active = safeVal.toLowerCase() === c.toLowerCase()
    return `w-5 h-5 rounded-sm border transition-transform hover:scale-125 hover:z-10 relative
      ${active ? 'border-blue-500 ring-2 ring-blue-400 ring-offset-1 scale-110 z-10' : 'border-transparent hover:border-gray-400'}`
  }

  return (
    <div ref={ref} className="relative inline-block flex-shrink-0">
      {/* ── Swatch 觸發按鈕 ─────────────────────────────────────────────── */}
      <button
        type="button"
        title={title || safeVal}
        onClick={() => setOpen(p => !p)}
        className={`${swatchSize} rounded border border-gray-300 cursor-pointer shadow-sm hover:ring-2 hover:ring-blue-400 transition flex-shrink-0`}
        style={{ backgroundColor: safeVal }}
      />

      {/* ── Popover ─────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="absolute z-[200] left-0 top-8 bg-white rounded-xl shadow-2xl border border-gray-200 p-3"
          style={{ width: 348 }}
        >
          {/* 分頁 tabs */}
          <div className="flex gap-1 mb-2 border-b border-gray-100 pb-1.5">
            {(['spectrum', 'standard'] as PickerTab[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`text-[11px] px-2.5 py-0.5 rounded-md font-medium transition
                  ${tab === t
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              >
                {t === 'spectrum' ? '🎨 光譜' : '⭐ 常用'}
              </button>
            ))}
          </div>

          {tab === 'spectrum' ? (
            /* ── 光譜色格 24 col × 9 row + 灰階 ── */
            <div>
              <div
                className="grid gap-px"
                style={{ gridTemplateColumns: `repeat(${HUE_COUNT}, 1fr)` }}
              >
                {SPECTRUM_ROWS.flat().map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    title={c.toUpperCase()}
                    onClick={() => selectColor(c)}
                    className={spectrumCls(c)}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              {/* 灰階 row */}
              <div
                className="grid gap-px mt-1.5"
                style={{ gridTemplateColumns: `repeat(${HUE_COUNT}, 1fr)` }}
              >
                {GRAYS.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    title={c.toUpperCase()}
                    onClick={() => selectColor(c)}
                    className={spectrumCls(c)}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* ── 常用 40 色（8 × 5）── */
            <div className="grid grid-cols-8 gap-0.5">
              {STANDARD_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  title={c.toUpperCase()}
                  onClick={() => selectColor(c)}
                  className={standardCls(c)}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}

          {/* 當前色預覽 + Hex + RGB */}
          <div className="flex items-center gap-2 mt-2.5 mb-2 bg-gray-50 rounded-lg p-1.5">
            <div
              className="w-8 h-8 rounded-md border border-gray-200 flex-shrink-0 shadow-sm"
              style={{ backgroundColor: safeVal }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs font-semibold text-gray-700 flex-1 select-all">
                  {safeVal.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={copyHex}
                  className="text-gray-400 hover:text-blue-500 transition flex-shrink-0"
                  title="複製 Hex 代碼"
                >
                  {copied
                    ? <Check size={12} className="text-green-500" />
                    : <Copy size={12} />}
                </button>
              </div>
              {rgb && (
                <span className="text-[10px] text-gray-400 font-mono">
                  R:{rgb.r} G:{rgb.g} B:{rgb.b}
                </span>
              )}
            </div>
          </div>

          {/* 手動 Hex 輸入 */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400 font-mono">#</span>
            <input
              type="text"
              maxLength={6}
              value={hexInput.toUpperCase()}
              onChange={e => handleHexInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyHexInput()}
              className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-400 text-gray-700"
              placeholder="RRGGBB"
            />
            <button
              type="button"
              onClick={applyHexInput}
              className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded transition font-medium"
              title="套用"
            >✓</button>
          </div>
        </div>
      )}
    </div>
  )
}
