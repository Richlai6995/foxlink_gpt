/**
 * MetalsPage — 金屬情報精簡版(/metals)
 *
 * 規劃見 docs/metals-lite-plan.md
 *
 * Layout(桌機 ≥1280px):
 *   ┌── Top bar(返回 + 我的偏好 + 匯出 XLSX + 切完整版)
 *   ├── 三欄
 *   │    ├ 左:LME 報價 / 貴金屬 報價(2 block 上下)
 *   │    ├ 中:LME 走勢圖 / 貴金屬 走勢圖(2 chart 上下)
 *   │    └ 右:AI 分析 / 宏觀 / 新聞-週報-月報 tab
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, Settings, Download, Loader2, AlertCircle, Sparkles, X, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import MetalsPriceBlock from '../components/metals/MetalsPriceBlock'
import MetalsChart from '../components/metals/MetalsChart'
import MetalsAiPanel from '../components/metals/MetalsAiPanel'
import MetalsMacroPanel from '../components/metals/MetalsMacroPanel'
import MetalsNewsPanel from '../components/metals/MetalsNewsPanel'

const PRECIOUS = [
  { code: 'AU', name: '金' }, { code: 'AG', name: '銀' },
  { code: 'PT', name: '鉑' }, { code: 'PD', name: '鈀' }, { code: 'RH', name: '銠' },
]
const BASE = [
  { code: 'CU', name: '銅' }, { code: 'AL', name: '鋁' },
  { code: 'NI', name: '鎳' }, { code: 'ZN', name: '鋅' },
  { code: 'PB', name: '鉛' }, { code: 'SN', name: '錫' },
]
const ALL_METALS = [...PRECIOUS, ...BASE]

interface Prefs {
  focused_metals: string[]
  default_24h_only: number
}

export default function MetalsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  // 從哪進來?有 state.from → 返回那;沒 → /chat
  const backTo = (location.state as any)?.from || '/chat'
  const [denied, setDenied] = useState(false)
  const [loadingInit, setLoadingInit] = useState(true)
  const [prefs, setPrefs] = useState<Prefs>({ focused_metals: [], default_24h_only: 1 })
  const [showPrefs, setShowPrefs] = useState(false)
  const [hasFullAccess, setHasFullAccess] = useState(false)  // 採購端,顯示「切到完整版」

  const [prices, setPrices] = useState<any[]>([])
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [primaryBase, setPrimaryBase] = useState('CU')
  const [primaryPrecious, setPrimaryPrecious] = useState('AU')
  const [showAi, setShowAi] = useState(false)

  // 初始載入:偏好 + 是否有採購完整版權限
  useEffect(() => {
    Promise.all([
      api.get('/metals/preferences').catch(err => {
        if (err?.response?.status === 403) setDenied(true)
        return { data: null }
      }),
      api.get('/help/books').catch(() => ({ data: [] })),
    ]).then(([pRes, bRes]) => {
      if (pRes.data) setPrefs(pRes.data)
      const codes = (bRes.data || []).map((b: any) => b.code)
      setHasFullAccess(codes.includes('precious-metals'))
    }).finally(() => setLoadingInit(false))
  }, [])

  const focusedSet = useMemo(() => new Set(prefs.focused_metals || []), [prefs])

  // 載報價
  useEffect(() => {
    if (denied || loadingInit) return
    setLoadingPrices(true)
    api.get('/metals/prices').then(r => setPrices(r.data || [])).finally(() => setLoadingPrices(false))
  }, [denied, loadingInit])

  const downloadXlsx = async () => {
    const params: Record<string, string> = {}
    if (prefs.focused_metals?.length) params.metals = prefs.focused_metals.join(',')
    const url = '/metals/export.xlsx?' + new URLSearchParams(params).toString()
    const resp = await api.get(url, { responseType: 'blob' })
    const blob = new Blob([resp.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const dl = document.createElement('a')
    dl.href = URL.createObjectURL(blob)
    const now = new Date()
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    dl.download = `metals_snapshot_${stamp}.xlsx`
    dl.click()
    URL.revokeObjectURL(dl.href)
  }

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 text-slate-500 gap-3">
        <AlertCircle size={48} className="text-amber-400" />
        <div className="text-lg font-medium">{t('metalsLite.deniedTitle', '需要金屬情報閱讀權限')}</div>
        <div className="text-sm">{t('metalsLite.deniedHint', '請洽 admin 在「特殊說明書管理」加你進「金屬情報(精簡版)」的分享名單')}</div>
        <button onClick={() => navigate('/chat')} className="mt-3 px-4 py-2 text-sm rounded bg-slate-800 text-white hover:bg-slate-900">
          {t('metalsLite.backToChat', '回到對話')}
        </button>
      </div>
    )
  }

  if (loadingInit) {
    return <div className="flex items-center justify-center h-screen text-slate-400"><Loader2 className="animate-spin" /> {t('metalsLite.loading', '載入中…')}</div>
  }

  return (
    <div className="flex flex-col h-screen bg-amber-50/30 overflow-hidden">
      {/* Top bar */}
      <header className="bg-white border-b px-6 py-2.5 flex items-center gap-3 shadow-sm flex-shrink-0">
        <button onClick={() => navigate(backTo)} className="text-slate-500 hover:text-slate-800 text-sm flex items-center gap-1">
          <ArrowLeft size={16} /> {t('metalsLite.back', '返回')}
        </button>
        <Sparkles size={18} className="text-amber-500" />
        <h1 className="text-lg font-bold text-slate-800">{t('metalsLite.title', '金屬情報')}</h1>
        <span className="text-xs text-slate-400">{t('metalsLite.subtitle', '報價 / 走勢 / 宏觀 / 新聞 / AI')}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowAi(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
            title="開啟 AI 分析助理"
          ><MessageSquare size={14} /> AI 分析</button>
          <button
            onClick={() => setShowPrefs(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-slate-200 hover:bg-slate-50 text-slate-700"
          ><Settings size={14} /> {t('metalsLite.myPrefs', '我的偏好')}</button>
          <button
            onClick={downloadXlsx}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-blue-200 text-blue-700 hover:bg-blue-50"
            title={t('metalsLite.exportTitle', '匯出當前金屬報價 + 漲跌 + 宏觀')}
          ><Download size={14} /> {t('metalsLite.exportXlsx', '匯出 XLSX')}</button>
          {hasFullAccess && (
            <button
              onClick={() => navigate('/pm/briefing', { state: { from: '/metals' } })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-amber-100 text-amber-800 hover:bg-amber-200"
              title={t('metalsLite.toFullTitle', '切到採購完整版')}
            >→ {t('metalsLite.toFull', '採購完整版')}</button>
          )}
        </div>
      </header>

      {/* 三欄 layout */}
      <div className="flex-1 min-h-0 grid gap-3 p-3 overflow-hidden" style={{ gridTemplateColumns: 'minmax(240px, 280px) 1fr minmax(320px, 360px)' }}>
        {/* 左欄 — 報價兩 block */}
        <div className="overflow-y-auto space-y-3 min-h-0">
          <MetalsPriceBlock
            title={t('metalsLite.baseMetals', '基本金屬(LME)')}
            rows={prices}
            metalsAllowed={BASE.map(m => m.code)}
            loading={loadingPrices}
            selectedCode={primaryBase}
            onSelect={setPrimaryBase}
            focusedSet={focusedSet}
            theme="lme"
          />
          <MetalsPriceBlock
            title={t('metalsLite.preciousMetals', '貴金屬')}
            rows={prices}
            metalsAllowed={PRECIOUS.map(m => m.code)}
            loading={loadingPrices}
            selectedCode={primaryPrecious}
            onSelect={setPrimaryPrecious}
            focusedSet={focusedSet}
            theme="precious"
          />
        </div>

        {/* 中欄 — 兩 chart */}
        <div className="overflow-y-auto space-y-3 min-h-0">
          <MetalsChart
            title={t('metalsLite.baseChartTitle', '基本金屬走勢(LME)')}
            metals={BASE.filter(m => focusedSet.size === 0 || focusedSet.has(m.code))}
            primaryMetal={primaryBase}
            onPrimaryChange={setPrimaryBase}
            theme="lme"
          />
          <MetalsChart
            title={t('metalsLite.preciousChartTitle', '貴金屬走勢')}
            metals={PRECIOUS.filter(m => focusedSet.size === 0 || focusedSet.has(m.code))}
            primaryMetal={primaryPrecious}
            onPrimaryChange={setPrimaryPrecious}
            theme="precious"
          />
        </div>

        {/* 右欄 — 宏觀(精簡單欄)/ 新聞(展開吃滿) */}
        <div className="flex flex-col gap-3 min-h-0">
          <MetalsMacroPanel />
          <MetalsNewsPanel />
        </div>
      </div>

      {/* AI Drawer — 從右滑入 */}
      <MetalsAiPanel isOpen={showAi} onClose={() => setShowAi(false)} />

      {showPrefs && <PrefsModal prefs={prefs} onClose={() => setShowPrefs(false)} onSaved={(p) => { setPrefs(p); setShowPrefs(false) }} />}
    </div>
  )
}

// ── 偏好 modal ──────────────────────────────────────────────────────────────
function PrefsModal({ prefs, onClose, onSaved }: { prefs: Prefs; onClose: () => void; onSaved: (p: Prefs) => void }) {
  const { t } = useTranslation()
  const [focused, setFocused] = useState<string[]>(prefs.focused_metals || [])
  const [saving, setSaving] = useState(false)

  const toggle = (code: string) =>
    setFocused(focused.includes(code) ? focused.filter(c => c !== code) : [...focused, code])

  const save = async () => {
    setSaving(true)
    try {
      // 共用 pm_user_preferences,後端兩條路由(metals / pm/briefing)都更新同一張表
      await api.put('/metals/preferences', { focused_metals: focused, default_24h_only: prefs.default_24h_only })
      onSaved({ ...prefs, focused_metals: focused })
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[480px] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium">⚙ {t('metalsLite.myPrefs', '我的偏好')}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-xs text-slate-500">
            {t('metalsLite.prefsHint', '勾選後:報價列 / 走勢圖只顯示這些金屬。留空 = 全部都顯示。')}
          </div>
          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">🪙 {t('metalsLite.preciousMetals', '貴金屬')}</div>
            <div className="grid grid-cols-3 gap-2">
              {PRECIOUS.map(m => (
                <label key={m.code} className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer border ${
                  focused.includes(m.code) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}>
                  <input type="checkbox" checked={focused.includes(m.code)} onChange={() => toggle(m.code)} />
                  <span className="font-mono font-bold">{m.code}</span>
                  <span className="text-slate-500">{m.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">🔧 {t('metalsLite.baseMetals', '基本金屬(LME)')}</div>
            <div className="grid grid-cols-3 gap-2">
              {BASE.map(m => (
                <label key={m.code} className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer border ${
                  focused.includes(m.code) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}>
                  <input type="checkbox" checked={focused.includes(m.code)} onChange={() => toggle(m.code)} />
                  <span className="font-mono font-bold">{m.code}</span>
                  <span className="text-slate-500">{m.name}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">{t('metalsLite.prefsShared', '本偏好與「貴金屬情報(完整版)」共用,改一邊兩邊同步。')}</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600">{t('metalsLite.cancel', '取消')}</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded disabled:opacity-50">
            {saving ? '...' : t('metalsLite.save', '儲存')}
          </button>
        </div>
      </div>
    </div>
  )
}
