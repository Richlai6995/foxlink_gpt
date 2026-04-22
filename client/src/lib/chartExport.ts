/**
 * chartExport — Chart PNG / PPTX 匯出
 *
 * 單張 chart (echarts getDataURL) → 塞進 PPTX slide,瀏覽器直接下載。
 * 純 client-side,pptxgenjs 同構套件 browser 可跑。
 *
 * 詳見 docs/chat-inline-chart-plan.md §4 Phase 4 PPT 匯出
 */
import PptxGenJS from 'pptxgenjs'
import type { InlineChartSpec } from '../types'

export interface ChartExportItem {
  title: string
  pngDataUrl: string   // from ECharts getDataURL({ type: 'png' })
  spec?: InlineChartSpec   // 若要附資料表可帶 spec(會渲染 data 前 30 列成 table)
}

function sanitizeFilename(name: string): string {
  return (name || 'chart').replace(/[\\/:*?"<>|]/g, '_').trim() || 'chart'
}

/**
 * 匯出單張 chart 成 PPTX(一個 slide 一張圖)
 */
export async function exportChartsToPptx(items: ChartExportItem[], fileName = 'charts.pptx'): Promise<void> {
  if (!items || items.length === 0) throw new Error('no charts to export')

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'          // 13.33 × 7.5 inch,適合寬螢幕
  pptx.title = 'FOXLINK GPT · 圖表匯出'
  pptx.author = 'FOXLINK GPT'

  for (const item of items) {
    const slide = pptx.addSlide()

    // 標題(上)
    slide.addText(item.title || 'Chart', {
      x: 0.3, y: 0.2, w: 12.7, h: 0.5,
      fontSize: 18, bold: true, color: '1f2937',
    })

    // Chart PNG(圖像貼右半 or 上 2/3)
    const hasTable = !!(item.spec?.data && item.spec.data.length > 0)
    slide.addImage({
      data: item.pngDataUrl,
      x: 0.3, y: 0.8,
      w: hasTable ? 8.5 : 12.7,
      h: hasTable ? 5.8 : 6.3,
    })

    // 附資料表(右側前 30 列)
    if (hasTable && item.spec) {
      const cols = [item.spec.x_field, ...item.spec.y_fields.map(yf => yf.field)]
      const rows = (item.spec.data || []).slice(0, 30)
      const headerRow = cols.map(c => ({ text: String(c), options: { bold: true, fill: 'e0f2fe', fontSize: 9 } }))
      const dataRows = rows.map(r => cols.map(c => ({
        text: r[c] === null || r[c] === undefined ? '' : String(r[c]),
        options: { fontSize: 8 },
      })))
      slide.addTable([headerRow, ...dataRows], {
        x: 9.0, y: 0.8, w: 4.0,
        border: { type: 'solid', color: 'cbd5e1', pt: 0.5 },
        colW: cols.map(() => 4.0 / cols.length),
      })
    }

    // 頁尾(來源 / 時間戳)
    if (item.spec?.meta?.source_tool) {
      slide.addText(`Source: ${item.spec.meta.source_tool}`, {
        x: 0.3, y: 7.0, w: 8, h: 0.3,
        fontSize: 8, color: '94a3b8', italic: true,
      })
    }
    slide.addText(new Date().toLocaleString('zh-TW'), {
      x: 10.3, y: 7.0, w: 3, h: 0.3,
      fontSize: 8, color: '94a3b8', align: 'right',
    })
  }

  await pptx.writeFile({ fileName: sanitizeFilename(fileName) + (fileName.endsWith('.pptx') ? '' : '.pptx') })
}

/**
 * 從 ECharts instance 抓 PNG dataURL。
 * instance 通常來自 ref.current.getEchartsInstance()
 */
export function getChartPngFromEcharts(inst: any): string {
  if (!inst) throw new Error('ECharts instance not ready')
  return inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
}
