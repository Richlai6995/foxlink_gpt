/**
 * FactoryCostTemplates — 廠級成本範本管理(管理 > 廠級成本範本 · R1.5 正式入口)
 *
 * 廠級 BU 共用範本(國別 × BU × 模型 × 版本)唯一維護處:
 *   列表(含歷史版)· 啟用/停用 · 「開啟編輯器」= 開 CORTEX-COST-TPL WarRoom 的 Cleansheet
 *   Excel 匯入(存入範本庫 · 同名 supersede 版本化)· 匯出 / 空白範本下載
 * 開案(Wizard / ＋廠別)從這裡 clone;既有案為快照不受影響。
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../../../context/AuthContext'
import { useCrumbs } from '../Shell/PlatformContext'
import { Factory, Loader2, Upload, Download, Pencil, Power } from 'lucide-react'

type Tpl = {
  caseFactoryId: number; factoryCode: string; costingModel: string; templateLabel: string | null
  isActive: number; effectiveFrom?: string; tplProjectId: number | null; bgCode: string | null; buCode: string | null
}

export default function FactoryCostTemplates() {
  const { token } = useAuth() as any
  const navigate = useNavigate()
  useCrumbs([{ label: '管理' }, { label: '廠級成本範本' }])
  const [rows, setRows] = useState<Tpl[] | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [factory, setFactory] = useState('')

  async function load() {
    try { const r = await api.get<{ templates: Tpl[] }>(token, `/bom/provision/templates${showInactive ? '?includeInactive=1' : ''}`); setRows(r.templates || []) }
    catch (e: any) { setErr(e.message); setRows([]) }
  }
  useEffect(() => { if (token) load() }, [token, showInactive])   // eslint-disable-line

  async function importTpl() {
    if (!file) { setErr('選擇成本模型 Excel'); return }
    if (!label.trim()) { setErr('填範本名稱(如「CN 穿戴標準 2026Q3」)'); return }
    setBusy(true); setErr(''); setMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('label', label.trim())
      if (factory.trim()) fd.append('factoryCode', factory.trim().toUpperCase())
      const res = await fetch('/api/projects/bom/cost-model/import-template', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `匯入失敗 HTTP ${res.status}`)
      setMsg(`✓ 已存入(${d.warnings?.length ? `${d.warnings.length} 個警告` : '無警告'});同名舊版已自動停用`)
      setFile(null); setLabel(''); setFactory('')
      await load()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function toggleActive(t: Tpl) {
    setBusy(true); setErr('')
    try { await api.put(token, `/bom/cost-model/template/${t.caseFactoryId}/active`, { active: t.isActive ? 0 : 1 }); await load() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function dl(path: string, name: string) {
    try {
      const res = await fetch(`/api/projects/bom${path}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`下載失敗 HTTP ${res.status}`)
      const blob = await res.blob(); const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
    } catch (e: any) { setErr(e.message) }
  }

  const tplProjectId = rows?.find((r) => r.tplProjectId)?.tplProjectId || null

  return (
    <div className="bg-white rounded-lg border border-cortex-line p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-cortex-ink flex items-center gap-2"><Factory className="w-5 h-5 text-cortex-teal" /> 廠級成本範本</h2>
          <p className="text-[12px] text-cortex-muted mt-0.5">國別 × BU × 模型的共用成本基礎(DL/IDL/設備/廠房/製程/耗材)。開案由此 clone;既有案為快照不受影響。</p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1 cursor-pointer text-cortex-muted">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> 含歷史版
          </label>
          {tplProjectId && (
            <button onClick={() => navigate(`/projects-platform/projects/${tplProjectId}`)}
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded hover:opacity-90">
              <Pencil className="w-3.5 h-3.5" /> 開啟範本編輯器(Cleansheet)
            </button>
          )}
        </div>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      {msg && <div className="text-[11px] text-green-700">{msg}</div>}

      {/* 匯入新範本 */}
      <div className="border border-cortex-line rounded-lg p-3 flex items-end gap-2 flex-wrap text-[11px] bg-cortex-bg/30">
        <span className="font-bold text-cortex-ink">匯入新範本(Excel):</span>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="text-[11px] file:mr-1.5 file:px-2 file:py-0.5 file:border-0 file:rounded file:bg-white file:cursor-pointer file:text-[11px]" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="範本名稱(同名=新版本)" className="border border-cortex-line rounded px-2 py-1 w-48" />
        <input value={factory} onChange={(e) => setFactory(e.target.value)} placeholder="廠別碼(空=用檔內)" className="border border-cortex-line rounded px-2 py-1 w-28" />
        <button onClick={importTpl} disabled={busy || !file}
          className="flex items-center gap-1 px-2.5 py-1 bg-cortex-teal text-white rounded hover:opacity-90 disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} 存入範本庫
        </button>
        <span className="text-cortex-muted">空白範本:</span>
        <button onClick={() => dl('/cost-model/template?model=SIMPLIFIED_WEARABLE&blank=1', 'cost-model-blank-SIMPLIFIED.xlsx')} className="text-cortex-teal hover:underline">穿戴</button>
        <button onClick={() => dl('/cost-model/template?model=FULL_MVA&blank=1', 'cost-model-blank-FULL.xlsx')} className="text-cortex-teal hover:underline">FULL</button>
      </div>

      {/* 範本列表 */}
      {rows === null ? (
        <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入…</div>
      ) : (
        <table className="w-full text-[12px]">
          <thead className="text-cortex-muted border-b border-cortex-line"><tr>
            <th className="text-left px-2 py-1.5">廠</th><th className="text-left px-2 py-1.5">BU</th>
            <th className="text-left px-2 py-1.5">模型</th><th className="text-left px-2 py-1.5">範本名稱</th>
            <th className="text-center px-2 py-1.5">狀態</th><th className="text-left px-2 py-1.5">生效</th>
            <th className="text-right px-2 py-1.5">動作</th>
          </tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.caseFactoryId} className={`border-b border-cortex-line/40 ${!t.isActive ? 'opacity-50' : ''}`}>
                <td className="px-2 py-1.5 font-bold">{t.factoryCode}</td>
                <td className="px-2 py-1.5">{t.buCode || <span className="text-cortex-muted">—</span>}{t.bgCode ? <span className="text-[9px] text-cortex-muted ml-1">({t.bgCode})</span> : null}</td>
                <td className="px-2 py-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded ${t.costingModel === 'FULL_MVA' ? 'bg-indigo-50 text-indigo-700' : 'bg-teal-50 text-teal-700'}`}>{t.costingModel === 'FULL_MVA' ? 'FULL MVA' : 'SIMPLIFIED'}</span></td>
                <td className="px-2 py-1.5">{t.templateLabel || <span className="text-cortex-muted">(未命名)</span>}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-cortex-line text-cortex-muted'}`}>{t.isActive ? '現行' : '停用'}</span>
                </td>
                <td className="px-2 py-1.5 text-[10px] text-cortex-muted font-mono">{t.effectiveFrom ? String(t.effectiveFrom).slice(0, 10) : '—'}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <button onClick={() => tplProjectId && navigate(`/projects-platform/projects/${tplProjectId}`)} title="開編輯器(Cleansheet · 選對應廠 tab)"
                    className="text-[11px] text-cortex-teal hover:underline mr-2">編輯</button>
                  <button onClick={() => dl(`/case/${t.caseFactoryId}/cost-model`, `cost-model-${t.factoryCode}-${t.templateLabel || t.costingModel}.xlsx`)} title="匯出 Excel"
                    className="text-cortex-muted hover:text-cortex-teal mr-2"><Download className="w-3.5 h-3.5 inline" /></button>
                  <button onClick={() => toggleActive(t)} disabled={busy} title={t.isActive ? '停用(新案不可選)' : '啟用'}
                    className={`${t.isActive ? 'text-cortex-muted hover:text-red-500' : 'text-cortex-muted hover:text-green-600'}`}><Power className="w-3.5 h-3.5 inline" /></button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="px-2 py-4 text-center text-cortex-muted text-[11px]">範本庫為空 —— 上方匯入,或到任一專案 BOM 區「存入範本庫」。</td></tr>}
          </tbody>
        </table>
      )}
      <div className="text-[10px] text-cortex-muted">
        「編輯」= 開範本專案(CORTEX-COST-TPL)WarRoom → 🧮 Cleansheet 選對應廠 tab 直接改參數(影響之後新案);
        同名 Excel 再匯入 = 產生新版本並自動停用舊版;BU 由 Excel Baseline 分頁 BG_CODE/BU_CODE 帶入。
      </div>
    </div>
  )
}
