import { useEffect, useState } from 'react'
import { X, Plus, Trash2, Save, BookOpen, AlertTriangle, Search } from 'lucide-react'
import api from '../../lib/api'

interface GlossaryEntry {
  id: number
  source_text: string
  en_text: string | null
  vi_text: string | null
  notes: string | null
  scope: string
  updated_at?: string
}

interface Props {
  onClose: () => void
}

export default function ErpGlossaryModal({ onClose }: Props) {
  const [entries, setEntries] = useState<GlossaryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState<{ source_text: string; en_text: string; vi_text: string; notes: string } | null>(null)
  // 未儲存的行級編輯
  const [dirty, setDirty] = useState<Record<number, Partial<GlossaryEntry>>>({})

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/erp-tools/glossary/list')
      setEntries(res.data || [])
      setDirty({})
    } catch (e: any) {
      setError(e.response?.data?.error || '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = entries.filter(e => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return (e.source_text || '').toLowerCase().includes(q)
      || (e.en_text || '').toLowerCase().includes(q)
      || (e.vi_text || '').toLowerCase().includes(q)
  })

  const upsertDraft = async () => {
    if (!draft || !draft.source_text.trim()) {
      setError('中文原文必填')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.post('/erp-tools/glossary', {
        source_text: draft.source_text.trim(),
        en_text:     draft.en_text.trim() || null,
        vi_text:     draft.vi_text.trim() || null,
        notes:       draft.notes.trim() || null,
      })
      setDraft(null)
      await load()
    } catch (e: any) {
      setError(e.response?.data?.error || '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const saveRow = async (e: GlossaryEntry) => {
    const patch = dirty[e.id]
    if (!patch) return
    setSaving(true)
    setError(null)
    try {
      await api.post('/erp-tools/glossary', {
        source_text: e.source_text,
        en_text:     patch.en_text ?? e.en_text ?? null,
        vi_text:     patch.vi_text ?? e.vi_text ?? null,
        notes:       patch.notes   ?? e.notes   ?? null,
      })
      await load()
    } catch (err: any) {
      setError(err.response?.data?.error || '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (e: GlossaryEntry) => {
    if (!confirm(`刪除「${e.source_text}」?`)) return
    setSaving(true)
    try {
      await api.delete(`/erp-tools/glossary/${e.id}`)
      await load()
    } catch (err: any) {
      setError(err.response?.data?.error || '刪除失敗')
    } finally {
      setSaving(false)
    }
  }

  const updField = (id: number, field: 'en_text' | 'vi_text' | 'notes', value: string) => {
    setDirty(d => ({ ...d, [id]: { ...(d[id] || {}), [field]: value } }))
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <BookOpen size={15} className="text-sky-600" />
              ERP 結果翻譯詞庫
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              維護中文→英文/越南文的專有名詞對照,用來降低 AI 翻譯 ERP 結果時的亂翻機率
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={12} /> {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={filter} onChange={e => setFilter(e.target.value)}
                placeholder="搜尋原文 / 譯文"
                className="w-full pl-7 pr-2 py-1.5 border border-slate-300 rounded text-sm" />
            </div>
            <button onClick={() => setDraft({ source_text: '', en_text: '', vi_text: '', notes: '' })}
              className="flex items-center gap-1 px-3 py-1.5 bg-sky-600 text-white text-sm rounded hover:bg-sky-700">
              <Plus size={13} /> 新增詞彙
            </button>
          </div>

          {draft && (
            <div className="border-2 border-sky-300 bg-sky-50 rounded p-3 space-y-2">
              <div className="text-xs font-medium text-sky-800">新增詞彙</div>
              <div className="grid grid-cols-4 gap-2">
                <input value={draft.source_text}
                  onChange={e => setDraft({ ...draft, source_text: e.target.value })}
                  placeholder="中文原文(如:發補單)" autoFocus
                  className="border border-slate-300 rounded px-2 py-1 text-sm" />
                <input value={draft.en_text}
                  onChange={e => setDraft({ ...draft, en_text: e.target.value })}
                  placeholder="English (如: Reissue Note)"
                  className="border border-slate-300 rounded px-2 py-1 text-sm" />
                <input value={draft.vi_text}
                  onChange={e => setDraft({ ...draft, vi_text: e.target.value })}
                  placeholder="Tiếng Việt"
                  className="border border-slate-300 rounded px-2 py-1 text-sm" />
                <input value={draft.notes}
                  onChange={e => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="備註(選填)"
                  className="border border-slate-300 rounded px-2 py-1 text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={upsertDraft} disabled={saving}
                  className="px-3 py-1 text-xs bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1">
                  <Save size={11} /> {saving ? '儲存中…' : '儲存'}
                </button>
                <button onClick={() => setDraft(null)}
                  className="px-3 py-1 text-xs border border-slate-300 rounded hover:bg-white">取消</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center text-sm text-slate-400 py-8">載入中…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-12 border border-dashed border-slate-200 rounded">
              {entries.length === 0 ? '尚無詞彙,點「新增詞彙」建立第一筆' : '沒有符合的結果'}
            </div>
          ) : (
            <div className="border border-slate-200 rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left w-1/5">中文(原文)</th>
                    <th className="px-3 py-2 text-left w-1/4">English</th>
                    <th className="px-3 py-2 text-left w-1/4">Tiếng Việt</th>
                    <th className="px-3 py-2 text-left">備註</th>
                    <th className="px-3 py-2 w-24">動作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => {
                    const d = dirty[e.id] || {}
                    const hasChange = Object.keys(d).length > 0
                    return (
                      <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                        <td className="px-3 py-1.5 font-medium">{e.source_text}</td>
                        <td className="px-3 py-1.5">
                          <input defaultValue={e.en_text || ''}
                            onChange={ev => updField(e.id, 'en_text', ev.target.value)}
                            className="w-full border border-slate-200 rounded px-2 py-0.5 text-xs focus:border-sky-400 focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input defaultValue={e.vi_text || ''}
                            onChange={ev => updField(e.id, 'vi_text', ev.target.value)}
                            className="w-full border border-slate-200 rounded px-2 py-0.5 text-xs focus:border-sky-400 focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input defaultValue={e.notes || ''}
                            onChange={ev => updField(e.id, 'notes', ev.target.value)}
                            className="w-full border border-slate-200 rounded px-2 py-0.5 text-xs focus:border-sky-400 focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex gap-1">
                            {hasChange && (
                              <button onClick={() => saveRow(e)} disabled={saving}
                                title="儲存修改"
                                className="p-1 text-sky-600 hover:bg-sky-50 rounded disabled:opacity-50">
                                <Save size={12} />
                              </button>
                            )}
                            <button onClick={() => remove(e)} disabled={saving}
                              title="刪除"
                              className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-50">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-[10px] text-slate-400 pt-2">
            提示:詞庫改動後 10 分鐘內生效(app-level cache);已翻譯的結果保持 Redis 24 小時舊版,新詞庫對新內容才生效
          </div>
        </div>

        <div className="px-5 py-3 border-t bg-slate-50 flex justify-between items-center">
          <span className="text-[11px] text-slate-500">共 {entries.length} 筆{filter && ` · 篩選後 ${filtered.length} 筆`}</span>
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-slate-300 rounded hover:bg-white">關閉</button>
        </div>
      </div>
    </div>
  )
}
