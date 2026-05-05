import { useEffect, useState, useCallback } from 'react'
import { Megaphone, Plus, Edit, Archive, Trash2, Languages, X, Search, Filter, RotateCcw, Send, FileEdit } from 'lucide-react'
import api from '../../lib/api'

type Level = 'info' | 'notice' | 'warning' | 'critical'
type Status = 'draft' | 'active' | 'archived'
type GranteeType = 'user' | 'role' | 'factory' | 'department' | 'cost_center' | 'division' | 'org_group'
type Lang = 'zh-TW' | 'en' | 'vi'

interface AnnouncementListItem {
  id: number
  level: Level
  status: Status
  dismissible: number
  audience_mode: 'all' | 'targeted'
  revision: number
  effective_from: string
  effective_to: string | null
  title_zh: string | null
  title_local: string | null
  audience_count: number
  dismiss_count: number
  created_at: string
  created_by: number | null
  created_by_name: string | null
  created_by_username: string | null
}

interface ListResponse {
  rows: AnnouncementListItem[]
  total: number
  limit: number
  offset: number
}

interface FilterState {
  status: Status | 'all'
  level: Level | 'all'
  q: string
  audience_mode: 'all' | 'targeted' | ''
  created_from: string
  created_to: string
}

const EMPTY_FILTER: FilterState = {
  status: 'active',
  level: 'all',
  q: '',
  audience_mode: '',
  created_from: '',
  created_to: '',
}

interface Translation { lang: string; title: string; body: string; updated_at?: string }
interface Audience { grantee_type: GranteeType; grantee_id: string }
interface AnnouncementDetail {
  id: number
  level: Level
  status: Status
  dismissible: number
  audience_mode: 'all' | 'targeted'
  revision: number
  effective_from: string
  effective_to: string | null
  translations: Translation[]
  audiences: Audience[]
}

interface User { id: number; username: string; name: string }
interface Role { id: number; name: string }

const LEVELS: { value: Level; label: string; cls: string }[] = [
  { value: 'info',     label: '資訊(走鈴鐺)',         cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  { value: 'notice',   label: '佈達(藍色 banner)',     cls: 'bg-cyan-50 text-cyan-700 border-cyan-300' },
  { value: 'warning',  label: '警告(橘色 banner)',     cls: 'bg-amber-50 text-amber-700 border-amber-300' },
  { value: 'critical', label: '緊急(紅色強制 banner)', cls: 'bg-red-50 text-red-700 border-red-300' },
]

const levelDot = (lv: Level) => ({
  critical: 'bg-red-500',
  warning:  'bg-amber-500',
  notice:   'bg-cyan-500',
  info:     'bg-slate-400',
})[lv]

const isoLocalForInput = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const tz = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - tz).toISOString().slice(0, 16)
}

export default function AnnouncementsAdmin() {
  const [list, setList] = useState<AnnouncementListItem[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [appliedFilter, setAppliedFilter] = useState<FilterState>(EMPTY_FILTER)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<AnnouncementDetail | 'new' | null>(null)
  const PAGE_SIZE = 100

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { limit: PAGE_SIZE, offset: 0 }
      if (appliedFilter.status !== 'all')      params.status = appliedFilter.status
      if (appliedFilter.level !== 'all')       params.level = appliedFilter.level
      if (appliedFilter.q.trim())              params.q = appliedFilter.q.trim()
      if (appliedFilter.audience_mode)         params.audience_mode = appliedFilter.audience_mode
      if (appliedFilter.created_from)          params.created_from = new Date(appliedFilter.created_from).toISOString()
      if (appliedFilter.created_to)            params.created_to   = new Date(appliedFilter.created_to).toISOString()
      const { data } = await api.get<ListResponse>('/announcements/admin', { params })
      setList(data.rows || [])
      setTotal(Number(data.total || 0))
    } catch (e: any) {
      alert('載入公告失敗: ' + (e?.response?.data?.error || e.message))
    } finally {
      setLoading(false)
    }
  }, [appliedFilter])

  useEffect(() => { load() }, [load])

  const applyFilter = () => setAppliedFilter(filter)
  const resetFilter = () => { setFilter(EMPTY_FILTER); setAppliedFilter(EMPTY_FILTER) }

  const handleArchive = async (id: number) => {
    if (!confirm('確定要下架這則公告嗎?(下架後使用者端立即看不到,但完整保留歷史紀錄供日後查詢)')) return
    try {
      await api.post(`/announcements/admin/${id}/archive`)
      await load()
    } catch (e: any) { alert('下架失敗: ' + (e?.response?.data?.error || e.message)) }
  }

  const handlePublish = async (id: number) => {
    if (!confirm('確定要發布這則草稿公告嗎?\n\n發布後使用者端立即看到。如果尚未翻譯 en/vi,使用者切到該語言會看到 zh-TW 原文。')) return
    try {
      await api.post(`/announcements/admin/${id}/publish`)
      await load()
    } catch (e: any) { alert('發布失敗: ' + (e?.response?.data?.error || e.message)) }
  }

  /** 永久刪除 — 走兩段確認,使用者要打字驗證 ID,避免手滑誤刪 */
  const handleDelete = async (a: AnnouncementListItem) => {
    const title = a.title_zh || `公告 #${a.id}`
    const first = confirm(
      `永久刪除以下公告?\n\n` +
      `  ID:${a.id}\n` +
      `  標題:${title}\n` +
      `  狀態:${a.status === 'active' ? '上架中' : '已下架'}\n\n` +
      `★ 刪除後將無法復原(連同三語翻譯、受眾設定、所有 user 已讀紀錄一併清除)\n` +
      `★ 一般情況請改用「下架」即可,只在確定不需保留歷史的舊公告才用刪除。`
    )
    if (!first) return
    const typed = prompt(`請輸入此公告的 ID(${a.id})以確認永久刪除:`)
    if (!typed || typed.trim() !== String(a.id)) {
      alert('ID 不符,已取消刪除')
      return
    }
    try {
      await api.delete(`/announcements/admin/${a.id}`)
      await load()
    } catch (e: any) {
      alert('刪除失敗: ' + (e?.response?.data?.error || e.message))
    }
  }

  const openEdit = async (id: number) => {
    try {
      const { data } = await api.get<AnnouncementDetail>(`/announcements/admin/${id}`)
      setEditing(data)
    } catch (e: any) { alert('載入失敗: ' + (e?.response?.data?.error || e.message)) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-700">
          <Megaphone size={20} className="text-cyan-600" />
          <h2 className="text-lg font-semibold">系統公告</h2>
          <span className="text-xs text-slate-500">— 全站發布訊息給使用者(支援三語、四種重要度、受眾控制、可下架)</span>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-sm px-3 py-1.5 rounded-lg transition"
        >
          <Plus size={14} /> 新增公告
        </button>
      </div>

      {/* ── 查詢工具列 ──────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <Filter size={14} className="text-slate-400" />
          <span className="text-slate-500 font-medium">篩選</span>
          <span className="text-slate-400">— 公告下架後仍永久保留,可隨時用此檢索歷史紀錄</span>
          <button
            onClick={resetFilter}
            className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-600"
          >
            <RotateCcw size={11} /> 重設
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {/* 關鍵字 */}
          <div className="md:col-span-2 relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={filter.q}
              onChange={e => setFilter({ ...filter, q: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') applyFilter() }}
              placeholder="搜尋標題或內文(zh-TW)"
              className="w-full text-xs border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          {/* 狀態 */}
          <select
            value={filter.status}
            onChange={e => setFilter({ ...filter, status: e.target.value as any })}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="active">上架中</option>
            <option value="draft">草稿(尚未發布)</option>
            <option value="archived">已下架</option>
            <option value="all">全部</option>
          </select>

          {/* 等級 */}
          <select
            value={filter.level}
            onChange={e => setFilter({ ...filter, level: e.target.value as any })}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="all">全部等級</option>
            <option value="critical">緊急(紅)</option>
            <option value="warning">警告(橘)</option>
            <option value="notice">佈達(藍)</option>
            <option value="info">資訊(灰)</option>
          </select>

          {/* 受眾 */}
          <select
            value={filter.audience_mode}
            onChange={e => setFilter({ ...filter, audience_mode: e.target.value as any })}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="">不分受眾</option>
            <option value="all">全員公告</option>
            <option value="targeted">特定對象</option>
          </select>

          {/* 建立區間 from */}
          <div>
            <label className="text-[10px] text-slate-400 block">建立日期從</label>
            <input
              type="date"
              value={filter.created_from}
              onChange={e => setFilter({ ...filter, created_from: e.target.value })}
              className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5"
            />
          </div>
          {/* 建立區間 to */}
          <div>
            <label className="text-[10px] text-slate-400 block">建立日期到</label>
            <input
              type="date"
              value={filter.created_to}
              onChange={e => setFilter({ ...filter, created_to: e.target.value })}
              className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5"
            />
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              onClick={applyFilter}
              className="ml-auto bg-cyan-600 hover:bg-cyan-700 text-white text-xs px-4 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <Search size={12} /> 套用查詢
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {loading ? '查詢中…' :
            total === 0 ? '無符合條件的公告'
            : list.length < total ? `顯示前 ${list.length} 筆,共 ${total} 筆`
            : `共 ${total} 筆`}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-3 py-2 text-left">等級</th>
              <th className="px-3 py-2 text-left">標題</th>
              <th className="px-3 py-2 text-left">狀態</th>
              <th className="px-3 py-2 text-left">受眾</th>
              <th className="px-3 py-2 text-left">有效期</th>
              <th className="px-3 py-2 text-left">建立時間</th>
              <th className="px-3 py-2 text-left">發布者</th>
              <th className="px-3 py-2 text-right">已關閉</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400">載入中…</td></tr>
            )}
            {!loading && list.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400">無符合條件的公告</td></tr>
            )}
            {!loading && list.map(a => {
              const expired = a.effective_to && new Date(a.effective_to) < new Date()
              return (
                <tr key={a.id} className={`border-t border-slate-100 hover:bg-slate-50 ${a.status === 'archived' ? 'opacity-60' : a.status === 'draft' ? 'bg-amber-50/30' : ''}`}>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${levelDot(a.level)}`} />
                      <span className="text-xs text-slate-600">{a.level}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-800 max-w-md truncate">{a.title_zh || '(未設定 zh-TW 標題)'}</td>
                  <td className="px-3 py-2">
                    {a.status === 'active' && (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">上架中</span>
                    )}
                    {a.status === 'draft' && (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">草稿</span>
                    )}
                    {a.status === 'archived' && (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">已下架</span>
                    )}
                    {expired && a.status === 'active' && (
                      <span className="ml-1 text-[10px] text-amber-600">已過期</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {a.audience_mode === 'all' ? '全員' : `特定 ${a.audience_count}`}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {a.effective_to ? new Date(a.effective_to).toLocaleString() : '永久'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {a.created_by_username
                      ? <span title={a.created_by_name || ''}>{a.created_by_username}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 text-right">{a.dismiss_count}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => openEdit(a.id)} className="p-1.5 text-slate-500 hover:text-cyan-600 hover:bg-cyan-50 rounded" title={a.status === 'archived' ? '檢視 / 內容回查' : '編輯 / 翻譯'}>
                        <Edit size={14} />
                      </button>
                      {a.status === 'draft' && (
                        <button onClick={() => handlePublish(a.id)} className="p-1.5 text-slate-500 hover:text-cyan-600 hover:bg-cyan-50 rounded" title="發布(從草稿上架)">
                          <Send size={14} />
                        </button>
                      )}
                      {a.status === 'active' && (
                        <button onClick={() => handleArchive(a.id)} className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded" title="下架(保留歷史)">
                          <Archive size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(a)}
                        className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded"
                        title="永久刪除(無法復原,僅清理不重要舊公告用)"
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

      {editing && (
        <AnnouncementEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

// ── Editor Modal ─────────────────────────────────────────────────────────────

function AnnouncementEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: AnnouncementDetail | null
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !initial
  const zh = initial?.translations.find(t => t.lang === 'zh-TW')
  const en = initial?.translations.find(t => t.lang === 'en')
  const vi = initial?.translations.find(t => t.lang === 'vi')

  const [level, setLevel] = useState<Level>(initial?.level || 'notice')
  const [dismissible, setDismissible] = useState<boolean>(initial ? Number(initial.dismissible) === 1 : true)
  const [effectiveFrom, setEffectiveFrom] = useState(isoLocalForInput(initial?.effective_from) || isoLocalForInput(new Date().toISOString()))
  const [effectiveTo, setEffectiveTo] = useState(isoLocalForInput(initial?.effective_to))
  const [audienceMode, setAudienceMode] = useState<'all' | 'targeted'>(initial?.audience_mode || 'all')
  const [audiences, setAudiences] = useState<Audience[]>(initial?.audiences || [])
  const [bumpRevision, setBumpRevision] = useState(false)

  const [titleZh, setTitleZh] = useState(zh?.title || '')
  const [bodyZh, setBodyZh]   = useState(zh?.body || '')
  const [titleEn, setTitleEn] = useState(en?.title || '')
  const [bodyEn, setBodyEn]   = useState(en?.body || '')
  const [titleVi, setTitleVi] = useState(vi?.title || '')
  const [bodyVi, setBodyVi]   = useState(vi?.body || '')

  const [activeLang, setActiveLang] = useState<Lang>('zh-TW')
  const [saving, setSaving] = useState<null | 'draft' | 'publish'>(null)
  const [translating, setTranslating] = useState<Lang | null>(null)

  // 編輯既有公告時的當前狀態(會用來決定按鈕文字)
  // - 新增:isNew=true,固定走 draft / publish 兩動作
  // - 編輯 draft:儲存草稿變動 / 發布
  // - 編輯 active:儲存變更(維持 active) / 退回草稿
  // - 編輯 archived:只能儲存變更(維持 archived)
  const currentStatus: Status | null = isNew ? null : initial!.status

  /**
   * @param mode 'draft' = 儲存草稿(user 端不可見) / 'publish' = 儲存並發布上架 / 'asis' = 維持當前 status
   */
  const handleSave = async (mode: 'draft' | 'publish' | 'asis') => {
    if (!titleZh.trim()) { alert('請填寫繁體中文標題'); return }
    setSaving(mode === 'publish' ? 'publish' : 'draft')
    try {
      // 決定送出的 status:
      //   - new + draft → 'draft'
      //   - new + publish → 直接 'active'
      //   - edit + draft → 'draft'(active 退回草稿)
      //   - edit + publish → 'active'(草稿發布)
      //   - edit + asis → 不送 status,由後端維持
      let statusToSend: Status | undefined
      if (mode === 'draft') statusToSend = 'draft'
      else if (mode === 'publish') statusToSend = 'active'
      else statusToSend = undefined

      let id: number
      if (isNew) {
        const { data } = await api.post('/announcements/admin', {
          level, dismissible: dismissible ? 1 : 0,
          status: statusToSend || 'draft',
          effective_from: effectiveFrom ? new Date(effectiveFrom).toISOString() : null,
          effective_to:   effectiveTo   ? new Date(effectiveTo).toISOString()   : null,
          audience_mode: audienceMode,
          audiences: audienceMode === 'targeted' ? audiences : [],
          title: titleZh, body: bodyZh,
        })
        id = data.id
      } else {
        id = initial!.id
        const payload: any = {
          level, dismissible: dismissible ? 1 : 0,
          effective_from: effectiveFrom ? new Date(effectiveFrom).toISOString() : null,
          effective_to:   effectiveTo   ? new Date(effectiveTo).toISOString()   : null,
          audience_mode: audienceMode,
          audiences: audienceMode === 'targeted' ? audiences : [],
          title: titleZh, body: bodyZh,
          bumpRevision,
        }
        if (statusToSend) payload.status = statusToSend
        await api.put(`/announcements/admin/${id}`, payload)
      }
      // 個別存 en / vi 翻譯(只在內容非空時寫入)
      if (titleEn || bodyEn) {
        await api.put(`/announcements/admin/${id}/translations/en`, { title: titleEn, body: bodyEn })
      }
      if (titleVi || bodyVi) {
        await api.put(`/announcements/admin/${id}/translations/vi`, { title: titleVi, body: bodyVi })
      }
      onSaved()
    } catch (e: any) {
      alert('儲存失敗: ' + (e?.response?.data?.error || e.message))
    } finally {
      setSaving(null)
    }
  }

  const handleTranslate = async (lang: 'en' | 'vi') => {
    if (isNew) { alert('請先儲存才能翻譯'); return }
    if (!titleZh.trim()) { alert('請先填寫繁體中文標題'); return }
    setTranslating(lang)
    try {
      // 先儲存當前 zh-TW
      await api.put(`/announcements/admin/${initial!.id}`, { title: titleZh, body: bodyZh })
      const { data } = await api.post(`/announcements/admin/${initial!.id}/translate`, { lang })
      if (lang === 'en') { setTitleEn(data.title); setBodyEn(data.body || '') }
      if (lang === 'vi') { setTitleVi(data.title); setBodyVi(data.body || '') }
    } catch (e: any) {
      alert('翻譯失敗: ' + (e?.response?.data?.error || e.message))
    } finally {
      setTranslating(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Megaphone size={18} className="text-cyan-600" />
            {isNew ? '新增公告' : '編輯公告'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Level */}
          <div>
            <label className="text-xs text-slate-600 font-medium mb-1.5 block">重要程度</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {LEVELS.map(L => (
                <button
                  key={L.value}
                  onClick={() => setLevel(L.value)}
                  className={`text-xs px-3 py-2 rounded-lg border-2 transition ${
                    level === L.value ? `${L.cls} font-semibold` : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {L.label}
                </button>
              ))}
            </div>
            {level === 'critical' && (
              <label className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={!dismissible} onChange={e => setDismissible(!e.target.checked)} />
                強制顯示(使用者不可關閉,只有下架/過期才消失)
              </label>
            )}
          </div>

          {/* Effective dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600 font-medium mb-1 block">生效時間</label>
              <input
                type="datetime-local"
                value={effectiveFrom}
                onChange={e => setEffectiveFrom(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 font-medium mb-1 block">失效時間(留空=永久)</label>
              <input
                type="datetime-local"
                value={effectiveTo}
                onChange={e => setEffectiveTo(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-1.5"
              />
            </div>
          </div>

          {/* Audience */}
          <AudiencePicker mode={audienceMode} setMode={setAudienceMode} audiences={audiences} setAudiences={setAudiences} />

          {/* bumpRevision (僅編輯時) */}
          {!isNew && (
            <label className="inline-flex items-start gap-2 text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <input type="checkbox" checked={bumpRevision} onChange={e => setBumpRevision(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium text-amber-800">重大修訂</span>
                <span className="block text-amber-700 mt-0.5">勾選後 revision +1,所有 user 即使之前按過「不再顯示」也會重新看到此則公告</span>
              </span>
            </label>
          )}

          {/* 三語 tabs */}
          <div>
            <div className="flex items-center gap-1 border-b border-slate-200 mb-3">
              {(['zh-TW', 'en', 'vi'] as const).map(L => (
                <button
                  key={L}
                  onClick={() => setActiveLang(L)}
                  className={`px-3 py-1.5 text-xs border-b-2 -mb-px transition ${
                    activeLang === L
                      ? 'border-cyan-500 text-cyan-700 font-medium'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {L === 'zh-TW' ? '繁體中文(原文)' : L === 'en' ? 'English' : 'Tiếng Việt'}
                </button>
              ))}
              {!isNew && activeLang !== 'zh-TW' && (
                <button
                  onClick={() => handleTranslate(activeLang)}
                  disabled={translating === activeLang}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-cyan-700 hover:bg-cyan-50 px-2 py-1 rounded mb-1"
                >
                  <Languages size={12} />
                  {translating === activeLang ? '翻譯中…' : '從 zh-TW 翻譯'}
                </button>
              )}
            </div>

            {activeLang === 'zh-TW' && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={titleZh}
                  onChange={e => setTitleZh(e.target.value)}
                  placeholder="標題(必填)"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  maxLength={500}
                />
                <textarea
                  value={bodyZh}
                  onChange={e => setBodyZh(e.target.value)}
                  placeholder="內容(可選,支援 markdown)"
                  rows={6}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 font-mono"
                />
              </div>
            )}
            {activeLang === 'en' && (
              <div className="space-y-2">
                <input type="text" value={titleEn} onChange={e => setTitleEn(e.target.value)} placeholder="Title" className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2" />
                <textarea value={bodyEn} onChange={e => setBodyEn(e.target.value)} placeholder="Body (markdown)" rows={6} className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 font-mono" />
                <p className="text-[11px] text-slate-400">提示:點上方「從 zh-TW 翻譯」用 LLM 自動翻;也可手動編輯後按下方「儲存」一併寫入</p>
              </div>
            )}
            {activeLang === 'vi' && (
              <div className="space-y-2">
                <input type="text" value={titleVi} onChange={e => setTitleVi(e.target.value)} placeholder="Tiêu đề" className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2" />
                <textarea value={bodyVi} onChange={e => setBodyVi(e.target.value)} placeholder="Nội dung (markdown)" rows={6} className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 font-mono" />
                <p className="text-[11px] text-slate-400">提示:點上方「從 zh-TW 翻譯」用 LLM 自動翻;也可手動編輯後按下方「儲存」一併寫入</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer — 拆「儲存草稿」/「儲存並發布」兩個動作,讓 admin 可先存稿翻譯再上架 */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
          {!isNew && currentStatus && (
            <span className="text-xs text-slate-500">
              當前狀態:
              {currentStatus === 'draft'    && <span className="ml-1 text-slate-700 font-medium">草稿(user 端看不到)</span>}
              {currentStatus === 'active'   && <span className="ml-1 text-green-700 font-medium">已發布</span>}
              {currentStatus === 'archived' && <span className="ml-1 text-slate-500 font-medium">已下架</span>}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="text-sm px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>

            {/* 新增 / 編輯草稿 → 兩個按鈕並列 */}
            {(isNew || currentStatus === 'draft') && (
              <>
                <button
                  onClick={() => handleSave('draft')}
                  disabled={!!saving}
                  className="text-sm px-3 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5"
                  title="儲存為草稿,user 端不會顯示。可繼續編輯與翻譯"
                >
                  <FileEdit size={13} /> {saving === 'draft' ? '儲存中…' : '儲存草稿'}
                </button>
                <button
                  onClick={() => handleSave('publish')}
                  disabled={!!saving}
                  className="text-sm px-4 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5"
                  title="儲存並立即發布,user 端馬上看到"
                >
                  <Send size={13} /> {saving === 'publish' ? '發布中…' : (isNew ? '儲存並發布' : '發布')}
                </button>
              </>
            )}

            {/* 編輯 active 公告 → 維持 active 儲存 + 可退回草稿 */}
            {currentStatus === 'active' && (
              <>
                <button
                  onClick={() => handleSave('draft')}
                  disabled={!!saving}
                  className="text-sm px-3 py-1.5 border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5"
                  title="退回草稿,user 端立即看不到。修正後再重新發布"
                >
                  <FileEdit size={13} /> 退回草稿
                </button>
                <button
                  onClick={() => handleSave('asis')}
                  disabled={!!saving}
                  className="text-sm px-4 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? '儲存中…' : '儲存變更'}
                </button>
              </>
            )}

            {/* 編輯 archived 公告 → 只能儲存(歷史保留) */}
            {currentStatus === 'archived' && (
              <button
                onClick={() => handleSave('asis')}
                disabled={!!saving}
                className="text-sm px-4 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg disabled:opacity-50"
              >
                {saving ? '儲存中…' : '儲存變更'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Audience Picker ──────────────────────────────────────────────────────────

function AudiencePicker({
  mode, setMode, audiences, setAudiences,
}: {
  mode: 'all' | 'targeted'
  setMode: (m: 'all' | 'targeted') => void
  audiences: Audience[]
  setAudiences: (a: Audience[]) => void
}) {
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (mode === 'targeted' && !loaded) {
      Promise.all([api.get('/users'), api.get('/roles')]).then(([u, r]) => {
        setUsers(Array.isArray(u.data) ? u.data : [])
        setRoles(Array.isArray(r.data) ? r.data : [])
        setLoaded(true)
      }).catch(() => setLoaded(true))
    }
  }, [mode, loaded])

  const has = (type: GranteeType, id: string | number) =>
    audiences.some(a => a.grantee_type === type && a.grantee_id === String(id))

  const toggle = (type: GranteeType, id: string | number) => {
    if (has(type, id)) {
      setAudiences(audiences.filter(a => !(a.grantee_type === type && a.grantee_id === String(id))))
    } else {
      setAudiences([...audiences, { grantee_type: type, grantee_id: String(id) }])
    }
  }

  const filteredUsers = users.filter(u =>
    !search || (u.username + ' ' + (u.name || '')).toLowerCase().includes(search.toLowerCase())
  )

  const userBadges = audiences.filter(a => a.grantee_type === 'user').length
  const roleBadges = audiences.filter(a => a.grantee_type === 'role').length

  return (
    <div>
      <label className="text-xs text-slate-600 font-medium mb-1.5 block">受眾</label>
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setMode('all')}
          className={`text-xs px-3 py-1 rounded-lg border ${
            mode === 'all' ? 'bg-cyan-50 border-cyan-300 text-cyan-700 font-medium' : 'border-slate-200 text-slate-600'
          }`}
        >全員</button>
        <button
          onClick={() => setMode('targeted')}
          className={`text-xs px-3 py-1 rounded-lg border ${
            mode === 'targeted' ? 'bg-cyan-50 border-cyan-300 text-cyan-700 font-medium' : 'border-slate-200 text-slate-600'
          }`}
        >特定使用者/角色 {audiences.length > 0 && `(${audiences.length})`}</button>
      </div>

      {mode === 'targeted' && (
        <div className="border border-slate-200 rounded-lg p-3 space-y-3 max-h-72 overflow-y-auto">
          {/* Roles */}
          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">依角色 {roleBadges > 0 && <span className="text-cyan-600">({roleBadges} 個已選)</span>}</div>
            <div className="flex flex-wrap gap-1.5">
              {roles.length === 0 ? <span className="text-xs text-slate-400">{loaded ? '無角色' : '載入中…'}</span> :
                roles.map(r => (
                  <button
                    key={r.id}
                    onClick={() => toggle('role', r.id)}
                    className={`text-xs px-2 py-1 rounded border ${
                      has('role', r.id)
                        ? 'bg-cyan-100 border-cyan-300 text-cyan-700 font-medium'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >{r.name}</button>
                ))
              }
            </div>
          </div>

          {/* Users */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-slate-700">依使用者 {userBadges > 0 && <span className="text-cyan-600">({userBadges} 個已選)</span>}</span>
              <div className="ml-auto flex items-center gap-1">
                <Search size={11} className="text-slate-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜尋帳號/姓名"
                  className="text-xs border border-slate-200 rounded px-2 py-0.5 w-40"
                />
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto border border-slate-100 rounded p-1 bg-slate-50">
              {filteredUsers.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-2">{loaded ? '無使用者' : '載入中…'}</div>
              ) : filteredUsers.slice(0, 200).map(u => (
                <label key={u.id} className="flex items-center gap-2 text-xs px-2 py-0.5 hover:bg-white rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={has('user', u.id)}
                    onChange={() => toggle('user', u.id)}
                  />
                  <span className="text-slate-700">{u.username}</span>
                  <span className="text-slate-400">{u.name}</span>
                </label>
              ))}
              {filteredUsers.length > 200 && (
                <div className="text-[10px] text-slate-400 px-2 py-1">…還有 {filteredUsers.length - 200} 筆,請用搜尋過濾</div>
              )}
            </div>
          </div>

          <p className="text-[10px] text-slate-400">支援 user/role 兩種受眾。同一公告中任一條件命中該 user 即顯示(OR 關係)。</p>
        </div>
      )}
    </div>
  )
}
