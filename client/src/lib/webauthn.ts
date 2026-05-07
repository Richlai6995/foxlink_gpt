// WebAuthn client helper — Face ID / Touch ID / 指紋 登入
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser'
import api from './api'

export function isWebAuthnSupported(): boolean {
  try { return browserSupportsWebAuthn() } catch { return false }
}

/** 此裝置有 platform authenticator(Face ID / Touch ID / Windows Hello / Android 指紋)*/
export async function isPlatformBiometricAvailable(): Promise<boolean> {
  try { return await platformAuthenticatorIsAvailable() } catch { return false }
}

/**
 * 把 WebAuthn / Credential Manager 抽象的錯誤訊息翻成 user-friendly 提示。
 * Android 14+ 用 androidx.credentials.CredentialManager,真實錯誤在 logcat 拿不到,
 * 前端只能依錯誤訊息字串推測。
 */
function friendlyWebAuthnError(e: any): string | null {
  const name = e?.name || ''
  const msg = String(e?.message || '').toLowerCase()
  if (name === 'NotAllowedError') return '使用者取消或裝置拒絕'
  if (name === 'InvalidStateError') return '此裝置已綁定過,請先在「我的信任裝置」移除舊紀錄再重新綁定'
  if (name === 'SecurityError') return '安全性錯誤(可能是非 HTTPS 或網域不符),請聯絡 IT'
  if (msg.includes('credential manager')) {
    return [
      '與 Android Credential Manager 通訊失敗,可能原因:',
      '1. 手機未設螢幕鎖定 — 請先到「設定 → 安全性」設定 PIN / 圖形 / 指紋',
      '2. Google Password Manager 未啟用 — 請到「設定 → 密碼、密鑰與帳戶」確認',
      '3. Google Play 服務需更新 — 請到 Play Store 更新',
      '4. 重啟手機後再試一次',
    ].join('\n')
  }
  if (msg.includes('not supported') || name === 'NotSupportedError') {
    return '此裝置 / 瀏覽器不支援生物辨識(請更新至最新版本 Chrome 或 Safari)'
  }
  return null
}

/** 註冊新 passkey(已登入)— 觸發 Face ID / 指紋 prompt */
export async function registerPasskey(deviceLabel?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!isWebAuthnSupported()) {
      return { ok: false, error: '此瀏覽器不支援生物辨識' }
    }
    const optsRes = await api.post('/auth/webauthn/register/options')
    const attResp = await startRegistration({ optionsJSON: optsRes.data })
    await api.post('/auth/webauthn/register/verify', { response: attResp, deviceLabel })
    return { ok: true }
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[WebAuthn] register failed:', e?.name, e?.message)
    const friendly = friendlyWebAuthnError(e)
    if (friendly) return { ok: false, error: friendly }
    return { ok: false, error: e?.response?.data?.error || e?.message || '註冊失敗' }
  }
}

/** 用 passkey 登入(未登入)— 取代密碼 */
export async function loginWithPasskey(): Promise<{ ok: boolean; token?: string; user?: any; error?: string }> {
  try {
    if (!isWebAuthnSupported()) {
      return { ok: false, error: '此瀏覽器不支援生物辨識' }
    }
    const optsRes = await api.post('/auth/webauthn/auth/options')
    const { options, challengeKey } = optsRes.data
    const authResp = await startAuthentication({ optionsJSON: options })
    const r = await api.post('/auth/webauthn/auth/verify', { response: authResp, challengeKey })
    return { ok: true, token: r.data.token, user: r.data.user }
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[WebAuthn] login failed:', e?.name, e?.message)
    const friendly = friendlyWebAuthnError(e)
    if (friendly) return { ok: false, error: friendly }
    return { ok: false, error: e?.response?.data?.error || e?.message || '登入失敗' }
  }
}

export interface BoundCredential {
  id: number
  device_label: string
  transports: string | null
  created_at: string
  last_used_at: string | null
}

export async function listMyCredentials(): Promise<BoundCredential[]> {
  const r = await api.get('/auth/webauthn/credentials')
  return r.data || []
}

export async function deleteMyCredential(id: number): Promise<void> {
  await api.delete(`/auth/webauthn/credentials/${id}`)
}
