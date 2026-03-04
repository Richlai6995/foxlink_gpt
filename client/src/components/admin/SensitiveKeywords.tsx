import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, AlertTriangle, Download, Upload } from 'lucide-react'
import type { SensitiveKeyword } from '../../types'
import api from '../../lib/api'

export default function SensitiveKeywords() {
  const [keywords, setKeywords] = useState<SensitiveKeyword[]>([])
  const [newKw, setNewKw] = useState('')
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const res = await api.get('/admin/sensitive-keywords')
    setKeywords(res.data)
  }

  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!newKw.trim()) return
    setError('')
    try {
      await api.post('/admin/sensitive-keywords', { keyword: newKw.trim() })
      setNewKw('')
      await load()
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || '新增失敗')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('確定刪除此關鍵字？')) return
    await api.delete(`/admin/sensitive-keywords/${id}`)
    await load()
  }

  const exportCsv = () => {
    const csv = 'keyword\n' + keywords.map((k) => k.keyword).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sensitive-keywords.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportMsg('')
    setError('')
    const formData = new FormData()
    formData.append('csv_file', file)
    try {
      const res = await api.post('/admin/sensitive-keywords/import', formData)
      setImportMsg(`✅ 匯入完成：新增 ${res.data.imported} 筆，略過 ${res.data.skipped} 筆`)
      await load()
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || '匯入失敗')
    } finally {
      setImporting(false)
      if (importRef.current) importRef.current.value = ''
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle size={20} className="text-orange-500" />
          <h2 className="text-lg font-semibold text-slate-800">敏感詞彙管理</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={keywords.length === 0} className="btn-ghost flex items-center gap-1.5">
            <Download size={14} /> 匯出 CSV
          </button>
          <button
            onClick={() => importRef.current?.click()}
            disabled={importing}
            className="btn-ghost flex items-center gap-1.5"
          >
            <Upload size={14} /> {importing ? '匯入中...' : '匯入 CSV'}
          </button>
          <input ref={importRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImportCsv} />
        </div>
      </div>

      <p className="text-sm text-slate-500 mb-4">
        當使用者訊息中包含敏感詞彙時，系統將自動記錄並通知管理員。
      </p>

      {/* Add */}
      <div className="flex gap-2 mb-6">
        <input
          value={newKw}
          onChange={(e) => setNewKw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="輸入敏感詞彙..."
          className="input flex-1"
        />
        <button onClick={handleAdd} className="btn-primary flex items-center gap-1.5">
          <Plus size={15} /> 新增
        </button>
      </div>
      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      {importMsg && <p className="text-green-600 text-sm mb-3">{importMsg}</p>}

      {/* List */}
      <div className="flex flex-wrap gap-2">
        {keywords.map((k) => (
          <div
            key={k.id}
            className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-full px-3 py-1.5 text-sm text-orange-800"
          >
            <span>{k.keyword}</span>
            <button
              onClick={() => handleDelete(k.id)}
              className="text-orange-400 hover:text-red-500 transition"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {keywords.length === 0 && (
          <p className="text-slate-400 text-sm">尚未設定敏感詞彙</p>
        )}
      </div>
    </div>
  )
}
