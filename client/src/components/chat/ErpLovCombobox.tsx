import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X, Search } from 'lucide-react'

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
  /** 顯示總數上限提示(>= MAX 時顯示 "結果已截斷") */
  maxHint?: number
  className?: string
  /** server-side search:提供時 query 改用 server,client 不再 in-memory filter */
  onSearch?: (query: string) => void
  /** server-side search 載入中 */
  loading?: boolean
}

/**
 * ERP LOV 下拉選單 — inline 展開模式(搜尋 + 大清單),避免被 modal overflow 切掉
 * - 未開:單行顯示當前選值 + 下拉箭頭
 * - 開啟:完整展開 — 頂端搜尋框 + 底下大清單(max-h-80 可捲),推擠下方內容
 * - ↑↓ 選項移動,Enter 確認,Esc 關閉,Tab 關閉
 * - 子字串比對 label 與 value,不分大小寫
 */
export default function ErpLovCombobox({
  items, value, onChange, placeholder, disabled, maxHint = 500, className, onSearch, loading,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<number | null>(null)
  const lastSearchedRef = useRef<string | null>(null)

  const selected = useMemo(
    () => items.find(i => String(i.value) === String(value)) || null,
    [items, value]
  )
  // server-side search:不在 items 找到 selected 時 fallback 顯示原始 value(避免顯示為空)
  const displayLabel = selected
    ? (selected.label || selected.value)
    : (value ? String(value) : '')

  // server-side search 模式:items 直接是 server 回的結果,不再做 client filter
  const filtered = useMemo(() => {
    if (onSearch) return items
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(i =>
      String(i.label || '').toLowerCase().includes(q) ||
      String(i.value || '').toLowerCase().includes(q)
    )
  }, [items, query, onSearch])

  // server-side search:debounce 300ms;首次掛載 query='' 不觸發(避免覆蓋外面已預載的結果)
  useEffect(() => {
    if (!onSearch) return
    const q = query.trim()
    if (lastSearchedRef.current === null && q === '') {
      lastSearchedRef.current = ''
      return
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      lastSearchedRef.current = q
      onSearch(q)
    }, 300)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, onSearch])

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

  // 開啟時聚焦搜尋框
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      setTimeout(() => searchRef.current?.focus(), 0)
    }
  }, [open])

  // filter 變動時 reset highlight
  useEffect(() => { setHighlight(0) }, [query])

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
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(filtered.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const picked = filtered[highlight]
      if (picked) pick(picked)
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false)
      setQuery('')
    }
  }

  if (!open) {
    // 未開:單行顯示(selected 不在 items 時 fallback 顯示 raw value)
    const hasValue = !!value
    return (
      <div ref={containerRef} className={`relative ${className || ''}`}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen(true)}
          className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white hover:border-slate-400 focus:border-sky-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 flex items-center justify-between text-left"
        >
          <span className={hasValue ? 'truncate pr-1' : 'text-slate-400'}>
            {hasValue ? displayLabel : (placeholder || '-- 請選擇 --')}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {value && !disabled && (
              <span
                role="button"
                onMouseDown={e => e.preventDefault()}
                onClick={clear}
                className="p-0.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                title="清除"
              >
                <X size={12} />
              </span>
            )}
            <ChevronDown size={14} className="text-slate-400" />
          </div>
        </button>
      </div>
    )
  }

  // 已開:展開模式(搜尋 + 大清單)
  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      <div className="border-2 border-sky-400 rounded bg-white shadow-md">
        <div className="px-2 py-1 border-b border-slate-200 flex items-center gap-2">
          <Search size={13} className="text-slate-400 shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="輸入關鍵字搜尋(支援部分字串比對)"
            className="flex-1 text-sm focus:outline-none bg-transparent"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => { setOpen(false); setQuery('') }}
            className="p-0.5 text-slate-400 hover:text-slate-700 rounded shrink-0"
            title="關閉"
          >
            <ChevronUp size={14} />
          </button>
        </div>
        <div className="px-2 py-0.5 text-[10px] text-slate-500 border-b border-slate-200 bg-slate-50 flex justify-between">
          <span>
            {onSearch
              ? `${items.length} 筆${query ? ` · 搜尋「${query}」` : ''}${loading ? ' · 載入中…' : ''}`
              : `${filtered.length} / ${items.length} 筆${query ? ` · 搜尋「${query}」` : ''}`}
            {selected && ` · 已選:${selected.label || selected.value}`}
          </span>
          {!onSearch && items.length >= maxHint && (
            <span className="text-amber-600">結果已截斷,請輸入更精確的搜尋</span>
          )}
          {onSearch && items.length >= maxHint && (
            <span className="text-amber-600">仍有更多結果,請輸入更精確的關鍵字</span>
          )}
        </div>
        <div
          ref={listRef}
          className="max-h-80 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-2 py-6 text-sm text-slate-400 text-center">無符合結果</div>
          ) : filtered.map((it, i) => (
            <button
              key={`${it.value}-${i}`}
              type="button"
              data-idx={i}
              onMouseDown={e => { e.preventDefault(); pick(it) }}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left px-2 py-1 text-sm font-mono truncate border-b border-slate-50 ${
                i === highlight ? 'bg-sky-100 text-sky-900' : 'hover:bg-slate-50'
              } ${String(it.value) === String(value) ? 'font-semibold' : ''}`}
              title={it.label || it.value}
            >
              {it.label || it.value}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
