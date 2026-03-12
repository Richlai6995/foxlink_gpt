import { useState, useEffect } from 'react'
import { Save, RefreshCw, Cpu } from 'lucide-react'
import type { LlmModel } from '../../types'
import api from '../../lib/api'

interface VectorDefaults {
  embedding_model_key: string
  rerank_model_key: string
  ocr_model_key: string
  env_fallback: { embedding: string; rerank: string; ocr: string }
}

export default function VectorDefaultsPanel() {
  const [data,    setData]    = useState<VectorDefaults | null>(null)
  const [models,  setModels]  = useState<LlmModel[]>([])
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  const load = async () => {
    const [d, m] = await Promise.all([
      api.get('/admin/settings/vector-defaults'),
      api.get('/admin/llm-models'),
    ])
    setData(d.data)
    setModels(m.data)
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    if (!data) return
    setSaving(true); setMsg(null)
    try {
      await api.put('/admin/settings/vector-defaults', {
        embedding_model_key: data.embedding_model_key,
        rerank_model_key:    data.rerank_model_key,
        ocr_model_key:       data.ocr_model_key,
      })
      setMsg({ ok: true, text: '儲存成功' })
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || '儲存失敗' })
    } finally { setSaving(false) }
  }

  const embeddingModels = models.filter(m => m.model_role === 'embedding' && m.is_active)
  const rerankModels    = models.filter(m => m.model_role === 'rerank'    && m.is_active)
  const chatModels      = models.filter(m => (!m.model_role || m.model_role === 'chat') && m.is_active)

  if (!data) return <div className="text-slate-500 text-sm p-4">載入中…</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu size={18} className="text-slate-600" />
          <h2 className="text-base font-semibold text-slate-800">向量預設模型設定</h2>
        </div>
        <button onClick={load} className="text-slate-400 hover:text-slate-600"><RefreshCw size={15} /></button>
      </div>

      <p className="text-xs text-slate-500">
        設定 KB、ETL 向量化及 OCR 所使用的預設模型。若未指定則回退至 env 設定值。
      </p>

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">

        {/* Embedding */}
        <div className="p-4 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">向量嵌入 (Embedding)</label>
          <select
            className="input w-full"
            value={data.embedding_model_key}
            onChange={e => setData({ ...data, embedding_model_key: e.target.value })}
          >
            <option value="">— 使用 env 預設：{data.env_fallback.embedding} —</option>
            {embeddingModels.map(m => (
              <option key={m.key} value={m.key}>{m.name} ({m.api_model})</option>
            ))}
          </select>
          <p className="text-xs text-slate-400">用於 KB 文件向量化及 ETL 資料向量化。env: KB_EMBEDDING_MODEL</p>
        </div>

        {/* Rerank */}
        <div className="p-4 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">重排序 (Rerank)</label>
          <select
            className="input w-full"
            value={data.rerank_model_key}
            onChange={e => setData({ ...data, rerank_model_key: e.target.value })}
          >
            <option value="">— 使用 env 預設：{data.env_fallback.rerank} —</option>
            {rerankModels.map(m => (
              <option key={m.key} value={m.key}>{m.name} ({m.api_model})</option>
            ))}
          </select>
          <p className="text-xs text-slate-400">用於 KB 檢索結果重排序（無設定時自動選取第一個啟用的 rerank 模型）。env: KB_RERANK_MODEL</p>
        </div>

        {/* OCR */}
        <div className="p-4 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">OCR / 圖片轉文字模型</label>
          <select
            className="input w-full"
            value={data.ocr_model_key}
            onChange={e => setData({ ...data, ocr_model_key: e.target.value })}
          >
            <option value="">— 使用 env 預設：{data.env_fallback.ocr} —</option>
            {chatModels.map(m => (
              <option key={m.key} value={m.key}>{m.name} ({m.api_model})</option>
            ))}
          </select>
          <p className="text-xs text-slate-400">用於 KB 文件內嵌入圖片的 OCR 文字提取。env: KB_OCR_MODEL</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          儲存設定
        </button>
        {msg && (
          <span className={`text-sm ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</span>
        )}
      </div>
    </div>
  )
}
