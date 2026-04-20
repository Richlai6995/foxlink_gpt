import { useEffect, useState } from 'react'
import { Plus, Trash2, Edit2, Database, AlertTriangle, Play, ShieldAlert, Zap, Eye, History, Share2, Globe, ToggleLeft, ToggleRight, BookOpen } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'
import ErpToolEditor from './ErpToolEditor'
import ErpToolTestRunner from './ErpToolTestRunner'
import ErpToolAuditLogPanel from './ErpToolAuditLogPanel'
import ErpGlossaryModal from './ErpGlossaryModal'
import ShareModal from '../dashboard/ShareModal'

export interface ErpTool {
  id: number
  code: string
  name: string
  description: string | null
  tags: string[]
  db_owner: string
  package_name: string | null
  object_name: string
  overload: string | null
  routine_type: 'FUNCTION' | 'PROCEDURE'
  metadata_hash: string | null
  metadata_checked_at: string | null
  metadata_drifted: number
  access_mode: 'READ_ONLY' | 'WRITE'
  requires_approval: number
  allow_llm_auto: number
  allow_inject: number
  allow_manual: number
  params: ErpParam[]
  returns: ErpReturns | null
  tool_schema: any
  inject_config: any
  max_rows_llm: number
  max_rows_ui: number
  timeout_sec: number
  proxy_skill_id: number | null
  enabled: number
  is_public?: number
  created_at: string
  updated_at: string
}

export interface ErpParam {
  name: string
  position: number
  in_out: 'IN' | 'OUT' | 'IN/OUT'
  data_type: string
  pls_type?: string
  data_length?: number
  data_precision?: number
  data_scale?: number
  required: boolean
  ai_hint: string
  display_name?: string | null
  default_value: any
  lov_config: any
  inject_value: any
  inject_source: string | null
  visible?: boolean
  editable?: boolean
}

export interface ErpReturns {
  data_type: string
  pls_type?: string
  data_length?: number
}

export default function ErpToolsPanel() {
  const [tools, setTools] = useState<ErpTool[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ErpTool | null>(null)
  const [creating, setCreating] = useState(false)
  const [testing, setTesting] = useState<ErpTool | null>(null)
  const [auditToolId, setAuditToolId] = useState<number | 'all' | null>(null)
  const [sharing, setSharing] = useState<ErpTool | null>(null)
  const [config, setConfig] = useState<{ erp_configured: boolean; allowed_schemas: string[] } | null>(null)
  const [glossaryOpen, setGlossaryOpen] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const [toolsRes, cfgRes] = await Promise.all([
        api.get('/erp-tools'),
        api.get('/erp-tools/config/check').catch(() => ({ data: null })),
      ])
      setTools(toolsRes.data)
      setConfig(cfgRes.data)
    } catch (e: any) {
      setError(e.response?.data?.error || '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const remove = async (t: ErpTool) => {
    if (!confirm(`刪除 ${t.code}?`)) return
    try {
      await api.delete(`/erp-tools/${t.id}`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || '刪除失敗')
    }
  }

  const toggle = async (t: ErpTool, field: 'enabled' | 'is_public', value: boolean) => {
    try {
      await api.put(`/erp-tools/${t.id}/toggle`, { field, value })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || '操作失敗')
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Database size={16} className="text-sky-600" />
            ERP Procedure 工具
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            註冊 Oracle FUNCTION / PROCEDURE,讓 LLM 透過 function calling 呼叫 ERP,或由使用者手動觸發
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setGlossaryOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-700 text-sm rounded-lg hover:bg-slate-50 transition"
            title="維護翻譯詞庫,提升 AI 翻譯 ERP 結果的準確度"
          >
            <BookOpen size={14} /> 翻譯詞庫
          </button>
          <button
            onClick={() => setAuditToolId('all')}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-700 text-sm rounded-lg hover:bg-slate-50 transition"
          >
            <History size={14} /> 執行歷史
          </button>
          <button
            onClick={() => setCreating(true)}
            disabled={!config?.erp_configured}
            className="flex items-center gap-1.5 px-3 py-2 bg-sky-600 text-white text-sm rounded-lg hover:bg-sky-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            title={!config?.erp_configured ? 'ERP DB 未設定' : ''}
          >
            <Plus size={15} /> 新增 ERP 工具
          </button>
        </div>
      </div>

      {/* Config banner */}
      {!config?.erp_configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} />
          ERP DB 未設定 — 請在 server/.env 設定 ERP_DB_HOST / ERP_DB_USER / ERP_DB_USER_PASSWORD
        </div>
      )}
      {config?.erp_configured && config.allowed_schemas.length === 0 && (
        <div className="text-xs text-slate-500">
          Owner 白名單:<span className="text-slate-600">未設定(允許所有 schema)</span>
        </div>
      )}
      {config?.erp_configured && config.allowed_schemas.length > 0 && (
        <div className="text-xs text-slate-500">
          Owner 白名單:<span className="font-mono text-slate-700">{config.allowed_schemas.join(', ')}</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-slate-400 text-sm py-8 text-center">載入中…</div>
      ) : tools.length === 0 ? (
        <div className="text-slate-400 text-sm py-12 text-center border-2 border-dashed border-slate-200 rounded-xl">
          <Database size={32} className="mx-auto mb-3 text-slate-300" />
          尚未註冊任何 ERP 工具
        </div>
      ) : (
        <div className="space-y-2">
          {tools.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
              <div className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${t.enabled ? 'bg-green-500' : 'bg-slate-300'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-800 text-sm">{t.name}</span>
                    <span className="font-mono text-xs text-slate-500">{t.code}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${t.access_mode === 'WRITE' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                      {t.access_mode}
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 text-slate-600">
                      {t.routine_type}
                    </span>
                    {t.metadata_drifted ? (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 flex items-center gap-1">
                        <AlertTriangle size={10} /> metadata 已變動
                      </span>
                    ) : null}
                    {t.is_public ? (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-green-50 text-green-700 flex items-center gap-1">
                        <Globe size={10} /> 公開
                      </span>
                    ) : null}
                    {t.allow_llm_auto ? (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-50 text-purple-700 flex items-center gap-1">
                        <Zap size={10} /> LLM
                      </span>
                    ) : null}
                    {t.allow_inject ? (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-700">Inject</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono">
                    {t.db_owner}.{t.package_name ? `${t.package_name}.` : ''}{t.object_name}
                    {t.overload ? <span className="text-slate-400"> (overload {t.overload})</span> : null}
                  </div>
                  {t.description && (
                    <div className="text-xs text-slate-600 mt-1 line-clamp-2">{t.description}</div>
                  )}
                  <div className="text-[10px] text-slate-400 mt-1">
                    建立 {fmtTW(t.created_at)}
                    {t.metadata_checked_at && <> · metadata 檢查 {fmtTW(t.metadata_checked_at)}</>}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0 items-center">
                  <button onClick={() => setTesting(t)} className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded" title="試跑">
                    <Play size={14} />
                  </button>
                  <button onClick={() => setAuditToolId(t.id)} className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded" title="執行歷史">
                    <History size={14} />
                  </button>
                  <button onClick={() => setEditing(t)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded" title="編輯">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => setSharing(t)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="分享設定">
                    <Share2 size={14} />
                  </button>
                  <button onClick={() => toggle(t, 'is_public', !t.is_public)}
                    className={`p-1.5 rounded ${t.is_public ? 'text-green-600 hover:bg-green-50' : 'text-slate-400 hover:bg-slate-50'}`}
                    title={t.is_public ? '公開(點擊取消)' : '非公開(點擊公開)'}>
                    <Globe size={14} />
                  </button>
                  <button onClick={() => toggle(t, 'enabled', !t.enabled)}
                    className="p-1.5 text-slate-400 hover:bg-slate-50 rounded"
                    title={t.enabled ? '停用' : '啟用'}>
                    {t.enabled ? <ToggleRight size={16} className="text-green-600" /> : <ToggleLeft size={16} className="text-slate-400" />}
                  </button>
                  <button onClick={() => remove(t)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="刪除">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ErpToolEditor
          tool={editing}
          allowedSchemas={config?.allowed_schemas || []}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}

      {testing && (
        <ErpToolTestRunner
          tool={testing}
          onClose={() => setTesting(null)}
        />
      )}

      {auditToolId !== null && (
        <ErpToolAuditLogPanel
          tools={tools}
          initialToolId={auditToolId === 'all' ? undefined : auditToolId}
          onClose={() => setAuditToolId(null)}
        />
      )}

      {sharing && (
        <ShareModal
          title={`ERP 工具 — ${sharing.name}`}
          sharesUrl={`/erp-tools/${sharing.id}/access`}
          onClose={() => setSharing(null)}
        />
      )}

      {glossaryOpen && (
        <ErpGlossaryModal onClose={() => setGlossaryOpen(false)} />
      )}
    </div>
  )
}
