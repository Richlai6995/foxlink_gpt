/**
 * metalsExportXlsx — 匯出金屬走勢圖到 Excel(兩個 Sheet:原始資料 + 線圖 PNG)
 *
 * 用法:
 *   await exportMetalsChartToXlsx({
 *     filename: 'LME-Cu_近6月_20260609.xlsx',
 *     metals: ['CU', 'AL'],
 *     pointsByMetal: { CU: [{date,price}], AL: [...] },
 *     chartPngBase64: 'data:image/png;base64,...',  // ECharts.getDataURL()
 *     metaInfo: { title, range, days, exportedAt },
 *   })
 *
 * 兩個 Sheet:
 *   1. 原始資料 — date | metal1_price | metal2_price | ...(寬表,方便採購二次分析)
 *   2. 線圖 — A1 標題,A3 開始插入 PNG(跟畫面 1:1)
 *
 * ExcelJS 用 dynamic import 避免主 bundle 變肥(套件 ~200KB gzipped)
 */

export interface PricePoint {
  date: string
  price: number
}

export interface ExportOpts {
  filename: string
  metals: string[]                        // ['CU', 'AL', ...]
  pointsByMetal: Record<string, PricePoint[]>
  chartPngBase64: string                  // ECharts.getDataURL({type:'png',pixelRatio:2})
  metaInfo: {
    title: string                         // e.g. '基本金屬走勢(LME)'
    range: string                         // e.g. '近 6 月'
    days: number
    exportedAt: string                    // ISO 字串
  }
}

export async function exportMetalsChartToXlsx(opts: ExportOpts): Promise<void> {
  // 動態 import,只在 user 按按鈕時才下載 ExcelJS bundle(~200KB)
  const ExcelJS = (await import('exceljs')).default

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Foxlink Cortex 金屬情報'
  wb.created = new Date(opts.metaInfo.exportedAt)

  // ── Sheet 1: 原始資料(寬表)─────────────────────────────────────────────
  // 找出所有 date 的 union(各 metal 可能交易日不同 → 用 outer join)
  const allDates = new Set<string>()
  for (const code of opts.metals) {
    for (const p of opts.pointsByMetal[code] || []) allDates.add(p.date)
  }
  const sortedDates = Array.from(allDates).sort()

  // 每 metal 建 dateMap 快速 lookup
  const lookupByMetal: Record<string, Map<string, number>> = {}
  for (const code of opts.metals) {
    const m = new Map<string, number>()
    for (const p of opts.pointsByMetal[code] || []) m.set(p.date, p.price)
    lookupByMetal[code] = m
  }

  const dataSheet = wb.addWorksheet('原始資料', { views: [{ state: 'frozen', ySplit: 1 }] })
  // Header row
  const header = ['日期', ...opts.metals.map(c => `${c} (USD)`)]
  const headerRow = dataSheet.addRow(header)
  headerRow.font = { bold: true }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
  // Body rows
  for (const d of sortedDates) {
    const row: (string | number | null)[] = [d]
    for (const code of opts.metals) {
      const v = lookupByMetal[code].get(d)
      row.push(v == null ? null : Number(v.toFixed(4)))
    }
    dataSheet.addRow(row)
  }
  // Column widths
  dataSheet.getColumn(1).width = 12
  for (let i = 2; i <= header.length; i++) dataSheet.getColumn(i).width = 14

  // ── Sheet 2: 線圖 PNG ──────────────────────────────────────────────────
  const chartSheet = wb.addWorksheet('線圖', { views: [{ showGridLines: false }] })

  // 標題列
  chartSheet.getCell('A1').value = opts.metaInfo.title
  chartSheet.getCell('A1').font = { bold: true, size: 14 }
  chartSheet.getCell('A2').value = `${opts.metaInfo.range}(${opts.metaInfo.days} 天)  匯出於 ${new Date(opts.metaInfo.exportedAt).toLocaleString('zh-TW')}`
  chartSheet.getCell('A2').font = { color: { argb: 'FF6B7280' }, size: 10 }

  // 插入 PNG
  // base64 dataURL 須脫除 'data:image/png;base64,' prefix
  const base64Body = opts.chartPngBase64.replace(/^data:image\/png;base64,/, '')
  const imageId = wb.addImage({
    base64: base64Body,
    extension: 'png',
  })
  // tl = top-left 錨點(col, row 從 0 開始);ext = 圖片實際 px 寬高(維持 ECharts pixelRatio=2 解析度)
  // 用 ECharts getDataURL 預設輸出尺寸,Excel 內顯示 1:1
  chartSheet.addImage(imageId, {
    tl: { col: 0, row: 3 },     // A4(0-indexed)
    ext: { width: 1200, height: 540 },
  })

  // ── Sheet 3: 元資料 — 簡單記錄匯出條件,給未來追溯用 ───────────────────────
  const metaSheet = wb.addWorksheet('元資料')
  metaSheet.addRow(['欄位', '值']).font = { bold: true }
  metaSheet.addRow(['圖表標題', opts.metaInfo.title])
  metaSheet.addRow(['時間區間', opts.metaInfo.range])
  metaSheet.addRow(['天數', opts.metaInfo.days])
  metaSheet.addRow(['金屬代碼', opts.metals.join(', ')])
  metaSheet.addRow(['資料筆數', sortedDates.length])
  metaSheet.addRow(['匯出時間', new Date(opts.metaInfo.exportedAt).toLocaleString('zh-TW')])
  metaSheet.getColumn(1).width = 14
  metaSheet.getColumn(2).width = 40

  // ── Trigger download ──────────────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
