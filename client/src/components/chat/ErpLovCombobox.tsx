import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

interface Item {
  value: string
  label: string
}

interface Props {
  items: Item[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  /** 顯示總數上限提示(>= MAX 時顯示 "結果已截斷,請輸入更精確的搜尋") */
  maxHint?: number
  className?: string
}

/**
 * ERP LOV 下拉選單 — 支援模糊漸進搜尋、鍵盤導航、點外關閉
 * - 聚焦 / 點擊 → 開啟下拉,input 變成搜尋框
 * - ↑↓ 選項移動,Enter 確認,Esc 關閉
 * - 子字串比對 label 與 value,不分大小寫
 */
export default function ErpLovCombobox({
  items, value, onChange, placeholder, disabled, maxHint = 500, className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => items.find(i => String(i.value) === String(value)) || null,
    [items, value]
  )
  const displayLabel = selected ? (selected.label || selected.value) : ''

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(i =>
      String(i.label || '').toLowerCase().includes(q) ||
      String(i.value || '').toLowerCase().includes(q)
    )
  }, [items, query])

  // 點外面關閉
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // filter 變動時 reset highlight
  useEffect(() => { setHighlight(0) }, [query, open])

  // highlight 捲動到可見區
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const pick = (item: Item) => {
    onChange(String(item.value))
    setOpen(false)
    setQuery('')
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setQuery('')
    setOpen(false)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setHighlight(h => Math.min(filtered.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const picked = filtered[highlight]
      if (picked) pick(picked)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const openNow = () => {
    if (disabled) return
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={open ? query : displayLabel}
          onFocus={() => setOpen(true)}
          onClick={openNow}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={onKey}
          placeholder={placeholder || '-- 請選擇 --'}
          className="w-full border border-slate-300 rounded px-2 py-1 text-sm pr-12 focus:border-sky-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
          autoComplete="off"
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && !disabled && (
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={clear}
              className="p-0.5 text-slate-400 hover:text-slate-700 rounded"
              title="清除"
            >
              <X size={12} />
            </button>
          )}
          <ChevronDown
            size={14}
            className={`text-slate-400 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </div>
      {open && (
        <div
          ref={listRef}
          className="absolute top-full left-0 right-0 mt-0.5 max-h-64 overflow-y-auto bg-white border border-slate-300 rounded shadow-lg z-50"
        >
          <div className="px-2 py-1 text-[10px] text-slate-500 border-b bg-slate-50 sticky top-0 flex justify-between">
            <span>{filtered.length} / {items.length} 筆{query && ` · 搜尋「${query}」`}</span>
            {items.length >= maxHint && (
              <span className="text-amber-600">結果已截斷,請輸入更精確的搜尋</span>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-sm text-slate-400 text-center">無符合結果</div>
          ) : filtered.map((it, i) => (
            <button
              key={`${it.value}-${i}`}
              type="button"
              data-idx={i}
              onMouseDown={e => { e.preventDefault(); pick(it) }}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left px-2 py-1 text-sm font-mono truncate ${
                i === highlight ? 'bg-sky-100 text-sky-900' : 'hover:bg-slate-50'
              } ${String(it.value) === String(value) ? 'font-semibold' : ''}`}
              title={it.label || it.value}
            >
              {it.label || it.value}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
