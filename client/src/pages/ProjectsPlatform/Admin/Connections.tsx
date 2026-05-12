/**
 * Connections — ERP / SQL / BI 連線管理 + Field Mapping
 *
 * 對齊 HTML demo renderConnections() + spec §15
 *
 * 5 source_type:custom_sql / custom_plsql / erp_view / erp_function / file_pull
 * 6 連線 demo
 * Field Mapping UI(視覺化拖拉箭頭)
 */

import { useState } from 'react'
import { Database, Server, FileSpreadsheet, Globe, CircleCheck, CircleX, ArrowRight, Plus, Play } from 'lucide-react'
import AdminPageShell, { type Scope } from './AdminPageShell'
import { useCrumbs } from '../Shell/PlatformContext'

const SOURCE_TYPES = [
  { key: 'custom_sql',    label: 'Custom SQL',   desc: 'SELECT only · 參數化',                            Icon: Database },
  { key: 'custom_plsql',  label: 'Custom PLSQL', desc: 'PROCEDURE · OUT params',                          Icon: Server },
  { key: 'erp_view',      label: 'ERP View',     desc: 'EBS APPS schema view',                            Icon: Database },
  { key: 'erp_function',  label: 'ERP Function', desc: 'EBS function call',                               Icon: Server },
  { key: 'file_pull',     label: 'File Pull',    desc: 'SFTP / SMB / xlsx parse',                         Icon: FileSpreadsheet },
]

const CONNECTIONS = [
  { code: 'ERP_PROD',         name: 'ERP 正式 (EBS APPS)',     type: 'erp_view',     host: 'hqdb01-vip.foxlink.com.tw:1586', schema: 'APPS',     active: true,  source_count: 12 },
  { code: 'ERP_READONLY',     name: 'ERP 唯讀 Pool',           type: 'erp_view',     host: '10.8.93.104:1589',               schema: 'APPS_RO',  active: true,  source_count: 28 },
  { code: 'SFC_PROD',         name: 'SFC 工單系統',            type: 'custom_sql',   host: 'sfc-db.foxlink.com.tw:1521',     schema: 'SFC',      active: true,  source_count: 7  },
  { code: 'BI_QUOTE_HISTORY', name: 'BI 報價歷史 view',        type: 'custom_sql',   host: 'bi-warehouse.foxlink.com.tw',    schema: 'BI',       active: true,  source_count: 5  },
  { code: 'METALS_FEED',      name: '貴金屬行情 (Westmetal)',  type: 'file_pull',    host: 'sftp://westmetal.com',           schema: '—',        active: true,  source_count: 2  },
  { code: 'AS400_LEGACY',     name: 'AS/400 舊單(deprecated)', type: 'custom_plsql', host: 'as400.foxlink.com.tw',           schema: 'LEGACY',   active: false, source_count: 0  },
]

const SAMPLE_MAPPING = {
  source: 'ERP_READONLY.APPS_RO.V_CUSTOMER_INFO',
  fields: [
    { src: 'CUST_CODE',   dst: 'customer_code',  type: 'VARCHAR2(20)' },
    { src: 'CUST_NAME',   dst: 'customer_name',  type: 'VARCHAR2(100)' },
    { src: 'TIER_LEVEL',  dst: 'customer_tier',  type: 'CHAR(1)' },
    { src: 'CREDIT_LIMIT', dst: '(不映射)',       type: 'NUMBER' },
    { src: 'CONTACT_EMAIL', dst: 'contact_email', type: 'VARCHAR2(120)' },
  ],
}

export default function Connections() {
  useCrumbs([{ label: '管理' }, { label: '連線管理' }])
  const [scope, setScope] = useState<Scope>('SYSTEM')
  const [activeConn, setActiveConn] = useState(CONNECTIONS[0].code)

  return (
    <AdminPageShell
      title="連線管理 (ERP / SQL / BI)"
      subtitle="5 source_type · 視覺化 Field Mapping · 走 inboundResolver"
      specLink={{ label: 'spec §15', href: '/docs/projects-platform-spec.md' }}
      scope={scope} onScope={setScope}
      actions={
        <>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded">📊 拉值歷史</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-cortex-cyan text-cortex-navy font-bold rounded"><Plus size={12} /> 新連線</button>
        </>
      }
    >
      {/* Source types */}
      <div className="bg-white border border-cortex-line rounded-xl p-4">
        <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-widest mb-2.5">支援的 source_type ({SOURCE_TYPES.length})</div>
        <div className="grid grid-cols-5 gap-2.5">
          {SOURCE_TYPES.map((s) => {
            const Icon = s.Icon
            return (
              <div key={s.key} className="bg-gradient-to-b from-cortex-bg to-white border border-cortex-line rounded-lg p-3">
                <Icon size={18} className="text-cortex-teal mb-1.5" />
                <div className="text-[12px] font-bold text-cortex-ink">{s.label}</div>
                <div className="text-[10px] text-cortex-muted mt-1 leading-snug">{s.desc}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Connections list */}
      <div className="bg-white border border-cortex-line rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-cortex-line bg-cortex-bg flex items-center justify-between">
          <div className="text-[13px] font-bold text-cortex-ink">連線清單 ({CONNECTIONS.length})</div>
          <span className="text-[10px] text-cortex-muted">點任一連線 → 看 Field Mapping</span>
        </div>
        <div className="divide-y divide-cortex-line">
          <div className="grid grid-cols-[130px_1fr_120px_180px_100px_80px_80px] gap-3 px-4 py-2 bg-cortex-line-2/30 text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
            <div>Code</div>
            <div>名稱</div>
            <div>類型</div>
            <div>Host</div>
            <div>Schema</div>
            <div className="text-center">狀態</div>
            <div className="text-center">Sources</div>
          </div>
          {CONNECTIONS.map((c) => (
            <button
              key={c.code}
              onClick={() => setActiveConn(c.code)}
              className={`w-full text-left grid grid-cols-[130px_1fr_120px_180px_100px_80px_80px] gap-3 px-4 py-2.5 items-center text-[11px] transition ${
                activeConn === c.code ? 'bg-cortex-cyan-bg/40' : 'hover:bg-cortex-bg'
              }`}
            >
              <span className="font-mono font-bold text-cortex-ocean">{c.code}</span>
              <span className="text-cortex-ink font-semibold">{c.name}</span>
              <span className="text-[10px] bg-cortex-bg text-cortex-text px-1.5 py-0.5 rounded border border-cortex-line font-mono inline-block w-fit">{c.type}</span>
              <span className="font-mono text-[10px] text-cortex-muted truncate">{c.host}</span>
              <span className="font-mono text-[10px] text-cortex-text">{c.schema}</span>
              <div className="text-center">
                {c.active ? (
                  <CircleCheck size={14} className="text-cortex-green inline-block" />
                ) : (
                  <CircleX size={14} className="text-cortex-muted inline-block" />
                )}
              </div>
              <span className="text-center font-mono text-cortex-text font-bold">{c.source_count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Field Mapping UI */}
      <div className="bg-white border border-cortex-line rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[13px] font-bold text-cortex-ink">Field Mapping(視覺化)</div>
            <div className="text-[11px] text-cortex-muted mt-0.5">
              source: <span className="font-mono text-cortex-ocean">{SAMPLE_MAPPING.source}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] border border-cortex-line bg-white rounded">
              <Play size={11} /> 測試拉值
            </button>
            <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] bg-cortex-cyan text-cortex-navy font-bold rounded">
              💾 儲存
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_60px_1fr] gap-3 items-start">
          {/* Source columns */}
          <div className="bg-cortex-bg border border-cortex-line rounded-lg p-3">
            <div className="text-[10px] font-bold text-cortex-ocean uppercase tracking-widest mb-2">SOURCE 欄位</div>
            {SAMPLE_MAPPING.fields.map((f) => (
              <div key={f.src} className="bg-white border border-cortex-line rounded px-2.5 py-1.5 mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[12px] text-cortex-ink">{f.src}</span>
                <span className="text-[9px] text-cortex-muted">{f.type}</span>
              </div>
            ))}
          </div>

          {/* Arrows */}
          <div className="flex flex-col gap-1.5 mt-7 items-center">
            {SAMPLE_MAPPING.fields.map((f, i) => (
              <div key={i} className="h-7 flex items-center w-full">
                {f.dst === '(不映射)' ? (
                  <span className="text-cortex-muted text-[10px] italic w-full text-center">×</span>
                ) : (
                  <div className="w-full flex items-center gap-1">
                    <div className="flex-1 h-px bg-cortex-cyan/50" />
                    <ArrowRight size={11} className="text-cortex-cyan" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Form fields */}
          <div className="bg-cortex-cyan-bg/40 border border-cortex-cyan/30 rounded-lg p-3">
            <div className="text-[10px] font-bold text-cortex-teal uppercase tracking-widest mb-2">FORM 欄位</div>
            {SAMPLE_MAPPING.fields.map((f) => (
              <div key={f.src} className={`bg-white border rounded px-2.5 py-1.5 mb-1.5 ${f.dst === '(不映射)' ? 'border-dashed border-cortex-line opacity-50' : 'border-cortex-cyan/40'}`}>
                <span className={`font-mono text-[12px] ${f.dst === '(不映射)' ? 'text-cortex-muted italic' : 'text-cortex-ink'}`}>{f.dst}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-cortex-cyan-bg/40 border-l-2 border-cortex-cyan rounded-r p-2.5 mt-3 text-[11px] text-cortex-teal">
          💡 拉值機制:Wizard Step 1 / Form 載入時觸發 → inboundResolver 跑 SQL → 走 ERP 唯讀 pool → 結果 snapshot 進 project_erp_snapshots
        </div>
      </div>

      {/* 安全 banner */}
      <div className="bg-gradient-to-br from-cortex-red-bg/40 to-white border border-red-200 rounded-xl p-3.5">
        <div className="flex gap-3">
          <Globe size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <div className="text-[12px] font-bold text-red-700 mb-1">🔒 安全規範</div>
            <ul className="text-[11px] text-cortex-text space-y-0.5 leading-relaxed">
              <li>• Custom SQL <strong>只允許 SELECT</strong>,server-side 解析 + 參數化(防 SQL injection)</li>
              <li>• 走 <strong>ERP read-only role</strong>,絕不能用 admin/owner credential</li>
              <li>• 拉值結果 snapshot 進 <code className="font-mono bg-white px-1 rounded">project_erp_snapshots</code> 表(GUI 顯示拉值時間 + refresh 按鈕)</li>
              <li>• 每次拉值有 audit log(誰、何時、哪個 source、回幾筆)</li>
            </ul>
          </div>
        </div>
      </div>
    </AdminPageShell>
  )
}
