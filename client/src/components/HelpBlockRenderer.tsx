/**
 * HelpBlockRenderer — renders block-based help content from API data.
 * Each "block" is a typed object (para, tip, note, table, steps, etc.)
 * that maps to the same JSX components used in the original HelpPage.
 */
import {
  ChevronRight, Info, Lightbulb,
  BookOpen, MessageSquare, Upload, History, Download,
  User, Cpu, Zap, Settings, Terminal, Globe,
  ImageIcon, Clock, Share2, GitFork, Sparkles,
  Database, DollarSign, BarChart3, Server, Layers, BookMarked,
  LayoutTemplate, Lock,
} from 'lucide-react'

// ── Icon mapping (icon name string → React element) ──────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  BookOpen: <BookOpen size={22} />,
  User: <User size={22} />,
  Settings: <Settings size={22} />,
  MessageSquare: <MessageSquare size={22} />,
  Cpu: <Cpu size={22} />,
  Upload: <Upload size={22} />,
  History: <History size={22} />,
  Terminal: <Terminal size={22} />,
  Clock: <Clock size={22} />,
  ImageIcon: <ImageIcon size={22} />,
  Download: <Download size={22} />,
  Share2: <Share2 size={22} />,
  Sparkles: <Sparkles size={22} />,
  Database: <Database size={22} />,
  GitFork: <GitFork size={22} />,
  Zap: <Zap size={22} />,
  Globe: <Globe size={22} />,
  DollarSign: <DollarSign size={22} />,
  BarChart3: <BarChart3 size={22} />,
  BookMarked: <BookMarked size={22} />,
  Server: <Server size={22} />,
  Layers: <Layers size={22} />,
  LayoutTemplate: <LayoutTemplate size={22} />,
  Lock: <Lock size={22} />,
}

const ICON_MAP_SMALL: Record<string, React.ReactNode> = {}
for (const [k] of Object.entries(ICON_MAP)) {
  const Comp = {
    BookOpen, User, Settings, MessageSquare, Cpu, Upload, History, Terminal,
    Clock, ImageIcon, Download, Share2, Sparkles, Database, GitFork, Zap,
    Globe, DollarSign, BarChart3, BookMarked, Server, Layers, LayoutTemplate, Lock,
  }[k]
  if (Comp) ICON_MAP_SMALL[k] = <Comp size={18} />
}

export function getIcon(name: string, size: 'sm' | 'lg' = 'lg') {
  return size === 'sm' ? (ICON_MAP_SMALL[name] || null) : (ICON_MAP[name] || null)
}

// ── Block types ──────────────────────────────────────────────────────────────

export interface CardItem {
  emoji?: string
  title: string
  tag?: { color: string; text: string }
  desc: string
  borderColor: string
}

export interface ComparisonItem {
  title: string
  desc: string
  example?: string
  borderColor: string
}

export type HelpBlock =
  | { type: 'para'; text: string }
  | { type: 'tip'; text: string }
  | { type: 'note'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'steps'; items: { title: string; desc?: string }[] }
  | { type: 'code'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'subsection'; title: string; blocks: HelpBlock[] }
  | { type: 'card_grid'; cols: number; items: CardItem[] }
  | { type: 'comparison'; items: ComparisonItem[] }

export interface HelpSectionData {
  id: string
  sectionType: string
  sortOrder: number
  icon: string
  iconColor: string
  lastModified: string
  title: string
  sidebarLabel: string
  blocks: HelpBlock[]
  translatedAt?: string
  linkedCourseId?: number | null
  linkedLessonId?: number | null
}

// ── Inline text renderer (handles **bold** and `code`) ───────────────────────

function renderInlineText(text: string) {
  // Split by **bold** and `code` patterns
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Find first match of **bold** or `code`
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    const codeMatch = remaining.match(/`(.+?)`/)

    let firstMatch: { index: number; length: number; type: 'bold' | 'code'; content: string } | null = null

    if (boldMatch?.index !== undefined && (!codeMatch || boldMatch.index <= (codeMatch.index ?? Infinity))) {
      firstMatch = { index: boldMatch.index, length: boldMatch[0].length, type: 'bold', content: boldMatch[1] }
    } else if (codeMatch?.index !== undefined) {
      firstMatch = { index: codeMatch.index, length: codeMatch[0].length, type: 'code', content: codeMatch[1] }
    }

    if (!firstMatch) {
      parts.push(remaining)
      break
    }

    if (firstMatch.index > 0) {
      parts.push(remaining.slice(0, firstMatch.index))
    }

    if (firstMatch.type === 'bold') {
      parts.push(<strong key={key++}>{firstMatch.content}</strong>)
    } else {
      parts.push(<code key={key++} className="bg-white px-1 rounded text-sm">{firstMatch.content}</code>)
    }

    remaining = remaining.slice(firstMatch.index + firstMatch.length)
  }

  return parts
}

// ── Layout components ────────────────────────────────────────────────────────

function Section({
  id, icon, iconColor, title, children,
}: { id: string; icon: React.ReactNode; iconColor: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-12 scroll-mt-6">
      <div className={`flex items-center gap-3 mb-5 pb-3 border-b-2 ${iconColor.replace('text-', 'border-')}`}>
        <div className={`${iconColor} flex-shrink-0`}>{icon}</div>
        <h2 className="text-xl font-bold text-slate-800">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function SubSectionComp({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <ChevronRight size={16} className="text-blue-400" />
        {title}
      </h3>
      <div className="pl-5 space-y-3">{children}</div>
    </div>
  )
}

function Para({ text }: { text: string }) {
  // Handle \n as line breaks
  const lines = text.split('\n')
  return (
    <p className="text-slate-600 text-sm leading-7">
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {renderInlineText(line)}
        </span>
      ))}
    </p>
  )
}

function TipBox({ text }: { text: string }) {
  return (
    <div className="flex gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
      <Lightbulb size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
      <p className="text-blue-700 text-sm leading-6">{renderInlineText(text)}</p>
    </div>
  )
}

function NoteBox({ text }: { text: string }) {
  return (
    <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
      <Info size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <p className="text-amber-700 text-sm leading-6">{renderInlineText(text)}</p>
    </div>
  )
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto">
      <pre className="text-sm text-slate-300 font-mono leading-7 whitespace-pre-wrap">{text}</pre>
    </div>
  )
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    green: 'bg-green-100 text-green-700 border-green-200',
    purple: 'bg-purple-100 text-purple-700 border-purple-200',
    orange: 'bg-orange-100 text-orange-700 border-orange-200',
    gray: 'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[color] || styles.gray} mr-1.5`}>
      {children}
    </span>
  )
}

function StepItem({ num, title, desc }: { num: number; title: string; desc?: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5">
        {num}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-700">{renderInlineText(title)}</p>
        {desc && <p className="text-xs text-slate-500 mt-0.5 leading-5">{renderInlineText(desc)}</p>}
      </div>
    </div>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-100">
            {(headers || []).map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-sm text-left font-semibold text-slate-600">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((row, ri) => (
            <tr key={ri} className="border-t border-slate-100 hover:bg-slate-50">
              {(row || []).map((cell, ci) => (
                <td key={ci} className="px-4 py-2.5 text-sm text-left text-slate-600">{renderInlineText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Card grid colors ─────────────────────────────────────────────────────────

const BORDER_COLORS: Record<string, { border: string; bg: string; title: string; desc: string }> = {
  cyan:   { border: 'border-cyan-200',   bg: 'bg-cyan-50',   title: 'text-cyan-700',   desc: 'text-cyan-600' },
  yellow: { border: 'border-yellow-200', bg: 'bg-yellow-50', title: 'text-yellow-700', desc: 'text-yellow-600' },
  teal:   { border: 'border-teal-200',   bg: 'bg-teal-50',   title: 'text-teal-700',   desc: 'text-teal-600' },
  purple: { border: 'border-purple-200', bg: 'bg-purple-50', title: 'text-purple-700', desc: 'text-purple-600' },
  blue:   { border: 'border-blue-200',   bg: 'bg-blue-50',   title: 'text-blue-700',   desc: 'text-blue-600' },
  green:  { border: 'border-green-200',  bg: 'bg-green-50',  title: 'text-green-700',  desc: 'text-green-600' },
  orange: { border: 'border-orange-200', bg: 'bg-orange-50', title: 'text-orange-700', desc: 'text-orange-600' },
  rose:   { border: 'border-rose-200',   bg: 'bg-rose-50',   title: 'text-rose-700',   desc: 'text-rose-600' },
  indigo: { border: 'border-indigo-200', bg: 'bg-indigo-50', title: 'text-indigo-700', desc: 'text-indigo-600' },
  slate:  { border: 'border-slate-300',  bg: 'bg-slate-50',  title: 'text-slate-700',  desc: 'text-slate-600' },
  violet: { border: 'border-violet-200', bg: 'bg-violet-50', title: 'text-violet-700', desc: 'text-violet-600' },
  red:    { border: 'border-red-200',    bg: 'bg-red-50',    title: 'text-red-700',    desc: 'text-red-600' },
  amber:  { border: 'border-amber-200',  bg: 'bg-amber-50',  title: 'text-amber-700',  desc: 'text-amber-600' },
  sky:    { border: 'border-sky-200',    bg: 'bg-sky-50',    title: 'text-sky-700',    desc: 'text-sky-600' },
  emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50', title: 'text-emerald-700', desc: 'text-emerald-600' },
}

function getColorSet(color: string) {
  return BORDER_COLORS[color] || BORDER_COLORS.slate
}

// ── Block renderer ───────────────────────────────────────────────────────────

function renderBlock(block: HelpBlock, index: number): React.ReactNode {
  switch (block.type) {
    case 'para':
      return <Para key={index} text={block.text} />

    case 'tip':
      return <TipBox key={index} text={block.text} />

    case 'note':
      return <NoteBox key={index} text={block.text} />

    case 'table':
      return <Table key={index} headers={block.headers} rows={block.rows} />

    case 'steps':
      return (
        <div key={index} className="space-y-3">
          {(block.items || []).map((item, i) => (
            <StepItem key={i} num={i + 1} title={item.title} desc={item.desc} />
          ))}
        </div>
      )

    case 'code':
      return <CodeBlock key={index} text={block.text} />

    case 'list':
      return (
        <ul key={index} className="list-disc list-inside space-y-1.5 text-sm text-slate-600 leading-6">
          {(block.items || []).map((item, i) => (
            <li key={i}>{renderInlineText(item)}</li>
          ))}
        </ul>
      )

    case 'subsection':
      return (
        <SubSectionComp key={index} title={block.title}>
          {(block.blocks || []).map((b, i) => renderBlock(b, i))}
        </SubSectionComp>
      )

    case 'card_grid': {
      const gridCols = block.cols === 3 ? 'sm:grid-cols-3' : block.cols === 1 ? '' : 'sm:grid-cols-2'
      return (
        <div key={index} className={`grid grid-cols-1 ${gridCols} gap-3`}>
          {(block.items || []).map((card, i) => {
            const cs = getColorSet(card.borderColor)
            return (
              <div key={i} className={`border ${cs.border} rounded-xl p-4 ${cs.bg}`}>
                <div className="flex items-center gap-2 mb-2">
                  {card.emoji && <span className="text-lg">{card.emoji}</span>}
                  <span className={`font-semibold ${cs.title} text-sm`}>{card.title}</span>
                  {card.tag && <Tag color={card.tag.color}>{card.tag.text}</Tag>}
                </div>
                <p className={`text-xs ${cs.desc} leading-5`}>{renderInlineText(card.desc)}</p>
              </div>
            )
          })}
        </div>
      )
    }

    case 'comparison': {
      return (
        <div key={index} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(block.items || []).map((item, i) => {
            const cs = getColorSet(item.borderColor)
            return (
              <div key={i} className={`border-2 ${cs.border} rounded-xl p-4 ${cs.bg}`}>
                <div className={`font-semibold ${cs.title} text-sm mb-2`}>{item.title}</div>
                <p className={`text-xs ${cs.desc} leading-5`}>{renderInlineText(item.desc)}</p>
                {item.example && (
                  <div className={`mt-2 text-xs ${cs.desc} opacity-80`}>{item.example}</div>
                )}
              </div>
            )
          })}
        </div>
      )
    }

    default:
      return null
  }
}

// ── Main export: render a full section ────────────────────────────────────────

export function RenderHelpSection({ section }: { section: HelpSectionData }) {
  const icon = ICON_MAP[section.icon] || <BookOpen size={22} />
  return (
    <Section id={section.id} icon={icon} iconColor={section.iconColor} title={section.title}>
      {(section.blocks || []).map((block, i) => renderBlock(block, i))}
    </Section>
  )
}

export function RenderHelpSections({ sections }: { sections: HelpSectionData[] }) {
  return (
    <div>
      {sections.map(s => <RenderHelpSection key={s.id} section={s} />)}
    </div>
  )
}
