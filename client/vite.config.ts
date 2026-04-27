import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3007',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3007',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3007',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|@remix-run[\\/]router|history|scheduler|react-is|prop-types|use-sync-external-store)[\\/]/.test(id)) return 'react-vendor'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('echarts')) return 'charts'
          if (/react-markdown|react-syntax-highlighter|refractor|rehype|remark|micromark|mdast|hast|unified|unist|vfile|bail|trough|ccount|character-entities|comma-separated-tokens|space-separated-tokens|property-information|html-void-elements|is-plain-obj|markdown-table|escape-string-regexp|zwitch|longest-streak|decode-named-character|stringify-entities/.test(id)) return 'markdown'
          if (/pptxgenjs|docx-preview|html2canvas/.test(id)) return 'office-preview'
          return 'vendor'
        },
      },
    },
  },
})
