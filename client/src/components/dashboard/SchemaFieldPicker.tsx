/**
 * SchemaFieldPicker — 從目前 design 的 schema 選取欄位，插入到 textarea 游標位置
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import type { AiSchemaDef, AiSchemaColumn } from '../../types'

interface Props {
  designId: number
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onInsert: (text: string) => void
  onClose: () => void
}

export default function SchemaFieldPicker({ designId, textareaRef, onInsert, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const [schemas, setSchemas] = useState<AiSchemaDef[]>([])
  const [search, setSearch] = useState('')
  const [activeSchema, setActiveSchema] = useState<number | null>(null) // null = 全部
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [insertMode, setInsertMode] = useState<'name' | 'desc'>('desc')
  const [loading, setLoading] = useState(true)
  const [width, setWidth] = useState(400)
  const pickerRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartW = useRef(0)

  useEffect(() => {
    if (!designId) { setLoading(false); return }
    api.get(`/dashboard/schemas-for-design/${designId}`)
      .then((r: { data: AiSchemaDef[] }) => {
        const data = r.data || []
        setSchemas(data)
        const pickable = data.filter(s => !s.where_only)
        if (pickable.length === 1) setActiveSchema(pickable[0].id!)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [designId])

  // 點擊外部關閉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // 拖拉左邊緣改變寬度
  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartW.current = width

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const delta = resizeStartX.current - ev.clientX  // 往左拖 = 變寬
      setWidth(Math.max(320, Math.min(760, resizeStartW.current + delta)))
    }
    const onUp = () => {
      isResizing.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function colLabel(col: AiSchemaColumn): string {
    const lang = i18n.language
    if (lang === 'en') return col.desc_en || col.description || col.column_name
    if (lang === 'vi') return col.desc_vi || col.description || col.column_name
    return col.description || col.column_name
  }

  function schemaLabel(s: AiSchemaDef): string {
    const lang = i18n.language
    if (lang === 'en') return s.display_name_en || s.display_name || s.table_name
    if (lang === 'vi') return s.display_name_vi || s.display_name || s.table_name
    return s.display_name || s.table_name
  }

  // 過濾掉「僅WHERE」的 schema — 它們只作為 AI WHERE 條件上下文，不顯示在欄位選擇器
  const pickableSchemas = schemas.filter(s => !s.where_only)

  const visibleSchemas = activeSchema
    ? pickableSchemas.filter(s => s.id === activeSchema)
    : pickableSchemas

  const filteredSchemas = visibleSchemas.map(s => ({
    ...s,
    columns: (s.columns || []).filter(c => {
      if (!search) return true
      const q = search.toLowerCase()
      return c.column_name.toLowerCase().includes(q) || colLabel(c).toLowerCase().includes(q)
    }),
  })).filter(s => s.columns.length > 0 || !search)

  function toggleCol(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function insertSelected() {
    const allCols: AiSchemaColumn[] = schemas.flatMap(s => s.columns || [])
    const texts = [...selected].map(key => {
      const col = allCols.find(c => c.column_name === key)
      if (!col) return key
      return insertMode === 'name' ? col.column_name : colLabel(col)
    })
    if (!texts.length) return

    const ta = textareaRef.current
    if (ta) {
      const start = ta.selectionStart ?? ta.value.length
      const end = ta.selectionEnd ?? ta.value.length
      const insertText = texts.join('、')
      const newVal = ta.value.slice(0, start) + insertText + ta.value.slice(end)
      onInsert(newVal)
      setTimeout(() => {
        ta.focus()
        ta.setSelectionRange(start + insertText.length, start + insertText.length)
      }, 0)
    } else {
      onInsert(texts.join('、'))
    }
    setSelected(new Set())
    onClose()
  }

  return (
    <div
      ref={pickerRef}
      className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-xl"
      style={{ width, maxHeight: 520, display: 'flex', flexDirection: 'column', top: '100%', right: 0, marginTop: 4 }}
    >
      {/* 左側拖拉調寬把手 */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize rounded-l-lg hover:bg-blue-200 transition-colors"
        style={{ zIndex: 10 }}
      />

      {/* Header: 搜尋 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 6h18M3 14h10" />
        </svg>
        <input
          autoFocus
          type="text"
          placeholder={t('aiDash.fp.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 text-sm outline-none"
        />
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Table/View 切換 tabs（多個 schema 時才顯示） */}
      {pickableSchemas.length > 1 && (
        <div className="flex gap-1 px-2 py-1.5 border-b border-gray-100 overflow-x-auto flex-shrink-0">
          <button
            onClick={() => setActiveSchema(null)}
            className={`px-2.5 py-1 rounded text-xs whitespace-nowrap transition
              ${activeSchema === null ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
          >{t('aiDash.fp.all')}</button>
          {pickableSchemas.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSchema(s.id!)}
              className={`px-2.5 py-1 rounded text-xs whitespace-nowrap transition
                ${activeSchema === s.id ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
            >{schemaLabel(s)}</button>
          ))}
        </div>
      )}

      {/* 插入方式 */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs flex-shrink-0">
        <span className="text-gray-500 mr-1">{t('aiDash.fp.insertAs')}</span>
        <button
          onClick={() => setInsertMode('desc')}
          className={`px-2 py-0.5 rounded ${insertMode === 'desc' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-200'}`}
        >{t('aiDash.fp.insertDesc')}</button>
        <button
          onClick={() => setInsertMode('name')}
          className={`px-2 py-0.5 rounded ${insertMode === 'name' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-200'}`}
        >{t('aiDash.fp.insertName')}</button>
        {selected.size > 0 && (
          <span className="ml-auto text-gray-400">{t('aiDash.fp.selected', { count: selected.size })}</span>
        )}
      </div>

      {/* Column list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {loading && <div className="text-sm text-gray-400 text-center py-4">{t('aiDash.fp.loading')}</div>}
        {!loading && filteredSchemas.length === 0 && (
          <div className="text-sm text-gray-400 text-center py-4">{t('aiDash.fp.noMatch')}</div>
        )}
        {filteredSchemas.map(schema => (
          <div key={schema.id} className="mb-2">
            {/* 只有「全部」模式才顯示 schema 標題 */}
            {activeSchema === null && schemas.length > 1 && (
              <div className="text-xs font-semibold text-blue-600 px-1 py-1 sticky top-0 bg-white border-b border-gray-100 mb-1">
                {schemaLabel(schema)}
              </div>
            )}
            {(schema.columns || []).map(col => {
              const key = col.column_name
              const label = colLabel(col)
              const isSelected = selected.has(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleCol(key)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors
                    ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}
                >
                  <div className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center
                    ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                        <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    )}
                  </div>
                  {/* 說明欄：flex-1，不截斷，自然換行 */}
                  <span className="flex-1 leading-snug">{label}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0 ml-1 font-mono">{col.column_name}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      {selected.size > 0 && (
        <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-gray-500">{t('aiDash.fp.selected', { count: selected.size })}</span>
          <button
            onClick={insertSelected}
            className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
          >
            {t('aiDash.fp.insertBtn')}
          </button>
        </div>
      )}
    </div>
  )
}
