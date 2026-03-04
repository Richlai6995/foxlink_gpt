import { useRef, useState, useEffect } from 'react'
import { Database, Download, Upload, AlertTriangle, FolderOpen, Save, Play, Trash2, Clock, CalendarClock } from 'lucide-react'
import api from '../../lib/api'

interface CleanupStats {
  normal_sessions: number
  sensitive_sessions: number
  normal_audit: number
  sensitive_audit: number
  token_usage: number
}

export default function DbMaintenance() {
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
    if (!confirm('⚠️ 匯入資料庫將覆蓋現有資料，確定繼續？')) return

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
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || '匯入失敗'}`)
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
      setMessage('✅ 備份路徑已儲存')
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || '儲存失敗'}`)
    } finally {
      setSavingPath(false)
    }
  }

  const handleAutoBackup = async () => {
    setBackingUp(true)
    setMessage('')
    try {
      const res = await api.post('/admin/db/auto-backup')
      setMessage(`✅ 備份成功：${res.data.path}`)
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || '備份失敗'}`)
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
      const schedStr = backupSchedEnabled
        ? backupSchedType === 'weekly'
          ? `每週${weekdayNames[backupSchedWeekday]} ${timeStr}`
          : `每天 ${timeStr}`
        : '已停用'
      setMessage(`✅ 備份排程已儲存（${schedStr}）`)
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || '儲存失敗'}`)
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
      setMessage('✅ 清除設定已儲存' + (autoCleanEnabled ? `，排程每天 ${String(autoHour).padStart(2, '0')}:00 執行` : ''))
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || '儲存失敗'}`)
    } finally {
      setSavingCleanup(false)
    }
  }

  const handleManualCleanup = async () => {
    if (!confirm(`確定立即清除超過保留期的對話資料？\n一般對話保留 ${retentionDays} 天，敏感對話保留 ${sensitiveDays} 天。`)) return
    setCleaningUp(true)
    setMessage('')
    setCleanupStats(null)
    try {
      const res = await api.post('/admin/db/cleanup')
      setCleanupStats(res.data.stats)
      const s = res.data.stats
      const total = s.normal_sessions + s.sensitive_sessions + s.normal_audit + s.sensitive_audit + s.token_usage
      setMessage(`✅ 清除完成，共刪除 ${total} 筆資料`)
    } catch (e: unknown) {
      setMessage(`❌ ${(e as { response?: { data?: { error?: string } } })?.response?.data?.error || '清除失敗'}`)
    } finally {
      setCleaningUp(false)
    }
  }

  const weekdayOptions = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-120px)] pr-1">
      <div className="flex items-center gap-2 mb-4">
        <Database size={20} className="text-blue-500" />
        <h2 className="text-lg font-semibold text-slate-800">資料庫維護</h2>
      </div>

      {/* Export / Import */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Download size={18} className="text-green-500" />
            <h3 className="font-semibold text-slate-700">匯出資料庫</h3>
          </div>
          <p className="text-sm text-slate-500 mb-4">下載目前的 SQLite 資料庫備份檔案。</p>
          <button onClick={handleExport} className="btn-primary w-full flex items-center justify-center gap-2">
            <Download size={15} /> 下載備份
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Upload size={18} className="text-orange-500" />
            <h3 className="font-semibold text-slate-700">匯入資料庫</h3>
          </div>
          <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
            <AlertTriangle size={14} className="text-orange-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-orange-700">
              匯入將覆蓋現有所有資料，此操作不可逆！請確認已備份目前資料庫。
            </p>
          </div>
          <input ref={fileRef} type="file" accept=".db" className="hidden" onChange={handleImport} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition text-sm"
          >
            <Upload size={15} /> {importing ? '匯入中...' : '選擇並匯入'}
          </button>
        </div>
      </div>

      {/* Auto-backup path */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <FolderOpen size={18} className="text-blue-500" />
          <h3 className="font-semibold text-slate-700">自動備份路徑</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          設定伺服器端備份目錄（Docker 部署請填容器內路徑，例如{' '}
          <code className="bg-slate-100 px-1 rounded text-xs">/app/backups</code>）。
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={autoBackupPath}
            onChange={(e) => setAutoBackupPath(e.target.value)}
            placeholder="例如：/app/backups 或 D:\backups"
            className="input flex-1"
          />
          <button onClick={handleSavePath} disabled={savingPath} className="btn-primary flex items-center gap-1.5 whitespace-nowrap">
            <Save size={14} /> {savingPath ? '儲存中...' : '儲存路徑'}
          </button>
        </div>
        <button
          onClick={handleAutoBackup}
          disabled={backingUp || !autoBackupPath.trim()}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition text-sm"
        >
          <Play size={14} /> {backingUp ? '備份中...' : '立即備份到指定路徑'}
        </button>
      </div>

      {/* Backup Schedule */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock size={18} className="text-indigo-500" />
          <h3 className="font-semibold text-slate-700">自動備份排程</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          定時自動將資料庫備份至上方設定的備份路徑。需先設定備份路徑。
        </p>

        <div className="flex items-center gap-4 mb-4 bg-slate-50 rounded-xl p-3">
          <Clock size={16} className="text-slate-400 flex-shrink-0" />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={backupSchedEnabled}
              onChange={(e) => setBackupSchedEnabled(e.target.checked)}
              className="w-4 h-4 accent-indigo-600"
            />
            啟用自動備份
          </label>
        </div>

        {backupSchedEnabled && (
          <div className="grid grid-cols-1 gap-3 mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-slate-600 w-16">頻率</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="backupType"
                  value="daily"
                  checked={backupSchedType === 'daily'}
                  onChange={() => setBackupSchedType('daily')}
                  className="accent-indigo-600"
                />
                每日
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
                每週
              </label>
            </div>

            {backupSchedType === 'weekly' && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600 w-16">星期幾</span>
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
              <span className="text-sm text-slate-600 w-16">執行時間</span>
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
          <Save size={14} /> {savingBackupSched ? '儲存中...' : '儲存排程設定'}
        </button>
      </div>

      {/* Data Cleanup */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Trash2 size={18} className="text-red-500" />
          <h3 className="font-semibold text-slate-700">對話資料清除</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          超過保留期限的對話記錄將被刪除。敏感詞彙對話可設定更長保留時間，以備稽核。
        </p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="label">一般對話保留天數</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={3650}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="input w-24"
              />
              <span className="text-sm text-slate-500">天</span>
            </div>
          </div>
          <div>
            <label className="label">敏感詞彙對話保留天數</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={3650}
                value={sensitiveDays}
                onChange={(e) => setSensitiveDays(Number(e.target.value))}
                className="input w-24"
              />
              <span className="text-sm text-slate-500">天</span>
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
            每天自動清除
          </label>
          {autoCleanEnabled && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">執行時間</span>
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
            <Save size={14} /> {savingCleanup ? '儲存中...' : '儲存設定'}
          </button>
          <button
            onClick={handleManualCleanup}
            disabled={cleaningUp}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition text-sm"
          >
            <Trash2 size={14} /> {cleaningUp ? '清除中...' : '立即手動清除'}
          </button>
        </div>

        {/* Cleanup stats */}
        {cleanupStats && (
          <div className="mt-4 grid grid-cols-5 gap-3">
            {[
              { label: '一般對話', value: cleanupStats.normal_sessions, color: 'text-blue-600' },
              { label: '敏感對話', value: cleanupStats.sensitive_sessions, color: 'text-red-600' },
              { label: '一般稽核', value: cleanupStats.normal_audit, color: 'text-slate-600' },
              { label: '敏感稽核', value: cleanupStats.sensitive_audit, color: 'text-orange-600' },
              { label: 'Token 統計', value: cleanupStats.token_usage, color: 'text-purple-600' },
            ].map((s) => (
              <div key={s.label} className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-400">筆</p>
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
