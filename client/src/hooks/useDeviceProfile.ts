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

function detect(): DeviceProfile {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const uaPhone = PHONE_RE.test(ua)
  const uaTablet = TABLET_RE.test(ua)
  const isTouch =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches

  const queryOverride = readQueryFlag()

  // 規則:
  // 1. ?mobile=1 / ?mobile=0 為最高優先(debug / 強制覆蓋)
  // 2. UA 是 phone → mobile;tablet / 桌機 UA → 桌機
  //    (桌機 user 縮窗、半屏、開兩窗都不會被切到 mobile)
  const isMobile = queryOverride !== null ? queryOverride : (uaPhone && !uaTablet)

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
