import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
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
    const { t } = useTranslation()
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
            setError(e.response?.data?.error || t('codeRunners.loadFailed'))
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
            setError(e.response?.data?.error || t('codeRunners.actionFailed', { action }))
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
                            if (d.done) { setLogLines(p => [...p, `✅ ${t('codeRunners.installDone')}`]); load() }
                            if (d.error) setLogLines(p => [...p, `❌ ${t('codeRunners.installError', { msg: d.error })}`])
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
        if (s === 'running') return <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><CheckCircle size={11} />{t('codeRunners.statusRunning')} :{runner.runtime_port || runner.code_port}</span>
        if (s === 'error') return <span className="flex items-center gap-1 text-xs text-red-600 font-medium"><AlertCircle size={11} />{t('codeRunners.statusError')}</span>
        if (s === 'starting') return <span className="flex items-center gap-1 text-xs text-amber-600 font-medium"><Loader2 size={11} className="animate-spin" />{t('codeRunners.statusStarting')}</span>
        if (s === 'stopping') return <span className="flex items-center gap-1 text-xs text-orange-500 font-medium"><Loader2 size={11} className="animate-spin" />{t('codeRunners.statusStopping')}</span>
        return <span className="text-xs text-slate-400">{t('codeRunners.statusStopped')}</span>
    }

    const actionButton = (runner: CodeRunner) => {
        const isLoading = !!actionLoading[runner.id]
        const s = runner.runtime_running ? 'running' : runner.code_status

        if (s === 'running') {
            return (
                <button onClick={() => doAction(runner.id, 'stop')} disabled={isLoading}
                    title={t('codeRunners.stop')}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50">
                    {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}{t('codeRunners.stop')}
                </button>
            )
        }
        if (s === 'starting' || (isLoading && actionLoading[runner.id] === 'start')) {
            return (
                <button disabled className="flex items-center gap-1 px-3 py-1.5 text-xs bg-amber-50 text-amber-600 border border-amber-200 rounded-lg opacity-70 cursor-not-allowed">
                    <Loader2 size={12} className="animate-spin" />{t('codeRunners.statusStarting')}
                </button>
            )
        }
        if (s === 'stopping' || (isLoading && actionLoading[runner.id] === 'stop')) {
            return (
                <button disabled className="flex items-center gap-1 px-3 py-1.5 text-xs bg-orange-50 text-orange-500 border border-orange-200 rounded-lg opacity-70 cursor-not-allowed">
                    <Loader2 size={12} className="animate-spin" />{t('codeRunners.statusStopping')}
                </button>
            )
        }
        return (
            <button onClick={() => doAction(runner.id, 'start')} disabled={isLoading}
                title={t('codeRunners.start')}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}{t('codeRunners.start')}
            </button>
        )
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold text-slate-800">{t('codeRunners.title')}</h2>
                <span className="text-xs text-slate-400">{t('codeRunners.count', { count: runners.length })}</span>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-2">
                    {error}<button onClick={() => setError('')}><X size={13} /></button>
                </div>
            )}

            {loading && <div className="text-center py-12 text-slate-400 text-sm">{t('codeRunners.loading')}</div>}

            {!loading && runners.length === 0 && (
                <div className="text-center py-16 text-slate-400 text-sm">
                    <Terminal size={36} className="mx-auto mb-3 opacity-25" />
                    <p>{t('codeRunners.empty')}</p>
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
                                    title={t('codeRunners.restart')}
                                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-300 disabled:opacity-50">
                                    {actionLoading[runner.id] === 'restart' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                                </button>
                                <button onClick={() => openInstall(runner)} title={t('codeRunners.installPkg')}
                                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-300">
                                    <Package size={14} />
                                </button>
                                <button onClick={() => openLog(runner)} title={t('codeRunners.viewLogs')}
                                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-400">
                                    <Terminal size={14} />
                                </button>
                                <button onClick={() => toggleInlineLog(runner.id)} title={t('codeRunners.toggleInlineLog')}
                                    className={`p-1.5 rounded-lg border text-slate-500 hover:text-indigo-600 hover:border-indigo-300 ${expandedLogs.has(runner.id) ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'border-slate-200'}`}>
                                    {expandedLogs.has(runner.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                            </div>
                        </div>

                        {/* Inline log panel */}
                        {expandedLogs.has(runner.id) && (
                            <div className="border-t border-slate-100 bg-slate-900">
                                <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700">
                                    <span className="text-xs text-slate-400 font-mono">{t('codeRunners.inlineStdout')}</span>
                                    <button onClick={() => setInlineLogs(p => ({ ...p, [runner.id]: [] }))}
                                        className="text-xs text-slate-500 hover:text-slate-300">{t('codeRunners.clear')}</button>
                                </div>
                                <div className="h-40 overflow-auto p-3 font-mono text-xs text-emerald-300 space-y-0.5">
                                    {(!inlineLogs[runner.id] || inlineLogs[runner.id].length === 0) && (
                                        <p className="text-slate-500 italic">{t('codeRunners.waitingOutput')}</p>
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
                                <span className="font-semibold text-slate-800 text-sm">{t('codeRunners.installTitle', { name: installDialog.runner.name })}</span>
                            </div>
                            <button onClick={() => setInstallDialog(null)} className="p-1 rounded text-slate-400 hover:text-slate-600"><X size={15} /></button>
                        </div>
                        <div className="p-5 space-y-3">
                            <p className="text-xs text-slate-500">{t('codeRunners.installHint')}</p>
                            <div className="flex flex-wrap gap-1.5 min-h-8">
                                {installPkgs.map(p => (
                                    <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 rounded text-xs text-emerald-700 font-mono">
                                        {p}
                                        <button type="button" onClick={() => setInstallPkgs(ps => ps.filter(x => x !== p))}><X size={10} /></button>
                                    </span>
                                ))}
                                {installPkgs.length === 0 && <span className="text-xs text-slate-400 italic">{t('codeRunners.installEmptyHint')}</span>}
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
                                    placeholder={t('codeRunners.installPkgPlaceholder')}
                                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 font-mono"
                                />
                                <button type="button" onClick={() => {
                                    const t = installPkgInput.trim()
                                    if (t && !installPkgs.includes(t)) setInstallPkgs(p => [...p, t])
                                    setInstallPkgInput('')
                                }} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:border-emerald-300">{t('codeRunners.add')}</button>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
                            <button onClick={() => setInstallDialog(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('codeRunners.cancel')}</button>
                            <button onClick={() => doInstall(installDialog.runner, installPkgs)}
                                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 flex items-center gap-1.5">
                                <Package size={14} />{t('codeRunners.runInstall')}
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
                                    {logModal.mode === 'install' ? t('codeRunners.installPkg') : t('codeRunners.logTitle')} — {logModal.name}
                                </span>
                            </div>
                            <button onClick={closeModal} className="p-1 rounded text-slate-400 hover:text-slate-200"><X size={15} /></button>
                        </div>
                        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-emerald-300 space-y-0.5">
                            {logLines.length === 0 && <p className="text-slate-500 italic">{t('codeRunners.waitingOutput')}</p>}
                            {logLines.map((line, i) => <div key={i}>{line}</div>)}
                            <div ref={logEndRef} />
                        </div>
                        <div className="px-5 py-3 border-t border-slate-700 flex justify-end">
                            <button onClick={() => setLogLines([])} className="text-xs text-slate-400 hover:text-slate-200 mr-4">{t('codeRunners.clear')}</button>
                            <button onClick={closeModal} className="px-3 py-1.5 bg-slate-700 text-slate-200 rounded-lg text-xs hover:bg-slate-600">{t('codeRunners.close')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
