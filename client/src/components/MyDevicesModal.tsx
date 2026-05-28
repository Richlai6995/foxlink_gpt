import { useState, useEffect } from 'react'
import { X, Smartphone, Trash2, MapPin, Clock, CheckCircle2, AlertTriangle, Fingerprint, Plus } from 'lucide-react'
import api from '../lib/api'
import { useTranslation } from 'react-i18next'
import {
  isWebAuthnSupported,
  isPlatformBiometricAvailable,
  registerPasskey,
  listMyCredentials,
  deleteMyCredential,
  type BoundCredential,
} from '../lib/webauthn'

type Device = {
  id: number
  device_id: string
  device_label: string | null
  created_via_ip: string | null
  last_seen_ip: string | null
  user_agent: string | null
  created_at: string
  last_seen_at: string
  expires_at: string
  is_current: boolean
}

function fmt(ts: string | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function relativeTime(ts: string | null, t: (k: string, d?: any) => string) {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  if (isNaN(diff)) return ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return t('myDevices.justNow', '剛才')
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} ${t('myDevices.minAgo', '分鐘前')}`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ${t('myDevices.hourAgo', '小時前')}`
  const d = Math.floor(h / 24)
  return `${d} ${t('myDevices.dayAgo', '天前')}`
}

export default function MyDevicesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [err, setErr] = useState('')

  // Passkey(WebAuthn 生物辨識)
  const [passkeys, setPasskeys] = useState<BoundCredential[]>([])
  const [biometricAvail, setBiometricAvail] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyErr, setPasskeyErr] = useState('')

  const loadPasskeys = async () => {
    try { setPasskeys(await listMyCredentials()) } catch { setPasskeys([]) }
  }

  const load = async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await api.get('/auth/me/devices')
      setDevices(res.data || [])
      await loadPasskeys()
      if (isWebAuthnSupported()) {
        setBiometricAvail(await isPlatformBiometricAvailable())
      }
    } catch (e: any) {
      setErr(e?.response?.data?.error || '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleAddPasskey = async () => {
    setPasskeyBusy(true); setPasskeyErr('')
    try {
      const r = await registerPasskey()
      if (!r.ok) {
        if (r.error && r.error !== '使用者取消或裝置拒絕') setPasskeyErr(r.error)
      } else {
        await loadPasskeys()
      }
    } finally { setPasskeyBusy(false) }
  }

  const handleRemovePasskey = async (id: number) => {
    if (!confirm('移除這個裝置綁定?之後此裝置需重新註冊或用密碼登入')) return
    try {
      await deleteMyCredential(id)
      await loadPasskeys()
    } catch (e: any) {
      // 拆開三種狀態給 user 看 — 拿不到 response = 網路/防火牆/黑名單擋下;
      // 拿到 response 但無 error 欄位 = 後端非預期錯誤
      const status = e?.response?.status
      const body = e?.response?.data?.error
      if (body) {
        setPasskeyErr(`移除失敗 (${status}): ${body}`)
      } else if (status) {
        setPasskeyErr(`移除失敗 (HTTP ${status}) — 請重試或聯絡 IT`)
      } else {
        setPasskeyErr(`移除失敗 — 網路或連線被中介擋下 (${e?.message || 'no response'})`)
      }
    }
  }

  useEffect(() => { if (open) load() }, [open])

  const handleRemove = async (deviceId: string, isCurrent: boolean) => {
    if (!confirm(isCurrent
      ? t('myDevices.confirmRemoveCurrent', '移除這台裝置會強制本次連線下次重新登入。確定?')
      : t('myDevices.confirmRemove', '確認移除這台裝置?')
    )) return
    setBusy(deviceId)
    try {
      await api.delete(`/auth/me/devices/${deviceId}`)
      await load()
    } catch (e: any) {
      const status = e?.response?.status
      const body = e?.response?.data?.error
      if (body) setErr(`移除失敗 (${status}): ${body}`)
      else if (status) setErr(`移除失敗 (HTTP ${status}) — 請重試`)
      else setErr(`移除失敗 — 網路或連線被中介擋下 (${e?.message || 'no response'})`)
    } finally {
      setBusy(null)
    }
  }

  const handleRevokeAll = async () => {
    setBusy('all')
    try {
      await api.post('/auth/me/devices/revoke-all')
      await load()
      setConfirmAll(false)
    } catch (e: any) {
      setErr(e?.response?.data?.error || '操作失敗')
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Smartphone size={18} className="text-blue-400" />
            {t('myDevices.title', '我的信任裝置')}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Passkey / 生物辨識 區塊 ── */}
          {(isWebAuthnSupported() || passkeys.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Fingerprint size={14} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">快速登入(Face ID / 指紋)</h3>
              </div>
              <p className="text-xs text-slate-400 leading-6">
                綁定後可用本機生物辨識直接登入,不用打密碼。資料只在裝置本機驗證,系統僅儲存公鑰。
              </p>

              {passkeyErr && (
                <div className="flex items-start gap-2 bg-red-500/15 border border-red-500/30 rounded-xl px-3 py-2 text-red-300 text-sm">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {passkeyErr}
                </div>
              )}

              {passkeys.length === 0 ? (
                <div className="text-xs text-slate-500 py-2">尚未綁定任何裝置</div>
              ) : (
                passkeys.map((p) => (
                  <div key={p.id} className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-3">
                    <Fingerprint size={16} className="text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{p.device_label || '未命名裝置'}</p>
                      <p className="text-[11px] text-slate-400">
                        綁定:{p.created_at}
                        {p.last_used_at && ` · 最後使用:${p.last_used_at}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemovePasskey(p.id)}
                      className="text-slate-400 hover:text-red-400 shrink-0"
                      title="移除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}

              {biometricAvail && (
                <button
                  onClick={handleAddPasskey}
                  disabled={passkeyBusy}
                  className="w-full inline-flex items-center justify-center gap-2 text-xs text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10 disabled:opacity-50 rounded-xl py-2.5 transition"
                >
                  <Plus size={14} />
                  {passkeyBusy ? '驗證中…' : '綁定當前裝置'}
                </button>
              )}
            </div>
          )}

          {/* ── 信任 IP / MFA 裝置 區塊 ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone size={14} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-white">MFA 信任裝置</h3>
            </div>
            <p className="text-xs text-slate-400 leading-6">
              {t('myDevices.description',
                '完成 Webex MFA 驗證後,您的裝置會被信任 30 天免重新驗證。換網路 / IP 變動仍可使用,但換瀏覽器或清 cookie 會視為新裝置。改密碼會自動清空所有裝置。'
              )}
            </p>

          {err && (
            <div className="flex items-start gap-2 bg-red-500/15 border border-red-500/30 rounded-xl px-3 py-2 text-red-300 text-sm">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {err}
            </div>
          )}

          {loading && (
            <div className="text-center py-8 text-slate-500 text-sm">{t('common.loading', '載入中...')}</div>
          )}

          {!loading && devices.length === 0 && (
            <div className="text-center py-6 text-slate-500 text-xs leading-6">
              {t('myDevices.empty',
                '目前沒有 MFA 信任裝置 — 此區塊只記錄外網登入完成 Webex MFA 驗證後的裝置,\n跟上方「快速登入」綁定的指紋/Face ID 是兩個獨立系統。\n若從未走過外網 Webex MFA 流程,顯示空白是正常的。'
              )}
            </div>
          )}

          {!loading && devices.map(d => (
            <div key={d.device_id} className={`border rounded-xl p-4 ${d.is_current
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-white/5 border-white/10'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Smartphone size={14} className="text-blue-400 shrink-0" />
                    <span className="text-white font-medium text-sm truncate">
                      {d.device_label || t('myDevices.unknownDevice', '未知裝置')}
                    </span>
                    {d.is_current && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 px-2 py-0.5 bg-emerald-500/15 rounded">
                        <CheckCircle2 size={11} />
                        {t('myDevices.current', '目前使用中')}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 leading-6">
                    <div className="flex items-center gap-1.5">
                      <Clock size={11} />
                      {t('myDevices.lastSeen', '最後使用')}: {relativeTime(d.last_seen_at, t)}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin size={11} />
                      IP: <code className="text-slate-300">{d.last_seen_ip || '—'}</code>
                    </div>
                    <div className="text-[11px] text-slate-500 col-span-2">
                      {t('myDevices.created', '建立')}: {fmt(d.created_at)} ·
                      {' '}{t('myDevices.expires', '到期')}: {fmt(d.expires_at)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(d.device_id, d.is_current)}
                  disabled={busy === d.device_id}
                  className="text-slate-400 hover:text-red-400 disabled:opacity-50 shrink-0"
                  title={t('myDevices.remove', '移除')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          </div>
        </div>

        {/* Footer */}
        {!loading && devices.length > 0 && (
          <div className="p-5 border-t border-white/10">
            {!confirmAll ? (
              <button
                onClick={() => setConfirmAll(true)}
                className="text-xs text-red-400 hover:text-red-300 underline"
              >
                {t('myDevices.revokeAll', '移除所有裝置')}
              </button>
            ) : (
              <div className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <div className="text-xs text-red-300 leading-5">
                  {t('myDevices.revokeAllWarning',
                    '確認?移除全部裝置後,所有裝置(含這台)下次連線都需重新走 MFA。'
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setConfirmAll(false)}
                    className="text-xs text-slate-400 hover:text-white px-3 py-1.5 border border-white/10 rounded-lg"
                  >
                    {t('common.cancel', '取消')}
                  </button>
                  <button
                    onClick={handleRevokeAll}
                    disabled={busy === 'all'}
                    className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
                  >
                    {busy === 'all' ? t('common.loading', '載入中...') : t('myDevices.confirmRevokeAll', '確認移除全部')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
