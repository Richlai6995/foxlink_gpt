/**
 * AI Breakdown Modal — ⭐ AI #29 任務自動拆解
 *
 * 對齊 PPT slide 21 + Demo 手冊 §8.1
 *
 * 流程:
 *   1. user 打一句話「跑越南成本」
 *   2. AI 拆 3-6 個 subtask(顯示 title / SLA / A / R)
 *   3. user 可勾選 / 編輯 / 確認
 *   4. 一鍵批次建立進 backend
 *
 * USE_LLM=false → backend stub 規則式拆解(保守省 token)
 * USE_LLM=true → backend 真 Gemini Flash
 */

import { useState } from 'react'
import { X, Sparkles, Loader2, Check, ListChecks } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api } from '../api'
import { TOKENS } from '../tokens'

type Subtask = {
  title: string
  sla_hours: number
  accountable_role: string
  responsible_role: string
}

type Props = {
  projectId: number
  stageId?: number | null
  stageCode?: string | null
  onClose: () => void
  onCreated: (count: number) => void
}

const EXAMPLE_PROMPTS = [
  '跑越南成本',
  'BOM 完整建立',
  '客戶 Q&A 回覆流程',
  'Cleansheet 三廠分析',
]

export default function AiBreakdownModal({ projectId, stageId, stageCode, onClose, onCreated }: Props) {
  const { token } = useAuth() as any
  const [prompt, setPrompt] = useState('')
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [usedLlm, setUsedLlm] = useState<boolean | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const runBreakdown = async (promptStr?: string) => {
    const p = (promptStr ?? prompt).trim()
    if (!p) return
    if (promptStr) setPrompt(promptStr)
    setBusy(true)
    setErr(null)
    try {
      const r = await api.post<{ subtasks: Subtask[]; _llm: boolean; _model: string | null }>(
        token,
        `/projects/${projectId}/tasks/ai-breakdown`,
        { prompt: p, stage_code: stageCode },
      )
      setSubtasks(r.subtasks || [])
      setSelected(new Set((r.subtasks || []).map((_, i) => i)))
      setUsedLlm(r._llm)
      setModel(r._model)
    } catch (e: any) {
      setErr(e.message || '拆解失敗')
    } finally {
      setBusy(false)
    }
  }

  const toggleSelect = (i: number) => {
    setSelected((s) => {
      const n = new Set(s)
      n.has(i) ? n.delete(i) : n.add(i)
      return n
    })
  }

  const updateField = (i: number, key: keyof Subtask, value: any) => {
    setSubtasks((ts) => ts.map((t, idx) => idx === i ? { ...t, [key]: value } : t))
  }

  const submit = async () => {
    if (selected.size === 0) return
    setCreating(true)
    setErr(null)
    try {
      const toCreate = subtasks.filter((_, i) => selected.has(i))
      const r = await api.post<{ created: number }>(
        token,
        `/projects/${projectId}/tasks/batch`,
        { tasks: toCreate, stage_id: stageId },
      )
      onCreated(r.created || 0)
      onClose()
    } catch (e: any) {
      setErr(e.message || '建立失敗')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4 font-cortex" onClick={onClose}>
      <div
        className="rounded-xl shadow-cortex-lg w-full max-w-[720px] flex flex-col overflow-hidden"
        style={{ background: '#fff', maxHeight: 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-3 border-b flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)', color: '#fff' }}
        >
          <div className="font-bold text-[14px] inline-flex items-center gap-2">
            <Sparkles size={14} className="text-amber-300" />
            ⭐ AI 任務拆解 · #29
            <span className="text-[9px] font-bold bg-amber-300/20 text-amber-200 px-1.5 py-0.5 rounded tracking-widest">
              BETA
            </span>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {/* Prompt input */}
          <div>
            <div className="text-[11px] font-bold mb-1.5" style={{ color: TOKENS.muted }}>
              1. 描述你要做什麼(一句話即可)
            </div>
            <div className="flex gap-2">
              <input
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runBreakdown() }}
                placeholder="例:跑越南成本 / BOM 完整建立 / 客戶 Q&A 流程"
                className="flex-1 h-9 px-3 rounded border text-[13px] focus:outline-none"
                style={{ borderColor: TOKENS.line, color: TOKENS.ink, background: '#fff' }}
              />
              <button
                onClick={() => runBreakdown()}
                disabled={!prompt.trim() || busy}
                className="px-4 py-2 text-[12px] font-bold rounded inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{ background: TOKENS.cyan, color: TOKENS.navy }}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                AI 拆解
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="text-[10px]" style={{ color: TOKENS.muted }}>快速試:</span>
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => runBreakdown(p)}
                  className="text-[10px] px-2 py-0.5 rounded border hover:brightness-95"
                  style={{ borderColor: TOKENS.line, color: TOKENS.text, background: TOKENS.bg }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {err && (
            <div className="text-[12px] px-3 py-2 rounded border" style={{ background: TOKENS.redBg, color: '#b91c1c', borderColor: '#fca5a5' }}>
              ⚠ {err}
            </div>
          )}

          {/* Subtasks preview */}
          {subtasks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-bold" style={{ color: TOKENS.muted }}>
                  2. AI 拆解結果 · 勾選要建立的 ({selected.size}/{subtasks.length})
                </div>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={{
                    background: usedLlm ? TOKENS.greenBg : TOKENS.amberBg,
                    color: usedLlm ? TOKENS.green : '#92400e',
                  }}
                >
                  {usedLlm ? `✓ LLM · ${model}` : '◐ 規則式 stub'}
                </span>
              </div>

              <div className="space-y-1.5">
                {subtasks.map((s, i) => {
                  const checked = selected.has(i)
                  return (
                    <div
                      key={i}
                      className="border rounded p-2.5 transition"
                      style={{
                        borderColor: checked ? TOKENS.cyan : TOKENS.line,
                        background: checked ? TOKENS.cyanBg : '#fff',
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => toggleSelect(i)}
                          className="mt-1 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition"
                          style={{
                            borderColor: checked ? TOKENS.cyan : TOKENS.line,
                            background: checked ? TOKENS.cyan : '#fff',
                          }}
                        >
                          {checked && <Check size={11} className="text-white" strokeWidth={3} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <input
                            value={s.title}
                            onChange={(e) => updateField(i, 'title', e.target.value)}
                            className="w-full text-[13px] font-semibold bg-transparent focus:outline-none border-b border-transparent focus:border-cortex-cyan"
                            style={{ color: TOKENS.ink }}
                          />
                          <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: TOKENS.muted }}>
                            <span>⏱</span>
                            <input
                              type="number"
                              value={s.sla_hours}
                              onChange={(e) => updateField(i, 'sla_hours', Math.max(1, Number(e.target.value) || 1))}
                              className="w-12 px-1 py-0.5 rounded border text-center"
                              style={{ borderColor: TOKENS.line, color: TOKENS.text }}
                            />
                            <span>h · A:</span>
                            <input
                              value={s.accountable_role}
                              onChange={(e) => updateField(i, 'accountable_role', e.target.value)}
                              className="w-16 px-1 py-0.5 rounded border text-center font-mono text-[10px] bg-red-50"
                              style={{ borderColor: '#fca5a5', color: '#b91c1c' }}
                            />
                            <span>· R:</span>
                            <input
                              value={s.responsible_role}
                              onChange={(e) => updateField(i, 'responsible_role', e.target.value)}
                              className="w-20 px-1 py-0.5 rounded border text-center font-mono text-[10px] bg-blue-50"
                              style={{ borderColor: '#93c5fd', color: '#1d4ed8' }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="text-[10px] mt-2 italic" style={{ color: TOKENS.muted }}>
                💡 prompt 可以一次描述「BOM 流程」「議價策略」「驗證步驟」之類的工作組合
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex justify-between items-center" style={{ background: TOKENS.bg, borderColor: TOKENS.line }}>
          <div className="text-[10px]" style={{ color: TOKENS.muted }}>
            <ListChecks size={11} className="inline -mt-px mr-1" />
            建立後可在任務看板繼續編輯 dependency / owner
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[13px] rounded border"
              style={{ background: '#fff', borderColor: TOKENS.line, color: TOKENS.text }}
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={selected.size === 0 || creating}
              className="px-3 py-1.5 text-[13px] font-bold rounded inline-flex items-center gap-1 disabled:opacity-50"
              style={{ background: TOKENS.cyan, color: TOKENS.navy }}
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              批次建立 ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
