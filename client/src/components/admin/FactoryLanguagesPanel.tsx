import { useState, useEffect } from 'react'
import { Plus, Trash2, Globe } from 'lucide-react'
import api from '../../lib/api'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../../i18n'

interface FactoryLanguage {
  factory_code: string
  language_code: string
  updated_at: string
}

export default function FactoryLanguagesPanel() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<FactoryLanguage[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ factory_code: '', language_code: 'zh-TW' })
  const [error, setError] = useState('')
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editLang, setEditLang] = useState('zh-TW')

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/admin/factory-languages')
      setRows(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/admin/factory-languages', form)
      setForm({ factory_code: '', language_code: 'zh-TW' })
      load()
    } catch (err: any) {
      setError(err?.response?.data?.error || t('factoryLang.saveFailed'))
    }
  }

  const handleUpdate = async (code: string) => {
    try {
      await api.put(`/admin/factory-languages/${code}`, { language_code: editLang })
      setEditingCode(null)
      load()
    } catch (err: any) {
      setError(err?.response?.data?.error || t('factoryLang.saveFailed'))
    }
  }

  const handleDelete = async (code: string) => {
    if (!confirm(t('factoryLang.deleteConfirm', { code }))) return
    try {
      await api.delete(`/admin/factory-languages/${code}`)
      load()
    } catch (err: any) {
      setError(err?.response?.data?.error || t('factoryLang.deleteFailed'))
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 mb-1">
          <Globe size={20} className="text-blue-500" />
          {t('factoryLang.title')}
        </h2>
        <p className="text-slate-500 text-sm">{t('factoryLang.desc')}</p>
      </div>

      {/* Add form */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">{t('factoryLang.addTitle')}</h3>
        <form onSubmit={handleAdd} className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">{t('factoryLang.factoryCode')}</label>
            <input
              value={form.factory_code}
              onChange={e => setForm(p => ({ ...p, factory_code: e.target.value.toUpperCase() }))}
              placeholder={t('factoryLang.factoryCodePlaceholder')}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition"
              required
            />
          </div>
          <div className="w-48">
            <label className="block text-xs text-slate-500 mb-1">{t('factoryLang.language')}</label>
            <select
              value={form.language_code}
              onChange={e => setForm(p => ({ ...p, language_code: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition"
            >
              {SUPPORTED_LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            <Plus size={15} />
            {t('factoryLang.addBtn')}
          </button>
        </form>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">{t('factoryLang.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('factoryLang.cols.factoryCode')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('factoryLang.cols.language')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{t('factoryLang.cols.updatedAt')}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">{t('factoryLang.cols.action')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.factory_code} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-medium text-slate-800">{row.factory_code}</td>
                  <td className="px-4 py-3">
                    {editingCode === row.factory_code ? (
                      <select
                        value={editLang}
                        onChange={e => setEditLang(e.target.value)}
                        className="border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                      >
                        {SUPPORTED_LANGUAGES.map(l => (
                          <option key={l.code} value={l.code}>{l.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-600">
                        {SUPPORTED_LANGUAGES.find(l => l.code === row.language_code)?.label || row.language_code}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{row.updated_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {editingCode === row.factory_code ? (
                        <>
                          <button
                            onClick={() => handleUpdate(row.factory_code)}
                            className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 transition"
                          >
                            {t('common.save')}
                          </button>
                          <button
                            onClick={() => setEditingCode(null)}
                            className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 transition"
                          >
                            {t('common.cancel')}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => { setEditingCode(row.factory_code); setEditLang(row.language_code) }}
                          className="text-xs text-blue-500 hover:text-blue-700 transition"
                        >
                          {t('common.edit')}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(row.factory_code)}
                        className="text-red-400 hover:text-red-600 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
