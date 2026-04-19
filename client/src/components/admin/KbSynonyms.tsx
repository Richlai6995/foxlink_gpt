import { useEffect, useState } from 'react'
import { BookOpen, Plus, Trash2, RefreshCw, ArrowLeftRight } from 'lucide-react'
import api from '../../lib/api'

interface Thesaurus { name: string; phrase_count: number }
interface SynEntry  { term: string; related: string }

export default function KbSynonyms() {
  const [list,     setList]     = useState<Thesaurus[]>([])
  const [selected, setSelected] = useState<string>('')
  const [syns,     setSyns]     = useState<SynEntry[]>([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState('')
  const [newName,  setNewName]  = useState('')
  const [newTerm,  setNewTerm]  = useState('')
  const [newRel,   setNewRel]   = useState('')
  const [busy,     setBusy]     = useState(false)

  const loadList = async () => {
    setLoading(true); setErr('')
    try {
      const r = await api.get('/admin/kb/thesauri')
      setList(r.data)
      if (r.data.length > 0 && !selected) setSelected(r.data[0].name)
    } catch (e: any) {
      setErr(e.response?.data?.error || '載入字典列表失敗')
    } finally { setLoading(false) }
  }

  const loadSyns = async () => {
    if (!selected) { setSyns([]); return }
    try {
      const r = await api.get(`/admin/kb/thesauri/${selected}/synonyms`)
      setSyns(r.data)
    } catch (e: any) {
      setErr(e.response?.data?.error || '載入同義詞失敗')
    }
  }

  useEffect(() => { loadList() }, [])
  useEffect(() => { loadSyns() }, [selected]) // eslint-disable-line

  const createThes = async () => {
    if (!newName.trim()) return
    setBusy(true); setErr('')
    try {
      await api.post('/admin/kb/thesauri', { name: newName.trim() })
      setNewName('')
      await loadList()
      setSelected(newName.trim())
    } catch (e: any) {
      setErr(e.response?.data?.error || '建立失敗（可能缺 CTX_THES 權限）')
    } finally { setBusy(false) }
  }

  const dropThes = async (name: string) => {
    if (!confirm(`確定刪除字典 "${name}"？此操作無法復原，所有同義詞關係會一併消失。`)) return
    setBusy(true); setErr('')
    try {
      await api.delete(`/admin/kb/thesauri/${name}`)
      if (selected === name) setSelected('')
      await loadList()
    } catch (e: any) {
      setErr(e.response?.data?.error || '刪除失敗')
    } finally { setBusy(false) }
  }

  const addSyn = async () => {
    if (!selected || !newTerm.trim() || !newRel.trim()) return
    setBusy(true); setErr('')
    try {
      await api.post(`/admin/kb/thesauri/${selected}/synonyms`, {
        term:    newTerm.trim(),
        related: newRel.trim(),
      })
      setNewTerm(''); setNewRel('')
      await loadSyns()
    } catch (e: any) {
      setErr(e.response?.data?.error || '新增失敗')
    } finally { setBusy(false) }
  }

  const removeSyn = async (s: SynEntry) => {
    setBusy(true); setErr('')
    try {
      await api.delete(`/admin/kb/thesauri/${selected}/synonyms`, { data: s })
      await loadSyns()
    } catch (e: any) {
      setErr(e.response?.data?.error || '刪除失敗')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-2">
        <BookOpen size={18} className="text-slate-600" />
        <h2 className="text-base font-semibold text-slate-800">同義詞字典（CTX_THES）</h2>
      </div>
      <p className="text-xs text-slate-500">
        建立 Oracle Text 同義詞字典後，在 KB 檢索設定 /「進階檢索」填入字典名稱。
        查 "鍾漢成" 會自動展開 "Carson Chung" 等同義詞（雙向）。
      </p>
      {err && <div className="text-sm text-red-500 bg-red-50 border border-red-200 rounded p-2">{err}</div>}

      <div className="grid grid-cols-12 gap-4">
        {/* Thesauri list */}
        <div className="col-span-4 bg-white rounded-xl border border-slate-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700">字典列表</div>
            <button onClick={loadList} className="text-slate-400 hover:text-slate-600">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {list.length === 0 && (
              <div className="text-xs text-slate-400 italic">尚無字典</div>
            )}
            {list.map((t) => (
              <div
                key={t.name}
                className={`flex items-center justify-between p-2 rounded cursor-pointer border text-sm ${
                  selected === t.name ? 'bg-blue-50 border-blue-300' : 'border-slate-200 hover:bg-slate-50'
                }`}
                onClick={() => setSelected(t.name)}
              >
                <div>
                  <div className="font-mono text-slate-800">{t.name}</div>
                  <div className="text-[10px] text-slate-400">{t.phrase_count} phrases</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); dropThes(t.name) }}
                  className="text-red-400 hover:text-red-600 p-1"
                  disabled={busy}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Create new */}
          <div className="border-t pt-3 space-y-2">
            <div className="text-xs text-slate-500">新增字典</div>
            <input
              className="input w-full text-sm"
              placeholder="字典名稱（英數字底線）"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createThes() }}
            />
            <button
              onClick={createThes}
              disabled={busy || !newName.trim()}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium disabled:opacity-50"
            >
              <Plus size={12} /> 建立
            </button>
          </div>
        </div>

        {/* Synonyms editor */}
        <div className="col-span-8 bg-white rounded-xl border border-slate-200 p-3 space-y-3">
          {!selected ? (
            <div className="text-sm text-slate-400 italic p-8 text-center">← 先選一個字典</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-700">
                  <code className="text-blue-600">{selected}</code> 的同義詞關係
                </div>
                <div className="text-xs text-slate-400">{syns.length} 條關係</div>
              </div>

              {/* Add form */}
              <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                <div className="text-xs text-slate-500">新增同義詞（雙向）</div>
                <div className="flex gap-2 items-center">
                  <input
                    className="input flex-1 text-sm"
                    placeholder="term（例 鍾漢成）"
                    value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                  />
                  <ArrowLeftRight size={14} className="text-slate-400" />
                  <input
                    className="input flex-1 text-sm"
                    placeholder="related（例 Carson Chung）"
                    value={newRel}
                    onChange={(e) => setNewRel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addSyn() }}
                  />
                  <button
                    onClick={addSyn}
                    disabled={busy || !newTerm.trim() || !newRel.trim()}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium disabled:opacity-50"
                  >
                    新增
                  </button>
                </div>
              </div>

              {/* Synonym list */}
              <div className="max-h-[500px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 text-slate-600 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left w-[45%]">term</th>
                      <th className="px-3 py-2 text-left w-[45%]">related</th>
                      <th className="px-3 py-2 w-[10%]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {syns.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center text-xs text-slate-400 italic py-6">
                          尚無同義詞，從上方新增
                        </td>
                      </tr>
                    )}
                    {syns.map((s, i) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono">{s.term}</td>
                        <td className="px-3 py-2 font-mono">{s.related}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => removeSyn(s)}
                            disabled={busy}
                            className="text-red-400 hover:text-red-600"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
