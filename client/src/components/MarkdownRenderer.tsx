import { useState } from 'react'
import { copyText } from '../lib/clipboard'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'

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

export default function MarkdownRenderer({ content, className = '' }: Props) {
  return (
    <div className={`prose-chat ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
