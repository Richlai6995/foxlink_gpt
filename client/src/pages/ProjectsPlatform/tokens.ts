/**
 * Design Tokens — Cortex Projects Platform
 *
 * 對齊 docs/Cortex_互動Demo.html 的 CSS variables。
 * 同色值同時掛在 tailwind.config.js extend.colors.cortex.* 給 className 用。
 *
 * 命名跟 HTML demo 一致(navy / cyan / ocean / teal / amber / red / green ...)
 */

export const TOKENS = {
  // 色票
  navy:    '#0A2540',
  navy2:   '#11365B',
  ocean:   '#065A82',
  teal:    '#1C7293',
  cyan:    '#02C39A',
  cyanBg:  '#CFFAF1',
  amber:   '#F5A524',
  amberBg: '#FEF3C7',
  red:     '#E5484D',
  redBg:   '#FEE2E2',
  green:   '#16A34A',
  greenBg: '#DCFCE7',
  oceanBg: '#DBEAFE',

  // 中性
  ink:    '#1E293B',
  text:   '#334155',
  muted:  '#64748B',
  line:   '#E2E8F0',
  line2:  '#F1F5F9',
  bg:     '#F8FAFC',
  card:   '#FFFFFF',

  // 尺寸
  headerH:  56,
  sidebarW: 240,

  // 圓角
  radius:   8,
  radiusLg: 12,
} as const

// ─── Lifecycle 配色(對齊 demo PPT slide 13)──────────────────────
export const LIFECYCLE_COLORS: Record<
  'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'REOPENED',
  { label: string; dot: string; pill: string; ring: string }
> = {
  DRAFT:    { label: '草稿',   dot: 'bg-slate-400',     pill: 'bg-slate-100 text-slate-600 border-slate-200',                ring: 'ring-slate-200' },
  ACTIVE:   { label: '進行中', dot: 'bg-cortex-cyan',   pill: 'bg-cortex-cyan-bg text-cortex-teal border-cortex-cyan/30',    ring: 'ring-cortex-cyan/30' },
  PAUSED:   { label: '暫停',   dot: 'bg-cortex-amber',  pill: 'bg-cortex-amber-bg text-amber-700 border-amber-300',          ring: 'ring-amber-300' },
  CLOSED:   { label: '已結案', dot: 'bg-slate-500',     pill: 'bg-slate-200 text-slate-700 border-slate-300',                ring: 'ring-slate-300' },
  REOPENED: { label: '重啟',   dot: 'bg-cortex-ocean',  pill: 'bg-cortex-ocean-bg text-cortex-ocean border-blue-300',        ring: 'ring-blue-300' },
}

// ─── 訊息色語言(對齊 spec §13.4 + Sprint 2 後端)─────────────────
export const MESSAGE_STYLE: Record<
  'NORMAL' | 'PROGRESS' | 'BLOCKER' | 'DECISION' | 'AI_INSIGHT' | 'SYSTEM',
  { label: string; emoji: string; dot: string; bg: string }
> = {
  NORMAL:     { label: '一般', emoji: '',    dot: 'bg-slate-400',     bg: 'bg-white' },
  PROGRESS:   { label: '進度', emoji: '📊', dot: 'bg-blue-500',       bg: 'bg-blue-50' },
  BLOCKER:    { label: '卡關', emoji: '🚨', dot: 'bg-cortex-red',     bg: 'bg-cortex-red-bg' },
  DECISION:   { label: '決議', emoji: '✅', dot: 'bg-cortex-green',   bg: 'bg-cortex-green-bg' },
  AI_INSIGHT: { label: 'AI',   emoji: '🤖', dot: 'bg-purple-500',     bg: 'bg-purple-50' },
  SYSTEM:     { label: '系統', emoji: '⚙',  dot: 'bg-slate-500',      bg: 'bg-slate-50' },
}

// ─── 6 種 Demo 視角(對齊 demo 手冊 §10 角色)─────────────────────
export const DEMO_ROLES = [
  { key: 'HOST',              label: 'HOST',              desc: '業務主持人(全明文 / Stage Gate / 邀請)' },
  { key: 'PARTICIPANT',       label: 'PARTICIPANT',       desc: '一般成員(機密走 displayStrategy)' },
  { key: 'OBSERVER',          label: 'OBSERVER',          desc: '觀察者(唯讀 / 看明文)' },
  { key: 'CHAT_GUEST',        label: 'CHAT_GUEST',        desc: '臨時群參與者(只看 chat,form 403)' },
  { key: 'SUPER_PARTICIPANT', label: 'SUPER',             desc: 'BU/HQ 經管 self-join(看完整)' },
  { key: 'OUTSIDER',          label: 'OUTSIDER',          desc: '非成員(機密案 403)' },
] as const

export type DemoRole = typeof DEMO_ROLES[number]['key']
