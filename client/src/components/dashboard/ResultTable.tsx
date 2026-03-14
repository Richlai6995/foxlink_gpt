/**
 * ResultTable — 查詢結果資料表，支援匯出 CSV/Excel
 */
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  rows: Record<string, unknown>[]
  columns: string[]
  column_labels?: Record<string, string>  // col_lower → 中文說明
}

function exportCsv(rows: Record<string, unknown>[], columns: string[], labels: Record<string, string>) {
  const header = columns.map(c => labels[c] || c).join(',')
  const body = rows.map(r => columns.map(c => {
    const v = String(r[c] ?? '')
    return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
  }).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ai_result_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ResultTable({ rows, columns, column_labels = {} }: Props) {
  const { t } = useTranslation()
  if (!rows.length) return <p className="text-gray-400 text-sm py-4 text-center">{t('resultTable.noData')}</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{t('resultTable.rowCount', { count: rows.length })}</span>
        <button
          onClick={() => exportCsv(rows, columns, column_labels)}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
        >
          <Download size={12} /> {t('resultTable.exportCsv')}
        </button>
      </div>
      <div className="overflow-auto max-h-96 rounded-lg border border-gray-200">
        <table className="w-full text-xs text-left">
          <thead className="sticky top-0 bg-gray-100 border-b border-gray-200">
            <tr>
              {columns.map(c => (
                <th key={c} className="px-3 py-2 text-gray-600 font-medium whitespace-nowrap" title={c}>
                  {column_labels[c] || c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-100/50'}>
                {columns.map(c => (
                  <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[200px] truncate">
                    {row[c] != null ? String(row[c]) : <span className="text-gray-400">NULL</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
