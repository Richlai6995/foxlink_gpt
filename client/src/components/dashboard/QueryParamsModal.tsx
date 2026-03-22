/**
 * QueryParamsModal — 執行命名查詢前，讓使用者填入參數值
 */
import { useState, useEffect, useRef } from 'react'
import api from '../../lib/api'
import type { AiQueryParameter } from '../../types'
import { useTranslation } from 'react-i18next'
import {
  DYNAMIC_DATE_TOKENS, getTokenDef, extractN, buildNToken,
  resolveDynamicDate, tokenDisplayLabel,
} from '../../lib/dynamicDate'

interface ParamValue {
  param: AiQueryParameter
  value: string | string[]
}

interface Props {
  queryName: string
  params: AiQueryParameter[]
  initialValues?: Record<string, string | string[]>
  onConfirm: (values: Record<string, string | string[]>) => void
  onClose: () => void
}

const DEFAULT_SHORTCUTS: Record<string, string> = {
  today:      new Date().toISOString().slice(0, 10),
  this_month: `${new Date().toISOString().slice(0, 7)}-01|${new Date().toISOString().slice(0, 10)}`,
  last_month: (() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return `${d.toISOString().slice(0, 10)}|${last.toISOString().slice(0, 10)}`
  })(),
}

/** 可搜尋單選下拉 */
function SearchableSelect({
  opts, value, onChange, loading, onSearch,
}: {
  opts: { val: string; label: string }[]
  value: string
  onChange: (v: string) => void
  loading: boolean
  onSearch: (s: string) => void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selected = opts.find(o => o.val === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleSearch(v: string) {
    setSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onSearch(v), 350)
  }

  const filtered = opts  // 後端已過濾，直接顯示

  const displayText = loading ? t('aiDash.qpModal.loading')
    : selected ? (selected.label !== selected.val ? `${selected.label} (${selected.val})` : selected.val)
    : value ? value   // 有值但 opts 尚未載入時顯示原始值
    : t('aiDash.qpModal.selectPlaceholder')

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { if (!loading) { setOpen(v => !v); setSearch('') } }}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-left focus:outline-none focus:border-blue-400 bg-white flex items-center justify-between"
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>{displayText}</span>
        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col" style={{ maxHeight: 280 }}>
          {/* 搜尋欄 */}
          <div className="px-2 pt-2 pb-1 border-b border-gray-100">
            <div className="flex gap-1">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && search.trim()) {
                    onChange(search.trim())
                    setOpen(false)
                  }
                }}
                placeholder={t('aiDash.qpModal.searchPlaceholder')}
                className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
              />
              {search.trim() && (
                <button
                  onClick={() => { onChange(search.trim()); setOpen(false) }}
                  className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 whitespace-nowrap"
                >{t('aiDash.qpModal.useValue')}</button>
              )}
            </div>
          </div>
          {/* 清除選項 */}
          <button
            onClick={() => { onChange(''); setOpen(false) }}
            className="text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 border-b border-gray-50"
          >{t('aiDash.qpModal.noSelect')}</button>
          {/* 選項列表 */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-3">{t('aiDash.qpModal.noMatch')}</div>
            )}
            {filtered.map(o => (
              <button
                key={o.val}
                onClick={() => { onChange(o.val); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between
                  ${o.val === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
              >
                <span>{o.label !== o.val ? o.label : o.val}</span>
                {o.label !== o.val && <span className="text-xs text-gray-400 ml-2">{o.val}</span>}
              </button>
            ))}
          </div>
          <div className="px-2 py-1.5 text-xs text-gray-400 border-t border-gray-100 text-right">
            {t('aiDash.qpModal.totalCount', { filtered: filtered.length, total: opts.length })}
          </div>
        </div>
      )}
    </div>
  )
}

/** 可搜尋多選列表 */
function SearchableMultiSelect({
  opts, value, onToggle, loading, onSearch,
}: {
  opts: { val: string; label: string }[]
  value: string[]
  onToggle: (v: string) => void
  loading: boolean
  onSearch: (s: string) => void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearch(v: string) {
    setSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onSearch(v), 350)
  }

  const filtered = opts  // 後端已過濾

  return (
    <div className="border border-gray-200 rounded-lg flex flex-col" style={{ maxHeight: 260 }}>
      {/* 搜尋欄 */}
      <div className="px-2 pt-2 pb-1 border-b border-gray-100 flex-shrink-0">
        <div className="flex gap-1">
          <input
            type="text"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && search.trim()) {
                onToggle(search.trim())
                setSearch('')
              }
            }}
            placeholder={t('aiDash.qpModal.searchPlaceholder')}
            className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
          />
          {search.trim() && (
            <button
              onClick={() => { onToggle(search.trim()); setSearch('') }}
              className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 whitespace-nowrap"
            >{t('aiDash.qpModal.addValue')}</button>
          )}
        </div>
      </div>
      {/* 已選提示 */}
      {value.length > 0 && (
        <div className="px-3 py-1 bg-blue-50 text-xs text-blue-600 flex-shrink-0 border-b border-blue-100">
          {t('aiDash.qpModal.selectedCount', { count: value.length, items: value.slice(0, 3).join('、') + (value.length > 3 ? '…' : '') })}
        </div>
      )}
      {/* 選項列表 */}
      <div className="overflow-y-auto flex-1 p-1">
        {loading && <div className="text-xs text-gray-400 text-center py-3">{t('aiDash.qpModal.loading')}</div>}
        {!loading && filtered.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-3">{t('aiDash.qpModal.noMatch')}</div>
        )}
        {filtered.map(o => {
          const isChecked = value.includes(o.val)
          return (
            <label key={o.val} className={`flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded transition
              ${isChecked ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(o.val)}
                className="rounded"
              />
              <span className="flex-1">{o.label !== o.val ? o.label : o.val}</span>
              {o.label !== o.val && <span className="text-xs text-gray-400">{o.val}</span>}
            </label>
          )
        })}
      </div>
      <div className="px-2 py-1 text-xs text-gray-400 border-t border-gray-100 flex-shrink-0 text-right">
        {t('aiDash.qpModal.totalCount', { filtered: filtered.length, total: opts.length })}
      </div>
    </div>
  )
}

/** 動態日期選擇器 — 顯示多語言 token 清單，has_n token 額外顯示 N 輸入 */
function DynamicDatePicker({ value, onChange, lang }: {
  value: string
  onChange: (v: string) => void
  lang: 'zh' | 'en' | 'vi'
}) {
  // 分解目前 value 成 baseToken + n
  const tokenDef = getTokenDef(value)
  const baseToken = tokenDef?.has_n
    ? DYNAMIC_DATE_TOKENS.find(t => t.n_unit === tokenDef.n_unit)?.token || value
    : (value || '')
  const nVal = tokenDef?.has_n ? extractN(value) : 7

  const [selBase, setSelBase] = useState(baseToken)
  const [nInput, setNInput] = useState(nVal)

  function emitChange(base: string, n: number) {
    const def = DYNAMIC_DATE_TOKENS.find(t => t.token === base)
    if (def?.has_n) onChange(buildNToken(base, n))
    else onChange(base)
  }

  const tokenLabel = (t: typeof DYNAMIC_DATE_TOKENS[0]) =>
    lang === 'en' ? t.label_en : lang === 'vi' ? t.label_vi : t.label_zh

  // 解析預覽
  const previewResolved = value ? resolveDynamicDate(value) : ''
  const previewStr = previewResolved.includes('|')
    ? previewResolved.split('|').join(' ～ ')
    : previewResolved

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {DYNAMIC_DATE_TOKENS.map(t => (
          <button
            key={t.token}
            type="button"
            onClick={() => {
              setSelBase(t.token)
              emitChange(t.token, nInput)
            }}
            className={`px-2.5 py-1 rounded-full border text-xs transition-colors
              ${selBase === t.token
                ? 'border-blue-500 bg-blue-600 text-white font-medium'
                : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'}`}
          >
            {tokenLabel(t).replace('N', '●')}
          </button>
        ))}
      </div>

      {/* has_n token → 顯示 N 輸入 */}
      {DYNAMIC_DATE_TOKENS.find(t => t.token === selBase)?.has_n && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <span className="text-sm text-blue-700 whitespace-nowrap">
            {lang === 'en' ? 'N =' : lang === 'vi' ? 'N =' : 'N ='}
          </span>
          <input
            type="number"
            min={1}
            max={366}
            value={nInput}
            onChange={e => {
              const n = Math.max(1, parseInt(e.target.value) || 1)
              setNInput(n)
              emitChange(selBase, n)
            }}
            className="w-20 border border-blue-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-blue-600">
            {DYNAMIC_DATE_TOKENS.find(t => t.token === selBase)?.n_unit === 'd' ? (lang === 'en' ? 'days' : '天') :
             DYNAMIC_DATE_TOKENS.find(t => t.token === selBase)?.n_unit === 'w' ? (lang === 'en' ? 'weeks' : '週') :
             (lang === 'en' ? 'months' : '個月')}
          </span>
        </div>
      )}

      {/* 預覽解析結果 */}
      {previewStr && (
        <p className="text-xs text-gray-400">
          {lang === 'en' ? '→ Actual query range:' : lang === 'vi' ? '→ Phạm vi truy vấn thực tế:' : '→ 實際查詢範圍：'}<span className="text-blue-600 font-medium">{previewStr}</span>
        </p>
      )}
    </div>
  )
}

export default function QueryParamsModal({ queryName, params, initialValues, onConfirm, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const [values, setValues] = useState<ParamValue[]>(() =>
    params.map(p => ({
      param: p,
      value: initialValues?.[p.id] !== undefined
        ? initialValues[p.id]
        : p.default_value
          ? (DEFAULT_SHORTCUTS[p.default_value] ?? p.default_value)
          : (p.input_type === 'multiselect' ? [] : ''),
    }))
  )
  const [optionsMap, setOptionsMap] = useState<Record<string, { val: string; label: string }[]>>({})
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({})
  const [errorMap, setErrorMap] = useState<Record<string, string>>({})
  // undefined = 未載入過, [] = 載入但 0 筆, [...] = 有資料
  const [fetchedSet, setFetchedSet] = useState<Set<string>>(new Set())

  useEffect(() => {
    // 所有 select/multiselect 都嘗試載入，fetchOptions 內部處理缺設定的錯誤顯示
    for (const p of params) {
      if (p.input_type !== 'select' && p.input_type !== 'multiselect') continue
      fetchOptions(p, '')
    }
  }, [])

  async function fetchOptions(p: AiQueryParameter, search: string) {
    setLoadingMap(prev => ({ ...prev, [p.id]: true }))
    setErrorMap(prev => ({ ...prev, [p.id]: '' }))
    try {
      if (!p.schema_id && !p.fetch_values_sql) {
        setErrorMap(prev => ({ ...prev, [p.id]: '⚙ 此參數尚未設定來源 Schema 或自訂 SQL，請到命名查詢設定查詢參數' }))
        return
      }
      if (!p.column_name) {
        setErrorMap(prev => ({ ...prev, [p.id]: '⚙ 此參數尚未設定來源欄位（column_name）' }))
        return
      }
      const reqParams: Record<string, string> = { column_name: p.column_name }
      if (p.schema_id) reqParams.schema_id = String(p.schema_id)
      if (p.fetch_values_sql) reqParams.fetch_values_sql = p.fetch_values_sql
      if (search) reqParams.search = search
      const r = await api.get('/dashboard/saved-queries/param-values', { params: reqParams })
      setOptionsMap(prev => ({ ...prev, [p.id]: r.data }))
      setFetchedSet(prev => new Set([...prev, p.id]))
    } catch (e: unknown) {
      console.error('[LOV fetch]', e)
      const errData = (e as { response?: { data?: { error?: string; sql?: string } } })?.response?.data
      const msg = errData?.error || (e as { message?: string })?.message || 'LOV 載入失敗'
      const sqlHint = errData?.sql ? `\nSQL: ${errData.sql}` : ''
      setErrorMap(prev => ({ ...prev, [p.id]: msg + sqlHint }))
    } finally {
      setLoadingMap(prev => ({ ...prev, [p.id]: false }))
    }
  }

  function paramLabel(p: AiQueryParameter): string {
    const lang = i18n.language
    if (lang === 'en' && p.label_en) return p.label_en
    if (lang === 'vi' && p.label_vi) return p.label_vi
    return p.label_zh
  }

  function setValue(idx: number, val: string | string[]) {
    setValues(prev => prev.map((pv, i) => i === idx ? { ...pv, value: val } : pv))
  }

  function toggleMulti(idx: number, val: string) {
    const current = (values[idx].value as string[]) || []
    setValue(idx, current.includes(val) ? current.filter(v => v !== val) : [...current, val])
  }

  function handleConfirm() {
    for (const pv of values) {
      if (!pv.param.required) continue
      const v = pv.value
      if (!v || (Array.isArray(v) && v.length === 0) || v === '') {
        alert(`${t('aiDash.qpModal.requiredParam')}${paramLabel(pv.param)}`)
        return
      }
    }
    const result: Record<string, string | string[]> = {}
    for (const pv of values) result[pv.param.id] = pv.value
    onConfirm(result)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{t('aiDash.qpModal.runTitle')}{queryName}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t('aiDash.qpModal.fillParams')}</p>
        </div>

        {/* Params */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {values.map((pv, idx) => {
            const p = pv.param
            const label = paramLabel(p)
            const opts = optionsMap[p.id] || []
            const isLoading = loadingMap[p.id]
            const lovError = errorMap[p.id]
            const wasFetched = fetchedSet.has(p.id)
            const isLovEmpty = wasFetched && !isLoading && !lovError && opts.length === 0

            return (
              <div key={p.id}>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">
                  {label}
                  {p.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>

                {p.input_type === 'select' && (
                  <>
                    <SearchableSelect
                      opts={opts}
                      value={pv.value as string}
                      onChange={v => setValue(idx, v)}
                      loading={isLoading}
                      onSearch={s => fetchOptions(p, s)}
                    />
                    {lovError && (
                      <p className="text-xs text-red-500 mt-1 whitespace-pre-wrap">
                        ⚠ {lovError}
                        <button onClick={() => fetchOptions(p, '')} className="underline ml-2">重試</button>
                      </p>
                    )}
                    {isLovEmpty && (
                      <p className="text-xs text-amber-600 mt-1">
                        查詢成功但 ERP 回傳 0 筆，請確認 Schema 來源 SQL 是否能存取此欄位資料
                        <button onClick={() => fetchOptions(p, '')} className="underline ml-2">重試</button>
                      </p>
                    )}
                  </>
                )}

                {p.input_type === 'multiselect' && (
                  <>
                    <SearchableMultiSelect
                      opts={opts}
                      value={pv.value as string[]}
                      onToggle={v => toggleMulti(idx, v)}
                      loading={isLoading}
                      onSearch={s => fetchOptions(p, s)}
                    />
                    {lovError && (
                      <p className="text-xs text-red-500 mt-1 whitespace-pre-wrap">
                        ⚠ {lovError}
                        <button onClick={() => fetchOptions(p, '')} className="underline ml-2">重試</button>
                      </p>
                    )}
                    {isLovEmpty && (
                      <p className="text-xs text-amber-600 mt-1">
                        查詢成功但 ERP 回傳 0 筆，請確認 Schema 來源 SQL 是否能存取此欄位資料
                        <button onClick={() => fetchOptions(p, '')} className="underline ml-2">重試</button>
                      </p>
                    )}
                  </>
                )}

                {p.input_type === 'date_range' && (
                  <div className="space-y-2">
                    <div className="flex gap-2 items-center">
                      <input
                        type="date"
                        value={(pv.value as string).split('|')[0] || ''}
                        onChange={e => setValue(idx, `${e.target.value}|${(pv.value as string).split('|')[1] || ''}`)}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                      />
                      <span className="text-gray-400 text-sm">~</span>
                      <input
                        type="date"
                        value={(pv.value as string).split('|')[1] || ''}
                        onChange={e => setValue(idx, `${(pv.value as string).split('|')[0] || ''}|${e.target.value}`)}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div className="flex gap-1">
                      {['today', 'this_month', 'last_month'].map(k => (
                        <button
                          key={k}
                          onClick={() => setValue(idx, DEFAULT_SHORTCUTS[k])}
                          className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-blue-100 text-gray-600 hover:text-blue-700 rounded"
                        >
                          {k === 'today' ? t('aiDash.qpModal.today') : k === 'this_month' ? t('aiDash.qpModal.thisMonth') : t('aiDash.qpModal.lastMonth')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {p.input_type === 'number_range' && (
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      value={(pv.value as string).split('|')[0] || ''}
                      onChange={e => setValue(idx, `${e.target.value}|${(pv.value as string).split('|')[1] || ''}`)}
                      placeholder={t('aiDash.qpModal.minValue')}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                    />
                    <span className="text-gray-400 text-sm">~</span>
                    <input
                      type="number"
                      value={(pv.value as string).split('|')[1] || ''}
                      onChange={e => setValue(idx, `${(pv.value as string).split('|')[0] || ''}|${e.target.value}`)}
                      placeholder={t('aiDash.qpModal.maxValue')}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                )}

                {p.input_type === 'text' && (
                  <input
                    type="text"
                    value={pv.value as string}
                    onChange={e => setValue(idx, e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                )}

                {p.input_type === 'dynamic_date' && (
                  <DynamicDatePicker
                    value={pv.value as string}
                    onChange={v => setValue(idx, v)}
                    lang={i18n.language === 'en' ? 'en' : i18n.language === 'vi' ? 'vi' : 'zh'}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t('common.cancel')}</button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            {t('aiDash.qpModal.runBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
