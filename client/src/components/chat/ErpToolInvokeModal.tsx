import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, Play, ShieldAlert, AlertTriangle, CheckCircle, Eye, Sparkles, MessageSquare, Table2, FileJson, Languages, Copy, Maximize2 } from 'lucide-react'
import api from '../../lib/api'
import type { ErpTool } from '../admin/ErpToolsPanel'
import ErpLovCombobox from './ErpLovCombobox'

function resolvePresetClient(preset: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ds = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  switch (preset) {
    case 'today': return ds(now)
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate() - 1); return ds(d) }
    case 'tomorrow': { const d = new Date(now); d.setDate(d.getDate() + 1); return ds(d) }
    case 'this_week_start': { const d = new Date(now); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return ds(d) }
    case 'this_month_start': return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
    case 'last_month_start': { const d = new Date(now); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }
    case 'this_year_start': return `${now.getFullYear()}-01-01`
    case 'last_year_start': return `${now.getFullYear() - 1}-01-01`
    case 'now': return `${ds(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    case 'current_year': return String(now.getFullYear())
    case 'current_month': return String(now.getMonth() + 1)
    case 'current_day': return String(now.getDate())
    default: return ''
  }
}

export type ResultMode = 'view' | 'ai_explain' | 'ask_with'

interface Props {
  tool: ErpTool
  sessionId: string | null
  onClose: () => void
  onDone: (payload: {
    mode: ResultMode
    tool: ErpTool
    inputs: Record<string, any>
    result: any
    cache_key: string | null
  }) => void
}

/** 掃 param.lov_config 找所有 param:<NAME> 依賴,回傳 {paramName -> [依賴的 paramName...]} */
function buildDependencyMap(params: any[]): Record<string, string[]> {
  const deps: Record<string, string[]> = {}
  for (const p of params) {
    const lov = p.lov_config
    if (!lov) continue
    const sources: any[] = []
    if (Array.isArray(lov.binds)) sources.push(...lov.binds.map((b: any) => b.source))
    if (lov.param_map && typeof lov.param_map === 'object') {
      for (const v of Object.values(lov.param_map)) {
        if (v && typeof v === 'object' && (v as any).source) sources.push((v as any).source)
      }
    }
    if (typeof lov.source === 'string') sources.push(lov.source)
    const paramDeps = sources
      .filter(s => typeof s === 'string' && s.startsWith('param:'))
      .map(s => s.slice(6).trim())
      .filter(Boolean)
    if (paramDeps.length > 0) deps[p.name] = Array.from(new Set(paramDeps))
  }
  return deps
}

export default function ErpToolInvokeModal({ tool, sessionId, onClose, onDone }: Props) {
  const { i18n, t } = useTranslation()
  const targetLang = i18n.language?.toLowerCase().startsWith('en') ? 'en'
    : i18n.language?.toLowerCase().startsWith('vi') ? 'vi'
    : null

  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [lovCache, setLovCache] = useState<Record<string, { items: { value: string; label: string }[]; missing?: string[] }>>({})
  const [lovLoading, setLovLoading] = useState<Record<string, boolean>>({})
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [cacheKey, setCacheKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmToken, setConfirmToken] = useState<string | null>(null)
  const [pendingSummary, setPendingSummary] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table')
  const [translatedMap, setTranslatedMap] = useState<Record<string, string>>({})
  const [showTranslated, setShowTranslated] = useState<Record<string, boolean>>({})
  const [translating, setTranslating] = useState<Record<string, boolean>>({})
  const [zoomed, setZoomed] = useState<{ key: string; title: string; original: string } | null>(null)

  const inParams = tool.params.filter(p => (p.in_out === 'IN' || p.in_out === 'IN/OUT') && (p as any).visible !== false)
  const depMap = useMemo(() => buildDependencyMap(tool.params), [tool])
  // 反向:誰被 X 影響 → 當 X 變時要重載哪些
  const reverseDepMap = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const [child, parents] of Object.entries(depMap)) {
      for (const parent of parents) {
        if (!m[parent]) m[parent] = []
        m[parent].push(child)
      }
    }
    return m
  }, [depMap])

  useEffect(() => {
    const init: Record<string, any> = {}
    for (const p of tool.params) {
      const cfg = (p as any).default_config
      if (cfg?.mode === 'preset') init[p.name] = resolvePresetClient(cfg.preset)
      else if (cfg?.mode === 'fixed' && cfg.fixed_value != null) init[p.name] = cfg.fixed_value
      else if (p.default_value != null) init[p.name] = p.default_value
    }
    setInputs(init)
    // 自動載入無依賴或依賴已滿足的 LOV
    for (const p of inParams) {
      if (!p.lov_config?.type) continue
      if (p.lov_config.type === 'static') continue
      const deps = depMap[p.name] || []
      if (deps.length === 0 || deps.every(d => init[d] !== undefined && init[d] !== '')) {
        loadLov(p.name, init)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  const loadLov = async (paramName: string, inputsSnapshot?: Record<string, any>) => {
    const snapshot = inputsSnapshot || inputs
    setLovLoading(s => ({ ...s, [paramName]: true }))
    try {
      const res = await api.post(`/erp-tools/${tool.id}/lov/${paramName}`, {
        paramInputs: snapshot,
      })
      if (res.data.missing_deps && res.data.missing_deps.length > 0) {
        setLovCache(s => ({ ...s, [paramName]: { items: [], missing: res.data.missing_deps } }))
      } else {
        setLovCache(s => ({ ...s, [paramName]: { items: res.data.items || [] } }))
        if (res.data.type === 'system' && res.data.system_value != null) {
          setInputs(s => ({ ...s, [paramName]: res.data.system_value }))
        }
      }
    } catch (e: any) {
      setError(`LOV ${paramName}: ${e.response?.data?.error || e.message}`)
    } finally {
      setLovLoading(s => ({ ...s, [paramName]: false }))
    }
  }

  /** 改 input 時連動:若有下游 param 依賴此欄,清空下游值並重載其 LOV */
  const onInputChange = (name: string, value: any) => {
    const next = { ...inputs, [name]: value }
    const children = reverseDepMap[name] || []
    if (children.length > 0) {
      for (const c of children) {
        next[c] = ''
      }
    }
    setInputs(next)
    for (const c of children) {
      loadLov(c, next)
    }
  }

  const execute = async (withConfirm: boolean = false) => {
    setError(null)
    setExecuting(true)
    try {
      const payload: any = {
        inputs,
        trigger_source: 'manual_form',
        session_id: sessionId,
        include_full: true,
      }
      if (withConfirm && confirmToken) payload.confirmation_token = confirmToken
      const res = await api.post(`/erp-tools/${tool.id}/execute`, payload)
      if (res.data.requires_confirmation) {
        setConfirmToken(res.data.confirmation_token)
        setPendingSummary(res.data.summary)
      } else {
        setResult(res.data.full_result ?? res.data.result)
        setCacheKey(res.data.cache_key || null)
        setConfirmToken(null)
        setPendingSummary(null)
        setTranslatedMap({})
        setShowTranslated({})
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setExecuting(false)
    }
  }

  const sendBack = (mode: ResultMode) => {
    if (!result) return
    onDone({ mode, tool, inputs, result, cache_key: cacheKey })
  }

  /** 從 result 抽取所有可翻譯文字區塊(function_return + string 類 params) */
  const extractTextBlocks = (res: any): { key: string; text: string }[] => {
    const out: { key: string; text: string }[] = []
    if (!res) return out
    if (res.function_return !== undefined && res.function_return !== null) {
      const t = String(res.function_return)
      if (t.trim()) out.push({ key: 'ret', text: t })
    }
    if (res.params && typeof res.params === 'object') {
      for (const [name, v] of Object.entries(res.params)) {
        if (typeof v === 'string' && v.trim()) out.push({ key: `p:${name}`, text: v })
      }
    }
    return out
  }

  // 結果到手 + UI 是 en/vi → 自動把所有文字區塊翻好(不用 user 按)
  useEffect(() => {
    if (!result || !targetLang) return
    const blocks = extractTextBlocks(result)
    for (const b of blocks) {
      if (translatedMap[b.key]) continue
      if (translating[b.key]) continue
      translateBlock(b.key, b.text)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, targetLang])

  const translateBlock = async (key: string, text: string) => {
    if (!targetLang) return
    if (translatedMap[key]) {
      setShowTranslated(s => ({ ...s, [key]: !s[key] }))
      return
    }
    setTranslating(s => ({ ...s, [key]: true }))
    try {
      const res = await api.post('/erp-tools/translate-result', { text, target_lang: targetLang })
      setTranslatedMap(s => ({ ...s, [key]: res.data.translated || text }))
      setShowTranslated(s => ({ ...s, [key]: true }))
    } catch (e: any) {
      setError(`翻譯失敗: ${e.response?.data?.error || e.message}`)
    } finally {
      setTranslating(s => ({ ...s, [key]: false }))
    }
  }

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text) } catch (_) {}
  }

  const getParamLabel = (p: any): { primary: string; secondary: string | null } => {
    const dn = (p as any).display_name
    if (dn && dn !== p.name) return { primary: dn, secondary: p.name }
    return { primary: p.name, secondary: null }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[55] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
              <Play size={14} /> {tool.name}
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${tool.access_mode === 'WRITE' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                {tool.access_mode}
              </span>
            </h3>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
              {tool.db_owner}.{tool.package_name ? `${tool.package_name}.` : ''}{tool.object_name}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {tool.access_mode === 'WRITE' && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <ShieldAlert size={12} /> {t('erpInvoke.writeWarning', '這是 WRITE 型工具,執行會實際修改 ERP 資料')}
            </div>
          )}

          {inParams.length === 0 ? (
            <div className="text-xs text-slate-400">{t('erpInvoke.noParams', '此工具無輸入參數')}</div>
          ) : (
            <div className="space-y-2">
              {inParams.map(p => {
                const locked = (p as any).editable === false
                const lov = lovCache[p.name]
                const deps = depMap[p.name] || []
                const missingFromDeps = deps.filter(d => !inputs[d])
                const blocked = missingFromDeps.length > 0
                const { primary, secondary } = getParamLabel(p)
                return (
                <div key={p.name} className="grid grid-cols-4 gap-2 items-start">
                  <label className="text-xs text-slate-600 pt-1.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className={secondary ? 'font-medium' : 'font-mono'}>{primary}</span>
                      {p.required && !locked && <span className="text-red-600">*</span>}
                      {locked && <span className="text-amber-600">🔒</span>}
                    </div>
                    {secondary && (
                      <div className="text-[10px] text-slate-400 font-mono">{secondary}</div>
                    )}
                    <div className="text-[10px] text-slate-400">{p.data_type}{p.data_length ? `(${p.data_length})` : ''}</div>
                  </label>
                  <div className="col-span-3">
                    {locked ? (
                      <div className="w-full bg-slate-100 border border-slate-200 rounded px-2 py-1 text-sm text-slate-600 font-mono">
                        {inputs[p.name] ?? t('erpInvoke.autoFilled', '(系統自動帶入)')}
                      </div>
                    ) : p.lov_config?.type === 'static' ? (
                      <ErpLovCombobox
                        items={(p.lov_config.items || []).map((it: any) => ({ value: String(it.value), label: it.label || String(it.value) }))}
                        value={inputs[p.name] ?? ''}
                        onChange={v => onInputChange(p.name, v)}
                        placeholder={`-- ${t('erpInvoke.selectPlaceholder', '請選擇')} --`}
                      />
                    ) : p.lov_config?.type && blocked ? (
                      <div className="w-full border border-amber-200 bg-amber-50 rounded px-2 py-1 text-xs text-amber-800">
                        {t('erpInvoke.missingDepsHint', '請先選擇:')} {missingFromDeps.join(', ')}
                      </div>
                    ) : p.lov_config?.type && lov?.missing && lov.missing.length > 0 ? (
                      <div className="w-full border border-amber-200 bg-amber-50 rounded px-2 py-1 text-xs text-amber-800">
                        {t('erpInvoke.missingDepsHint', '請先選擇:')} {lov.missing.join(', ')}
                      </div>
                    ) : p.lov_config?.type && lov?.items ? (
                      <ErpLovCombobox
                        items={lov.items.map(it => ({ value: String(it.value), label: it.label || String(it.value) }))}
                        value={inputs[p.name] ?? ''}
                        onChange={v => onInputChange(p.name, v)}
                        placeholder={`-- ${t('erpInvoke.selectPlaceholder', '請選擇')} (${lov.items.length}) --`}
                      />
                    ) : p.lov_config?.type ? (
                      <div className="flex gap-1">
                        <input value={inputs[p.name] ?? ''}
                          onChange={e => onInputChange(p.name, e.target.value)}
                          className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                          placeholder={p.ai_hint || ''} />
                        <button onClick={() => loadLov(p.name)} disabled={lovLoading[p.name]}
                          className="px-2 text-xs border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50">
                          {lovLoading[p.name] ? '…' : t('erpInvoke.loadLov', '載入')}
                        </button>
                      </div>
                    ) : (
                      <input value={inputs[p.name] ?? ''}
                        onChange={e => onInputChange(p.name, e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        placeholder={p.ai_hint || ''} />
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          )}

          {pendingSummary && confirmToken && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert size={13} className="text-amber-700" />
                <span className="text-sm font-medium text-amber-800">{t('erpInvoke.needConfirm', '需要確認')}</span>
              </div>
              <div className="text-xs text-amber-800 mb-2">{pendingSummary}</div>
              <div className="flex gap-2">
                <button onClick={() => { setConfirmToken(null); setPendingSummary(null) }}
                  className="px-3 py-1 text-xs border border-slate-300 rounded bg-white hover:bg-slate-50">{t('common.cancel', '取消')}</button>
                <button onClick={() => execute(true)} disabled={executing}
                  className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                  {executing ? t('erpInvoke.executing', '執行中…') : t('erpInvoke.confirmExecute', '確認執行')}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={12} /> {error}
            </div>
          )}

          {result && (
            <section className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
                  <CheckCircle size={13} className="text-green-600" /> {t('erpInvoke.resultTitle', '結果')}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setViewMode('table')}
                    className={`text-xs px-2 py-0.5 rounded flex items-center gap-1 ${viewMode === 'table' ? 'bg-sky-100 text-sky-700' : 'text-slate-500'}`}>
                    <Table2 size={10} /> Table
                  </button>
                  <button onClick={() => setViewMode('json')}
                    className={`text-xs px-2 py-0.5 rounded flex items-center gap-1 ${viewMode === 'json' ? 'bg-sky-100 text-sky-700' : 'text-slate-500'}`}>
                    <FileJson size={10} /> JSON
                  </button>
                </div>
              </div>
              <ResultView data={result} viewMode={viewMode}
                targetLang={targetLang}
                translatedMap={translatedMap}
                showTranslated={showTranslated}
                translating={translating}
                onTranslate={translateBlock}
                onCopy={copyText}
                onZoom={(key, title, original) => setZoomed({ key, title, original })}
                t={t}
              />
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-slate-50 flex justify-end gap-2 flex-wrap">
          {result ? (
            <>
              <button onClick={() => execute(false)} disabled={executing}
                className="mr-auto px-3 py-1.5 text-xs bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5"
                title={t('erpInvoke.requeryTitle', '修改上方條件後按此重新查詢')}>
                <Play size={12} /> {executing ? t('erpInvoke.executing', '執行中…') : t('erpInvoke.requery', '重新查詢')}
              </button>
              <button onClick={() => sendBack('view')}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded hover:bg-white flex items-center gap-1.5">
                <Eye size={12} /> {t('erpInvoke.viewOnly', '僅顯示結果')}
              </button>
              <button onClick={() => sendBack('ai_explain')}
                className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-1.5">
                <Sparkles size={12} /> {t('erpInvoke.aiExplain', '讓 AI 解釋')}
              </button>
              <button onClick={() => sendBack('ask_with')}
                className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded hover:bg-sky-700 flex items-center gap-1.5">
                <MessageSquare size={12} /> {t('erpInvoke.askWith', '以此提問')}
              </button>
              <button onClick={onClose}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded hover:bg-white">{t('common.close', '關閉')}</button>
            </>
          ) : (
            <>
              <button onClick={onClose}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-white">{t('common.cancel', '取消')}</button>
              <button onClick={() => execute(false)} disabled={executing || !!confirmToken}
                className="px-3 py-1.5 text-sm bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">
                <Play size={12} /> {executing ? t('erpInvoke.executing', '執行中…') : t('erpInvoke.execute', '執行')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Zoom Modal - 全螢幕檢視單一結果欄位 */}
      {zoomed && (
        <ZoomViewer
          zoomed={zoomed}
          targetLang={targetLang}
          translatedMap={translatedMap}
          showTranslated={showTranslated}
          translating={translating}
          onTranslate={translateBlock}
          onCopy={copyText}
          onClose={() => setZoomed(null)}
          t={t}
        />
      )}
    </div>
  )
}

function ZoomViewer({
  zoomed, targetLang, translatedMap, showTranslated, translating, onTranslate, onCopy, onClose, t,
}: {
  zoomed: { key: string; title: string; original: string }
  targetLang: 'en' | 'vi' | null
  translatedMap: Record<string, string>
  showTranslated: Record<string, boolean>
  translating: Record<string, boolean>
  onTranslate: (key: string, text: string) => void
  onCopy: (text: string) => void
  onClose: () => void
  t: TFunction
}) {
  const translated = translatedMap[zoomed.key]
  const showing = showTranslated[zoomed.key]
  const text = showing && translated ? translated : zoomed.original
  const lineCount = (text.match(/\n/g) || []).length + 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4"
      onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
              <Maximize2 size={14} className="text-sky-600" />
              {zoomed.title}
            </h3>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {text.length.toLocaleString()} 字元 · {lineCount} 行
            </div>
          </div>
          <div className="flex items-center gap-2">
            {targetLang && (
              <button onClick={() => onTranslate(zoomed.key, zoomed.original)}
                disabled={translating[zoomed.key]}
                className="text-xs px-3 py-1.5 border border-slate-300 rounded hover:bg-white flex items-center gap-1.5 disabled:opacity-50">
                <Languages size={12} />
                {translating[zoomed.key]
                  ? t('erpInvoke.translating', '翻譯中…')
                  : translated
                    ? (showing ? t('erpInvoke.showOriginal', '原文') : t('erpInvoke.showTranslated', '譯文'))
                    : t('erpInvoke.translateTo', '翻譯') + ` (${targetLang.toUpperCase()})`}
              </button>
            )}
            <button onClick={() => onCopy(text)}
              className="text-xs px-3 py-1.5 border border-slate-300 rounded hover:bg-white flex items-center gap-1.5">
              <Copy size={12} /> {t('erpInvoke.copy', '複製')}
            </button>
            <button onClick={onClose}
              className="p-1.5 hover:bg-slate-200 rounded"
              title={t('common.close', '關閉') + ' (Esc)'}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 font-mono text-base whitespace-pre-wrap break-words leading-relaxed">
          {text}
        </div>
        {showing && translated && (
          <div className="px-5 py-2 text-xs text-slate-500 border-t bg-slate-50">
            {t('erpInvoke.aiTranslationNotice', '🌐 AI 翻譯 · 代碼/ID/數字保留原樣')}
          </div>
        )}
      </div>
    </div>
  )
}

interface ResultViewProps {
  data: any
  viewMode: 'table' | 'json'
  targetLang: 'en' | 'vi' | null
  translatedMap: Record<string, string>
  showTranslated: Record<string, boolean>
  translating: Record<string, boolean>
  onTranslate: (key: string, text: string) => void
  onCopy: (text: string) => void
  onZoom: (key: string, title: string, original: string) => void
  t: TFunction
}

function TranslatableText({
  textKey, title, original, targetLang, translatedMap, showTranslated, translating, onTranslate, onCopy, onZoom, t,
}: {
  textKey: string
  title: string
  original: string
} & Omit<ResultViewProps, 'data' | 'viewMode'>) {
  const translated = translatedMap[textKey]
  const showing = showTranslated[textKey]
  // 目標語言且尚未翻完 → 顯示 placeholder 避免閃中文
  const hidePending = targetLang && translating[textKey] && !translated && !showing
  const text = showing && translated ? translated : original
  return (
    <div className="bg-slate-50 border rounded">
      <div className="flex items-center justify-end gap-2 px-2 py-1 border-b border-slate-200 bg-slate-100/50">
        {targetLang && (
          <button onClick={() => onTranslate(textKey, original)}
            disabled={translating[textKey]}
            className="text-[10px] text-slate-600 hover:text-sky-600 flex items-center gap-1 disabled:opacity-50">
            <Languages size={10} />
            {translating[textKey]
              ? t('erpInvoke.translating', '翻譯中…')
              : translated
                ? (showing ? t('erpInvoke.showOriginal', '原文') : t('erpInvoke.showTranslated', '譯文'))
                : t('erpInvoke.translateTo', '翻譯') + ` (${targetLang.toUpperCase()})`}
          </button>
        )}
        <button onClick={() => onCopy(text)}
          disabled={!!hidePending}
          className="text-[10px] text-slate-600 hover:text-sky-600 flex items-center gap-1 disabled:opacity-40">
          <Copy size={10} /> {t('erpInvoke.copy', '複製')}
        </button>
        <button onClick={() => onZoom(textKey, title, original)}
          disabled={!!hidePending}
          className="text-[10px] text-slate-600 hover:text-sky-600 flex items-center gap-1 disabled:opacity-40"
          title="放大檢視">
          <Maximize2 size={10} /> {t('erpInvoke.zoom', '放大')}
        </button>
      </div>
      {hidePending ? (
        <div className="px-3 py-2 text-sm font-mono min-h-[240px] flex items-center justify-center text-slate-400">
          <div className="flex items-center gap-2">
            <Languages size={14} className="animate-pulse text-sky-500" />
            <span>{t('erpInvoke.translating', '翻譯中…')} ({targetLang?.toUpperCase()})</span>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 text-sm font-mono whitespace-pre-wrap break-words min-h-[240px] max-h-[480px] overflow-y-auto">
          {text}
        </div>
      )}
      {showing && translated && (
        <div className="px-3 py-1 text-[10px] text-slate-400 border-t border-slate-200 bg-slate-100/30">
          {t('erpInvoke.aiTranslationNotice', '🌐 AI 翻譯 · 代碼/ID/數字保留原樣')}
        </div>
      )}
    </div>
  )
}

function ResultView(props: ResultViewProps) {
  const { data, viewMode } = props
  if (!data) return <div className="text-xs text-slate-400">無資料</div>
  if (viewMode === 'json') {
    return (
      <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded overflow-auto max-h-[500px] font-mono whitespace-pre-wrap break-words">
        {JSON.stringify(data, null, 2)}
      </pre>
    )
  }
  const nodes: any[] = []
  if (data.function_return !== undefined) {
    const text = String(data.function_return ?? 'null')
    const title = `Function ${props.t('erpInvoke.functionReturn', '回傳')}`
    nodes.push(
      <div key="ret" className="mb-3">
        <div className="text-[10px] font-medium text-slate-500 mb-0.5">{title}</div>
        <TranslatableText textKey="ret" title={title} original={text} {...props} />
      </div>
    )
  }
  if (data.params) {
    for (const [name, v] of Object.entries(data.params)) {
      if (v && typeof v === 'object' && Array.isArray((v as any).rows)) {
        const rows = (v as any).rows
        if (rows.length === 0) {
          nodes.push(<div key={name} className="text-xs text-slate-400 mb-2">{name}: {props.t('erpInvoke.empty', '空')}</div>)
          continue
        }
        const cols = Object.keys(rows[0])
        nodes.push(
          <div key={name} className="mb-3">
            <div className="text-[10px] font-medium text-slate-500 mb-0.5">{name} ({(v as any).total_fetched} {props.t('erpInvoke.rows', '列')})</div>
            <div className="overflow-auto max-h-[400px] border rounded">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-100 sticky top-0 z-10">
                  <tr>{cols.map(c => <th key={c} className="px-2 py-1 text-left font-medium text-slate-600 border-b whitespace-nowrap">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {cols.map(c => (
                        <td key={c} className="px-2 py-0.5 border-b border-slate-100 font-mono align-top whitespace-pre-wrap break-words">
                          {r[c] === null || r[c] === undefined ? <span className="text-slate-400">null</span> : String(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      } else if (typeof v === 'string') {
        nodes.push(
          <div key={name} className="mb-3">
            <div className="text-[10px] font-medium text-slate-500 mb-0.5 font-mono">{name}</div>
            <TranslatableText textKey={`p:${name}`} title={name} original={v} {...props} />
          </div>
        )
      } else {
        nodes.push(
          <div key={name} className="mb-3">
            <div className="text-[10px] font-medium text-slate-500 mb-0.5 font-mono">{name}</div>
            <div className="bg-slate-50 border rounded px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
              {JSON.stringify(v, null, 2)}
            </div>
          </div>
        )
      }
    }
  }
  return <div>{nodes}</div>
}
