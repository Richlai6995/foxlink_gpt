/**
 * NewProjectDialog — Sprint 1 最小建案 dialog(無 Wizard,Wizard 在 Sprint 9)
 *
 * 必填:project_code、type_code、title、bu_id
 * 可選:pm_user_id、sales_user_id、importance、urgency
 */

import { useState } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, ProjectType } from '../api'

type Props = {
  types: ProjectType[]
  onClose: () => void
  onCreated: (projectId: number) => void
}

export default function NewProjectDialog({ types, onClose, onCreated }: Props) {
  const { token, user } = useAuth() as any
  const [code, setCode] = useState('')
  const [typeCode, setTypeCode] = useState(types[0]?.type_code || 'QUOTE')
  const [title, setTitle] = useState('')
  const [buId, setBuId] = useState('1')
  const [pmUserId, setPmUserId] = useState(String(user?.id || ''))
  const [salesUserId, setSalesUserId] = useState('')
  const [importance, setImportance] = useState<'HIGH' | 'NORMAL' | 'LOW'>('NORMAL')
  const [urgency, setUrgency] = useState<'HIGH' | 'NORMAL' | 'LOW'>('NORMAL')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const valid =
    code.trim().length > 0 &&
    typeCode.length > 0 &&
    title.trim().length > 0 &&
    /^\d+$/.test(buId)

  const submit = async () => {
    if (!valid) return
    setSubmitting(true)
    setErr(null)
    try {
      const r = await api.post<{ project: { id: number } }>(token, '/projects', {
        project_code: code.trim(),
        type_code: typeCode,
        title: title.trim(),
        bu_id: Number(buId),
        pm_user_id: pmUserId ? Number(pmUserId) : undefined,
        sales_user_id: salesUserId ? Number(salesUserId) : undefined,
        importance,
        urgency,
      })
      onCreated(r.project.id)
    } catch (e: any) {
      setErr(e.message || '建立失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-sky-300">建立新專案</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <Field label="專案編號 (project_code)" required>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例:Q-2026-001"
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono"
            />
          </Field>

          <Field label="類型" required>
            <select
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
            >
              {types.map((t) => (
                <option key={t.type_code} value={t.type_code}>
                  {t.type_code} {t.plugin_loaded ? '' : '(plugin 未載入)'}
                </option>
              ))}
            </select>
          </Field>

          <Field label="標題" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例:客戶 X 全新平台報價"
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="BU ID" required>
              <input
                value={buId}
                onChange={(e) => setBuId(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
              />
            </Field>
            <Field label="PM user_id">
              <input
                value={pmUserId}
                onChange={(e) => setPmUserId(e.target.value)}
                placeholder="預設 = 我"
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
              />
            </Field>
            <Field label="Sales user_id">
              <input
                value={salesUserId}
                onChange={(e) => setSalesUserId(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="重要度">
              <select
                value={importance}
                onChange={(e) => setImportance(e.target.value as any)}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
              >
                <option value="HIGH">HIGH</option>
                <option value="NORMAL">NORMAL</option>
                <option value="LOW">LOW</option>
              </select>
            </Field>
            <Field label="緊急度">
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as any)}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200"
              >
                <option value="HIGH">HIGH</option>
                <option value="NORMAL">NORMAL</option>
                <option value="LOW">LOW</option>
              </select>
            </Field>
          </div>

          {err && (
            <div className="p-2 bg-red-900/20 border border-red-800 rounded text-red-300 text-xs">
              {err}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded transition"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            className="px-4 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded transition"
          >
            {submitting ? '建立中…' : '建立'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 mb-1 block">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}
