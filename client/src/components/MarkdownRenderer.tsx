import { useState } from 'react'
import { copyText } from '../lib/clipboard'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'
import KbImage from './KbImage'

// 從 ![alt](kb-img://uuid) 抽 UUID;ReactMarkdown 把 src 原樣傳進來
// Fallback:Flash 系列 LLM 常漏寫 `kb-img://` 前綴或加上引號/反引號,寬鬆匹配
function extractKbImageId(src?: string): string | null {
  if (!src) return null
  const s = src.replace(/[`'"]/g, '').trim()
  // 1. 標準格式 kb-img://<uuid>
  const std = s.match(/(?:^|kb-img:\/\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  if (std) return std[1]
  // 2. 純 UUID(LLM 把 hint 內 UUID 抄進來但漏前綴)
  const bareUuid = s.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  if (bareUuid) return bareUuid[1]
  return null
}

interface Props {
  content: string
  className?: string
}

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    copyText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="relative group my-2">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded px-1.5 py-0.5 text-xs flex items-center gap-1"
        title="複製程式碼"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? '已複製' : '複製'}
      </button>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
        customStyle={{ borderRadius: '8px', margin: 0, fontSize: '13px' }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}

// ReactMarkdown 預設 urlTransform 只放行 http/https/mailto/tel/data:image,
// 我們自訂的 `kb-img://` scheme 會被 strip 成空字串 → KbImage 抓不到 id。
// 這裡 whitelist kb-img:// + 預設安全 protocols + 相對路徑。
function kbUrlTransform(url: string): string {
  if (typeof url !== 'string') return ''
  if (/^kb-img:\/\//i.test(url)) return url
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return url
  if (/^data:image\//i.test(url)) return url
  // 不含 protocol(相對路徑)放行
  if (!/^[a-z][a-z0-9+\-.]*:/i.test(url)) return url
  return ''
}

export default function MarkdownRenderer({ content, className = '' }: Props) {
  return (
    <div className={`prose-chat ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        urlTransform={kbUrlTransform}
        components={{
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const codeStr = String(children).replace(/\n$/, '')
            const isInline = !match && !codeStr.includes('\n')

            if (isInline) {
              return (
                <code className="bg-slate-100 rounded px-1 py-0.5 text-xs font-mono text-blue-700" {...props}>
                  {children}
                </code>
              )
            }

            return <CodeBlock language={match?.[1]}>{codeStr}</CodeBlock>
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="w-full border-collapse text-sm">{children}</table>
              </div>
            )
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {children}
              </a>
            )
          },
          img({ src, alt }) {
            const kbId = extractKbImageId(src as string)
            if (kbId) return <KbImage imageId={kbId} alt={alt} className="my-2" />
            const safeUrl = typeof src === 'string' && /^(https?:|data:|blob:)/i.test(src)
            if (safeUrl) {
              return <img src={src} alt={alt} className="max-w-full rounded-lg my-2" loading="lazy" />
            }
            // LLM 幻覺出來的 markdown image(檔名、相對路徑、亂寫 src) — 不 render broken icon,
            // 改成 inline 小框提示 alt text,避免使用者看到斷圖
            return (
              <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded align-middle">
                <span>📷</span><span>{alt || '圖片'}</span>
              </span>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
