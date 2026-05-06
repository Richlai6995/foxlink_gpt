// 一次性產生 PWA icon — 純文字 Cortex(藍底白字)
// Run:  node scripts/generate-icons.mjs
// Output: client/public/icons/{icon-192.png, icon-512.png, icon-maskable-512.png, favicon-32.png}
//
// 設計原則:
// - 主品牌色:Tailwind blue-600 #2563eb(theme color 用 #1e3a8a 較深,放 statusbar)
// - 文字 "C"(粗體大寫),正方形 icon 中央對齊
// - maskable:文字縮 60% 留 20% safe-zone,避免 Android home screen 切角
// - 統一 1 張(不做 dark/light)
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const BG = '#2563eb'
const FG = '#ffffff'

function svgFor(size, { padRatio = 0, label = 'C' } = {}) {
  // padRatio 0.2 → maskable 留 20% safe-zone
  const inner = Math.round(size * (1 - padRatio * 2))
  const fontSize = Math.round(inner * 0.62)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}" rx="${Math.round(size * 0.18)}" ry="${Math.round(size * 0.18)}"/>
  <text x="50%" y="50%" dy=".06em"
        font-family="-apple-system, 'Noto Sans TC', 'Segoe UI', sans-serif"
        font-weight="800"
        font-size="${fontSize}"
        fill="${FG}"
        text-anchor="middle"
        dominant-baseline="middle">${label}</text>
</svg>`
}

// Maskable 版要求矩形完全覆蓋 → 不要 rounded corners
function svgMaskable(size) {
  const fontSize = Math.round(size * 0.42) // 文字縮小,留 20% safe-zone
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <text x="50%" y="50%" dy=".06em"
        font-family="-apple-system, 'Noto Sans TC', 'Segoe UI', sans-serif"
        font-weight="800"
        font-size="${fontSize}"
        fill="${FG}"
        text-anchor="middle"
        dominant-baseline="middle">C</text>
</svg>`
}

async function build() {
  const tasks = [
    { name: 'icon-192.png',          svg: svgFor(192) },
    { name: 'icon-512.png',          svg: svgFor(512) },
    { name: 'icon-maskable-512.png', svg: svgMaskable(512) },
    { name: 'favicon-32.png',        svg: svgFor(32) },
  ]
  for (const t of tasks) {
    const out = resolve(outDir, t.name)
    await sharp(Buffer.from(t.svg)).png().toFile(out)
    console.log('✓', t.name)
  }
  console.log('\nDone →', outDir)
}

build().catch((err) => {
  console.error('Icon generation failed:', err)
  process.exit(1)
})
