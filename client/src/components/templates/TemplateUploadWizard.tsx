import { useState, useRef } from 'react'
import { Upload, X, CheckCircle, AlertCircle } from 'lucide-react'
import api from '../../lib/api'
import { TemplateSchema, TemplateVariable } from '../../types'
import VariableSchemaEditor from './VariableSchemaEditor'

interface Props {
  onCreated: () => void
  onClose: () => void
}

type Step = 1 | 2 | 3

export default function TemplateUploadWizard({ onCreated, onClose }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [schema, setSchema] = useState<TemplateSchema | null>(null)
  const [tempFile, setTempFile] = useState('')
  const [format, setFormat] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() || ''
    if (!['docx', 'xlsx', 'pdf', 'pptx'].includes(ext)) {
      setError('僅支援 DOCX、XLSX、PPTX、PDF 格式')
      return
    }
    setFile(f)
    setName(f.name.replace(/\.[^.]+$/, ''))
    setError('')
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setUploadMsg('上傳中...')
    setError('')

    const fd = new FormData()
    fd.append('file', file)

    try {
      const response = await fetch('/api/doc-templates/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: fd,
      })

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('event: ')) continue
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))
            if (data.message) setUploadMsg(data.message)
            if (data.schema) {
              setSchema(data.schema)
              setTempFile(data.temp_file)
              setFormat(data.format)
            }
            if (data.message === undefined && data.schema === undefined) {
              // done event
            }
          }
        }
      }

      setStep(2)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
      setUploadMsg('')
    }
  }

  const handleCreate = async () => {
    if (!name.trim()) { setError('請輸入範本名稱'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/doc-templates', {
        name: name.trim(),
        description,
        format,
        tags,
        is_public: isPublic,
        schema_json: schema,
        temp_file: tempFile,
      })
      onCreated()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const addTag = () => {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagInput('')
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[800px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-4">
            <span className="font-medium text-sm">新增文件範本</span>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              {[1, 2, 3].map(s => (
                <span key={s} className={`flex items-center gap-1 ${step === s ? 'text-blue-600 font-medium' : step > s ? 'text-green-600' : ''}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${step === s ? 'bg-blue-600 text-white' : step > s ? 'bg-green-500 text-white' : 'bg-slate-200'}`}>{s}</span>
                  {s === 1 ? '上傳' : s === 2 ? '確認變數' : '儲存設定'}
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {error && (
            <div className="mb-3 flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded p-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* Step 1 */}
          {step === 1 && (
            <div className="flex flex-col items-center gap-4">
              <div
                className="w-full border-2 border-dashed border-slate-300 rounded-lg p-12 flex flex-col items-center gap-3 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition"
                onClick={() => inputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              >
                <Upload size={32} className="text-slate-400" />
                <div className="text-sm text-slate-600">拖放檔案至此，或點擊選擇</div>
                <div className="text-xs text-slate-400">支援 DOCX / XLSX / PPTX / PDF，最大 50MB</div>
              </div>
              <input ref={inputRef} type="file" className="hidden" accept=".docx,.xlsx,.pdf,.pptx" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

              {file && (
                <div className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 border rounded px-4 py-2 w-full">
                  <CheckCircle size={16} className="text-green-500" />
                  {file.name} ({(file.size / 1024).toFixed(1)} KB)
                  <button className="ml-auto text-slate-400" onClick={() => setFile(null)}><X size={14} /></button>
                </div>
              )}

              {uploading && (
                <div className="text-sm text-blue-600 animate-pulse">{uploadMsg}</div>
              )}
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && schema && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-medium">AI 識別到 {schema.variables.length} 個變數</div>
                  {schema.confidence !== undefined && (
                    <div className="text-xs text-slate-400">信心度 {Math.round(schema.confidence * 100)}%{schema.notes ? ` · ${schema.notes}` : ''}</div>
                  )}
                </div>
              </div>
              <VariableSchemaEditor
                variables={schema.variables}
                onChange={vars => setSchema({ ...schema, variables: vars })}
              />
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="text-xs text-slate-500 block mb-1">範本名稱 *</label>
                <input
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="輸入範本名稱"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">描述</label>
                <textarea
                  className="w-full border rounded px-3 py-2 text-sm"
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="選填說明"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">標籤</label>
                <div className="flex flex-wrap gap-1 mb-1">
                  {tags.map(t => (
                    <span key={t} className="flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                      {t}
                      <button onClick={() => setTags(tags.filter(x => x !== t))}><X size={10} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border rounded px-2 py-1 text-xs"
                    placeholder="輸入標籤後按 Enter"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                  />
                  <button onClick={addTag} className="text-xs px-2 py-1 border rounded text-slate-600">新增</button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-500">公開範本</label>
                <button
                  onClick={() => {
                    if (!isPublic) {
                      if (!window.confirm('確定要公開此範本嗎？\n\n公開後，所有使用者都可以：\n• 瀏覽此範本的內容與變數設定\n• 使用此範本生成文件\n• 複製此範本為自己的副本')) return
                    }
                    setIsPublic(!isPublic)
                  }}
                  className={`w-10 h-5 rounded-full transition relative ${isPublic ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition ${isPublic ? 'left-5' : 'left-0.5'}`} />
                </button>
                {isPublic && <span className="text-xs text-blue-600">所有使用者可瀏覽</span>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between px-5 py-3 border-t">
          <button
            onClick={() => step > 1 ? setStep((step - 1) as Step) : onClose()}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            {step === 1 ? '取消' : '← 上一步'}
          </button>
          <div className="flex gap-2">
            {step === 1 && (
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {uploading ? '分析中...' : '下一步 →'}
              </button>
            )}
            {step === 2 && (
              <button
                onClick={() => setStep(3)}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                下一步 →
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '建立中...' : '建立範本'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
