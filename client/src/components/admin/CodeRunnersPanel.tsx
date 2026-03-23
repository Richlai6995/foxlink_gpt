import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, Square, RotateCcw, Package, Terminal, X, AlertCircle, CheckCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
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
    const statusSseRef = useRef<EventSource | null>(null)
    const [actionLoading, setActionLoading] = useState<Record<number, string>>({})
    const [installDialog, setInstallDialog] = useState<{ runner: CodeRunner } | null>(null)
    const [installPkgInput, setInstallPkgInput] = useState('')
    const [installPkgs, setInstallPkgs] = useState<string[]>([])
    // Inline log panel state
    const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set())
    const [inlineLogs, setInlineLogs] = useState<Record<number, string[]>>({})
    const inlineSseRefs = useRef<Record<number, EventSource>>({})
    const inlineLogEndRefs = useRef<Record<number, HTMLDivElement | null>>({})

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

    // Initial load
    useEffect(() => { load() }, [load])

    // SSE status stream — real-time runner status updates
    useEffect(() => {
        const token = localStorage.getItem('token')
        const es = new EventSource(`/api/admin/skill-runners/status-stream?token=${token}`)
        statusSseRef.current = es
        es.onmessage = (e) => {
            try {
                const d = JSON.parse(e.data)
                setRunners(prev => prev.map(r =>
                    r.id === d.skillId
                        ? {
                            ...r,
                            code_status: d.status,
                            runtime_running: d.status === 'running',
                            runtime_port: d.port ?? (d.status === 'running' ? r.runtime_port : null),
                            runtime_pid: d.pid ?? (d.status === 'running' ? r.runtime_pid : null),
                            code_error: d.error ?? (d.status === 'error' ? r.code_error : null),
                          }
                        : r
                ))
                // Clear actionLoading when status settles
                if (['running', 'stopped', 'error'].includes(d.status)) {
                    setActionLoading(prev => { const n = { ...prev }; delete n[d.skillId]; return n })
                }
            } catch (_) {}
        }
        es.onerror = () => { /* auto-reconnects */ }
        return () => { es.close(); statusSseRef.current = null }
    }, [])

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [logLines])

    // Auto-scroll inline logs
    useEffect(() => {
        for (const id of expandedLogs) {
            inlineLogEndRefs.current[id]?.scrollIntoView({ behavior: 'smooth' })
        }
    }, [inlineLogs, expandedLogs])

    const doAction = async (skillId: number, action: 'start' | 'stop' | 'restart') => {
        setActionLoading(p => ({ ...p, [skillId]: action }))
        try {
            await api.post(`/admin/skill-runners/${skillId}/${action}`)
            // For stop: server returns 202 immediately, SSE will update status
            // For start/restart: server awaits spawn, then SSE fires
            if (action !== 'stop') {
                await load()
            }
        } catch (e: any) {
            setError(e.response?.data?.error || `${action} 失敗`)
            setActionLoading(p => { const n = { ...p }; delete n[skillId]; return n })
        }
        // For stop, actionLoading is cleared by SSE when status becomes 'stopped'
        if (action !== 'stop') {
            setActionLoading(p => { const n = { ...p }; delete n[skillId]; return n })
        }
    }

    const toggleInlineLog = (runnerId: number) => {
        setExpandedLogs(prev => {
            const next = new Set(prev)
            if (next.has(runnerId)) {
                next.delete(runnerId)
                inlineSseRefs.current[runnerId]?.close()
                delete inlineSseRefs.current[runnerId]
            } else {
                next.add(runnerId)
                setInlineLogs(p => ({ ...p, [runnerId]: [] }))
                const token = localStorage.getItem('token')
                const es = new EventSource(`/api/admin/skill-runners/${runnerId}/logs?token=${token}`)
                inlineSseRefs.current[runnerId] = es
                es.onmessage = (e) => {
                    try {
                        const d = JSON.parse(e.data)
                        if (d.line) setInlineLogs(p => ({
                            ...p,
                            [runnerId]: [...(p[runnerId] || []).slice(-49), d.line],
                        }))
                    } catch (_) {}
                }
                es.onerror = () => {}
            }
            return next
        })
    }

    // Close all inline SSEs on unmount
    useEffect(() => {
        return () => {
            for (const es of Object.values(inlineSseRefs.current)) es.close()
        }
    }, [])

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
        if (s === 'running') return <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><CheckCircle size={11} />運行中 :{runner.runtime_port || runner.code_port}</span>
        if (s === 'error') return <span className="flex items-center gap-1 text-xs text-red-600 font-medium"><AlertCircle size={11} />錯誤</span>
        if (s === 'starting') return <span className="flex items-center gap-1 text-xs text-amber-600 font-medium"><Loader2 size={11} className="animate-spin" />啟動中</span>
        if (s === 'stopping') return <span className="flex items-center gap-1 text-xs text-orange-500 font-medium"><Loader2 size={11} className="animate-spin" />停止中</span>
        return <span className="text-xs text-slate-400">已停止</span>
    }

    const actionButton = (runner: CodeRunner) => {
        const isLoading = !!actionLoading[runner.id]
        const s = runner.runtime_running ? 'running' : runner.code_status

        if (s === 'running') {
            return (
                <button onClick={() => doAction(runner.id, 'stop')} disabled={isLoading}
                    title="停止"
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50">
                    {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}停止
                </button>
            )
        }
        if (s === 'starting' || (isLoading && actionLoading[runner.id] === 'start')) {
            return (
                <button disabled className="flex items-center gap-1 px-3 py-1.5 text-xs bg-amber-50 text-amber-600 border border-amber-200 rounded-lg opacity-70 cursor-not-allowed">
                    <Loader2 size={12} className="animate-spin" />啟動中
                </button>
            )
        }
        if (s === 'stopping' || (isLoading && actionLoading[runner.id] === 'stop')) {
            return (
                <button disabled className="flex items-center gap-1 px-3 py-1.5 text-xs bg-orange-50 text-orange-500 border border-orange-200 rounded-lg opacity-70 cursor-not-allowed">
                    <Loader2 size={12} className="animate-spin" />停止中
                </button>
            )
        }
        return (
            <button onClick={() => doAction(runner.id, 'start')} disabled={isLoading}
                title="啟動"
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}啟動
            </button>
        )
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
                    <div key={runner.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        {/* Runner header row */}
                        <div className="p-4 flex items-center gap-4">
                            <div className="text-2xl">{runner.icon}</div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="font-medium text-slate-800 text-sm">{runner.name}</span>
                                    <span className="text-xs text-slate-400">#{runner.id}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    {statusBadge(runner)}
                                    {(runner.runtime_pid || runner.code_pid) && (
                                        <span className="text-xs text-slate-400">PID: {runner.runtime_pid || runner.code_pid}</span>
                                    )}
                                    {runner.code_packages.length > 0 && (
                                        <span className="text-xs text-slate-400">pkg: {runner.code_packages.join(', ')}</span>
                                    )}
                                </div>
                                {runner.code_error && !runner.runtime_running && runner.code_status !== 'stopping' && (
                                    <p className="text-xs text-red-500 mt-1 truncate" title={runner.code_error}>{runner.code_error}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                {actionButton(runner)}
                                <button
                                    onClick={() => doAction(runner.id, 'restart')}
                                    disabled={!!actionLoading[runner.id] || runner.code_status === 'stopping'}
                                    title="重啟"
                                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-300 disabled:opacity-50">
                                    {actionLoading[runner.id] === 'restart' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                                </button>
                                <button onClick={() => openInstall(runner)} title="安裝套件"
                                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-300">
                                    <Package size={14} />
                                </button>
                                <button onClick={() => openLog(runner)} title="查看完整日誌"
                                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-400">
                                    <Terminal size={14} />
                                </button>
                                <button onClick={() => toggleInlineLog(runner.id)} title="展開/收合即時 Log"
                                    className={`p-1.5 rounded-lg border text-slate-500 hover:text-indigo-600 hover:border-indigo-300 ${expandedLogs.has(runner.id) ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'border-slate-200'}`}>
                                    {expandedLogs.has(runner.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                            </div>
                        </div>

                        {/* Inline log panel */}
                        {expandedLogs.has(runner.id) && (
                            <div className="border-t border-slate-100 bg-slate-900">
                                <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700">
                                    <span className="text-xs text-slate-400 font-mono">即時 stdout/stderr</span>
                                    <button onClick={() => setInlineLogs(p => ({ ...p, [runner.id]: [] }))}
                                        className="text-xs text-slate-500 hover:text-slate-300">清除</button>
                                </div>
                                <div className="h-40 overflow-auto p-3 font-mono text-xs text-emerald-300 space-y-0.5">
                                    {(!inlineLogs[runner.id] || inlineLogs[runner.id].length === 0) && (
                                        <p className="text-slate-500 italic">等待輸出...</p>
                                    )}
                                    {(inlineLogs[runner.id] || []).map((line, i) => (
                                        <div key={i} className="break-all">{line}</div>
                                    ))}
                                    <div ref={el => { inlineLogEndRefs.current[runner.id] = el }} />
                                </div>
                            </div>
                        )}
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
                                <input value={installPkgInput} onChange={e => setInstallPkgInput(e.target.value)}
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
                                <button type="button" onClick={() => {
                                    const t = installPkgInput.trim()
                                    if (t && !installPkgs.includes(t)) setInstallPkgs(p => [...p, t])
                                    setInstallPkgInput('')
                                }} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:border-emerald-300">新增</button>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
                            <button onClick={() => setInstallDialog(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
                            <button onClick={() => doInstall(installDialog.runner, installPkgs)}
                                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 flex items-center gap-1.5">
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
