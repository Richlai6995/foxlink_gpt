import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, Square, RotateCcw, Package, Terminal, X, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import api from '../../lib/api'

interface CodeRunner {
    id: number
    name: string
    icon: string
    code_status: string
    code_port: number | null
    code_pid: number | null
    code_error: string | null
    code_packages: string[]
    runtime_running: boolean
    runtime_port: number | null
    runtime_pid: number | null
}

type LogModalMode = 'log' | 'install'

export default function CodeRunnersPanel() {
    const [runners, setRunners] = useState<CodeRunner[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [logModal, setLogModal] = useState<{ skillId: number; name: string; mode: LogModalMode } | null>(null)
    const [logLines, setLogLines] = useState<string[]>([])
    const logEndRef = useRef<HTMLDivElement>(null)
    const sseRef = useRef<EventSource | null>(null)
    const [actionLoading, setActionLoading] = useState<Record<number, string>>({})
    // Install confirm dialog
    const [installDialog, setInstallDialog] = useState<{ runner: CodeRunner } | null>(null)
    const [installPkgInput, setInstallPkgInput] = useState('')
    const [installPkgs, setInstallPkgs] = useState<string[]>([])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await api.get('/admin/skill-runners')
            setRunners(res.data)
        } catch (e: any) {
            setError(e.response?.data?.error || '載入失敗')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [logLines])

    const doAction = async (skillId: number, action: 'start' | 'stop' | 'restart') => {
        setActionLoading(p => ({ ...p, [skillId]: action }))
        try {
            await api.post(`/admin/skill-runners/${skillId}/${action}`)
            await load()
        } catch (e: any) {
            setError(e.response?.data?.error || `${action} 失敗`)
        } finally {
            setActionLoading(p => { const n = { ...p }; delete n[skillId]; return n })
        }
    }

    const openLog = (runner: CodeRunner) => {
        if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
        setLogLines([])
        setLogModal({ skillId: runner.id, name: runner.name, mode: 'log' })

        const token = localStorage.getItem('token')
        const es = new EventSource(`/api/admin/skill-runners/${runner.id}/logs?token=${token}`)
        sseRef.current = es
        es.onmessage = (e) => {
            try {
                const d = JSON.parse(e.data)
                if (d.line) setLogLines(p => [...p, d.line])
            } catch (_) {}
        }
        es.onerror = () => es.close()
    }

    const openInstall = (runner: CodeRunner) => {
        // Show confirm dialog first
        setInstallPkgs([...runner.code_packages])
        setInstallPkgInput('')
        setInstallDialog({ runner })
    }

    const doInstall = (runner: CodeRunner, packages: string[]) => {
        setInstallDialog(null)
        if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
        setLogLines([])
        setLogModal({ skillId: runner.id, name: runner.name, mode: 'install' })

        const token = localStorage.getItem('token')
        fetch(`/api/admin/skill-runners/${runner.id}/install`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ packages }),
        }).then(async (res) => {
            const reader = res.body?.getReader()
            const decoder = new TextDecoder()
            if (!reader) return
            let buf = ''
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                const parts = buf.split('\n\n')
                buf = parts.pop() || ''
                for (const part of parts) {
                    const dataLine = part.split('\n').find(l => l.startsWith('data:'))
                    if (dataLine) {
                        try {
                            const d = JSON.parse(dataLine.slice(5))
                            if (d.line) setLogLines(p => [...p, d.line])
                            if (d.done) { setLogLines(p => [...p, '✅ 安裝完成']); load() }
                            if (d.error) setLogLines(p => [...p, `❌ 錯誤: ${d.error}`])
                        } catch (_) {}
                    }
                }
            }
        }).catch(e => setLogLines(p => [...p, `❌ ${e.message}`]))
    }

    const closeModal = () => {
        if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
        setLogModal(null)
        setLogLines([])
    }

    const statusBadge = (runner: CodeRunner) => {
        const s = runner.runtime_running ? 'running' : runner.code_status
        if (s === 'running') return <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><CheckCircle size={11} />運行中 :{runner.runtime_port}</span>
        if (s === 'error') return <span className="flex items-center gap-1 text-xs text-red-600 font-medium"><AlertCircle size={11} />錯誤</span>
        if (s === 'starting') return <span className="flex items-center gap-1 text-xs text-amber-600 font-medium"><Loader2 size={11} className="animate-spin" />啟動中</span>
        return <span className="text-xs text-slate-400">已停止</span>
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold text-slate-800">Code Runners</h2>
                <span className="text-xs text-slate-400">{runners.length} 個程式技能</span>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-2">
                    {error}<button onClick={() => setError('')}><X size={13} /></button>
                </div>
            )}

            {loading && <div className="text-center py-12 text-slate-400 text-sm">載入中...</div>}

            {!loading && runners.length === 0 && (
                <div className="text-center py-16 text-slate-400 text-sm">
                    <Terminal size={36} className="mx-auto mb-3 opacity-25" />
                    <p>尚無 type=code 技能。請至技能市集建立。</p>
                </div>
            )}

            <div className="space-y-3">
                {runners.map(runner => (
                    <div key={runner.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
                        <div className="text-2xl">{runner.icon}</div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-medium text-slate-800 text-sm">{runner.name}</span>
                                <span className="text-xs text-slate-400">#{runner.id}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                {statusBadge(runner)}
                                {runner.runtime_pid && <span className="text-xs text-slate-400">PID: {runner.runtime_pid}</span>}
                                {runner.code_packages.length > 0 && (
                                    <span className="text-xs text-slate-400">pkg: {runner.code_packages.join(', ')}</span>
                                )}
                            </div>
                            {runner.code_error && !runner.runtime_running && (
                                <p className="text-xs text-red-500 mt-1 truncate" title={runner.code_error}>{runner.code_error}</p>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {!runner.runtime_running ? (
                                <button
                                    onClick={() => doAction(runner.id, 'start')}
                                    disabled={!!actionLoading[runner.id]}
                                    title="啟動"
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                                >
                                    {actionLoading[runner.id] === 'start' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                                    啟動
                                </button>
                            ) : (
                                <button
                                    onClick={() => doAction(runner.id, 'stop')}
                                    disabled={!!actionLoading[runner.id]}
                                    title="停止"
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
                                >
                                    {actionLoading[runner.id] === 'stop' ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                                    停止
                                </button>
                            )}
                            <button
                                onClick={() => doAction(runner.id, 'restart')}
                                disabled={!!actionLoading[runner.id]}
                                title="重啟"
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-300 disabled:opacity-50"
                            >
                                {actionLoading[runner.id] === 'restart' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                            </button>
                            <button
                                onClick={() => openInstall(runner)}
                                title="安裝套件"
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-300"
                            >
                                <Package size={14} />
                            </button>
                            <button
                                onClick={() => openLog(runner)}
                                title="查看日誌"
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-400"
                            >
                                <Terminal size={14} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Install Confirm Dialog */}
            {installDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <Package size={16} className="text-emerald-600" />
                                <span className="font-semibold text-slate-800 text-sm">安裝 NPM 套件 — {installDialog.runner.name}</span>
                            </div>
                            <button onClick={() => setInstallDialog(null)} className="p-1 rounded text-slate-400 hover:text-slate-600"><X size={15} /></button>
                        </div>
                        <div className="p-5 space-y-3">
                            <p className="text-xs text-slate-500">確認或修改要安裝的套件，可以加入 skill 建立時未填寫的套件。</p>
                            <div className="flex flex-wrap gap-1.5 min-h-8">
                                {installPkgs.map(p => (
                                    <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 rounded text-xs text-emerald-700 font-mono">
                                        {p}
                                        <button type="button" onClick={() => setInstallPkgs(ps => ps.filter(x => x !== p))}><X size={10} /></button>
                                    </span>
                                ))}
                                {installPkgs.length === 0 && <span className="text-xs text-slate-400 italic">（只安裝 express wrapper，不含其他套件）</span>}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    value={installPkgInput}
                                    onChange={e => setInstallPkgInput(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            const t = installPkgInput.trim()
                                            if (t && !installPkgs.includes(t)) setInstallPkgs(p => [...p, t])
                                            setInstallPkgInput('')
                                        }
                                    }}
                                    placeholder="輸入套件名稱後按 Enter，如 axios"
                                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 font-mono"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const t = installPkgInput.trim()
                                        if (t && !installPkgs.includes(t)) setInstallPkgs(p => [...p, t])
                                        setInstallPkgInput('')
                                    }}
                                    className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:border-emerald-300"
                                >新增</button>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
                            <button onClick={() => setInstallDialog(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
                            <button
                                onClick={() => doInstall(installDialog.runner, installPkgs)}
                                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 flex items-center gap-1.5"
                            >
                                <Package size={14} />執行安裝
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Log / Install Modal */}
            {logModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-slate-900 rounded-2xl w-full max-w-3xl h-[70vh] flex flex-col shadow-2xl">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
                            <div className="flex items-center gap-2">
                                <Terminal size={15} className="text-slate-400" />
                                <span className="text-slate-200 text-sm font-medium">
                                    {logModal.mode === 'install' ? '安裝套件' : '即時日誌'} — {logModal.name}
                                </span>
                            </div>
                            <button onClick={closeModal} className="p-1 rounded text-slate-400 hover:text-slate-200"><X size={15} /></button>
                        </div>
                        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-emerald-300 space-y-0.5">
                            {logLines.length === 0 && <p className="text-slate-500 italic">等待輸出...</p>}
                            {logLines.map((line, i) => <div key={i}>{line}</div>)}
                            <div ref={logEndRef} />
                        </div>
                        <div className="px-5 py-3 border-t border-slate-700 flex justify-end">
                            <button onClick={() => setLogLines([])} className="text-xs text-slate-400 hover:text-slate-200 mr-4">清除</button>
                            <button onClick={closeModal} className="px-3 py-1.5 bg-slate-700 text-slate-200 rounded-lg text-xs hover:bg-slate-600">關閉</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
