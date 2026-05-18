import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Copy, Check, ToggleLeft, ToggleRight, Key, RefreshCw, Lock, BarChart3, X, UserCog, AlertTriangle } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW, fmtDateTW } from '../../lib/fmtTW'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  description: string | null
  kb_ids: string | null
  scopes: string | null
  rate_limit_per_min: number | null
  allow_confidential: number | null
  acts_as_user_id: number | null
  acts_as_name?: string | null
  acts_as_username?: string | null
  allowed_ips: string | null
  is_active: number
  expires_at: string | null
  created_at: string
  last_used_at: string | null
  created_by_name: string | null
  created_by_username: string
  req_24h?: number
  err_24h?: number
}

interface Kb {
  id: string
  name: string
  is_confidential?: boolean
}

interface Scope { key: string; label: string; description: string; group: 'read' | 'write'; write: boolean }

interface BindableUser {
  id: number
  username: string
  name: string
  employee_id: string | null
  dept_name: string | null
  role: string
}

interface UsageResp {
  days: number
  summary: {
    req_total: number; req_errors: number;
    tokens_in: number; tokens_out: number; bytes_out: number; avg_ms: number;
  }
  by_endpoint: { endpoint: string; method: string; cnt: number; errs: number }[]
  recent: {
    endpoint: string; method: string; status_code: number; kb_id: string | null;
    tokens_in: number; tokens_out: number; bytes_out: number; duration_ms: number; called_at: string;
    acts_as_user_id: number | null; acts_as_name: string | null; acts_as_username: string | null;
    client_ip: string | null; resource_id: string | null; error_message: string | null;
    kb_name: string | null;
  }[]
}

export default function ApiKeysPanel() {
  const [keys,    setKeys]    = useState<ApiKey[]>([])
  const [kbs,     setKbs]     = useState<Kb[]>([])
  const [scopes,  setScopes]  = useState<Scope[]>([])
  const [defaultScopes, setDefaultScopes] = useState<string[]>([])
  const [bindableUsers, setBindableUsers] = useState<BindableUser[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newKey,   setNewKey]   = useState<string | null>(null)
  const [copied,   setCopied]   = useState(false)
  const [usageOpen, setUsageOpen] = useState<{ key: ApiKey; data: UsageResp | null } | null>(null)

  const [form, setForm] = useState({
    name: '',
    description: '',
    kb_ids: [] as string[],
    expires_at: '',
    scopes: [] as string[],
    rate_limit_per_min: 60,
    allow_confidential: false,
    acts_as_user_id: null as number | null,
    allowed_ips: '' as string, // textarea: 換行/空白/逗號分隔
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [keysRes, kbsRes, scopesRes, usersRes] = await Promise.all([
        api.get('/api-keys'),
        api.get('/kb'),
        api.get('/api-keys/scopes'),
        api.get('/api-keys/bindable-users'),
      ])
      setKeys(keysRes.data)
      setKbs(kbsRes.data?.kbs || kbsRes.data || [])
      setScopes(scopesRes.data?.scopes || [])
      setDefaultScopes(scopesRes.data?.defaults || [])
      setBindableUsers(usersRes.data || [])
    } catch (e: any) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 開啟新增表單時把 scopes 預填預設值
  useEffect(() => {
    if (showForm && form.scopes.length === 0 && defaultScopes.length) {
      setForm((f) => ({ ...f, scopes: defaultScopes }))
    }
  }, [showForm, defaultScopes, form.scopes.length])

  const hasWriteScope = form.scopes.some((s) => scopes.find((sc) => sc.key === s)?.write)

  const handleCreate = async () => {
    if (!form.name.trim()) return
    if (hasWriteScope && !form.acts_as_user_id) {
      alert('寫入 scope 必須綁定 Acts As User(service account)。')
      return
    }
    if (hasWriteScope) {
      const u = bindableUsers.find((x) => x.id === form.acts_as_user_id)
      const ok = confirm(`此金鑰將以 user「${u?.name || form.acts_as_user_id}」身分對 KB 寫入,
所有寫入動作會記錄為該 user 操作(包含 audit log)。
保密 KB 仍需 owner 將該 user 加入共享 (permission=edit) 才能寫入。
確定建立?`)
      if (!ok) return
    }
    try {
      const ips = form.allowed_ips.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
      const payload: Record<string, any> = {
        name:        form.name.trim(),
        description: form.description.trim() || undefined,
        kb_ids:      form.kb_ids.length ? form.kb_ids : undefined,
        expires_at:  form.expires_at || undefined,
        scopes:      form.scopes,
        rate_limit_per_min: form.rate_limit_per_min,
        allow_confidential: form.allow_confidential,
        acts_as_user_id: form.acts_as_user_id || undefined,
        allowed_ips:  ips.length ? ips : undefined,
      }
      const res = await api.post('/api-keys', payload)
      setNewKey(res.data.key)
      setShowForm(false)
      setForm({ name: '', description: '', kb_ids: [], expires_at: '', scopes: defaultScopes, rate_limit_per_min: 60, allow_confidential: false, acts_as_user_id: null, allowed_ips: '' })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  const toggleActive = async (k: ApiKey) => {
    try {
      await api.patch(`/api-keys/${k.id}`, { is_active: k.is_active ? 0 : 1 })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('確定刪除此 API 金鑰?此操作無法復原(用量紀錄也會一起清掉)。')) return
    try {
      await api.delete(`/api-keys/${id}`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  const openUsage = async (k: ApiKey) => {
    setUsageOpen({ key: k, data: null })
    try {
      const res = await api.get(`/api-keys/${k.id}/usage`, { params: { days: 7, limit: 50 } })
      setUsageOpen({ key: k, data: res.data })
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
      setUsageOpen(null)
    }
  }

  const copyKey = () => {
    if (!newKey) return
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const toggleKb = (id: string) => {
    setForm((f) => ({
      ...f,
      kb_ids: f.kb_ids.includes(id) ? f.kb_ids.filter((x) => x !== id) : [...f.kb_ids, id],
    }))
  }

  const toggleScope = (key: string) => {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(key) ? f.scopes.filter((x) => x !== key) : [...f.scopes, key],
    }))
  }

  const externalBase = `${window.location.protocol}//${window.location.hostname}${window.location.port ? `:${window.location.port.replace('5173', '3007')}` : ''}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">外部 API 金鑰管理</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            API 端點:<code className="bg-slate-100 px-1 rounded">{externalBase}/api/v1</code>
            <a href={`${externalBase}/api/v1/openapi.json`} target="_blank" rel="noopener" className="ml-2 text-blue-600 hover:underline">查看 OpenAPI</a>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => { setShowForm(true); setNewKey(null) }}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
          >
            <Plus size={15} /> 新增金鑰
          </button>
        </div>
      </div>

      {/* API Docs hint */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-1">
        <p className="font-semibold text-slate-700 mb-2">API 使用說明</p>
        <p>在 HTTP Header 加入:<code className="bg-white border border-slate-200 px-1 rounded">Authorization: Bearer {'<your-api-key>'}</code></p>
        <div className="mt-2 space-y-1">
          <p><span className="text-green-700 font-mono">GET</span>  <code>{externalBase}/api/v1/openapi.json</code> — 自描述(無需驗證)</p>
          <p><span className="text-green-700 font-mono">GET</span>  <code>{externalBase}/api/v1/kb/list</code> <span className="text-slate-400">(scope kb:read)</span> — 列出可存取的知識庫(含 doc/chunk count、tags、保密旗標)</p>
          <p><span className="text-blue-700 font-mono">POST</span> <code>{externalBase}/api/v1/kb/search</code> <span className="text-slate-400">(scope kb:search)</span> — body: <code>{'{ kb_id, query, top_k? }'}</code>;結果含 image_ids</p>
          <p><span className="text-blue-700 font-mono">POST</span> <code>{externalBase}/api/v1/kb/chat</code> <span className="text-slate-400">(scope kb:chat)</span> — body: <code>{'{ kb_id, question, model? }'}</code>;回傳 answer + image_ids</p>
          <p><span className="text-blue-700 font-mono">POST</span> <code>{externalBase}/api/v1/kb/images/list</code> <span className="text-slate-400">(scope kb:image:read)</span> — body: <code>{'{ kb_id, limit?, offset? }'}</code></p>
          <p><span className="text-green-700 font-mono">GET</span>  <code>{externalBase}/api/v1/kb/images/:imageId</code> <span className="text-slate-400">(scope kb:image:read)</span> — 直接回圖片二進位</p>
          <p className="pt-2 border-t border-slate-200 mt-1 text-rose-600 font-medium">— 以下為寫入端點,必須綁 Acts As User —</p>
          <p><span className="text-amber-700 font-mono">PUT</span>    <code>{externalBase}/api/v1/kb/:kbId</code> <span className="text-slate-400">(scope kb:settings:write)</span> — 改 KB 設定(切 is_confidential 須額外 kb:confidential:write)</p>
          <p><span className="text-amber-700 font-mono">POST</span>   <code>{externalBase}/api/v1/kb/:kbId/documents</code> <span className="text-slate-400">(scope kb:document:write)</span> — multipart files[]</p>
          <p><span className="text-rose-700 font-mono">DELETE</span> <code>{externalBase}/api/v1/kb/:kbId/documents/:docId</code> <span className="text-slate-400">(scope kb:document:write)</span></p>
          <p><span className="text-amber-700 font-mono">POST</span>   <code>{externalBase}/api/v1/kb/:kbId/documents/:docId/reparse</code> <span className="text-slate-400">(scope kb:document:write)</span> — body: <code>{'{ parse_mode?, pdf_ocr_mode?, extract_images? }'}</code></p>
          <p><span className="text-amber-700 font-mono">POST</span>   <code>{externalBase}/api/v1/kb/:kbId/images</code> <span className="text-slate-400">(scope kb:image:write)</span> — multipart files[]</p>
          <p><span className="text-amber-700 font-mono">PATCH</span>  <code>{externalBase}/api/v1/kb/:kbId/images/:imageId</code> <span className="text-slate-400">(scope kb:image:write)</span> — body: <code>{'{ caption }'}</code>(自動重 embed)</p>
          <p><span className="text-rose-700 font-mono">DELETE</span> <code>{externalBase}/api/v1/kb/:kbId/images/:imageId</code> <span className="text-slate-400">(scope kb:image:write)</span></p>
          <p><span className="text-rose-700 font-mono">POST</span>   <code>{externalBase}/api/v1/kb/:kbId/images/batch-delete</code> <span className="text-slate-400">(scope kb:image:write)</span> — body: <code>{'{ ids: string[] }'}</code></p>
          <p><span className="text-amber-700 font-mono">POST</span>   <code>{externalBase}/api/v1/kb/:kbId/images/:imageId/retry-caption</code> <span className="text-slate-400">(scope kb:image:write)</span></p>
        </div>
        <div className="mt-3 space-y-1 text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          <p><strong>⚠ 保密 KB 規則:</strong></p>
          <p>1. 讀取 — API key 須勾「允許保密 KB」(allow_confidential=1)</p>
          <p>2. 寫入 — Acts As User 須被 KB owner 加入共享(permission=edit)</p>
          <p>3. 切換 is_confidential — Acts As User 必須是 KB owner,且需要 kb:confidential:write scope</p>
        </div>
      </div>

      {/* One-time key display */}
      {newKey && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
            <Key size={15} /> API 金鑰已建立(請立即複製,此後將無法再查看)
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800 break-all">
              {newKey}
            </code>
            <button
              onClick={copyKey}
              className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? '已複製' : '複製'}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-green-700 hover:underline">
            已複製,關閉提示
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-slate-700 text-sm">新增 API 金鑰</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-slate-500 mb-1 block">名稱 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例:外部系統 A"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-slate-500 mb-1 block">到期日(選填)</label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">描述(選填)</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="用途說明"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-slate-500 mb-1 block">每分鐘呼叫上限</label>
              <input
                type="number" min={0}
                value={form.rate_limit_per_min}
                onChange={(e) => setForm((f) => ({ ...f, rate_limit_per_min: Number(e.target.value) || 0 }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">0 = 不限制</p>
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-slate-500 mb-1 block">允許保密 KB</label>
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allow_confidential}
                  onChange={(e) => setForm((f) => ({ ...f, allow_confidential: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                <Lock size={14} className="text-amber-500" />
                <span className="text-sm text-slate-700">允許此金鑰存取保密知識庫</span>
              </label>
            </div>
          </div>

          {/* Scopes - 分群 read/write */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 mb-2 block">讀取 Scopes</label>
              <div className="flex flex-wrap gap-3">
                {scopes.filter((s) => !s.write).map((s) => (
                  <label key={s.key} className="flex items-start gap-2 cursor-pointer p-2 rounded border border-slate-200 hover:bg-slate-50 min-w-60 flex-1">
                    <input
                      type="checkbox"
                      checked={form.scopes.includes(s.key)}
                      onChange={() => toggleScope(s.key)}
                      className="mt-0.5 rounded border-slate-300"
                    />
                    <span>
                      <span className="block text-sm text-slate-700 font-medium">{s.label}</span>
                      <span className="block text-xs text-slate-400">{s.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-rose-600 mb-2 flex items-center gap-1"><AlertTriangle size={12}/>寫入 Scopes(需綁定 Acts As User)</label>
              <div className="flex flex-wrap gap-3">
                {scopes.filter((s) => s.write).map((s) => (
                  <label key={s.key} className={`flex items-start gap-2 cursor-pointer p-2 rounded border min-w-60 flex-1 ${form.scopes.includes(s.key) ? 'border-rose-300 bg-rose-50' : 'border-slate-200 hover:bg-rose-50/30'}`}>
                    <input
                      type="checkbox"
                      checked={form.scopes.includes(s.key)}
                      onChange={() => toggleScope(s.key)}
                      className="mt-0.5 rounded border-slate-300"
                    />
                    <span>
                      <span className="block text-sm text-slate-700 font-medium">{s.label}</span>
                      <span className="block text-xs text-slate-400">{s.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Acts As User(寫入必填)*/}
          <div className={hasWriteScope ? 'p-3 border-2 border-rose-200 bg-rose-50/30 rounded-lg' : ''}>
            <label className="text-xs text-slate-500 mb-1 flex items-center gap-1.5">
              <UserCog size={13} className={hasWriteScope ? 'text-rose-500' : 'text-slate-400'} />
              Acts As User(service account){hasWriteScope && <span className="text-rose-600 font-semibold">* 必填</span>}
            </label>
            <select
              value={form.acts_as_user_id || ''}
              onChange={(e) => setForm((f) => ({ ...f, acts_as_user_id: e.target.value ? Number(e.target.value) : null }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 不綁(只能讀)—</option>
              {bindableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.username}){u.dept_name ? ` · ${u.dept_name}` : ''}{u.role === 'admin' ? ' [admin]' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              所有寫入操作會記錄為此 user 的動作。KB owner 須將此 user 加入共享(permission=edit)才能寫入該 KB。
            </p>
          </div>

          {/* Allowed IPs */}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">允許來源 IP(選填,空白 = 不限)</label>
            <textarea
              value={form.allowed_ips}
              onChange={(e) => setForm((f) => ({ ...f, allowed_ips: e.target.value }))}
              placeholder="10.8.0.0/16&#10;192.168.1.5"
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">支援單一 IP 或 CIDR(IPv4/IPv6),一行一個或以空白/逗號分隔。</p>
          </div>

          {kbs.length > 0 && (
            <div>
              <label className="text-xs text-slate-500 mb-2 block">
                可存取知識庫(不選 = 全部)
              </label>
              <div className="flex flex-wrap gap-2">
                {kbs.map((kb) => (
                  <label key={kb.id} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.kb_ids.includes(kb.id)}
                      onChange={() => toggleKb(kb.id)}
                      className="rounded border-slate-300"
                    />
                    <span className="text-sm text-slate-700">
                      {kb.name}
                      {kb.is_confidential && <Lock size={12} className="inline ml-1 text-amber-500" />}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!form.name.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              建立金鑰
            </button>
          </div>
        </div>
      )}

      {/* Keys table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">名稱</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">前綴</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Scopes</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Acts As</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">KB</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">限速</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">保密</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">狀態</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">24h</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">到期日</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">最後使用</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={12} className="text-center py-8 text-slate-400">載入中...</td></tr>
            )}
            {!loading && keys.length === 0 && (
              <tr><td colSpan={12} className="text-center py-8 text-slate-400">尚無 API 金鑰</td></tr>
            )}
            {!loading && keys.map((k) => {
              let kbLabel = '(全部)'
              if (k.kb_ids) {
                try {
                  const arr = JSON.parse(k.kb_ids)
                  if (Array.isArray(arr) && !arr.includes('*')) {
                    const names = arr.map((id: any) => kbs.find((kb) => String(kb.id) === String(id))?.name || `#${id}`)
                    kbLabel = names.join(', ')
                  }
                } catch { /* ignore */ }
              }
              let scopeLabels: string[] = []
              try {
                const arr = JSON.parse(k.scopes || '[]')
                scopeLabels = Array.isArray(arr) ? arr : []
              } catch {}
              const isExpired = k.expires_at && new Date(k.expires_at) < new Date()
              const rpm = k.rate_limit_per_min ?? 0
              return (
                <tr key={k.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{k.name}</p>
                    {k.description && <p className="text-xs text-slate-400 truncate max-w-40">{k.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-slate-100 px-2 py-0.5 rounded font-mono">{k.key_prefix}...</code>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-40">
                    <div className="flex flex-wrap gap-1">
                      {scopeLabels.map((s) => {
                        const isWrite = scopes.find((sc) => sc.key === s)?.write
                        return (
                          <span key={s} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${isWrite ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'}`}>{s}</span>
                        )
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {k.acts_as_user_id
                      ? <span className="inline-flex items-center gap-1 text-slate-700"><UserCog size={11}/>{k.acts_as_name || k.acts_as_username || `#${k.acts_as_user_id}`}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-32 truncate" title={kbLabel}>{kbLabel}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{rpm > 0 ? `${rpm}/分` : '不限'}</td>
                  <td className="px-4 py-3">
                    {k.allow_confidential
                      ? <span className="inline-flex items-center gap-0.5 text-amber-600 text-xs"><Lock size={11}/>允許</span>
                      : <span className="text-xs text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(k)} className="flex items-center gap-1.5 text-xs transition">
                      {k.is_active && !isExpired
                        ? <><ToggleRight size={18} className="text-green-500" /><span className="text-green-600">啟用</span></>
                        : <><ToggleLeft  size={18} className="text-slate-400" /><span className="text-slate-400">{isExpired ? '已到期' : '停用'}</span></>
                      }
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                    <button onClick={() => openUsage(k)} className="hover:underline text-blue-600">
                      {k.req_24h || 0} 次
                    </button>
                    {(k.err_24h || 0) > 0 && <span className="ml-1 text-rose-500">({k.err_24h} 錯)</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {k.expires_at ? fmtDateTW(k.expires_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {k.last_used_at ? fmtTW(k.last_used_at) : '從未使用'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openUsage(k)}
                        className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition"
                        title="用量明細"
                      >
                        <BarChart3 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(k.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        title="刪除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Usage modal */}
      {usageOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setUsageOpen(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white">
              <h3 className="font-semibold text-slate-800">用量明細:{usageOpen.key.name}</h3>
              <button onClick={() => setUsageOpen(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              {!usageOpen.data && <p className="text-sm text-slate-400">載入中...</p>}
              {usageOpen.data && (
                <>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">過去 {usageOpen.data.days} 天總覽</h4>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                      <Stat label="請求數"   value={usageOpen.data.summary.req_total} />
                      <Stat label="錯誤數"   value={usageOpen.data.summary.req_errors} color={usageOpen.data.summary.req_errors > 0 ? 'text-rose-600' : ''} />
                      <Stat label="輸入 tok" value={usageOpen.data.summary.tokens_in} />
                      <Stat label="輸出 tok" value={usageOpen.data.summary.tokens_out} />
                      <Stat label="流量 KB"  value={Math.round(usageOpen.data.summary.bytes_out / 1024)} />
                      <Stat label="平均 ms"  value={usageOpen.data.summary.avg_ms} />
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">依端點分布</h4>
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-slate-500">
                        <th className="py-2">Endpoint</th>
                        <th className="py-2">Method</th>
                        <th className="py-2">次數</th>
                        <th className="py-2">錯誤</th>
                      </tr></thead>
                      <tbody>
                        {usageOpen.data.by_endpoint.map((r, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="py-2"><code className="text-xs">{r.endpoint}</code></td>
                            <td className="py-2 text-xs text-slate-500">{r.method}</td>
                            <td className="py-2">{r.cnt}</td>
                            <td className={`py-2 ${r.errs > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{r.errs}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">最近 {usageOpen.data.recent.length} 筆</h4>
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-xs text-slate-500">
                        <th className="py-2 pr-2">時間</th>
                        <th className="py-2 pr-2">Endpoint</th>
                        <th className="py-2 pr-2">狀態</th>
                        <th className="py-2 pr-2">耗時</th>
                        <th className="py-2 pr-2">Tok</th>
                        <th className="py-2 pr-2">Acts As</th>
                        <th className="py-2 pr-2">IP</th>
                        <th className="py-2 pr-2">KB / 資源</th>
                        <th className="py-2 pr-2">錯誤</th>
                      </tr></thead>
                      <tbody>
                        {usageOpen.data.recent.map((r, i) => (
                          <tr key={i} className="border-t border-slate-100 align-top">
                            <td className="py-1.5 pr-2 text-slate-500 whitespace-nowrap">{r.called_at}</td>
                            <td className="py-1.5 pr-2"><code>{r.method} {r.endpoint}</code></td>
                            <td className={`py-1.5 pr-2 ${r.status_code >= 400 ? 'text-rose-600' : 'text-emerald-600'}`}>{r.status_code}</td>
                            <td className="py-1.5 pr-2">{r.duration_ms}ms</td>
                            <td className="py-1.5 pr-2 text-slate-500">{r.tokens_in}/{r.tokens_out}</td>
                            <td className="py-1.5 pr-2 text-slate-600">{r.acts_as_name || r.acts_as_username || '—'}</td>
                            <td className="py-1.5 pr-2 text-slate-500 font-mono">{r.client_ip || '—'}</td>
                            <td className="py-1.5 pr-2 text-slate-600 max-w-40">
                              {r.kb_name && <div className="truncate" title={r.kb_name}>{r.kb_name}</div>}
                              {r.resource_id && <div className="text-slate-400 truncate" title={r.resource_id}>{r.resource_id}</div>}
                              {!r.kb_name && !r.resource_id && '—'}
                            </td>
                            <td className="py-1.5 pr-2 text-rose-600 max-w-40 truncate" title={r.error_message || ''}>{r.error_message || ''}</td>
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
      )}
    </div>
  )
}

function Stat({ label, value, color = '' }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-semibold ${color || 'text-slate-800'}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}
