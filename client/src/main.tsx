import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './i18n'
import { initPwa } from './lib/pwa'
import { installChunkErrorAutoReset } from './lib/swReset'

// 部署新版本 + 舊 SW 還在的常見 race:lazy 載入的 chunk 名變了 → fetch 404 →
// React 整個白屏。這個 listener 偵測到 chunk fetch 失敗就自動清 SW + caches + reload。
// 1 分鐘內只觸發一次避免 loop(若 reload 後還失敗代表是 server 真的壞,不再 auto 重試)
installChunkErrorAutoReset()

initPwa()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
