import { useState } from 'react'
import { FileText, FileSpreadsheet, File, Play, Edit2, Share2, Copy, Trash2, Download, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { fmtDateTW } from '../../lib/fmtTW'
import { DocTemplate } from '../../types'
import TemplateGenerateModal from './TemplateGenerateModal'
import TemplateShareModal from './TemplateShareModal'

interface Props {
  template: DocTemplate
  onRefresh: () => void
  onEdit: (t: DocTemplate) => void
}

function FormatIcon({ format }: { format: string }) {
  if (format === 'xlsx') return <FileSpreadsheet size={20} className="text-green-600" />
  if (format === 'pdf')  return <File size={20} className="text-red-500" />
  return <FileText size={20} className="text-blue-600" />
}

const FORMAT_LABEL: Record<string, string> = { docx: 'Word', xlsx: 'Excel', pdf: 'PDF' }

export default function TemplateCard({ template, onRefresh, onEdit }: Props) {
  const { t } = useTranslation()
  const [showGenerate, setShowGenerate] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [isPublic, setIsPublic] = useState(template.is_public === 1)

  const access = template.access_level || 'use'
  const isOwner = access === 'owner'
  const canEdit = access === 'owner' || access === 'edit'
  const tags: string[] = (() => { try { return JSON.parse(template.tags || '[]') } catch { return [] } })()

  const handleFork = async () => {
    try {
      await api.post(`/doc-templates/${template.id}/fork`)
      onRefresh()
    } catch (e: unknown) {
      alert((e as Error).message)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(t('tpl.card.confirmDelete', { name: template.name }))) return
    try {
      await api.delete(`/doc-templates/${template.id}`)
      onRefresh()
    } catch (e: unknown) {
      alert((e as Error).message)
    }
  }

  const handleDownload = () => {
    const token = localStorage.getItem('token')
    const url = `/api/doc-templates/${template.id}/download`
    const a = document.createElement('a')
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        a.href = URL.createObjectURL(blob)
        a.download = `${template.name}.${template.format}`
        a.click()
        URL.revokeObjectURL(a.href)
      })
  }

  return (
    <>
      <div className="border rounded-lg p-4 bg-white hover:shadow-sm transition flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <FormatIcon format={template.format} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{template.name}</div>
            <div className="text-xs text-slate-400">
              {FORMAT_LABEL[template.format] || template.format}
              {template.creator_name && ` · ${t('tpl.card.by', { name: template.creator_name })}`}
              {template.forked_from && ` · ${t('tpl.card.forked')}`}
            </div>
          </div>
          {isPublic && <span className="text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">{t('tpl.card.public')}</span>}
        </div>

        {/* Description */}
        {template.description && (
          <div className="text-xs text-slate-500 line-clamp-2">{template.description}</div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(tg => (
              <span key={tg} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{tg}</span>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{t('tpl.card.useCount', { count: template.use_count })}</span>
          {template.created_at && (
            <span className="flex items-center gap-1"><Clock size={10} />{fmtDateTW(template.created_at)}</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-1 mt-auto pt-2 border-t">
          <button
            onClick={() => setShowGenerate(true)}
            className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Play size={11} /> {t('tpl.card.generate')}
          </button>

          <button
            onClick={handleDownload}
            className="flex items-center gap-1 text-xs px-2 py-1 border rounded text-slate-600 hover:bg-slate-50"
          >
            <Download size={11} /> {t('tpl.card.download')}
          </button>

          {canEdit && (
            <button
              onClick={() => onEdit(template)}
              className="flex items-center gap-1 text-xs px-2 py-1 border rounded text-slate-600 hover:bg-slate-50"
            >
              <Edit2 size={11} /> {t('tpl.card.edit')}
            </button>
          )}

          {isOwner && (
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-1 text-xs px-2 py-1 border rounded text-slate-600 hover:bg-slate-50"
            >
              <Share2 size={11} /> {t('tpl.card.share')}
            </button>
          )}

          <button
            onClick={handleFork}
            className="flex items-center gap-1 text-xs px-2 py-1 border rounded text-slate-600 hover:bg-slate-50"
          >
            <Copy size={11} /> {t('tpl.card.fork')}
          </button>

          {isOwner && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1 text-xs px-2 py-1 border rounded text-red-500 hover:bg-red-50 ml-auto"
            >
              <Trash2 size={11} /> {t('tpl.card.delete')}
            </button>
          )}
        </div>
      </div>

      {showGenerate && (
        <TemplateGenerateModal template={template} onClose={() => setShowGenerate(false)} />
      )}

      {showShare && (
        <TemplateShareModal
          template={{ ...template, is_public: isPublic ? 1 : 0 }}
          onClose={() => setShowShare(false)}
          onPublicChange={v => setIsPublic(v)}
        />
      )}
    </>
  )
}
