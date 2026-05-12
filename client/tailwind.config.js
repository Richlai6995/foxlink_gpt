/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Cortex Projects Platform — Ocean Depth + Cyan
        // 對齊 docs/Cortex_互動Demo.html;只在 /projects-platform/* 下使用
        cortex: {
          navy:      '#0A2540',
          'navy-2':  '#11365B',
          ocean:     '#065A82',
          teal:      '#1C7293',
          cyan:      '#02C39A',
          'cyan-bg': '#CFFAF1',
          amber:     '#F5A524',
          'amber-bg':'#FEF3C7',
          red:       '#E5484D',
          'red-bg':  '#FEE2E2',
          green:     '#16A34A',
          'green-bg':'#DCFCE7',
          'ocean-bg':'#DBEAFE',
          ink:       '#1E293B',
          text:      '#334155',
          muted:     '#64748B',
          line:      '#E2E8F0',
          'line-2':  '#F1F5F9',
          bg:        '#F8FAFC',
        },
      },
      boxShadow: {
        'cortex-sm': '0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)',
        'cortex':    '0 4px 12px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.04)',
        'cortex-lg': '0 10px 30px rgba(15,23,42,0.12), 0 4px 8px rgba(15,23,42,0.04)',
      },
      fontFamily: {
        'cortex': ['"PingFang TC"', '"Microsoft JhengHei"', '"Noto Sans TC"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
