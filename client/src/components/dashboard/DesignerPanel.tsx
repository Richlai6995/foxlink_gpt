/**
 * DesignerPanel — Schema / Topic / Design / ETL 管理介面
 * 僅 can_design_ai_select / admin 可見
 */
import { useState, useEffect } from 'react'
import { Plus, Save, Trash2, Play, RefreshCw, ChevronDown, ChevronRight, Eye } from 'lucide-react'
import api from '../../lib/api'
import type { AiSchemaDef, AiSelectTopic, AiSelectDesign, AiEtlJob, AiEtlRunLog } from '../../types'

type Tab = 'schema' | 'designs' | 'etl'

export default function DesignerPanel() {
  const [tab, setTab] = useState<Tab>('schema')

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 px-4 pt-3 gap-1 flex-shrink-0">
        {(['schema', 'designs', 'etl'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs rounded-t-lg transition ${
              tab === t ? 'bg-white text-blue-600 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {{ schema: 'Schema 知識庫', designs: '查詢設計', etl: 'ETL 排程' }[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'schema' && <SchemaManager />}
        {tab === 'designs' && <DesignManager />}
        {tab === 'etl' && <EtlManager />}
      </div>
    </div>
  )
}

// ── Schema Manager ────────────────────────────────────────────────────────────
function SchemaManager() {
  const [schemas, setSchemas] = useState<AiSchemaDef[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ table_name: '', display_name: '', db_connection: 'erp', business_notes: '', join_hints: '' })
  const [loading, setLoading] = useState(false)

  const load = () => api.get('/dashboard/designer/schemas').then(r => setSchemas(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const save = async () => {
    setLoading(true)
    try {
      if (editId) {
        await api.put(`/dashboard/designer/schemas/${editId}`, form)
      } else {
        await api.post('/dashboard/designer/schemas', form)
      }
      setEditId(null)
      setForm({ table_name: '', display_name: '', db_connection: 'erp', business_notes: '', join_hints: '' })
      load()
    } catch (e: any) {
      alert(e?.response?.data?.error || '儲存失敗')
    } finally {
      setLoading(false)
    }
  }

  const del = async (id: number) => {
    if (!confirm('確定刪除此 Schema？')) return
    await api.delete(`/dashboard/designer/schemas/${id}`)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-100 rounded-xl p-4 space-y-3">
        <p className="text-xs text-gray-500 font-medium">{editId ? '編輯 Schema' : '新增 Schema'}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">資料表名稱 *</label>
            <input className="input py-1.5 text-sm" placeholder="APPS.WO_ABNORMAL_V"
              value={form.table_name} onChange={e => setForm(p => ({ ...p, table_name: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">顯示名稱</label>
            <input className="input py-1.5 text-sm" placeholder="工單異常視圖"
              value={form.display_name} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">資料庫連線</label>
            <select className="input py-1.5 text-sm" value={form.db_connection}
              onChange={e => setForm(p => ({ ...p, db_connection: e.target.value }))}>
              <option value="erp">ERP (Oracle)</option>
              <option value="system">系統 DB</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">商業邏輯說明（LLM 理解用）</label>
          <textarea className="input py-1.5 text-sm resize-none" rows={3}
            placeholder="此視圖包含工單異常紀錄，JOIN 條件..."
            value={form.business_notes} onChange={e => setForm(p => ({ ...p, business_notes: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">JOIN 提示（JSON）</label>
          <textarea className="input py-1.5 text-sm font-mono resize-none" rows={2}
            placeholder='{"WO_ABNORMAL.WO_NO": "WORK_ORDERS.WO_NO"}'
            value={form.join_hints} onChange={e => setForm(p => ({ ...p, join_hints: e.target.value }))} />
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={loading || !form.table_name}
            className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
            <Save size={12} /> {loading ? '儲存中...' : '儲存'}
          </button>
          {editId && <button onClick={() => { setEditId(null); setForm({ table_name: '', display_name: '', db_connection: 'erp', business_notes: '', join_hints: '' }) }}
            className="text-xs text-gray-500 hover:text-gray-800 px-2">取消</button>}
        </div>
      </div>

      <div className="space-y-2">
        {schemas.map(s => (
          <div key={s.id} className="bg-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer"
              onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
              <div className="flex items-center gap-2">
                {expanded === s.id ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                <span className="text-sm text-gray-800 font-medium">{s.display_name || s.table_name}</span>
                <span className="text-xs text-gray-400">{s.table_name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${s.db_connection === 'erp' ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}>
                  {s.db_connection}
                </span>
              </div>
              <div className="flex gap-2">
                <button onClick={e => { e.stopPropagation(); setEditId(s.id); setForm({ table_name: s.table_name, display_name: s.display_name || '', db_connection: s.db_connection, business_notes: s.business_notes || '', join_hints: s.join_hints || '' }) }}
                  className="text-gray-400 hover:text-blue-400 text-xs">編輯</button>
                <button onClick={e => { e.stopPropagation(); del(s.id) }}
                  className="text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
              </div>
            </div>
            {expanded === s.id && s.business_notes && (
              <div className="px-4 pb-3 text-xs text-gray-500 border-t border-gray-200 pt-2">
                {s.business_notes}
              </div>
            )}
          </div>
        ))}
        {schemas.length === 0 && <p className="text-gray-400 text-xs text-center py-4">尚無 Schema 定義</p>}
      </div>
    </div>
  )
}

// ── Design Manager ────────────────────────────────────────────────────────────
function DesignManager() {
  const [topics, setTopics] = useState<AiSelectTopic[]>([])
  const [editDesign, setEditDesign] = useState<AiSelectDesign | null>(null)
  const [showDesignForm, setShowDesignForm] = useState(false)
  const [designForm, setDesignForm] = useState({
    topic_id: '', name: '', description: '', system_prompt: '', few_shot_examples: '[]',
    chart_config: '', cache_ttl_minutes: '30', is_public: false, vector_search_enabled: false
  })
  const [topicForm, setTopicForm] = useState({ name: '', description: '', icon: '', sort_order: '0' })
  const [loading, setLoading] = useState(false)

  const load = () => api.get('/dashboard/topics').then(r => setTopics(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const saveTopic = async () => {
    await api.post('/dashboard/designer/topics', topicForm)
    setTopicForm({ name: '', description: '', icon: '', sort_order: '0' })
    load()
  }

  const delTopic = async (id: number) => {
    if (!confirm('刪除主題會一併刪除其下所有任務')) return
    await api.delete(`/dashboard/designer/topics/${id}`)
    load()
  }

  const saveDesign = async () => {
    setLoading(true)
    try {
      const payload = { ...designForm, topic_id: Number(designForm.topic_id), cache_ttl_minutes: Number(designForm.cache_ttl_minutes) }
      if (editDesign) {
        await api.put(`/dashboard/designer/designs/${editDesign.id}`, payload)
      } else {
        await api.post('/dashboard/designer/designs', payload)
      }
      setShowDesignForm(false)
      setEditDesign(null)
      load()
    } catch (e: any) {
      alert(e?.response?.data?.error || '儲存失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 新增主題 */}
      <div className="bg-gray-100 rounded-xl p-4 space-y-2">
        <p className="text-xs text-gray-500 font-medium">新增主題</p>
        <div className="grid grid-cols-3 gap-2">
          <input className="input py-1.5 text-sm col-span-2" placeholder="主題名稱 *"
            value={topicForm.name} onChange={e => setTopicForm(p => ({ ...p, name: e.target.value }))} />
          <input className="input py-1.5 text-sm" placeholder="icon (e.g. bar-chart-2)"
            value={topicForm.icon} onChange={e => setTopicForm(p => ({ ...p, icon: e.target.value }))} />
          <input className="input py-1.5 text-sm col-span-2" placeholder="說明"
            value={topicForm.description} onChange={e => setTopicForm(p => ({ ...p, description: e.target.value }))} />
          <input className="input py-1.5 text-sm" placeholder="排序" type="number"
            value={topicForm.sort_order} onChange={e => setTopicForm(p => ({ ...p, sort_order: e.target.value }))} />
        </div>
        <button onClick={saveTopic} disabled={!topicForm.name}
          className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
          <Plus size={12} /> 新增主題
        </button>
      </div>

      {/* 主題清單 */}
      {topics.map(t => (
        <div key={t.id} className="bg-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200">
            <span className="text-sm font-medium text-gray-800">{t.name}</span>
            <div className="flex gap-2">
              <button onClick={() => { setDesignForm(p => ({ ...p, topic_id: String(t.id) })); setEditDesign(null); setShowDesignForm(true) }}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                <Plus size={11} /> 新增任務
              </button>
              <button onClick={() => delTopic(t.id)} className="text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {(t.designs || []).map(d => (
              <div key={d.id} className="flex items-center justify-between px-6 py-2">
                <div>
                  <span className="text-xs text-gray-700">{d.name}</span>
                  {d.vector_search_enabled === 1 && <span className="ml-2 text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">語意</span>}
                  {d.is_public === 1 && <span className="ml-1 text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded">公開</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => {
                    setEditDesign(d)
                    setDesignForm({
                      topic_id: String(d.topic_id), name: d.name, description: d.description || '',
                      system_prompt: d.system_prompt || '', few_shot_examples: d.few_shot_examples || '[]',
                      chart_config: d.chart_config || '', cache_ttl_minutes: String(d.cache_ttl_minutes),
                      is_public: d.is_public === 1, vector_search_enabled: d.vector_search_enabled === 1
                    })
                    setShowDesignForm(true)
                  }} className="text-xs text-gray-500 hover:text-blue-400">編輯</button>
                  <button onClick={async () => { if (confirm('刪除此任務？')) { await api.delete(`/dashboard/designer/designs/${d.id}`); load() } }}
                    className="text-gray-400 hover:text-red-400"><Trash2 size={11} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 任務表單 Modal */}
      {showDesignForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-100 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <p className="text-sm font-medium text-gray-800">{editDesign ? '編輯任務' : '新增任務'}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">任務名稱 *</label>
                <input className="input py-1.5 text-sm" value={designForm.name}
                  onChange={e => setDesignForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">說明</label>
                <input className="input py-1.5 text-sm" value={designForm.description}
                  onChange={e => setDesignForm(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">快取時間（分鐘）</label>
                <input className="input py-1.5 text-sm" type="number" value={designForm.cache_ttl_minutes}
                  onChange={e => setDesignForm(p => ({ ...p, cache_ttl_minutes: e.target.value }))} />
              </div>
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={designForm.is_public}
                    onChange={e => setDesignForm(p => ({ ...p, is_public: e.target.checked }))} />
                  公開
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={designForm.vector_search_enabled}
                    onChange={e => setDesignForm(p => ({ ...p, vector_search_enabled: e.target.checked }))} />
                  啟用語意搜尋
                </label>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">System Prompt（SQL 生成指令）</label>
              <textarea className="input py-1.5 text-sm font-mono resize-none" rows={6}
                value={designForm.system_prompt}
                onChange={e => setDesignForm(p => ({ ...p, system_prompt: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Few-shot 範例（JSON）</label>
              <textarea className="input py-1.5 text-sm font-mono resize-none" rows={4}
                placeholder='[{"q":"計畫異常數量","sql":"SELECT COUNT(*) FROM ..."}]'
                value={designForm.few_shot_examples}
                onChange={e => setDesignForm(p => ({ ...p, few_shot_examples: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">圖表設定（JSON）</label>
              <textarea className="input py-1.5 text-sm font-mono resize-none" rows={6}
                placeholder='{"default_chart":"bar","charts":[{"type":"bar","x_field":"NAME","y_field":"CNT","gradient":true}]}'
                value={designForm.chart_config}
                onChange={e => setDesignForm(p => ({ ...p, chart_config: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={saveDesign} disabled={loading || !designForm.name}
                className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1">
                <Save size={12} /> {loading ? '儲存中...' : '儲存'}
              </button>
              <button onClick={() => { setShowDesignForm(false); setEditDesign(null) }}
                className="text-xs text-gray-500 hover:text-gray-800 px-3">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ETL Manager ───────────────────────────────────────────────────────────────
function EtlManager() {
  const [jobs, setJobs] = useState<AiEtlJob[]>([])
  const [logs, setLogs] = useState<AiEtlRunLog[]>([])
  const [showLogs, setShowLogs] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '', source_sql: '', source_connection: 'erp',
    vectorize_fields: '', metadata_fields: '', embedding_dimension: '768',
    cron_expression: '', is_incremental: true
  })
  const [running, setRunning] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const loadJobs = () => api.get('/dashboard/etl/jobs').then(r => setJobs(r.data)).catch(() => {})
  useEffect(() => { loadJobs() }, [])

  const loadLogs = async (jobId: number) => {
    const r = await api.get(`/dashboard/etl/jobs/${jobId}/logs`)
    setLogs(r.data)
    setShowLogs(jobId)
  }

  const runNow = async (jobId: number) => {
    setRunning(jobId)
    try {
      await api.post(`/dashboard/etl/jobs/${jobId}/run`)
      setTimeout(() => { loadJobs(); setRunning(null) }, 2000)
    } catch (e: any) {
      alert(e?.response?.data?.error || '執行失敗')
      setRunning(null)
    }
  }

  const save = async () => {
    setLoading(true)
    try {
      const payload = {
        ...form,
        embedding_dimension: Number(form.embedding_dimension),
        vectorize_fields: form.vectorize_fields ? form.vectorize_fields.split(',').map(s => s.trim()) : [],
        metadata_fields: form.metadata_fields ? form.metadata_fields.split(',').map(s => s.trim()) : [],
      }
      if (editId) { await api.put(`/dashboard/etl/jobs/${editId}`, payload) }
      else { await api.post('/dashboard/etl/jobs', payload) }
      setShowForm(false); setEditId(null)
      loadJobs()
    } catch (e: any) {
      alert(e?.response?.data?.error || '儲存失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', source_sql: '', source_connection: 'erp', vectorize_fields: '', metadata_fields: '', embedding_dimension: '768', cron_expression: '', is_incremental: true }) }}
        className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
        <Plus size={12} /> 新增 ETL Job
      </button>

      {showForm && (
        <div className="bg-gray-100 rounded-xl p-4 space-y-3">
          <p className="text-xs text-gray-500 font-medium">{editId ? '編輯 ETL Job' : '新增 ETL Job'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">名稱 *</label>
              <input className="input py-1.5 text-sm" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">來源 SQL（可含 :last_run 增量綁定）</label>
              <textarea className="input py-1.5 text-sm font-mono resize-none" rows={5}
                placeholder="SELECT wo_no, plan_name, abnormal_reply FROM apps.wo_abnormal WHERE create_date > :last_run"
                value={form.source_sql} onChange={e => setForm(p => ({ ...p, source_sql: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">向量化欄位（逗號分隔）</label>
              <input className="input py-1.5 text-sm" placeholder="ABNORMAL_REPLY,PLAN_NAME"
                value={form.vectorize_fields} onChange={e => setForm(p => ({ ...p, vectorize_fields: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Metadata 欄位</label>
              <input className="input py-1.5 text-sm" placeholder="WO_NO,PART_NO"
                value={form.metadata_fields} onChange={e => setForm(p => ({ ...p, metadata_fields: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Embedding 維度</label>
              <select className="input py-1.5 text-sm" value={form.embedding_dimension}
                onChange={e => setForm(p => ({ ...p, embedding_dimension: e.target.value }))}>
                <option value="768">768</option>
                <option value="1536">1536</option>
                <option value="3072">3072</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Cron 排程</label>
              <input className="input py-1.5 text-sm" placeholder="0 2 * * *"
                value={form.cron_expression} onChange={e => setForm(p => ({ ...p, cron_expression: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 pt-4">
              <input type="checkbox" checked={form.is_incremental}
                onChange={e => setForm(p => ({ ...p, is_incremental: e.target.checked }))} />
              <label className="text-xs text-gray-500">增量模式（使用 :last_run）</label>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={loading || !form.name || !form.source_sql}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
              <Save size={12} /> {loading ? '儲存中...' : '儲存'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-xs text-gray-500 hover:text-gray-800 px-2">取消</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {jobs.map(j => (
          <div key={j.id} className="bg-gray-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-sm text-gray-800 font-medium">{j.name}</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${j.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-400'}`}>{j.status}</span>
                {j.cron_expression && <span className="ml-2 text-xs text-gray-400 font-mono">{j.cron_expression}</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => runNow(j.id)} disabled={running === j.id}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition">
                  {running === j.id ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                  立即執行
                </button>
                <button onClick={() => loadLogs(j.id)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
                  <Eye size={12} /> 紀錄
                </button>
                <button onClick={async () => { if (confirm('刪除此 ETL Job？')) { await api.delete(`/dashboard/etl/jobs/${j.id}`); loadJobs() } }}
                  className="text-gray-400 hover:text-red-400"><Trash2 size={12} /></button>
              </div>
            </div>
            <div className="text-xs text-gray-400 space-x-3">
              <span>共執行 {j.run_count ?? 0} 次</span>
              {j.last_run_at && <span>上次：{new Date(j.last_run_at).toLocaleString('zh-TW')}</span>}
              <span>維度：{j.embedding_dimension}</span>
              {j.is_incremental ? <span className="text-teal-500">增量</span> : <span className="text-amber-500">全量</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Logs Modal */}
      {showLogs !== null && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-100 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <p className="text-sm font-medium text-gray-800">執行紀錄</p>
              <button onClick={() => setShowLogs(null)} className="text-gray-500 hover:text-gray-800">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {logs.map(l => (
                <div key={l.id} className={`rounded-lg p-3 text-xs ${l.status === 'success' ? 'bg-green-50 border border-green-200' : l.status === 'failed' ? 'bg-red-50 border border-red-200' : 'bg-gray-100'}`}>
                  <div className="flex justify-between mb-1">
                    <span className={`font-medium ${l.status === 'success' ? 'text-green-400' : l.status === 'failed' ? 'text-red-400' : 'text-gray-500'}`}>{l.status}</span>
                    <span className="text-gray-400">{l.started_at ? new Date(l.started_at).toLocaleString('zh-TW') : '-'}</span>
                  </div>
                  <span className="text-gray-500">撈取 {l.rows_fetched} 筆 / 向量化 {l.rows_vectorized} 筆</span>
                  {l.error_message && <p className="text-red-400 mt-1 font-mono">{l.error_message}</p>}
                </div>
              ))}
              {logs.length === 0 && <p className="text-gray-400 text-center py-4">無執行紀錄</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
