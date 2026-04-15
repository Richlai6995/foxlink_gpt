/**
 * FactoryTranslationsPanel
 *
 * Admin 廠區翻譯管理。
 * zh-TW 從 ERP FND_FLEX_VALUES_VL 唯讀；en / vi 可編輯或 LLM 批次翻譯。
 * 見 docs/factory-share-layer-plan.md §2.3
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Languages, Pencil, Save, X, Loader2, Factory } from 'lucide-react'
import api from '../../lib/api'

interface FactoryItem {
  factory_code: string
  zh_TW: string
  en: string | null
  vi: string | null
  en_updated_at: string | null
  vi_updated_at: string | null
}

interface CacheStatus {
  loaded: boolean
  size: number
  loadedAt: number
  ageMs: number | null
  ttlMs: number
}

export default function FactoryTranslationsPanel() {
  const { t } = useTranslation()
  const [items, setItems] = useState<FactoryItem[]>([])
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [editing, setEditing] = useState<{ code: string; lang: 'en' | 'vi' } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [overwriteMode, setOverwriteMode] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/factory-translations')
      setItems(data.items || [])
      setCacheStatus(data.cache_status || null)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const refreshCache = async () => {
    setRefreshing(true)
    try {
      await api.post('/admin/factory-translations/refresh-cache')
      await load()
    } catch (e) {
      console.error(e)
      alert(t('admin.factoryTrans.refreshFailed', '重刷 ERP 快取失敗'))
    } finally {
      setRefreshing(false)
    }
  }

  const startEdit = (item: FactoryItem, lang: 'en' | 'vi') => {
    setEditing({ code: item.factory_code, lang })
    setEditValue(item[lang] || '')
  }

  const cancelEdit = () => {
    setEditing(null)
    setEditValue('')
  }

  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const trimmed = editValue.trim()
      if (trimmed) {
        await api.put(`/admin/factory-translations/${encodeURIComponent(editing.code)}/${editing.lang}`, {
          factory_name: trimmed,
        })
      } else {
        await api.delete(`/admin/factory-translations/${encodeURIComponent(editing.code)}/${editing.lang}`)
      }
      await load()
      cancelEdit()
    } catch (e) {
      console.error(e)
      alert(t('admin.factoryTrans.saveFailed', '儲存失敗'))
    } finally {
      setSaving(false)
    }
  }

  const llmTranslate = async () => {
    const confirmMsg = overwriteMode
      ? t('admin.factoryTrans.confirmOverwrite', '確定用 LLM 覆寫所有 en/vi 翻譯？')
      : t('admin.factoryTrans.confirmTranslate', '確定用 LLM 批次翻譯缺少的 en/vi？')
    if (!confirm(confirmMsg)) return

    setTranslating(true)
    try {
      const { data } = await api.post('/admin/factory-translations/llm-translate', {
        langs: ['en', 'vi'],
        overwrite: overwriteMode,
      }, { timeout: 300000 })  // 5 min — LLM 批翻可能較慢
      const msg = [
        `en: ${data.translated?.en || 0} 筆, 跳過 ${data.skipped?.en || 0} 筆`,
        `vi: ${data.translated?.vi || 0} 筆, 跳過 ${data.skipped?.vi || 0} 筆`,
      ].join('\n')
      alert(msg)
      await load()
    } catch (e: any) {
      console.error(e)
      alert(`${t('admin.factoryTrans.translateFailed', 'LLM 翻譯失敗')}: ${e?.response?.data?.error || e.message}`)
    } finally {
      setTranslating(false)
    }
  }

  const filtered = items.filter(item => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return item.factory_code.toLowerCase().includes(q) ||
      item.zh_TW.toLowerCase().includes(q) ||
      (item.en || '').toLowerCase().includes(q) ||
      (item.vi || '').toLowerCase().includes(q)
  })

  const formatDate = (s: string | null) => {
    if (!s) return '-'
    try { return new Date(s).toLocaleString() } catch { return s }
  }

  const cacheAge = cacheStatus?.ageMs != null
    ? Math.floor(cacheStatus.ageMs / 1000 / 60)
    : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Factory size={18} className="text-indigo-500" />
          <h2 className="text-lg font-semibold text-slate-800">
            {t('admin.factoryTrans.title', '廠區翻譯管理')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {cacheStatus?.loaded
              ? t('admin.factoryTrans.cacheInfo', `ERP 快取 ${cacheStatus.size} 筆，${cacheAge} 分鐘前載入`)
              : t('admin.factoryTrans.cacheNotLoaded', 'ERP 快取未載入')}
          </span>
          <button
            onClick={refreshCache}
            disabled={refreshing}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {t('admin.factoryTrans.refreshCache', '重刷 ERP 快取')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 bg-slate-50 border rounded p-3">
        <input
          type="text"
          placeholder={t('admin.factoryTrans.searchPlaceholder', '搜尋代碼或名稱...')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:border-blue-400"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={overwriteMode}
            onChange={e => setOverwriteMode(e.target.checked)}
          />
          {t('admin.factoryTrans.overwriteMode', '覆寫已有翻譯')}
        </label>
        <button
          onClick={llmTranslate}
          disabled={translating || !items.length}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {translating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
          {t('admin.factoryTrans.llmTranslate', 'LLM 批次翻譯 en/vi')}
        </button>
      </div>

      <div className="border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-24">
                {t('admin.factoryTrans.col.code', '代碼')}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {t('admin.factoryTrans.col.zhTW', '繁中 (ERP)')}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {t('admin.factoryTrans.col.en', 'English')}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {t('admin.factoryTrans.col.vi', 'Tiếng Việt')}
              </th>
              <th className="px-3 py-2 text-left font-medium w-40">
                {t('admin.factoryTrans.col.updatedAt', '更新時間')}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400">{t('common.loading', '載入中...')}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400">
                {search
                  ? t('admin.factoryTrans.noMatch', '無符合的廠區')
                  : t('admin.factoryTrans.empty', 'ERP 無資料')}
              </td></tr>
            ) : filtered.map(item => (
              <tr key={item.factory_code} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{item.factory_code}</td>
                <td className="px-3 py-2 text-slate-800">{item.zh_TW}</td>
                {(['en', 'vi'] as const).map(lang => (
                  <td key={lang} className="px-3 py-2">
                    {editing?.code === item.factory_code && editing.lang === lang ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          autoFocus
                          className="flex-1 px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none"
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEdit()
                            else if (e.key === 'Escape') cancelEdit()
                          }}
                        />
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="text-green-600 hover:text-green-800 disabled:opacity-50"
                          title={t('common.save', '儲存')}
                        >
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        </button>
                        <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600"
                                title={t('common.cancel', '取消')}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <span className={item[lang] ? 'text-slate-800' : 'text-slate-400 italic'}>
                          {item[lang] || t('admin.factoryTrans.notTranslated', '(未翻譯)')}
                        </span>
                        <button
                          onClick={() => startEdit(item, lang)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600"
                          title={t('common.edit', '編輯')}
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-xs text-slate-500">
                  <div>en: {formatDate(item.en_updated_at)}</div>
                  <div>vi: {formatDate(item.vi_updated_at)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-500">
        {t('admin.factoryTrans.footerHint', 'zh-TW 名稱來自 ERP FND_FLEX_VALUES_VL (flex value set 1008041)，唯讀；en / vi 為本地翻譯。')}
      </div>
    </div>
  )
}
