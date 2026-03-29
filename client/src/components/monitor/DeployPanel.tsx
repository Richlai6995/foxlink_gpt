import { useState, useRef, useEffect } from 'react'
import { Rocket, X, Clock, CheckCircle, XCircle } from 'lucide-react'
import api from '../../lib/api'
import { fmtTW } from '../../lib/fmtTW'

interface DeployRecord {
  id: number
  triggered_by_name: string
  triggered_by_username: string
  git_before: string
  git_after: string
  exit_code: number
  log_text: string
  deployed_at: string
}

interface Props {
  onRefresh: () => void
}

export default function DeployPanel({ onRefresh }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployLog, setDeployLog] = useState<string[]>([])
  const [history, setHistory] = useState<DeployRecord[]>([])
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    try {
      const { data } = await api.get('/monitor/deploy/history')
      setHistory(data)
    } catch {}
  }

  const doDeploy = () => {
    setShowConfirm(false)
    setDeploying(true)
    setDeployLog([])

    const token = localStorage.getItem('token')
    const es = new EventSource(`/api/monitor/deploy?token=${token}`)
    // Deploy uses POST but EventSource only does GET, so we use fetch with streaming instead
    es.close()

    fetch('/api/monitor/deploy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }).then(async (res) => {
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        // Parse SSE lines
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.line) {
              setDeployLog(prev => [...prev, data.line])
            }
            if (data.done) {
              setDeployLog(prev => [...prev,
                '',
                data.exitCode === 0
                  ? '=== Deploy 完成 ==='
                  : `=== Deploy 失敗 (exit code: ${data.exitCode}) ===`,
                `git: ${data.gitBefore?.slice(0, 7)} → ${data.gitAfter?.slice(0, 7)}`,
              ])
              setDeploying(false)
              loadHistory()
              onRefresh()
            }
            if (data.status) {
              setDeployLog(prev => [...prev, `[${data.status}] ${data.gitBefore || ''}`])
            }
          } catch {}
        }
      }
    }).catch(e => {
      setDeployLog(prev => [...prev, `[Error] ${e.message}`])
      setDeploying(false)
    })
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [deployLog])

  return (
    <div className="space-y-3">
      {/* Deploy Button & Confirm */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowConfirm(true)}
          disabled={deploying}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
        >
          <Rocket size={14} />
          {deploying ? 'Deploying...' : 'Deploy'}
        </button>
        {history.length > 0 && (
          <span className="text-xs text-slate-400">
            上次: {fmtTW(history[0].deployed_at)}
            {history[0].exit_code === 0
              ? <CheckCircle size={12} className="inline ml-1 text-green-500" />
              : <XCircle size={12} className="inline ml-1 text-red-500" />}
          </span>
        )}
      </div>

      {/* Confirm Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">確認 Deploy</span>
              <button onClick={() => setShowConfirm(false)}><X size={16} /></button>
            </div>
            <div className="text-sm text-slate-600">
              即將執行：
              <code className="block bg-slate-100 rounded p-2 mt-1 text-xs font-mono">
                cd ~/foxlink_gpt && git pull && ./deploy.sh
              </code>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
              >
                取消
              </button>
              <button
                onClick={doDeploy}
                className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
              >
                確認 Deploy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deploy Log */}
      {deployLog.length > 0 && (
        <div
          ref={logRef}
          className="bg-slate-900 rounded-lg font-mono text-xs text-slate-300 p-3 overflow-auto"
          style={{ maxHeight: 250 }}
        >
          {deployLog.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all leading-5">{line}</div>
          ))}
        </div>
      )}

      {/* Deploy History */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
          <Clock size={14} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-700">Deploy 歷史</span>
        </div>
        <div className="max-h-48 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 text-slate-500">時間</th>
                <th className="text-left px-3 py-1.5 text-slate-500">執行者</th>
                <th className="text-left px-3 py-1.5 text-slate-500">Git Commit</th>
                <th className="text-left px-3 py-1.5 text-slate-500">結果</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {history.map(h => (
                <>
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtTW(h.deployed_at)}</td>
                    <td className="px-3 py-1.5">{h.triggered_by_name || h.triggered_by_username}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">
                      {h.git_before?.slice(0, 7)} → {h.git_after?.slice(0, 7)}
                    </td>
                    <td className="px-3 py-1.5">
                      {h.exit_code === 0
                        ? <span className="text-green-600">成功</span>
                        : <span className="text-red-600">失敗 ({h.exit_code})</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => setExpandedLog(expandedLog === h.id ? null : h.id)}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        {expandedLog === h.id ? '收起' : 'Log'}
                      </button>
                    </td>
                  </tr>
                  {expandedLog === h.id && h.log_text && (
                    <tr key={`${h.id}-log`}>
                      <td colSpan={5} className="p-0">
                        <div className="bg-slate-900 font-mono text-[10px] text-slate-300 p-3 max-h-40 overflow-auto whitespace-pre-wrap">
                          {h.log_text}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {history.length === 0 && (
            <div className="text-center text-slate-400 text-xs py-6">尚無 Deploy 紀錄</div>
          )}
        </div>
      </div>
    </div>
  )
}
