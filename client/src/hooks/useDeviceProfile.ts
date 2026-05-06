import { useEffect, useState } from 'react'

export interface DeviceProfile {
  isMobile: boolean
  isTouch: boolean
  uaPhone: boolean
  uaTablet: boolean
  viewport: string
}

const PHONE_RE = /Mobi|Android(?!.*Tablet)|iPhone|iPod/i
const TABLET_RE = /iPad|Tablet/i

function readQueryFlag(): boolean | null {
  try {
    const sp = new URLSearchParams(window.location.search)
    const v = sp.get('mobile')
    if (v === '1') return true
    if (v === '0') return false
  } catch {}
  return null
}

function readMobileV1Flag(): boolean {
  // Dev 環境一律 ON,方便手機接 npm run dev 測試;Prod 仍需 user 顯式開
  // PR-2 ship 後 prod 也預設 ON(砍掉這行 + 整個函式)
  if (import.meta.env.DEV) return true
  try {
    return localStorage.getItem('mobile_v1') === '1'
  } catch {
    return false
  }
}

function detect(): DeviceProfile {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const uaPhone = PHONE_RE.test(ua)
  const uaTablet = TABLET_RE.test(ua)
  const isTouch =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches

  const v1 = readMobileV1Flag()
  const queryOverride = readQueryFlag()

  // 規則:
  // 1. ?mobile=1 / ?mobile=0 為最高優先(debug 用)
  // 2. mobile_v1 旗標未開 → 一律桌機(灰度開關)
  // 3. UA 是 phone → mobile;tablet → 桌機;桌機 UA → 桌機
  let isMobile: boolean
  if (queryOverride !== null) {
    isMobile = queryOverride
  } else if (!v1) {
    isMobile = false
  } else {
    isMobile = uaPhone && !uaTablet
  }

  const viewport =
    typeof window !== 'undefined'
      ? `${window.innerWidth}x${window.innerHeight}`
      : '0x0'

  return { isMobile, isTouch, uaPhone, uaTablet, viewport }
}

export function useDeviceProfile(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(detect)

  useEffect(() => {
    const update = () => setProfile(detect())
    window.addEventListener('orientationchange', update)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('orientationchange', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return profile
}

export function isMobileSync(): boolean {
  return detect().isMobile
}
