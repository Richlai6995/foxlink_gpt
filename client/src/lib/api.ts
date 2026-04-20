import axios from 'axios'
import i18n from '../i18n'

const api = axios.create({
  baseURL: '/api',
  timeout: 300000, // 5 min — KB 上傳/解析、SSE 長回應、xlsx/pdf 大檔都需要
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // 每次 API 請求都帶上目前路由，讓 verifyToken 能更新 session 的 current_page
  config.headers['X-Current-Page'] = window.location.pathname
  // 帶上當前 UI 語言, server 端 API (如 /erp-tools/my/list、help) 據此回對應語言翻譯
  try {
    const lang = i18n.language || localStorage.getItem('preferred_language') || 'zh-TW'
    config.headers['X-Lang'] = lang
  } catch (_) {}
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      // 已經在 /login 就不要再 reload，避免死循環（沒 token 時某些 hook 還是會打 API → 401 → reload → ...）
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
