import { TemplateVariable } from '../../types'

interface Props {
  variable: TemplateVariable
  value: Record<string, string>[]
  onChange: (rows: Record<string, string>[]) => void
}

export default function LoopDataTable({ variable, value, onChange }: Props) {
  const children = variable.children || []
  const addRow = () => onChange([...value, {}])
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const setCell = (ri: number, key: string, val: string) => {
    const next = [...value]
    next[ri] = { ...next[ri], [key]: val }
    onChange(next)
  }

  return (
    <div>
      <table className="w-full text-xs border-collapse mb-1">
        <thead>
          <tr className="bg-slate-100">
            {children.map(c => (
              <th key={c.key} className="border px-2 py-1 text-left font-medium">{c.label || c.key}</th>
            ))}
            <th className="border px-2 py-1 w-8" />
          </tr>
        </thead>
        <tbody>
          {value.map((row, ri) => (
            <tr key={ri}>
              {children.map(c => (
                <td key={c.key} className="border px-1 py-0.5">
                  <input
                    className="w-full outline-none text-xs px-1"
                    type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                    value={row[c.key] || ''}
                    onChange={e => setCell(ri, c.key, e.target.value)}
                  />
                </td>
              ))}
              <td className="border px-1 py-0.5 text-center">
                <button onClick={() => removeRow(ri)} className="text-red-400 hover:text-red-600">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow} className="text-xs text-blue-500 hover:text-blue-700">+ 新增一行</button>
    </div>
  )
}
