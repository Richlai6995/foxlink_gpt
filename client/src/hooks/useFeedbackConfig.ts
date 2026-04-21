import { useEffect, useState } from 'react'
import api from '../lib/api'

interface FeedbackConfig {
  features: { sla: boolean }
}

let _cache: FeedbackConfig | null = null
let _inflight: Promise<FeedbackConfig> | null = null

function fetchOnce(): Promise<FeedbackConfig> {
  if (_cache) return Promise.resolve(_cache)
  if (_inflight) return _inflight
  _inflight = api.get('/feedback/config')
    .then(r => {
      _cache = r.data as FeedbackConfig
      return _cache
    })
    .catch(() => {
      _cache = { features: { sla: false } }
      return _cache
    })
    .finally(() => { _inflight = null })
  return _inflight
}

export function invalidateFeedbackConfig() {
  _cache = null
}

export function useFeedbackConfig(): FeedbackConfig {
  const [cfg, setCfg] = useState<FeedbackConfig>(_cache || { features: { sla: false } })
  useEffect(() => {
    let alive = true
    fetchOnce().then(c => { if (alive) setCfg(c) })
    return () => { alive = false }
  }, [])
  return cfg
}
