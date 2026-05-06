import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 改 prompt:user 看到 toast 再點才更新,避免半路 reload
      registerType: 'prompt',
      injectRegister: false, // 由 main.tsx 顯式註冊,可加 update toast
      workbox: {
        // app shell:JS / CSS / 字型 / 圖片
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}'],
        // 排除大型 vendor chunk 避免 cache 過大
        globIgnores: [
          '**/charts-*.js',
          '**/office-preview-*.js',
          '**/markdown-*.js',
          '**/pdf.worker-*.mjs',
          '**/TrainingPage-*.js',
        ],
        // 主 index chunk 約 2.8MB,單檔上限拉到 5MB
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // /api/* 一律 NetworkOnly,絕不 cache(SSE / 上傳 / 對話內容)
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/],
        runtimeCaching: [
          // Google Fonts:CacheFirst,1 年 TTL
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 30 },
            },
          },
          // /api/* 強制 NetworkOnly(防呆,雖然 navigateFallbackDenylist 已擋,但 runtime fetch 也不要 cache)
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      includeAssets: ['favicon.png', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Cortex',
        short_name: 'Cortex',
        description: 'FOXLINK AI 整合平台 — LLM 對話 / 教育訓練 / AI 工具集',
        theme_color: '#1e3a8a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/chat',
        lang: 'zh-TW',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        // 開發環境也啟用,方便 debug;但 Workbox SW 在 dev mode 行為較慢,可選
        enabled: false,
      },
    }),
  ],
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
