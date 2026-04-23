/**
 * PinChartButton — Phase 5:把 chat inline chart 釘選到「我的圖庫」
 *
 * 設計:
 *   - 點擊 → 彈 prompt 取 title → POST /api/user-charts
 *   - 若 chart 來源是 tool(tool_call_id 推斷),帶上 source_tool 欄位
 *   - freeform chart(無 tool 來源):仍可釘選 = 私人收藏(分享 UI 會 disable)
 *
 * 暫不在此處做 source_tool 自動推斷 — 由 ChatPage 透過 onPinChart callback
 * 在 inline chart 渲染時注入 source 元資料(因為 tool_call_id → tool ref 的對應只有 ChatPage 知道)。
 */
import { useState } from 'react'
import { Star, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import type { InlineChartSpec, UserChartParam } from '../../types'

interface Props {
  spec: InlineChartSpec
  /** 來自 chat 的元資料,讓 user_charts.source_* 欄位可填 */
  source?: {
    type?: 'mcp' | 'erp' | 'skill' | 'self_kb' | 'dify' | 'chat_freeform'
    tool?: string                  // 'erp:42' / 'mcp:5:get_inv'
    tool_version?: string
    schema_hash?: string
    prompt?: string
    params?: UserChartParam[]
    /** 工具呼叫當時的實際參數(ERP 含 P_ORG_ID 等);server 會據此自動產 params template */
    source_args?: Record<string, unknown>
    session_id?: string
    message_id?: number
  }
}

export default function PinChartButton({ spec, source }: Props) {
  const { t } = useTranslation()
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)

  const handlePin = async () => {
    if (busy || pinned) return
    const defaultTitle = spec.title || t('chart.pin.defaultTitle', '我的圖表')
    const title = window.prompt(t('chart.pin.askTitle', '為這張圖命名:'), defaultTitle)
    if (!title || !title.trim()) return

    setBusy(true)
    try {
      await api.post('/user-charts', {
        title: title.trim(),
        chart_spec: spec,
        source_type: source?.type || 'chat_freeform',
        source_tool: source?.tool || null,
        source_tool_version: source?.tool_version || null,
        source_schema_hash: source?.schema_hash || null,
        source_prompt: source?.prompt || null,
        source_params: source?.params || null,
        // 若有 source_args(ERP 路徑的原始呼叫參數),server 會自動對應 tool metadata 產出 params template
        source_args: source?.source_args || null,
        source_session_id: source?.session_id || null,
        source_message_id: source?.message_id || null,
      })
      setPinned(true)
    } catch (e) {
      console.error('[PinChart] failed:', e)
      alert(t('chart.pin.failed', '釘選失敗:') + (e instanceof Error ? e.message : 'unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={handlePin}
      disabled={busy || pinned}
      title={pinned ? t('chart.pin.done', '已加入圖庫') : t('chart.pin.button', '釘選到圖庫')}
      className={`p-1.5 rounded bg-white/90 border border-slate-200 transition ${
        pinned
          ? 'text-amber-500'
          : busy
            ? 'text-slate-300'
            : 'text-slate-500 hover:text-amber-500 hover:bg-white'
      }`}
    >
      {pinned ? <Check size={13} /> : <Star size={13} />}
    </button>
  )
}
