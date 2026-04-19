import { useEffect, useState } from 'react'
import { Save, RefreshCw, Search, Trash2, Database, AlertCircle, Settings2, Hammer } from 'lucide-react'
import api from '../../lib/api'

type Backend = 'like' | 'oracle_text'
type Fusion  = 'weighted' | 'rrf'

interface RetrievalDefaults {
  backend: Backend
  use_hybrid_sql: boolean
  vector_weight: number
  fulltext_weight: number
  match_boost: number
  title_weight: number
  body_weight: number
  fulltext_query_op: 'accum' | 'and' | 'or'
  fuzzy: boolean
  synonym_thesaurus: string | null
  use_proximity: boolean
  proximity_distance: number
  min_ft_score: number
  vec_cutoff: number
  fusion_method: Fusion
  rrf_k: number
  token_stopwords: string[]
  default_top_k_fetch: number
  default_top_k_return: number
  default_score_threshold: number
  debug: boolean
  use_multi_vector: boolean
}

interface DimRow {
  dims: number | null
  kb_count: number
  chunk_count: number
  kb_names: string
}

interface MaintenanceStats {
  dims: DimRow[]
  orphan_count: number
}

interface LoadedData {
  defaults: RetrievalDefaults
  hardcoded: RetrievalDefaults
  cleanup_cron: string
  cleanup_enabled: boolean
}

export default function KbRetrievalSettings() {
  const [data,    setData]    = useState<LoadedData | null>(null)
  const [stats,   setStats]   = useState<MaintenanceStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [busy,    setBusy]    = useState<string | null>(null)
  const [stopwordsText, setStopwordsText] = useState('')
  const [thesauri,      setThesauri]      = useState<string[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const [a, b] = await Promise.all([
        api.get('/admin/settings/kb-retrieval'),
        api.get('/admin/kb/maintenance/stats'),
      ])
      setData(a.data)
      setStats(b.data)
      setStopwordsText((a.data.defaults.token_stopwords || []).join(','))
      try {
        const t = await api.get('/admin/kb/thesauri')
        setThesauri((t.data || []).map((x: { name: string }) => x.name))
      } catch { /* ignore */ }
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || '載入失敗' })
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const patch = (p: Partial<RetrievalDefaults>) => {
    if (!data) return
    setData({ ...data, defaults: { ...data.defaults, ...p } })
  }

  const save = async () => {
    if (!data) return
    setSaving(true); setMsg(null)
    try {
      const stopwords = stopwordsText
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const defaults = { ...data.defaults, token_stopwords: stopwords }
      await api.put('/admin/settings/kb-retrieval', {
        defaults,
        cleanup_cron: data.cleanup_cron,
        cleanup_enabled: data.cleanup_enabled,
      })
      setMsg({ ok: true, text: '儲存成功' })
      await load()
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || '儲存失敗' })
    } finally { setSaving(false) }
  }

  const runOrphanCleanup = async () => {
    setBusy('orphan'); setMsg(null)
    try {
      const r = await api.post('/admin/kb/maintenance/cleanup-orphan')
      setMsg({ ok: true, text: `清除 ${r.data.removed} 個 orphan chunks (${r.data.elapsed_ms}ms)` })
      await load()
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || '清理失敗' })
    } finally { setBusy(null) }
  }

  const rebuildVectorIndex = async () => {
    if (!confirm('重建 vector index 可能需要數分鐘，期間向量查詢會走暴力掃描。繼續？')) return
    setBusy('vidx'); setMsg(null)
    try {
      const r = await api.post('/admin/kb/maintenance/rebuild-vector-index')
      setMsg({ ok: true, text: `vector index 重建完成 (${r.data.elapsed_ms}ms)` })
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || '重建失敗' })
    } finally { setBusy(null) }
  }

  if (loading || !data) return <div className="text-slate-500 text-sm p-4">載入中…</div>
  const d = data.defaults

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search size={18} className="text-slate-600" />
          <h2 className="text-base font-semibold text-slate-800">KB 檢索預設設定</h2>
        </div>
        <button onClick={load} className="text-slate-400 hover:text-slate-600"><RefreshCw size={15} /></button>
      </div>
      <p className="text-xs text-slate-500">
        系統級預設；單一 KB 可在其「進階檢索」區塊個別覆寫。
        快取 60 秒失效，儲存後立即生效。
      </p>

      {/* Backend + Fusion */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Settings2 size={15} className="text-indigo-500" />
          檢索後端
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500">Backend</label>
            <select className="input w-full" value={d.backend} onChange={(e) => patch({ backend: e.target.value as Backend })}>
              <option value="like">LIKE（保守，任何環境能跑）</option>
              <option value="oracle_text">Oracle Text（WORLD_LEXER + CONTAINS，推薦）</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Score Fusion</label>
            <select className="input w-full" value={d.fusion_method} onChange={(e) => patch({ fusion_method: e.target.value as Fusion })}>
              <option value="weighted">加權和（vec×w + ft×w）</option>
              <option value="rrf">Reciprocal Rank Fusion（推薦）</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Fulltext Query Op</label>
            <select
              className="input w-full"
              value={d.fulltext_query_op}
              onChange={(e) => patch({ fulltext_query_op: e.target.value as any })}
              disabled={d.backend !== 'oracle_text'}
            >
              <option value="accum">ACCUM（多詞加權，推薦）</option>
              <option value="and">AND（所有詞都要有）</option>
              <option value="or">OR（任一詞即可）</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">RRF k</label>
            <input
              type="number" min={1} max={500}
              className="input w-full"
              value={d.rrf_k}
              onChange={(e) => patch({ rrf_k: parseInt(e.target.value) || 60 })}
              disabled={d.fusion_method !== 'rrf'}
            />
          </div>
        </div>
      </div>

      {/* Weights (only weighted fusion) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="text-sm font-medium text-slate-700">Weighted Fusion 權重</div>
        <p className="text-xs text-slate-400">當 Score Fusion 選 <code>weighted</code> 時生效。</p>
        <div className="grid grid-cols-3 gap-3">
          <SliderField label="Vector 權重" value={d.vector_weight}   onChange={(v) => patch({ vector_weight: v })}   disabled={d.fusion_method !== 'weighted'} />
          <SliderField label="Fulltext 權重" value={d.fulltext_weight} onChange={(v) => patch({ fulltext_weight: v })} disabled={d.fusion_method !== 'weighted'} />
          <SliderField label="Match Boost"  value={d.match_boost}     onChange={(v) => patch({ match_boost: v })}     disabled={d.fusion_method !== 'weighted'} />
        </div>
      </div>

      {/* Fulltext options */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="text-sm font-medium text-slate-700">Oracle Text 進階選項</div>
        <p className="text-xs text-slate-400">僅 backend = oracle_text 時生效。</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={d.fuzzy} onChange={(e) => patch({ fuzzy: e.target.checked })} disabled={d.backend !== 'oracle_text'} />
            Fuzzy 模糊匹配（誤召率高，預設關）
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={d.use_proximity} onChange={(e) => patch({ use_proximity: e.target.checked })} disabled={d.backend !== 'oracle_text'} />
            使用 Proximity NEAR
          </label>
          <div>
            <label className="text-xs text-slate-500">Proximity 距離</label>
            <input
              type="number" min={1} max={100}
              className="input w-full"
              value={d.proximity_distance}
              onChange={(e) => patch({ proximity_distance: parseInt(e.target.value) || 10 })}
              disabled={!d.use_proximity || d.backend !== 'oracle_text'}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">同義詞字典</label>
            <select
              className="input w-full"
              value={d.synonym_thesaurus || ''}
              onChange={(e) => patch({ synonym_thesaurus: e.target.value || null })}
              disabled={d.backend !== 'oracle_text'}
            >
              <option value="">— 不使用 —</option>
              {thesauri.map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
            <p className="text-xs text-slate-400 mt-0.5">管理於「KB 同義詞字典」tab</p>
          </div>
        </div>
      </div>

      {/* TopK + Thresholds */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="text-sm font-medium text-slate-700">TopK / 門檻</div>
        <div className="grid grid-cols-3 gap-3">
          <NumField label="TopK Fetch（撈回數）"       value={d.default_top_k_fetch}      onChange={(v) => patch({ default_top_k_fetch: v })}      min={1} max={100} />
          <NumField label="TopK Return（回傳數）"      value={d.default_top_k_return}     onChange={(v) => patch({ default_top_k_return: v })}     min={1} max={50} />
          <NumField label="Score 門檻（0 = 不過濾）"    value={d.default_score_threshold}  onChange={(v) => patch({ default_score_threshold: v })}  step={0.05} min={0} max={1} />
          <NumField label="Vector cutoff（0–1 越小越嚴）" value={d.vec_cutoff}             onChange={(v) => patch({ vec_cutoff: v })}              step={0.05} min={0} max={1} />
          <NumField label="最低 FT Score (0–1)"         value={d.min_ft_score}            onChange={(v) => patch({ min_ft_score: v })}            step={0.05} min={0} max={1} />
        </div>
      </div>

      {/* Stopwords */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <div className="text-sm font-medium text-slate-700">Tokenize 停用詞</div>
        <p className="text-xs text-slate-400">用 <code>,</code> 或換行分隔；避免這些詞主導 LIKE 匹配。</p>
        <textarea
          rows={3}
          className="input w-full font-mono text-xs"
          value={stopwordsText}
          onChange={(e) => setStopwordsText(e.target.value)}
        />
      </div>

      {/* Multi-vector */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={d.use_multi_vector} onChange={(e) => patch({ use_multi_vector: e.target.checked })} />
          啟用 Multi-vector（title + body 加權）
        </label>
        <p className="text-xs text-slate-400">
          每個 chunk 額外用 heading 做一份 embedding，查詢時加權 `title_weight × sim(title) + body_weight × sim(body)`。
          chunks 沒 heading 時自動退回單向量。<strong>需 per-KB 回溯填值</strong>（KB 設定頁「補 title 向量」按鈕），或新上傳/重解析的 chunks 會自動補。
        </p>
        <div className="grid grid-cols-2 gap-3">
          <SliderField label="Title 權重" value={d.title_weight} onChange={(v) => patch({ title_weight: v })} disabled={!d.use_multi_vector} />
          <SliderField label="Body 權重"  value={d.body_weight}  onChange={(v) => patch({ body_weight: v })}  disabled={!d.use_multi_vector} />
        </div>
      </div>

      {/* Debug */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={d.debug} onChange={(e) => patch({ debug: e.target.checked })} />
          開啟 debug log（每次檢索印詳細 tokens / scores）
        </label>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          儲存設定
        </button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</span>}
      </div>

      {/* ── Maintenance ──────────────────────────────────────────── */}
      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-700">維護操作</h3>
        </div>

        {/* Stats */}
        {stats && (
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">
                Orphan chunks（孤兒資料）：
                <span className={`ml-2 font-semibold ${stats.orphan_count > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {stats.orphan_count.toLocaleString()}
                </span>
              </div>
              <button
                onClick={runOrphanCleanup}
                disabled={busy === 'orphan'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
              >
                <Trash2 size={13} /> 立即清理
              </button>
            </div>
            {stats.dims.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-2 py-1 text-left">維度</th>
                      <th className="px-2 py-1 text-right">KB 數</th>
                      <th className="px-2 py-1 text-right">chunk 數</th>
                      <th className="px-2 py-1 text-left">KB 名稱</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.dims.map((r, i) => (
                      <tr key={i} className="border-t border-slate-200">
                        <td className="px-2 py-1 font-mono">{r.dims ?? '—'}</td>
                        <td className="px-2 py-1 text-right">{r.kb_count}</td>
                        <td className="px-2 py-1 text-right">{r.chunk_count.toLocaleString()}</td>
                        <td className="px-2 py-1 truncate max-w-[300px]" title={r.kb_names}>{r.kb_names}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Cron */}
        <CronSection
          enabled={data.cleanup_enabled}
          cron={data.cleanup_cron}
          onEnabledChange={(v) => setData({ ...data, cleanup_enabled: v })}
          onCronChange={(v) => setData({ ...data, cleanup_cron: v })}
        />

        {/* Rebuild vector index */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="text-sm font-medium text-amber-900">重建 Vector Index</div>
            <p className="text-xs text-amber-800">
              當所有 KB 已統一維度、或 embedding 重新計算後使用。重建期間向量查詢會變慢（走暴力掃描）。
            </p>
            <button
              onClick={rebuildVectorIndex}
              disabled={busy === 'vidx'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              <Hammer size={13} /> 重建 kb_chunks_vidx
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SliderField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="text-xs text-slate-500 flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono text-slate-700">{value.toFixed(2)}</span>
      </label>
      <input
        type="range"
        min={0} max={1} step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="w-full accent-blue-600"
      />
    </div>
  )
}

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: '每 15 分鐘',      value: '*/15 * * * *' },
  { label: '每 30 分鐘',      value: '*/30 * * * *' },
  { label: '每小時（整點）',  value: '0 * * * *' },
  { label: '每 3 小時',       value: '0 */3 * * *' },
  { label: '每 6 小時',       value: '0 */6 * * *' },
  { label: '每天凌晨 2 點',   value: '0 2 * * *' },
  { label: '每週一凌晨 3 點', value: '0 3 * * 1' },
]

function CronSection({
  enabled, cron, onEnabledChange, onCronChange,
}: {
  enabled: boolean; cron: string
  onEnabledChange: (v: boolean) => void; onCronChange: (v: string) => void
}) {
  const matchedPreset = CRON_PRESETS.find((p) => p.value === cron)
  const [mode, setMode] = useState<'preset' | 'custom'>(matchedPreset ? 'preset' : 'custom')
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        啟用 orphan 定期清理
      </label>
      <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>
        <label className="text-xs text-slate-500">執行頻率</label>
        <div className="flex gap-2 mt-1">
          <select
            className="input flex-1"
            value={mode === 'preset' ? cron : '__custom__'}
            onChange={(e) => {
              if (e.target.value === '__custom__') { setMode('custom') }
              else { setMode('preset'); onCronChange(e.target.value) }
            }}
          >
            {CRON_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}（{p.value}）</option>
            ))}
            <option value="__custom__">— 自訂 cron 表達式 —</option>
          </select>
        </div>
        {mode === 'custom' && (
          <input
            className="input w-full font-mono mt-2"
            value={cron}
            onChange={(e) => onCronChange(e.target.value)}
            placeholder="0 * * * *"
          />
        )}
        <p className="text-xs text-slate-400 mt-1.5">儲存後立即套用。欄位格式：分 時 日 月 週。</p>
      </div>
    </div>
  )
}

function NumField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div>
      <label className="text-xs text-slate-500">{label}</label>
      <input
        type="number"
        className="input w-full"
        value={value}
        min={min} max={max} step={step || 1}
        onChange={(e) => onChange(step ? parseFloat(e.target.value) : parseInt(e.target.value) || 0)}
      />
    </div>
  )
}
