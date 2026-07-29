/**
 * CostSummarySection — §9.3 成本核算 headline(接真 run_result · 取代 demo)
 *
 * 對應 docs/cortex-bom-import-plan.md §9.3。讀 GET /bom/summary(各廠最新 run 的成本)→ 真實成本矩陣。
 * demo 專案(data_payload.factory_matrix)仍走 FactoryMatrixSection;真 BOM 專案走這裡。
 * 註:真實成本 / margin 之後依角色機密遮罩(S2 view_true_cost)。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { BarChart3, Crown, Loader2, RefreshCw } from 'lucide-react'

const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')
const pct = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

export default function CostSummarySection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [factories, setFactories] = useState<any[] | null>(null)
  const [quote, setQuote] = useState<any>(null)
  const [submitCf, setSubmitCf] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // P1 議價紀錄
  const [neg, setNeg] = useState<any>(null)
  const [negTarget, setNegTarget] = useState(''); const [negOffer, setNegOffer] = useState(''); const [negNote, setNegNote] = useState('')

  async function load() {
    try {
      const r = await api.get<{ factories: any[] }>(token, `/bom/summary?projectId=${projectId}`); setFactories(r.factories || [])
      const q = await api.get<any>(token, `/bom/quote?projectId=${projectId}`); setQuote(q)
      api.get<any>(token, `/bom/negotiation?projectId=${projectId}`).then(setNeg).catch(() => {})
    } catch (e: any) { setErr(e.message); setFactories((f) => f ?? []) }
  }
  async function addRound() {
    setBusy(true); setErr('')
    try {
      await api.post(token, '/bom/negotiation', { projectId, customerTargetUsd: negTarget || null, ourOfferUsd: negOffer || null, note: negNote || null })
      setNegTarget(''); setNegOffer(''); setNegNote('')
      setNeg(await api.get<any>(token, `/bom/negotiation?projectId=${projectId}`))
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function updRound(id: number, outcome: string) {
    setBusy(true); setErr('')
    try { await api.put(token, `/bom/negotiation/${id}`, { outcome }); setNeg(await api.get<any>(token, `/bom/negotiation?projectId=${projectId}`)) }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function delRound(id: number) {
    if (!confirm('刪除這輪議價紀錄?')) return
    setBusy(true); setErr('')
    try { await api.delete(token, `/bom/negotiation/${id}`); setNeg(await api.get<any>(token, `/bom/negotiation?projectId=${projectId}`)) }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { if (token) load() }, [token, projectId])

  // P1 AI 比對上代:程式 diff(即時)+ Pro 摘要(按需)
  const [legacyList, setLegacyList] = useState<any[]>([])
  const [legacyId, setLegacyId] = useState<number | ''>('')
  const [cmp, setCmp] = useState<any>(null)
  const [cmpBusy, setCmpBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  useEffect(() => {
    if (!token) return
    api.get<{ projects: any[] }>(token, '/projects?limit=200').then((r) => {
      const rows = (r.projects || []).filter((p: any) => p.id !== projectId && (p.type_code === 'QUOTE' || !p.type_code))
        .map((p: any) => { let t = null; try { t = JSON.parse(p.data_payload || '{}').title } catch { /* noop */ } return { ...p, title: p.title || t } })
      setLegacyList(rows)
    }).catch(() => {})
  }, [token, projectId])
  async function runCompare(withAi: boolean) {
    if (!legacyId) return
    withAi ? setAiBusy(true) : setCmpBusy(true); setErr('')
    try {
      const r = await api.post<any>(token, '/bom/compare-legacy', { projectId, legacyProjectId: legacyId, withAi })
      setCmp((prev: any) => (withAi && prev && !r.ai ? { ...r, ai: prev.ai } : r))
    } catch (e: any) { setErr(e.message) } finally { setCmpBusy(false); setAiBusy(false) }
  }

  async function recompute() {
    setBusy(true); setErr('')
    try { await api.post(token, '/bom/compare', { projectId, force: true }); await load(); setTimeout(() => window.dispatchEvent(new CustomEvent('cortex:stage-refresh')), 600) }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  async function doSubmit() {
    if (!submitCf) return
    setBusy(true); setErr('')
    try { await api.post(token, '/bom/quote/submit', { projectId, caseFactoryId: submitCf }); setSubmitCf(''); await load(); setTimeout(() => window.dispatchEvent(new CustomEvent('cortex:stage-refresh')), 600) }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  // 報價單 PDF 下載(P1 · 全 quote 側;非 APPROVED 蓋 DRAFT 浮水印;lang=zh|en)
  async function dlPdf(versionId: number, versionNo: number, lang: 'zh' | 'en' = 'zh') {
    try {
      const res = await fetch(`/api/projects/bom/quote/${versionId}/pdf?lang=${lang}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`PDF 產生失敗 (HTTP ${res.status})`)
      // 檔名以 server 為準(專案碼+名稱+日期+語言)
      const cd = res.headers.get('content-disposition') || ''
      const m = cd.match(/filename="?([^";]+)"?/)
      const filename = m ? decodeURIComponent(m[1]) : `quotation-v${versionNo}-${lang}.pdf`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { setErr(e.message) }
  }

  async function doApprove(versionId: number) {
    setBusy(true); setErr('')
    try { await api.post(token, '/bom/quote/approve', { versionId }); await load(); setTimeout(() => window.dispatchEvent(new CustomEvent('cortex:stage-refresh')), 600) }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  if (factories === null) return <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入成本…</div>

  if (factories.length === 0) return (
    <div className="bg-cortex-bg/40 border border-cortex-line rounded-lg p-4 text-[12px]">
      <div className="font-bold text-cortex-ink mb-1">📊 成本核算</div>
      <div className="text-cortex-muted">此專案尚無成本模型。請至「📦 BOM / 材料」建立成本模型(選廠別範本)並匯入 BOM 計算,成本會在此彙總比較。</div>
    </div>
  )

  const anyRun = factories.some((f) => f.run_id)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-bold text-cortex-ink flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-cortex-teal" /> 成本核算 · 多廠彙總</div>
        <button onClick={recompute} disabled={busy} className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] border border-cortex-line rounded hover:bg-white disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} 重新計算所有廠
        </button>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      <table className="w-full text-[12px]">
        <thead className="text-cortex-muted border-b border-cortex-line">
          <tr>
            <th className="text-left px-2 py-1">廠</th>
            <th className="text-right px-2 py-1">報價 Total</th>
            <th className="text-right px-2 py-1">內部真實</th>
            <th className="text-right px-2 py-1">MVA</th>
            <th className="text-right px-2 py-1">Margin</th>
          </tr>
        </thead>
        <tbody>
          {factories.map((f) => (
            <tr key={f.case_factory_id} className={`border-b border-cortex-line/40 ${f.isCheapest ? 'bg-cortex-cyan-bg/40 font-semibold' : ''}`}>
              <td className="px-2 py-1.5">
                {f.isCheapest && <Crown className="w-3 h-3 inline text-cortex-teal mr-1" />}
                {f.factory_code} <span className="text-cortex-muted text-[9px]">{f.costing_model}</span>
              </td>
              {f.run_id ? (
                <>
                  <td className="px-2 py-1.5 text-right font-mono">{money(f.total_quote_with_nre ?? f.total_quote_usd)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-cortex-muted">{money(f.total_true_with_nre ?? f.total_true_usd)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-cortex-muted">{money(f.mva_usd)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{money(f.margin_amount_usd)} · {pct(f.gross_margin_pct)}</td>
                </>
              ) : (
                <td colSpan={4} className="px-2 py-1.5 text-right text-cortex-muted text-[11px]">尚未計算</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {/* 報價定版 / 送審(流程終點) */}
      {anyRun && (
        <div className="border-t border-cortex-line pt-2 space-y-2">
          <div className="text-[12px] font-bold text-cortex-ink">報價定版 / 送審</div>
          {quote?.official && (
            <div className="bg-cortex-cyan-bg/50 border border-cortex-teal rounded p-2 text-[12px] flex items-center gap-2 flex-wrap">
              <span className="text-base">🏆</span>
              <span className="font-bold">官方報價 v{quote.official.version_no}</span>
              <span>· {quote.official.factory_code}</span>
              <span className="font-mono font-bold text-cortex-teal">{money(quote.official.unit_quote_usd)}/台</span>
              <span className="text-[10px] text-cortex-muted">已核准</span>
              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => dlPdf(quote.official.id, quote.official.version_no, 'zh')}
                  className="px-2 py-0.5 bg-cortex-teal text-white rounded hover:opacity-90 text-[11px]">📄 報價單 PDF</button>
                <button onClick={() => dlPdf(quote.official.id, quote.official.version_no, 'en')}
                  className="px-2 py-0.5 border border-cortex-teal text-cortex-teal rounded hover:bg-cortex-cyan-bg text-[11px]">EN</button>
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-cortex-muted">送審廠別:</span>
            <select value={submitCf} onChange={(e) => setSubmitCf(e.target.value ? Number(e.target.value) : '')} className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px]">
              <option value="">選一廠…</option>
              {factories.filter((f) => f.run_id).map((f) => <option key={f.case_factory_id} value={f.case_factory_id}>{f.factory_code} · {money(f.total_quote_with_nre ?? f.total_quote_usd)}</option>)}
            </select>
            <button onClick={doSubmit} disabled={busy || !submitCf} className="px-2 py-0.5 bg-cortex-navy text-white rounded hover:opacity-90 disabled:opacity-40">送審</button>
          </div>
          {quote?.versions?.length > 0 && (
            <table className="w-full text-[11px]">
              <thead className="text-cortex-muted border-b border-cortex-line"><tr>
                <th className="text-left px-2 py-1">版本</th><th className="text-left px-2 py-1">廠</th>
                <th className="text-right px-2 py-1">單價</th><th className="text-center px-2 py-1">狀態</th>
                <th className="text-left px-2 py-1">送審者</th><th className="text-left px-2 py-1">核准者</th><th className="w-14"></th>
              </tr></thead>
              <tbody>
                {quote.versions.map((v: any) => (
                  <tr key={v.id} className="border-b border-cortex-line/40">
                    <td className="px-2 py-1">v{v.version_no}</td>
                    <td className="px-2 py-1">{v.factory_code}</td>
                    <td className="px-2 py-1 text-right font-mono">{money(v.unit_quote_usd)}</td>
                    <td className="px-2 py-1 text-center">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${v.status === 'APPROVED' ? 'bg-green-100 text-green-700' : v.status === 'SUBMITTED' ? 'bg-amber-100 text-amber-700' : 'bg-cortex-line text-cortex-muted'}`}>{v.status}</span>
                    </td>
                    <td className="px-2 py-1 text-cortex-muted">{v.submitted_by_name || v.submitted_by || '—'}</td>
                    <td className="px-2 py-1 text-cortex-muted">{v.approved_by_name || (v.status === 'SUBMITTED' ? '待核准' : '—')}</td>
                    <td className="px-2 py-1 text-center whitespace-nowrap">
                      {v.status === 'SUBMITTED' && <button onClick={() => doApprove(v.id)} disabled={busy} className="text-[10px] text-cortex-teal hover:underline font-semibold mr-1">核准</button>}
                      <button onClick={() => dlPdf(v.id, v.version_no, 'zh')} title={v.status === 'APPROVED' ? '下載報價單 PDF(中文)' : '下載草稿 PDF(DRAFT 浮水印)'}
                        className="text-[10px] text-cortex-muted hover:text-cortex-teal">📄</button>
                      <button onClick={() => dlPdf(v.id, v.version_no, 'en')} title="English PDF"
                        className="text-[9px] text-cortex-muted hover:text-cortex-teal ml-0.5">EN</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* P1 議價紀錄(官方版之後 · 輪次 · vs 底線 margin 走 S2 遮罩) */}
      {quote?.official && (
        <div className="border-t border-cortex-line pt-2 space-y-2">
          <div className="text-[12px] font-bold text-cortex-ink">🤝 議價紀錄
            <span className="text-[10px] text-cortex-muted font-normal ml-1.5">vs 官方報價 v{quote.official.version_no}({money(quote.official.unit_quote_usd)}/台)· 讓價成立 → 回 BOM 改價重算 → 送審新版本</span>
          </div>
          {neg?.rounds?.length > 0 && (
            <table className="w-full text-[11px]">
              <thead className="text-cortex-muted border-b border-cortex-line"><tr>
                <th className="text-left px-2 py-1">輪</th>
                <th className="text-right px-2 py-1">客戶目標</th>
                <th className="text-right px-2 py-1">我方回應</th>
                <th className="text-right px-2 py-1">差距</th>
                <th className="text-right px-2 py-1">vs 底線</th>
                <th className="text-center px-2 py-1">結果</th>
                <th className="text-left px-2 py-1">備註</th>
                <th className="w-10"></th>
              </tr></thead>
              <tbody>
                {neg.rounds.map((r: any) => (
                  <tr key={r.id} className={`border-b border-cortex-line/40 ${r.outcome === 'ACCEPTED' ? 'bg-green-50 font-semibold' : r.outcome === 'REJECTED' ? 'opacity-60' : ''}`}>
                    <td className="px-2 py-1">R{r.round_no}{r.outcome === 'ACCEPTED' && ' 🤝'}</td>
                    <td className="px-2 py-1 text-right font-mono">{money(r.customer_target_usd)}</td>
                    <td className="px-2 py-1 text-right font-mono">{money(r.our_offer_usd)}</td>
                    <td className="px-2 py-1 text-right font-mono text-cortex-muted">
                      {typeof r.customer_target_usd === 'number' && typeof r.our_offer_usd === 'number' ? money(r.our_offer_usd - r.customer_target_usd) : '—'}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {typeof r.marginUsd === 'number'
                        ? <span className={r.marginUsd < 0 ? 'text-red-600 font-semibold' : 'text-cortex-teal'}>{money(r.marginUsd)} · {pct(r.marginPct)}</span>
                        : <span className="text-cortex-muted">▒▒▒</span>}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <select value={r.outcome} onChange={(e) => updRound(r.id, e.target.value)} disabled={busy}
                        className={`text-[10px] border rounded px-1 py-0.5 ${r.outcome === 'ACCEPTED' ? 'border-green-400 text-green-700' : 'border-cortex-line text-cortex-muted'}`}>
                        {['OPEN', 'COUNTER', 'ACCEPTED', 'REJECTED'].map((o) => <option key={o} value={o}>{o === 'OPEN' ? '進行中' : o === 'COUNTER' ? '再議' : o === 'ACCEPTED' ? '成交' : '破局'}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-cortex-muted max-w-[180px] truncate" title={r.note || ''}>{r.note || '—'}</td>
                    <td className="px-2 py-1 text-center"><button onClick={() => delRound(r.id)} disabled={busy} className="text-[10px] text-cortex-muted hover:text-red-500">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-end gap-1.5 flex-wrap text-[11px]">
            <label className="text-[10px] text-cortex-muted">客戶目標/台<br />
              <input value={negTarget} onChange={(e) => setNegTarget(e.target.value)} placeholder="95.00" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-20 font-mono" /></label>
            <label className="text-[10px] text-cortex-muted">我方回應/台<br />
              <input value={negOffer} onChange={(e) => setNegOffer(e.target.value)} placeholder="102.00" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-20 font-mono" /></label>
            <label className="text-[10px] text-cortex-muted">備註(條件)<br />
              <input value={negNote} onChange={(e) => setNegNote(e.target.value)} placeholder="量增至 150k / NRE 分期…" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-56" /></label>
            <button onClick={addRound} disabled={busy || (!negTarget && !negOffer)}
              className="px-2.5 py-1 bg-cortex-navy text-white rounded hover:opacity-90 disabled:opacity-40 text-[11px]">＋ 記一輪</button>
          </div>
        </div>
      )}

      {/* P1 AI 比對上代:程式算 diff · Pro 只解讀 */}
      <div className="border-t border-cortex-line pt-2 space-y-2">
        <div className="text-[12px] font-bold text-cortex-ink">🔄 AI 比對上代
          <span className="text-[10px] text-cortex-muted font-normal ml-1.5">選上一代專案 → 程式算 BOM/成本差異 → AI(Pro)歸納主因與談判要點</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <select value={legacyId} onChange={(e) => { setLegacyId(e.target.value ? Number(e.target.value) : ''); setCmp(null) }}
            className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] max-w-[280px]">
            <option value="">選上代專案…</option>
            {legacyList.map((p) => <option key={p.id} value={p.id}>{p.project_code}{p.title ? ` · ${p.title}` : ''}</option>)}
          </select>
          <button onClick={() => runCompare(false)} disabled={cmpBusy || !legacyId}
            className="px-2.5 py-1 bg-cortex-navy text-white rounded hover:opacity-90 disabled:opacity-40">
            {cmpBusy ? <Loader2 className="w-3 h-3 inline animate-spin" /> : null} 產生對比
          </button>
          {cmp && (
            <button onClick={() => runCompare(true)} disabled={aiBusy}
              className="px-2.5 py-1 bg-cortex-teal text-white rounded hover:opacity-90 disabled:opacity-40">
              {aiBusy ? <Loader2 className="w-3 h-3 inline animate-spin" /> : '✨'} AI 摘要(Pro)
            </button>
          )}
        </div>
        {cmp && (
          <div className="space-y-2">
            {/* 成本橋 */}
            <div className="bg-cortex-bg/40 border border-cortex-line rounded p-2 text-[11px] flex items-center gap-2 flex-wrap font-mono">
              <span className="text-cortex-muted">{cmp.legacy.projectCode} {money(cmp.diff.bridge.legacyTotal)}</span>
              <span>→</span>
              {cmp.diff.bridge.addedSum !== 0 && <span className="text-red-600">+新增 {money(cmp.diff.bridge.addedSum)}</span>}
              {cmp.diff.bridge.replacedSum !== 0 && <span className={cmp.diff.bridge.replacedSum > 0 ? 'text-red-600' : 'text-green-700'}>替換 {money(cmp.diff.bridge.replacedSum)}</span>}
              {cmp.diff.bridge.priceUpSum !== 0 && <span className="text-red-600">+漲價 {money(cmp.diff.bridge.priceUpSum)}</span>}
              {cmp.diff.bridge.priceDownSum !== 0 && <span className="text-green-700">降價 {money(cmp.diff.bridge.priceDownSum)}</span>}
              {cmp.diff.bridge.removedSum !== 0 && <span className="text-green-700">移除 {money(cmp.diff.bridge.removedSum)}</span>}
              {typeof cmp.diff.bridge.nonMaterialDelta === 'number' && Math.abs(cmp.diff.bridge.nonMaterialDelta) > 1e-9 && <span className="text-cortex-muted">非材料 {money(cmp.diff.bridge.nonMaterialDelta)}</span>}
              <span>→</span>
              <span className="font-bold text-cortex-teal">{cmp.current.projectCode} {money(cmp.diff.bridge.currentTotal)}</span>
              <span className="text-cortex-muted ml-auto">料件 {cmp.diff.counts.legacyItems}→{cmp.diff.counts.currentItems} · 新增{cmp.diff.counts.added} 移除{cmp.diff.counts.removed} 替換{cmp.diff.counts.replaced} 價差{cmp.diff.counts.changed}</span>
            </div>
            {/* 明細 top(合一表) */}
            <table className="w-full text-[10px]">
              <thead className="text-cortex-muted border-b border-cortex-line"><tr>
                <th className="text-left px-1.5 py-0.5">類</th><th className="text-left px-1.5 py-0.5">料件</th>
                <th className="text-right px-1.5 py-0.5">上代</th><th className="text-right px-1.5 py-0.5">本案</th><th className="text-right px-1.5 py-0.5">影響/台</th>
              </tr></thead>
              <tbody>
                {[
                  ...cmp.diff.added.map((x: any) => ({ ...x, _t: '新增', _o: '—', _n: `${x.qty}×${money(x.price)}` })),
                  ...cmp.diff.removed.map((x: any) => ({ ...x, _t: '移除', _o: `${x.qty}×${money(x.price)}`, _n: '—' })),
                  ...cmp.diff.replaced.map((x: any) => ({ ...x, _t: '替換', _o: money(x.oldPrice), _n: money(x.newPrice) })),
                  ...cmp.diff.changed.map((x: any) => ({ ...x, _t: '價差', _o: `${x.oldQty}×${money(x.oldPrice)}`, _n: `${x.newQty}×${money(x.newPrice)}` })),
                ].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 12).map((x: any, i: number) => (
                  <tr key={i} className="border-b border-cortex-line/30">
                    <td className="px-1.5 py-0.5"><span className={`px-1 rounded text-[9px] ${x._t === '新增' ? 'bg-red-50 text-red-600' : x._t === '移除' ? 'bg-green-50 text-green-700' : x._t === '替換' ? 'bg-amber-50 text-amber-700' : 'bg-cortex-bg text-cortex-muted'}`}>{x._t}</span></td>
                    <td className="px-1.5 py-0.5 max-w-[220px] truncate" title={`${x.fpn || x.newFpn || ''} ${x.desc}`}>{x.desc}<span className="text-cortex-muted ml-1">{x.module}</span></td>
                    <td className="px-1.5 py-0.5 text-right font-mono">{x._o}</td>
                    <td className="px-1.5 py-0.5 text-right font-mono">{x._n}</td>
                    <td className={`px-1.5 py-0.5 text-right font-mono ${x.impact > 0 ? 'text-red-600' : 'text-green-700'}`}>{money(x.impact)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cmp.ai?.text && (
              <div className="bg-cortex-cyan-bg/30 border border-cortex-teal/40 rounded p-2.5 text-[11px] whitespace-pre-wrap leading-relaxed">
                <div className="text-[10px] text-cortex-muted mb-1">✨ AI 摘要({cmp.ai.model})— 數字由程式計算,AI 僅解讀</div>
                {cmp.ai.text}
              </div>
            )}
            {cmp.aiError && <div className="text-[10px] text-red-600">AI 摘要失敗:{cmp.aiError}(diff 仍有效)</div>}
          </div>
        )}
      </div>

      {!anyRun && <div className="text-[11px] text-cortex-muted">尚無計算結果 —— 至「BOM/材料」匯入並算成本,或按「重新計算所有廠」。</div>}
      {factories.some((f) => Number(f.nre_per_unit_quote_usd) > 0) && (
        <div className="text-[10px] text-cortex-teal">報價 Total 已含 NRE 每台攤提(AMORTIZED · 見「🔧 NRE 成本」tab)。</div>
      )}
      <div className="text-[10px] text-cortex-muted">真實成本 / margin 之後依角色機密遮罩(S2 view_true_cost)。</div>
    </div>
  )
}
