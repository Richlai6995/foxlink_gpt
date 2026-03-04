import { useState, useEffect } from 'react'
import { BarChart3, RefreshCw, Download, Plus, Trash2, DollarSign, Pencil, Check, X, Search } from 'lucide-react'
import type { TokenUsage, TokenPrice, LlmModel } from '../../types'
import api from '../../lib/api'

const CURRENCY_OPTIONS = ['USD', 'TWD', 'CNY']

function fmt(n: number | null | undefined, digits = 4) {
  if (n == null) return '-'
  return n.toFixed(digits)
}

// ─── Shared form types ────────────────────────────────────────────────────────
interface PriceForm {
  model: string
  price_input: string
  price_output: string
  use_tier2: boolean
  tier_threshold: string
  price_input_tier2: string
  price_output_tier2: string
  price_image_output: string
  currency: string
  start_date: string
  end_date: string
}

const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <label className="text-xs text-slate-500">{label}</label>
    {children}
  </div>
)

function InlineForm({ form, setForm, llmModels, onSave, onCancel }: {
  form: PriceForm
  setForm: React.Dispatch<React.SetStateAction<PriceForm>>
  llmModels: LlmModel[]
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 py-3 space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        <F label="模型">
          <select value={form.model} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} className="input py-1">
            {llmModels.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
        </F>
        <F label="輸入價格/1M (第1段)">
          <input type="number" step="0.01" placeholder="0.00" value={form.price_input}
            onChange={(e) => setForm((p) => ({ ...p, price_input: e.target.value }))} className="input py-1 w-28" />
        </F>
        <F label="輸出價格/1M (第1段)">
          <input type="number" step="0.01" placeholder="0.00" value={form.price_output}
            onChange={(e) => setForm((p) => ({ ...p, price_output: e.target.value }))} className="input py-1 w-28" />
        </F>
        <F label="圖片輸出價格/張（選填）">
          <input type="number" step="0.001" placeholder="0.134" value={form.price_image_output}
            onChange={(e) => setForm((p) => ({ ...p, price_image_output: e.target.value }))} className="input py-1 w-28" />
        </F>
        <F label="幣別">
          <select value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))} className="input py-1">
            {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </F>
        <F label="生效日期">
          <input type="date" value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} className="input py-1" />
        </F>
        <F label="結束日期（空=永久）">
          <input type="date" value={form.end_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} className="input py-1" />
        </F>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={form.use_tier2} onChange={(e) => setForm((p) => ({ ...p, use_tier2: e.target.checked }))} />
            啟用兩段計費
          </label>
        </div>
      </div>
      {form.use_tier2 && (
        <div className="flex flex-wrap gap-3 items-end pl-1 pt-1 border-t border-blue-200">
          <F label="第1段上限 (tokens)">
            <input type="number" placeholder="200000" value={form.tier_threshold}
              onChange={(e) => setForm((p) => ({ ...p, tier_threshold: e.target.value }))} className="input py-1 w-32" />
          </F>
          <F label="輸入價格/1M (第2段)">
            <input type="number" step="0.01" placeholder="0.00" value={form.price_input_tier2}
              onChange={(e) => setForm((p) => ({ ...p, price_input_tier2: e.target.value }))} className="input py-1 w-28" />
          </F>
          <F label="輸出價格/1M (第2段)">
            <input type="number" step="0.01" placeholder="0.00" value={form.price_output_tier2}
              onChange={(e) => setForm((p) => ({ ...p, price_output_tier2: e.target.value }))} className="input py-1 w-28" />
          </F>
          <div className="text-xs text-slate-400 self-end pb-2">超過第1段上限的 tokens 以第2段計費</div>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onSave} className="btn-primary py-1 px-3 text-xs flex items-center gap-1"><Check size={12} /> 儲存</button>
        <button onClick={onCancel} className="btn-ghost py-1 px-3 text-xs flex items-center gap-1"><X size={12} /> 取消</button>
      </div>
    </div>
  )
}

// ─── Price Settings Panel ─────────────────────────────────────────────────────
function PriceSettings({ llmModels }: { llmModels: LlmModel[] }) {
  const [prices, setPrices] = useState<TokenPrice[]>([])
  const [loading, setLoading] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)

  const emptyForm = () => ({
    model: llmModels[0]?.key || 'pro',
    price_input: '',
    price_output: '',
    use_tier2: false,
    tier_threshold: '',
    price_input_tier2: '',
    price_output_tier2: '',
    price_image_output: '',
    currency: 'USD',
    start_date: '',
    end_date: '',
  })
  const [form, setForm] = useState<PriceForm>(emptyForm())
  const [adding, setAdding] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/admin/token-prices')
      setPrices(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const buildPayload = () => ({
    model: form.model,
    price_input: parseFloat(form.price_input),
    price_output: parseFloat(form.price_output),
    tier_threshold: form.use_tier2 && form.tier_threshold ? parseInt(form.tier_threshold) : null,
    price_input_tier2: form.use_tier2 && form.price_input_tier2 ? parseFloat(form.price_input_tier2) : null,
    price_output_tier2: form.use_tier2 && form.price_output_tier2 ? parseFloat(form.price_output_tier2) : null,
    price_image_output: form.price_image_output !== '' ? parseFloat(form.price_image_output) : null,
    currency: form.currency,
    start_date: form.start_date,
    end_date: form.end_date || null,
  })

  const handleAdd = async () => {
    if (!form.start_date || !form.price_input || !form.price_output) return
    await api.post('/admin/token-prices', buildPayload())
    setForm(emptyForm())
    setAdding(false)
    load()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('確定刪除此價格設定？')) return
    await api.delete(`/admin/token-prices/${id}`)
    load()
  }

  const startEdit = (p: TokenPrice) => {
    setEditId(p.id)
    setForm({
      model: p.model,
      price_input: String(p.price_input),
      price_output: String(p.price_output),
      use_tier2: p.tier_threshold != null,
      tier_threshold: p.tier_threshold != null ? String(p.tier_threshold) : '',
      price_input_tier2: p.price_input_tier2 != null ? String(p.price_input_tier2) : '',
      price_output_tier2: p.price_output_tier2 != null ? String(p.price_output_tier2) : '',
      price_image_output: p.price_image_output != null ? String(p.price_image_output) : '',
      currency: p.currency,
      start_date: p.start_date,
      end_date: p.end_date || '',
    })
  }

  const handleSaveEdit = async () => {
    if (!editId) return
    await api.put(`/admin/token-prices/${editId}`, buildPayload())
    setEditId(null)
    load()
  }

  return (
    <div className="mb-6 border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 border-b border-slate-200">
        <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          <DollarSign size={15} className="text-green-500" /> Token 價格設定（每百萬 tokens）
        </span>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost py-1 px-2 text-xs flex items-center gap-1">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 重新整理
          </button>
          <button onClick={() => { setAdding(true); setEditId(null) }} className="btn-primary py-1 px-2 text-xs flex items-center gap-1">
            <Plus size={12} /> 新增
          </button>
        </div>
      </div>

      {adding && <InlineForm form={form} setForm={setForm} llmModels={llmModels} onSave={handleAdd} onCancel={() => setAdding(false)} />}

      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {['模型', '輸入 $/1M', '輸出 $/1M', '兩段閾值', '輸入T2', '輸出T2', '圖片 $/張', '幣別', '生效日期', '結束日期', ''].map((h) => (
              <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {prices.map((p) =>
            editId === p.id ? (
              <tr key={p.id}>
                <td colSpan={11} className="p-0">
                  <InlineForm form={form} setForm={setForm} llmModels={llmModels} onSave={handleSaveEdit} onCancel={() => setEditId(null)} />
                </td>
              </tr>
            ) : (
              <tr key={p.id} className="hover:bg-slate-50 transition">
                <td className="px-3 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.model === 'flash' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                    {llmModels.find((m) => m.key === p.model)?.name || p.model}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">{p.price_input}</td>
                <td className="px-3 py-2.5 text-right">{p.price_output}</td>
                <td className="px-3 py-2.5 text-right text-slate-500">{p.tier_threshold != null ? p.tier_threshold.toLocaleString() : '-'}</td>
                <td className="px-3 py-2.5 text-right text-slate-500">{p.price_input_tier2 != null ? p.price_input_tier2 : '-'}</td>
                <td className="px-3 py-2.5 text-right text-slate-500">{p.price_output_tier2 != null ? p.price_output_tier2 : '-'}</td>
                <td className="px-3 py-2.5 text-right text-purple-600">{p.price_image_output != null ? p.price_image_output : '-'}</td>
                <td className="px-3 py-2.5 text-slate-500">{p.currency}</td>
                <td className="px-3 py-2.5 text-slate-500">{p.start_date}</td>
                <td className="px-3 py-2.5 text-slate-500">{p.end_date || '永久'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(p)} className="text-slate-400 hover:text-blue-600 transition"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(p.id)} className="text-slate-400 hover:text-red-600 transition"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            )
          )}
          {prices.length === 0 && !loading && (
            <tr><td colSpan={11} className="px-4 py-6 text-center text-slate-400 text-xs">尚未設定任何價格</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export default function TokenUsagePanel() {
  const [rows, setRows] = useState<TokenUsage[]>([])
  const [loading, setLoading] = useState(false)
  const [llmModels, setLlmModels] = useState<LlmModel[]>([])
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    model: '',
  })
  const [orgSearch, setOrgSearch] = useState('')

  useEffect(() => {
    api.get('/admin/llm-models').then((r) => setLlmModels(r.data)).catch(() => { })
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)
      if (filters.model) params.set('model', filters.model)
      const res = await api.get(`/admin/token-usage?${params}`)
      setRows(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const totalIn = rows.reduce((a, r) => a + (r.input_tokens || 0), 0)
  const totalOut = rows.reduce((a, r) => a + (r.output_tokens || 0), 0)
  const totalCost = rows.reduce((a, r) => a + (r.cost || 0), 0)
  const totalImages = rows.reduce((a, r) => a + (r.image_count || 0), 0)
  const hasCost = rows.some((r) => r.cost != null)
  const hasImages = rows.some((r) => (r.image_count || 0) > 0)
  const currency = rows.find((r) => r.currency)?.currency || ''

  // Org search filter
  const filteredRows = orgSearch.trim()
    ? rows.filter((r) => {
      const q = orgSearch.trim().toLowerCase()
      const r2 = r as any
      return (
        (r.name || r.username || '').toLowerCase().includes(q) ||
        (r.employee_id || '').toLowerCase().includes(q) ||
        (r2.user_email || '').toLowerCase().includes(q) ||
        (r2.dept_name || '').toLowerCase().includes(q) ||
        (r2.profit_center_name || '').toLowerCase().includes(q) ||
        (r2.org_section_name || '').toLowerCase().includes(q) ||
        (r2.org_group_name || '').toLowerCase().includes(q)
      )
    })
    : rows

  const exportCsv = () => {
    const cols = ['日期', '使用者', '工號', '模型', '輸入Tokens', '輸出Tokens', '合計Tokens']
    if (hasImages) cols.push('圖片數')
    if (hasCost) cols.push(`費用(${currency})`)
    const header = cols.join(',')
    const lines = rows.map((r) => {
      const base: (string | number)[] = [r.date, r.name || r.username, r.employee_id || '', r.model, r.input_tokens, r.output_tokens, r.input_tokens + r.output_tokens]
      if (hasImages) base.push(r.image_count || 0)
      if (hasCost) base.push(r.cost != null ? r.cost : '')
      return base.join(',')
    })
    const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `token-usage-${filters.startDate}-to-${filters.endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <BarChart3 size={20} className="text-blue-500" /> Token 使用統計
        </h2>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={rows.length === 0} className="btn-ghost flex items-center gap-1.5">
            <Download size={14} /> 匯出 CSV
          </button>
          <button onClick={load} disabled={loading} className="btn-ghost flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 重新整理
          </button>
        </div>
      </div>

      {/* Price Settings */}
      <PriceSettings llmModels={llmModels} />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 bg-slate-50 rounded-xl p-4">
        <div>
          <label className="label">開始日期</label>
          <input type="date" value={filters.startDate} onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))} className="input" />
        </div>
        <div>
          <label className="label">結束日期</label>
          <input type="date" value={filters.endDate} onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))} className="input" />
        </div>
        <div>
          <label className="label">模型</label>
          <select value={filters.model} onChange={(e) => setFilters((p) => ({ ...p, model: e.target.value }))} className="input">
            <option value="">全部</option>
            {llmModels.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={load} className="btn-primary">查詢</button>
        </div>
        <div className="w-full flex items-center gap-2 border-t border-slate-200 pt-3 mt-1">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={orgSearch}
            onChange={e => setOrgSearch(e.target.value)}
            placeholder="篩選 姓名 / 工號 / Email / 部門名稱 / 利潤中心名稱 / 事業處名稱 / 事業群名稱"
            className="flex-1 bg-transparent text-sm outline-none text-slate-700 placeholder:text-slate-400"
          />
          {orgSearch && (
            <>
              <span className="text-xs text-slate-500">{filteredRows.length}/{rows.length}</span>
              <button onClick={() => setOrgSearch('')} className="text-slate-400 hover:text-slate-600"><X size={12} /></button>
            </>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className={`grid gap-4 mb-4 ${!hasImages && !hasCost ? 'grid-cols-3' : hasImages && hasCost ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {[
          { label: '總輸入 Tokens', value: totalIn.toLocaleString(), color: 'text-blue-600' },
          { label: '總輸出 Tokens', value: totalOut.toLocaleString(), color: 'text-indigo-600' },
          { label: '總計 Tokens', value: (totalIn + totalOut).toLocaleString(), color: 'text-purple-600' },
          ...(hasImages ? [{ label: '總圖片數', value: totalImages.toLocaleString(), color: 'text-purple-500' }] : []),
          ...(hasCost ? [{ label: `估算費用 (${currency})`, value: totalCost.toFixed(4), color: 'text-green-600' }] : []),
        ].map((s) => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['日期', '使用者', '工號', '模型', '輸入 Tokens', '輸出 Tokens',
                  ...(hasImages ? ['圖片數'] : []),
                  '合計',
                  ...(hasCost ? [`費用 (${currency})`] : []),
                  '部門名稱', '利潤中心名稱', '事業處名稱', '事業群名稱',
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.map((r) => {
                const r2 = r as any
                return (
                  <tr key={r.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-slate-500">{r.date}</td>
                    <td className="px-4 py-3 font-medium">{r.name || r.username}</td>
                    <td className="px-4 py-3 text-slate-500">{r.employee_id || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.model === 'flash' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                        {llmModels.find((m) => m.key === r.model)?.name || r.model}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{r.input_tokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{r.output_tokens.toLocaleString()}</td>
                    {hasImages && (
                      <td className="px-4 py-3 text-right text-purple-600">{(r.image_count || 0).toLocaleString()}</td>
                    )}
                    <td className="px-4 py-3 text-right font-medium">{(r.input_tokens + r.output_tokens).toLocaleString()}</td>
                    {hasCost && (
                      <td className="px-4 py-3 text-right text-green-700 font-medium">
                        {fmt(r.cost)}
                      </td>
                    )}
                    <td className="px-4 py-3 text-xs text-slate-500">{r2.dept_name || '-'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{r2.profit_center_name || '-'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{r2.org_section_name || '-'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{r2.org_group_name || '-'}</td>
                  </tr>
                )
              })}
              {filteredRows.length === 0 && !loading && (
                <tr><td colSpan={7 + (hasImages ? 1 : 0) + (hasCost ? 1 : 0) + 4} className="px-4 py-8 text-center text-slate-400 text-sm">查無資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
