import { useRef, useState, useEffect } from 'react'
import { Database, Download, Upload, AlertTriangle, FolderOpen, Save, Play, Trash2, Clock, CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'

interface CleanupStats {
  normal_sessions: number
  sensitive_sessions: number
  normal_audit: number
  sensitive_audit: number
  token_usage: number
}

export default function DbMaintenance() {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')

  // Auto-backup path
  const [autoBackupPath, setAutoBackupPath] = useState('')
  const [savingPath, setSavingPath] = useState(false)
  const [backingUp, setBackingUp] = useState(false)

  // Backup schedule
  const [backupSchedEnabled, setBackupSchedEnabled] = useState(false)
  const [backupSchedType, setBackupSchedType] = useState<'daily' | 'weekly'>('daily')
  const [backupSchedHour, setBackupSchedHour] = useState(2)
  const [backupSchedWeekday, setBackupSchedWeekday] = useState(1)
  const [savingBackupSched, setSavingBackupSched] = useState(false)

  // Cleanup settings
  const [retentionDays, setRetentionDays] = useState(90)
  const [sensitiveDays, setSensitiveDays] = useState(365)
  const [autoCleanEnabled, setAutoCleanEnabled] = useState(false)
  const [autoHour, setAutoHour] = useState(2)
  const [savingCleanup, setSavingCleanup] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [cleanupStats, setCleanupStats] = useState<CleanupStats | null>(null)

  useEffect(() => {
    api.get('/admin/settings/auto-backup-path').then((res) => {
      setAutoBackupPath(res.data.path || '')
    }).catch(() => {})

    api.get('/admin/settings/auto-backup-schedule').then((res) => {
      setBackupSchedEnabled(!!res.data.enabled)
      setBackupSchedType(res.data.type || 'daily')
      setBackupSchedHour(res.data.hour ?? 2)
      setBackupSchedWeekday(res.data.weekday ?? 1)
    }).catch(() => {})

    api.get('/admin/settings/cleanup').then((res) => {
      setRetentionDays(res.data.retention_days || 90)
      setSensitiveDays(res.data.sensitive_days || 365)
      setAutoCleanEnabled(!!res.data.auto_enabled)
      setAutoHour(res.data.auto_hour ?? 2)
    }).catch(() => {})
  }, [])

  const handleExport = () => {
    const token = localStorage.getItem('token')
    const a = document.createElement('a')
    a.href = `/api/admin/db/export?token=${token}`
    a.download = `foxlink_gpt_backup_${new Date().toISOString().slice(0, 10)}.db`
    a.click()
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!confirm(t('db.importConfirm'))) return

    setImporting(true)
    setMessage('')
    const formData = new FormData()
    formData.append('db_file', file)

    try {
      const res = await api.post('/admin/db/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMessage(`✅ ${res.data.message}`)
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('common.error')}`)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleSavePath = async () => {
    setSavingPath(true)
    setMessage('')
    try {
      await api.put('/admin/settings/auto-backup-path', { path: autoBackupPath })
      setMessage('✅ ' + t('db.backupPathSaved'))
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('db.saveFailed')}`)
    } finally {
      setSavingPath(false)
    }
  }

  const handleAutoBackup = async () => {
    setBackingUp(true)
    setMessage('')
    try {
      const res = await api.post('/admin/db/auto-backup')
      setMessage('✅ ' + t('db.backupSuccess', { path: res.data.path }))
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('db.backupFailed')}`)
    } finally {
      setBackingUp(false)
    }
  }

  const handleSaveBackupSched = async () => {
    setSavingBackupSched(true)
    setMessage('')
    try {
      await api.put('/admin/settings/auto-backup-schedule', {
        enabled: backupSchedEnabled,
        type: backupSchedType,
        hour: backupSchedHour,
        weekday: backupSchedWeekday,
      })
      const weekdayNames = ['日', '一', '二', '三', '四', '五', '六']
      const timeStr = `${String(backupSchedHour).padStart(2, '0')}:00`
      let schedStr: string
      if (!backupSchedEnabled) {
        schedStr = t('db.scheduleDisabled')
      } else if (backupSchedType === 'weekly') {
        schedStr = t('db.weeklySchedule', { weekday: weekdayNames[backupSchedWeekday], time: timeStr })
      } else {
        schedStr = t('db.dailySchedule', { time: timeStr })
      }
      setMessage('✅ ' + t('db.backupScheduleSaved', { schedule: schedStr }))
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('db.saveFailed')}`)
    } finally {
      setSavingBackupSched(false)
    }
  }

  const handleSaveCleanup = async () => {
    setSavingCleanup(true)
    setMessage('')
    try {
      await api.put('/admin/settings/cleanup', {
        retention_days: retentionDays,
        sensitive_days: sensitiveDays,
        auto_enabled: autoCleanEnabled,
        auto_hour: autoHour,
      })
      if (autoCleanEnabled) {
        setMessage('✅ ' + t('db.cleanupSettingsSaved', { hour: String(autoHour).padStart(2, '0') }))
      } else {
        setMessage('✅ ' + t('db.cleanupSettingsSavedOnly'))
      }
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('db.saveFailed')}`)
    } finally {
      setSavingCleanup(false)
    }
  }

  const handleManualCleanup = async () => {
    if (!confirm(t('db.cleanupConfirm', { retentionDays, sensitiveDays }))) return
    setCleaningUp(true)
    setMessage('')
    setCleanupStats(null)
    try {
      const res = await api.post('/admin/db/cleanup')
      setCleanupStats(res.data.stats)
      const s = res.data.stats
      const total = s.normal_sessions + s.sensitive_sessions + s.normal_audit + s.sensitive_audit + s.token_usage
      setMessage('✅ ' + t('db.cleanupSuccess', { total }))
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('db.cleanupFailed')}`)
    } finally {
      setCleaningUp(false)
    }
  }

  const weekdayOptions = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-120px)] pr-1">
      <div className="flex items-center gap-2 mb-4">
        <Database size={20} className="text-blue-500" />
        <h2 className="text-lg font-semibold text-slate-800">{t('db.title')}</h2>
      </div>

      {/* Export / Import */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Download size={18} className="text-green-500" />
            <h3 className="font-semibold text-slate-700">{t('db.exportDb')}</h3>
          </div>
          <p className="text-sm text-slate-500 mb-4">{t('db.exportDesc')}</p>
          <button onClick={handleExport} className="btn-primary w-full flex items-center justify-center gap-2">
            <Download size={15} /> {t('db.downloadBackup')}
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Upload size={18} className="text-orange-500" />
            <h3 className="font-semibold text-slate-700">{t('db.importDb')}</h3>
          </div>
          <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
            <AlertTriangle size={14} className="text-orange-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-orange-700">
              {t('db.importWarning')}
            </p>
          </div>
          <input ref={fileRef} type="file" accept=".db" className="hidden" onChange={handleImport} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition text-sm"
          >
            <Upload size={15} /> {importing ? t('common.importing') : t('db.selectImport')}
          </button>
        </div>
      </div>

      {/* Auto-backup path */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <FolderOpen size={18} className="text-blue-500" />
          <h3 className="font-semibold text-slate-700">{t('db.backupPath')}</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">{t('db.backupPathDesc')}</p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={autoBackupPath}
            onChange={(e) => setAutoBackupPath(e.target.value)}
            placeholder={t('db.backupPathPlaceholder')}
            className="input flex-1"
          />
          <button onClick={handleSavePath} disabled={savingPath} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Save size={14} /> {savingPath ? t('common.saving') : t('db.savePath')}
          </button>
        </div>
        <button
          onClick={handleAutoBackup}
          disabled={backingUp || !autoBackupPath.trim()}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition text-sm"
        >
          <Play size={14} /> {backingUp ? t('db.backingUp') : t('db.backupNow')}
        </button>
      </div>

      {/* Backup Schedule */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock size={18} className="text-indigo-500" />
          <h3 className="font-semibold text-slate-700">{t('db.backupSchedule')}</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">{t('db.backupScheduleDesc')}</p>

        <div className="flex items-center gap-4 mb-4 bg-slate-50 rounded-xl p-3">
          <Clock size={16} className="text-slate-400 flex-shrink-0" />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={backupSchedEnabled}
              onChange={(e) => setBackupSchedEnabled(e.target.checked)}
              className="w-4 h-4 accent-indigo-600"
            />
            {t('db.enableAutoBackup')}
          </label>
        </div>

        {backupSchedEnabled && (
          <div className="grid grid-cols-1 gap-3 mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-slate-600 w-16">{t('db.frequency')}</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="backupType"
                  value="daily"
                  checked={backupSchedType === 'daily'}
                  onChange={() => setBackupSchedType('daily')}
                  className="accent-indigo-600"
                />
                {t('db.daily')}
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="backupType"
                  value="weekly"
                  checked={backupSchedType === 'weekly'}
                  onChange={() => setBackupSchedType('weekly')}
                  className="accent-indigo-600"
                />
                {t('db.weekly')}
              </label>
            </div>

            {backupSchedType === 'weekly' && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600 w-16">{t('db.weekday')}</span>
                <div className="flex gap-1">
                  {weekdayOptions.map((label, idx) => (
                    <button
                      key={idx}
                      onClick={() => setBackupSchedWeekday(idx)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition ${
                        backupSchedWeekday === idx
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600 w-16">{t('db.executeTime')}</span>
              <select
                value={backupSchedHour}
                onChange={(e) => setBackupSchedHour(Number(e.target.value))}
                className="input py-1 w-24"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <button
          onClick={handleSaveBackupSched}
          disabled={savingBackupSched}
          className="btn-primary flex items-center gap-1.5"
        >
          <Save size={14} /> {savingBackupSched ? t('common.saving') : t('db.saveSchedule')}
        </button>
      </div>

      {/* Data Cleanup */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Trash2 size={18} className="text-red-500" />
          <h3 className="font-semibold text-slate-700">{t('db.dataCleanup')}</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">{t('db.dataCleanupDesc')}</p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="label">{t('db.normalRetention')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={3650}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="input w-24"
              />
              <span className="text-sm text-slate-500">{t('common.days')}</span>
            </div>
          </div>
          <div>
            <label className="label">{t('db.sensitiveRetention')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={3650}
                value={sensitiveDays}
                onChange={(e) => setSensitiveDays(Number(e.target.value))}
                className="input w-24"
              />
              <span className="text-sm text-slate-500">{t('common.days')}</span>
            </div>
          </div>
        </div>

        {/* Auto schedule */}
        <div className="flex items-center gap-4 mb-4 bg-slate-50 rounded-xl p-3">
          <Clock size={16} className="text-slate-400 flex-shrink-0" />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={autoCleanEnabled}
              onChange={(e) => setAutoCleanEnabled(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            {t('db.autoCleanup')}
          </label>
          {autoCleanEnabled && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">{t('db.executeTime')}</span>
              <select
                value={autoHour}
                onChange={(e) => setAutoHour(Number(e.target.value))}
                className="input py-1 w-20"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSaveCleanup}
            disabled={savingCleanup}
            className="btn-primary flex items-center gap-1.5"
          >
            <Save size={14} /> {savingCleanup ? t('common.saving') : t('db.saveSettings')}
          </button>
          <button
            onClick={handleManualCleanup}
            disabled={cleaningUp}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition text-sm"
          >
            <Trash2 size={14} /> {cleaningUp ? t('db.cleaningUp') : t('db.manualCleanup')}
          </button>
        </div>

        {/* Cleanup stats */}
        {cleanupStats && (
          <div className="mt-4 grid grid-cols-5 gap-3">
            {[
              { label: t('db.cleanupStats.normalSessions'), value: cleanupStats.normal_sessions, color: 'text-blue-600' },
              { label: t('db.cleanupStats.sensitiveSessions'), value: cleanupStats.sensitive_sessions, color: 'text-red-600' },
              { label: t('db.cleanupStats.normalAudit'), value: cleanupStats.normal_audit, color: 'text-slate-600' },
              { label: t('db.cleanupStats.sensitiveAudit'), value: cleanupStats.sensitive_audit, color: 'text-orange-600' },
              { label: t('db.cleanupStats.tokenUsage'), value: cleanupStats.token_usage, color: 'text-purple-600' },
            ].map((s) => (
              <div key={s.label} className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-400">{t('common.records')}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {message && (
        <div className={`mt-4 p-3 rounded-xl text-sm ${message.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message}
        </div>
      )}
    </div>
  )
}
