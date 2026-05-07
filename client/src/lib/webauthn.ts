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
    if (e?.name === 'NotAllowedError') return { ok: false, error: '使用者取消或裝置拒絕' }
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
    if (e?.name === 'NotAllowedError') return { ok: false, error: '使用者取消或裝置拒絕' }
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
