import { useState, useRef, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

export default function TagInput({ tags, onChange, placeholder = '輸入標籤後按 Enter', required, disabled, className }: TagInputProps) {
  const [input, setInput] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const addTag = (val: string) => {
    const t = val.trim()
    if (!t || tags.includes(t)) return
    onChange([...tags, t])
    setInput('')
  }

  const removeTag = (idx: number) => {
    onChange(tags.filter((_, i) => i !== idx))
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(input)
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags.length - 1)
    }
  }

  return (
    <div
      className={`flex flex-wrap gap-1.5 items-center border border-slate-200 rounded-lg px-2 py-1.5 min-h-[38px] focus-within:ring-2 focus-within:ring-blue-400 bg-white ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${className || ''}`}
      onClick={() => ref.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span key={i} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
          {tag}
          {!disabled && (
            <button type="button" onClick={(e) => { e.stopPropagation(); removeTag(i); }} className="hover:text-blue-900">
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      <input
        ref={ref}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={tags.length === 0 ? placeholder : ''}
        disabled={disabled}
        className="flex-1 min-w-[80px] text-sm outline-none bg-transparent"
      />
      {required && tags.length === 0 && (
        <span className="text-red-400 text-xs">*必填</span>
      )}
    </div>
  )
}
