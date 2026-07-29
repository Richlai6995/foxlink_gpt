/**
 * WorkflowChecklistSection — 🎬 操作流程 checklist(v0.16 plan #2)
 *
 * 26 步(Stage 4–7):auto 步由 DB 資料自動判定(唯讀勾);manual 步手動勾(存 form.workflow.done)。
 * 每步可附圖(D5:上傳截圖+圖說);action「前往」跳對應 Form section(CustomEvent cortex:goto-section)。
 */

import { useEffect, useRef, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Loader2, ChevronDown, ChevronRight, Camera, X, ArrowRight, Zap, Hand } from 'lucide-react'

type Step = { id: string; name: string; desc: string; goto: string | null; mode: 'auto' | 'manual'; done: boolean; manualDone: boolean; images: { url: string; caption?: string }[] }
type Stage = { stage: number; code: string; name: string; owner: string; color: string; steps: Step[] }

const STAGE_COLORS: Record<string, string> = {
  purple: 'border-purple-300 bg-purple-50 text-purple-700',
  blue: 'border-blue-300 bg-blue-50 text-blue-700',
  teal: 'border-teal-300 bg-teal-50 text-teal-700',
  amber: 'border-amber-300 bg-amber-50 text-amber-700',
}

export default function WorkflowChecklistSection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [data, setData] = useState<{ filled: number; total: number; stages: Stage[] } | null>(null)
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [imgStep, setImgStep] = useState<string | null>(null)   // 正在附圖的步驟
  const [caption, setCaption] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const r = await api.get<any>(token, `/bom/workflow/checklist?projectId=${projectId}`)
      setData(r)
      // 預設展開第一個未完成的 stage
      setOpen((prev) => {
        if (Object.keys(prev).length) return prev
        const o: Record<number, boolean> = {}
        const firstUndone = r.stages.find((s: Stage) => s.steps.some((x: Step) => !x.done))
        r.stages.forEach((s: Stage) => { o[s.stage] = firstUndone ? s.stage === firstUndone.stage : true })
        return o
      })
    } catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { if (token) load() }, [token, projectId])   // eslint-disable-line

  // 手動勾(整包 done map 送 PUT /form/workflow)
  async function toggleManual(step: Step) {
    if (!data) return
    setBusy(step.id); setErr('')
    try {
      const done: Record<string, string | null> = {}
      for (const st of data.stages) for (const s of st.steps) if (s.mode === 'manual' && s.manualDone) done[s.id] = 'x'
      if (step.manualDone) delete done[step.id]; else done[step.id] = new Date().toISOString()
      await api.put(token, '/bom/form/workflow', { projectId, fields: { done } })
      await load()
      window.dispatchEvent(new CustomEvent('cortex:form-refresh'))
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }

  async function uploadImage(step: Step, file: File) {
    setBusy(step.id); setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('projectId', String(projectId)); fd.append('stepId', step.id); fd.append('caption', caption)
      const res = await fetch('/api/projects/bom/workflow/step-image', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `上傳失敗 HTTP ${res.status}`)
      setCaption(''); setImgStep(null); await load()
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }

  async function delImage(step: Step, url: string) {
    if (!confirm('移除這張附圖?')) return
    setBusy(step.id)
    try { await api.delete(token, '/bom/workflow/step-image', { projectId, stepId: step.id, url }); await load() }
    catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }

  if (!data) return <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入操作流程…</div>
  const pct = Math.round((data.filled / data.total) * 100)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-bold text-cortex-ink">🎬 操作流程
          <span className="text-[10px] text-cortex-muted font-normal ml-1.5">報價全流程 26 步 · 自動判定 + 手動勾 · 可附截圖</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-28 h-1.5 bg-cortex-line/60 rounded overflow-hidden">
            <div className={`h-full ${pct >= 100 ? 'bg-green-500' : 'bg-cortex-teal'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] font-mono text-cortex-muted">{data.filled}/{data.total} · {pct}%</span>
        </div>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}

      {data.stages.map((st) => {
        const doneN = st.steps.filter((s) => s.done).length
        const isOpen = !!open[st.stage]
        return (
          <div key={st.stage} className="border border-cortex-line rounded-lg overflow-hidden">
            <button onClick={() => setOpen((p) => ({ ...p, [st.stage]: !p[st.stage] }))}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left border-l-4 ${STAGE_COLORS[st.color] || ''}`}>
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <span className="text-[12px] font-bold">Stage {st.stage} · {st.name}</span>
              <span className="text-[10px] opacity-70">{st.owner}</span>
              <span className={`ml-auto text-[10px] font-mono ${doneN === st.steps.length ? 'text-green-600 font-bold' : ''}`}>{doneN}/{st.steps.length}</span>
            </button>
            {isOpen && (
              <div className="divide-y divide-cortex-line/40">
                {st.steps.map((s) => (
                  <div key={s.id} className={`px-3 py-2 ${s.done ? 'bg-green-50/40' : ''}`}>
                    <div className="flex items-start gap-2">
                      {/* 勾:auto=唯讀 · manual=可點 */}
                      {s.mode === 'manual' ? (
                        <button onClick={() => toggleManual(s)} disabled={busy === s.id}
                          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-[10px] ${s.done ? 'bg-green-500 border-green-500 text-white' : 'border-cortex-line hover:border-cortex-teal'}`}>
                          {busy === s.id ? '·' : s.done ? '✓' : ''}
                        </button>
                      ) : (
                        <span className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${s.done ? 'bg-green-500 border-green-500 text-white' : 'border-cortex-line text-cortex-muted'}`}>
                          {s.done ? '✓' : ''}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-cortex-muted">{s.id}</span>
                          <span className={`text-[12px] ${s.done ? 'text-cortex-muted line-through decoration-green-400' : 'text-cortex-ink font-medium'}`}>{s.name}</span>
                          <span title={s.mode === 'auto' ? '自動判定(依資料)' : '手動勾選'}>
                            {s.mode === 'auto' ? <Zap className="w-3 h-3 text-cortex-teal" /> : <Hand className="w-3 h-3 text-cortex-muted" />}
                          </span>
                        </div>
                        <div className="text-[10px] text-cortex-muted mt-0.5">{s.desc}</div>
                        {/* 附圖縮圖列 */}
                        {s.images.length > 0 && (
                          <div className="flex gap-1.5 mt-1.5 flex-wrap">
                            {s.images.map((im, i) => (
                              <span key={i} className="relative group">
                                <a href={im.url} target="_blank" rel="noreferrer">
                                  <img src={im.url} alt={im.caption || s.id} title={im.caption || ''} className="h-14 rounded border border-cortex-line object-cover" />
                                </a>
                                <button onClick={() => delImage(s, im.url)}
                                  className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-4 h-4 bg-red-500 text-white rounded-full items-center justify-center"><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ))}
                          </div>
                        )}
                        {/* 附圖輸入列 */}
                        {imgStep === s.id && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="圖說(選填)"
                              className="border border-cortex-line rounded px-1.5 py-0.5 text-[10px] w-44" />
                            <button onClick={() => fileRef.current?.click()} disabled={busy === s.id}
                              className="px-2 py-0.5 bg-cortex-teal text-white rounded text-[10px]">{busy === s.id ? '上傳中…' : '選圖上傳'}</button>
                            <button onClick={() => { setImgStep(null); setCaption('') }} className="text-[10px] text-cortex-muted">取消</button>
                            <input ref={fileRef} type="file" accept="image/*" className="hidden"
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(s, f); e.target.value = '' }} />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => setImgStep(imgStep === s.id ? null : s.id)} title="附圖(截圖)"
                          className="p-1 text-cortex-muted hover:text-cortex-teal"><Camera className="w-3.5 h-3.5" /></button>
                        {s.goto && (
                          <button onClick={() => window.dispatchEvent(new CustomEvent('cortex:goto-section', { detail: s.goto }))}
                            className="flex items-center gap-0.5 text-[10px] text-cortex-teal hover:underline">前往 <ArrowRight className="w-3 h-3" /></button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <div className="text-[10px] text-cortex-muted"><Zap className="w-3 h-3 inline text-cortex-teal" /> = 自動判定(做完對應動作自動打勾)· <Hand className="w-3 h-3 inline" /> = 手動勾選 · 📷 可為每步附操作截圖</div>
    </div>
  )
}
