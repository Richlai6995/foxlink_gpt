import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, Maximize2, X, Clipboard, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { copyText } from '../lib/clipboard'
import type { ChatArtifact } from '../types'

/**
 * ArtifactCard — MCP / Skill 直出 MD/HTML artifact (Phase 1 inline)
 * 詳見 docs/tool-artifact-passthrough.md §7.3
 *
 * 安全:
 *   - HTML 走 sandboxed iframe(allow-scripts only;不給 same-origin / popup / top-nav)
 *   - MD 用獨立 ReactMarkdown,不啟 rehype-raw → raw HTML 會被當文字
 */

const fmtSize = (n: number) => {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function downloadArtifact(a: ChatArtifact) {
  const ext = a.mime_type === 'text/html' ? 'html' : 'md'
  const safeTitle = (a.title || 'artifact').replace(/[^\w一-鿿\-_. ()]/g, '_').slice(0, 80)
  const blob = new Blob([a.content], { type: `${a.mime_type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeTitle}.${ext}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function ArtifactHeader({ artifact, onFullscreen }: { artifact: ChatArtifact; onFullscreen?: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between text-xs text-slate-500 px-3 py-1.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700 rounded-t-lg">
      <div className="flex items-center gap-2 truncate">
        <ExternalLink size={12} className="shrink-0" />
        <span className="font-medium text-slate-700 dark:text-slate-300 truncate" title={artifact.title}>
          {artifact.title || t('chat.artifact.untitled')}
        </span>
        <span className="text-slate-400">· {artifact.tool_name || artifact.source_type}</span>
        <span className="text-slate-400">· {fmtSize(artifact.size)}</span>
      </div>
      {onFullscreen && (
        <button
          onClick={onFullscreen}
          className="hover:text-slate-700 dark:hover:text-slate-200"
          title={t('chat.artifact.fullscreen')}
        >
          <Maximize2 size={14} />
        </button>
      )}
    </div>
  )
}

function ArtifactActions({ artifact }: { artifact: ChatArtifact }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [copyErr, setCopyErr] = useState(false)

  const onCopy = async () => {
    try {
      await copyText(artifact.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyErr(true)
      setTimeout(() => setCopyErr(false), 3000)
    }
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-800/30 border-t border-slate-200 dark:border-slate-700 rounded-b-lg">
      {artifact.mime_type === 'text/markdown' && (
        <button onClick={onCopy} className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
          <Clipboard size={12} />
          {copied ? t('chat.artifact.copySuccess') : copyErr ? t('chat.artifact.copyFailed') : t('chat.artifact.copyMd')}
        </button>
      )}
      <button onClick={() => downloadArtifact(artifact)} className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
        <Download size={12} />
        {t('chat.artifact.download')}
      </button>
      <span className="ml-auto text-slate-400 text-[11px] truncate" title={t('chat.artifact.analyzeHint')}>
        💡 {t('chat.artifact.analyzeHint')}
      </span>
    </div>
  )
}

function FullscreenModal({ artifact, onClose }: { artifact: ChatArtifact; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700">
          <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{artifact.title}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800" title={t('chat.artifact.closeFullscreen')}>
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {artifact.mime_type === 'text/markdown' ? (
            <div className="prose-chat p-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
            </div>
          ) : (
            <iframe
              srcDoc={artifact.content}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              title={artifact.title}
              className="w-full h-full border-0"
            />
          )}
        </div>
        <ArtifactActions artifact={artifact} />
      </div>
    </div>
  )
}

export default function ArtifactCard({ artifact }: { artifact: ChatArtifact }) {
  const [fullscreen, setFullscreen] = useState(false)

  if (artifact.mime_type === 'text/markdown') {
    return (
      <div className="my-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50">
        <ArtifactHeader artifact={artifact} onFullscreen={() => setFullscreen(true)} />
        <div className="prose-chat px-3 py-2 max-h-[480px] overflow-auto">
          {/* 注意:這裡刻意 NOT 啟用 rehype-raw,raw HTML 不渲染避免 XSS */}
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
        </div>
        <ArtifactActions artifact={artifact} />
        {fullscreen && <FullscreenModal artifact={artifact} onClose={() => setFullscreen(false)} />}
      </div>
    )
  }

  // text/html
  return (
    <div className="my-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50">
      <ArtifactHeader artifact={artifact} onFullscreen={() => setFullscreen(true)} />
      <iframe
        srcDoc={artifact.content}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={artifact.title}
        style={{ width: '100%', height: 600, border: 0 }}
      />
      <ArtifactActions artifact={artifact} />
      {fullscreen && <FullscreenModal artifact={artifact} onClose={() => setFullscreen(false)} />}
    </div>
  )
}
