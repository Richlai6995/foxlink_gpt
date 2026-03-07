/**
 * ResultTable — 查詢結果資料表，支援匯出 CSV/Excel
 */
import { Download } from 'lucide-react'

interface Props {
  rows: Record<string, unknown>[]
  columns: string[]
}

function exportCsv(rows: Record<string, unknown>[], columns: string[]) {
  const header = columns.join(',')
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

export default function ResultTable({ rows, columns }: Props) {
  if (!rows.length) return <p className="text-slate-500 text-sm py-4 text-center">無資料</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">共 {rows.length} 筆</span>
        <button
          onClick={() => exportCsv(rows, columns)}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
        >
          <Download size={12} /> 匯出 CSV
        </button>
      </div>
      <div className="overflow-auto max-h-96 rounded-lg border border-slate-700">
        <table className="w-full text-xs text-left">
          <thead className="sticky top-0 bg-slate-800 border-b border-slate-700">
            <tr>
              {columns.map(c => (
                <th key={c} className="px-3 py-2 text-slate-400 font-medium whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/50'}>
                {columns.map(c => (
                  <td key={c} className="px-3 py-2 text-slate-300 whitespace-nowrap max-w-[200px] truncate">
                    {row[c] != null ? String(row[c]) : <span className="text-slate-600">NULL</span>}
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
