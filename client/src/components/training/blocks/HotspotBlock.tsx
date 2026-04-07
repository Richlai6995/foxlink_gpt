import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface Region {
  id: string
  shape: string
  coords: { x: number; y: number; w: number; h: number }
  correct: boolean
  feedback: string
  label?: string
  type?: string
  narration?: string
  audio_url?: string
}

interface InteractionResult {
  block_type: string
  block_index: number
  player_mode: string
  interaction_mode: string
  action_log: any[]
  total_time_seconds: number
  steps_completed: number
  total_steps: number
  wrong_clicks: number
}

interface Props {
  block: any
  blockIndex?: number
  isLastSlide?: boolean
  playerMode?: 'learn' | 'test'
  slideAudioUrl?: string | null
  globalMuted?: boolean
  autoPlay?: boolean
  onAllComplete?: () => void
  onInteractionComplete?: (result: InteractionResult) => void
  onAutoPlayDone?: () => void
}

export default function HotspotBlock({ block, blockIndex = 0, isLastSlide = false, playerMode = 'learn', slideAudioUrl, globalMuted = false, autoPlay = false, onAllComplete, onInteractionComplete, onAutoPlayDone }: Props) {
  const { t } = useTranslation()
  const isTestMode = playerMode === 'test'
  const isDemoMode = block.interaction_mode === 'demo'
  // In test mode, use guided (step-by-step) unless demo mode
  const mode: 'guided' | 'explore' | 'demo' = isDemoMode ? 'demo' : (isTestMode ? 'guided' : (block.interaction_mode || 'guided'))
  const allRegions: Region[] = block.regions || []
  const correctRegions = allRegions.filter(r => r.correct)
  const maxAttempts = block.max_attempts || 3
  const showHintAfter = block.show_hint_after || 2

  // Reset all state when block changes (slide navigation)
  const blockKey = block.image || ''
  const [prevKey, setPrevKey] = useState(blockKey)
  // Guided mode state
  const [currentStep, setCurrentStep] = useState(0)
  // Explore mode state
  const [exploredIds, setExploredIds] = useState<Set<string>>(new Set())
  // Common state
  const [attempts, setAttempts] = useState(0)
  const [stepAttempts, setStepAttempts] = useState(0)
  const [feedback, setFeedback] = useState<{ text: string; correct: boolean; regionId?: string } | null>(null)
  const [completed, setCompleted] = useState(false)
  const [hoverRegion, setHoverRegion] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const [muted, setMuted] = useState(globalMuted)
  const [transitioning, setTransitioning] = useState(false)
  const [introPlayed, setIntroPlayed] = useState(false)
  const [introPlaying, setIntroPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const actionLogRef = useRef<any[]>([])
  const startTimeRef = useRef<number>(Date.now())
  const wrongClicksRef = useRef<number>(0)

  // Reset when block or playerMode changes
  const resetKey = `${blockKey}_${playerMode}`
  if (resetKey !== prevKey) {
    setPrevKey(resetKey)
    setCurrentStep(0)
    setExploredIds(new Set())
    setAttempts(0)
    setStepAttempts(0)
    setFeedback(null)
    setCompleted(false)
    setTransitioning(false)
    setHoverRegion(null)
    setIntroPlayed(false)
    setIntroPlaying(false)
    actionLogRef.current = []
    startTimeRef.current = Date.now()
    wrongClicksRef.current = 0
  }

  // Coordinate system
  const isPixelCoords = block.coordinate_system === 'pixel' ||
    (!block.coordinate_system && allRegions.some(r => r.coords.x > 100 || r.coords.y > 100))
  const imgDim = block.image_dimensions
  const imgW = isPixelCoords ? (imgDim?.w || Math.max(...allRegions.map(r => r.coords.x + (r.coords.w || 0)), 200) * 1.05) : 100
  const imgH = isPixelCoords ? (imgDim?.h || Math.max(...allRegions.map(r => r.coords.y + (r.coords.h || 0)), 200) * 1.05) : 100
  const toPercent = (r: Region['coords']) => {
    if (!isPixelCoords) return r
    return { x: r.x / imgW * 100, y: r.y / imgH * 100, w: r.w / imgW * 100, h: r.h / imgH * 100 }
  }

  const currentTarget = mode === 'guided' ? correctRegions[currentStep] : null

  // Stop any current audio
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current.onended = null
    }
  }, [])

  // Sync global mute from CoursePlayer header
  useEffect(() => {
    setMuted(globalMuted)
  }, [globalMuted])

  // Stop audio when muted — also skip intro if still playing
  useEffect(() => {
    if (muted) {
      stopAudio()
      if (introPlaying) {
        setIntroPlaying(false)
        setIntroPlayed(true)
      }
    }
  }, [muted, stopAudio, introPlaying])

  // Play region audio based on current mode
  const playRegionAudio = useCallback((region: Region, forceField?: string) => {
    if (muted || !audioRef.current) return
    const r = region as any
    let url: string | undefined
    if (forceField) {
      url = r[forceField]
    } else if (isTestMode && mode !== 'demo') {
      // Test mode (non-demo): don't auto-play narration
      return
    } else if (mode === 'explore') {
      url = r.explore_audio_url || r.audio_url
    } else {
      url = r.audio_url
    }
    if (url) { audioRef.current.src = url; audioRef.current.play().catch(() => {}) }
  }, [muted, isTestMode, mode])

  // Play intro narration then start interaction
  // Priority: mode-specific block audio → slide-level audio_url
  useEffect(() => {
    if (introPlayed || completed) return
    const introAudioUrl = isTestMode ? (block.slide_narration_test_audio || slideAudioUrl)
      : mode === 'explore' ? (block.slide_narration_explore_audio || slideAudioUrl)
      : (block.slide_narration_audio || slideAudioUrl) || null
    if (!introAudioUrl || muted) {
      setIntroPlayed(true)
      return
    }
    setIntroPlaying(true)
    if (audioRef.current) {
      audioRef.current.src = introAudioUrl
      audioRef.current.onended = () => {
        setIntroPlaying(false)
        setIntroPlayed(true)
        if (audioRef.current) audioRef.current.onended = null
      }
      audioRef.current.play().catch(() => {
        setIntroPlaying(false)
        setIntroPlayed(true)
      })
    } else {
      setIntroPlayed(true)
    }
  }, [introPlayed, completed, muted])

  // Auto-play region audio for current guided/demo step (after intro finishes)
  useEffect(() => {
    if (!introPlayed || introPlaying || completed) return
    if ((mode === 'guided' || mode === 'demo') && currentTarget) {
      playRegionAudio(currentTarget)
    }
  }, [currentStep, completed, introPlayed, introPlaying])

  // ─── Auto-play: auto-advance through guided steps ───
  useEffect(() => {
    if (!autoPlay || !introPlayed || introPlaying || completed || isTestMode) return
    if (mode !== 'guided' || !currentTarget) return
    if (!audioRef.current) return

    const audio = audioRef.current
    const advanceStep = () => {
      const nextStep = currentStep + 1
      if (nextStep >= correctRegions.length) {
        setCompleted(true)
        onAutoPlayDone?.()
      } else {
        // Show checkmark briefly before advancing
        setFeedback({ text: '', correct: true, regionId: currentTarget.id })
        setTimeout(() => {
          setCurrentStep(nextStep)
          setFeedback(null)
        }, 800)
      }
    }

    // If region has audio → wait for it to end
    const regionAudioUrl = (currentTarget as any).audio_url
    if (regionAudioUrl && !muted) {
      audio.addEventListener('ended', advanceStep, { once: true })
      return () => { audio.removeEventListener('ended', advanceStep) }
    } else {
      // No audio → advance after 2 seconds
      const timer = setTimeout(advanceStep, 2000)
      return () => clearTimeout(timer)
    }
  }, [autoPlay, currentStep, introPlayed, introPlaying, completed, isTestMode, mode, muted])

  // ─── Demo mode: auto-advance through all steps (no interaction needed) ───
  useEffect(() => {
    if (mode !== 'demo' || !introPlayed || introPlaying || completed) return
    if (!currentTarget || !audioRef.current) return

    const audio = audioRef.current
    const advanceStep = () => {
      const nextStep = currentStep + 1
      if (nextStep >= correctRegions.length) {
        setCompleted(true)
        // In test mode, fire interaction complete with full score
        if (isTestMode && onInteractionComplete) {
          const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000)
          onInteractionComplete({
            block_type: 'hotspot', block_index: blockIndex, player_mode: 'test',
            interaction_mode: 'demo',
            action_log: correctRegions.map(r => ({ region_id: r.id, label: r.label, correct: true, auto: true })),
            total_time_seconds: elapsed,
            steps_completed: correctRegions.length, total_steps: correctRegions.length,
            wrong_clicks: 0
          })
        }
        onAutoPlayDone?.()
      } else {
        setFeedback({ text: '', correct: true, regionId: currentTarget.id })
        setTimeout(() => {
          setCurrentStep(nextStep)
          setFeedback(null)
        }, 800)
      }
    }

    const regionAudioUrl = (currentTarget as any).audio_url
    if (regionAudioUrl && !muted) {
      audio.addEventListener('ended', advanceStep, { once: true })
      return () => { audio.removeEventListener('ended', advanceStep) }
    } else {
      const timer = setTimeout(advanceStep, 3000)
      return () => clearTimeout(timer)
    }
  }, [mode, currentStep, introPlayed, introPlaying, completed, muted])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (completed || transitioning || mode === 'demo') return // demo mode: no clicks
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    const hit = allRegions.find(r => {
      const c = toPercent(r.coords)
      return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h
    })

    setAttempts(prev => prev + 1)

    // Record action log entry
    const logEntry = {
      timestamp: Date.now(),
      step: mode === 'guided' ? currentStep : exploredIds.size,
      region_id: hit?.id || null,
      correct: hit ? (mode === 'guided' ? hit.id === correctRegions[currentStep]?.id : hit.correct) : false,
      click_coords: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 },
      attempt_number: stepAttempts + 1
    }
    actionLogRef.current.push(logEntry)

    if (!hit) {
      wrongClicksRef.current++
      setFeedback({ text: t('training.missedRegion'), correct: false })
      setStepAttempts(prev => prev + 1)
      return
    }

    if (mode === 'guided') {
      handleGuidedClick(hit)
    } else {
      handleExploreClick(hit)
    }
  }

  const fireInteractionComplete = useCallback((stepsCompleted: number) => {
    const totalTime = Math.round((Date.now() - startTimeRef.current) / 1000)
    const result: InteractionResult = {
      block_type: 'hotspot',
      block_index: blockIndex,
      player_mode: playerMode,
      interaction_mode: mode,
      action_log: actionLogRef.current,
      total_time_seconds: totalTime,
      steps_completed: stepsCompleted,
      total_steps: correctRegions.length,
      wrong_clicks: wrongClicksRef.current
    }
    onInteractionComplete?.(result)
    onAllComplete?.()
  }, [blockIndex, playerMode, mode, correctRegions.length, onInteractionComplete, onAllComplete])

  const handleGuidedClick = (hit: Region) => {
    if (!currentTarget) return
    if (hit.id === currentTarget.id) {
      // Correct — stop current audio immediately
      stopAudio()
      const correctPhrases = t('training.correctPhrases', { returnObjects: true }) as string[]
      const correctText = isTestMode
        ? correctPhrases[currentStep % correctPhrases.length]
        : (hit.feedback || t('training.correct'))
      setFeedback({ text: correctText, correct: true, regionId: hit.id })
      setTransitioning(true)
      setTimeout(() => {
        const nextStep = currentStep + 1
        if (nextStep >= correctRegions.length) {
          setCompleted(true)
          fireInteractionComplete(nextStep)
        } else {
          setCurrentStep(nextStep)
          setStepAttempts(0)
        }
        setTransitioning(false)
        setFeedback(null)
      }, isTestMode ? 800 : 1500)
    } else {
      wrongClicksRef.current++
      const newStepAttempts = stepAttempts + 1
      setStepAttempts(newStepAttempts)
      if (isTestMode) {
        // Progressive hints: 1-2 → generic, 3+ → test_hint with audio, N+ → highlight
        const encouragements = t('training.incorrectPhrases', { returnObjects: true }) as string[]
        if (newStepAttempts < 3) {
          setFeedback({ text: encouragements[newStepAttempts % encouragements.length], correct: false, regionId: hit.id })
        } else {
          const hint = (currentTarget as any).test_hint || currentTarget.narration || t('training.findAndClick', { label: currentTarget.label || t('training.target') })
          setFeedback({ text: `${t('training.hintPrefix')}${hint}`, correct: false, regionId: hit.id })
          // Play test hint audio if available
          if (!muted && (currentTarget as any).test_audio_url && audioRef.current) {
            audioRef.current.src = (currentTarget as any).test_audio_url
            audioRef.current.play().catch(() => {})
          }
        }
      } else {
        setFeedback({ text: hit.feedback || t('training.wrongPosition', { label: hit.label || hit.id }), correct: false, regionId: hit.id })
      }
    }
  }

  const handleExploreClick = (hit: Region) => {
    const desc = (hit as any).explore_desc || hit.feedback || t('training.thisIs', { label: hit.label || hit.id })
    setFeedback({ text: desc, correct: hit.correct, regionId: hit.id })
    playRegionAudio(hit)
    if (hit.correct) {
      setExploredIds(prev => {
        const next = new Set(prev)
        next.add(hit.id)
        if (next.size >= correctRegions.length) {
          setTimeout(() => {
            setCompleted(true)
            fireInteractionComplete(next.size)
          }, 800)
        }
        return next
      })
    }
  }

  const reset = () => {
    setCurrentStep(0)
    setExploredIds(new Set())
    setAttempts(0)
    setStepAttempts(0)
    setFeedback(null)
    setCompleted(false)
    setTransitioning(false)
    setIntroPlayed(false)
    setIntroPlaying(false)
  }

  // In test mode, hints only appear after show_hint_after failures (fallback to highlight)
  const showStepHints = mode === 'guided' && !completed && stepAttempts >= showHintAfter
  const isGuidedLike = mode === 'guided' || mode === 'demo' // demo uses same visual as guided

  // Region rendering
  const renderRegions = (isZoom = false) => allRegions.map((r) => {
    const c = toPercent(r.coords)
    const isCurrentTarget = isGuidedLike && currentTarget?.id === r.id
    const isExplored = mode === 'explore' && exploredIds.has(r.id)
    const isHovered = hoverRegion === r.id
    const isHit = feedback?.regionId === r.id
    const justCorrect = isHit && feedback?.correct

    // Guided/demo mode: only show current step + completed steps
    const guidedVisible = isGuidedLike
      ? (isCurrentTarget || correctRegions.findIndex(cr => cr.id === r.id) < currentStep)
      : true

    // Dimming: in guided/demo mode, non-current regions are dimmed
    const dimmed = isGuidedLike && !isCurrentTarget && !completed &&
      correctRegions.findIndex(cr => cr.id === r.id) >= currentStep

    // Test mode: hide all region visuals until showStepHints kicks in (not for demo)
    const testHidden = isTestMode && mode !== 'demo' && !completed && !showStepHints &&
      correctRegions.findIndex(cr => cr.id === r.id) >= currentStep

    if (isGuidedLike && !guidedVisible && !completed) return null

    return (
      <div key={r.id}>
        <div
          className="absolute transition-all duration-300"
          style={{
            left: `${c.x}%`, top: `${c.y}%`,
            width: `${c.w}%`, height: `${c.h}%`,
            border: testHidden ? 'none'
              : justCorrect ? '3px solid #22c55e'
              : isCurrentTarget && showStepHints ? '2px dashed #facc15'
              : isCurrentTarget && !isTestMode ? '2px solid #3b82f6'
              : isExplored ? '2px solid #22c55e'
              : isHovered && !isTestMode ? '2px solid rgba(99,102,241,0.6)'
              : completed ? '2px solid rgba(34,197,94,0.4)'
              : dimmed ? '1px solid rgba(100,116,139,0.2)'
              : mode === 'explore' ? '2px solid rgba(59,130,246,0.4)'
              : 'none',
            background: testHidden ? 'transparent'
              : justCorrect ? 'rgba(34,197,94,0.2)'
              : isCurrentTarget && showStepHints ? 'rgba(250,204,21,0.1)'
              : isCurrentTarget && !isTestMode ? 'rgba(59,130,246,0.08)'
              : isExplored ? 'rgba(34,197,94,0.08)'
              : isHovered && !isTestMode ? 'rgba(99,102,241,0.08)'
              : dimmed ? 'rgba(0,0,0,0.3)'
              : 'transparent',
            borderRadius: '6px',
            pointerEvents: 'none',
            zIndex: isCurrentTarget || isHovered ? 3 : 2,
            opacity: dimmed && !completed ? 0.3 : 1
          }}
        >
          {/* Label — hidden in test mode until hints or completed */}
          {!testHidden && (isCurrentTarget || isExplored || (isHovered && !isTestMode) || completed) && r.label && (
            <div className="absolute -top-6 left-0 flex items-center gap-1 whitespace-nowrap" style={{ zIndex: 4 }}>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm" style={{
                backgroundColor: justCorrect || isExplored ? '#22c55e' : isCurrentTarget ? '#3b82f6' : '#6366f1',
                color: 'white'
              }}>
                {mode === 'guided' && r.correct
                  ? `${correctRegions.findIndex(cr => cr.id === r.id) + 1}. `
                  : ''
                }
                {r.label}
              </span>
              {r.type && (
                <span className="text-[8px] px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: 'white' }}>{r.type}</span>
              )}
            </div>
          )}
          {/* Pulse hint */}
          {isCurrentTarget && showStepHints && (
            <div className="absolute inset-0 rounded-md border-2 border-yellow-400 animate-pulse" />
          )}
        </div>

        {/* Hover tooltip — hidden in test mode */}
        {isHovered && !completed && !isTestMode && r.label && (
          <div className="absolute z-[10] pointer-events-none" style={{
            left: `${c.x + c.w / 2}%`, top: `${c.y - 1}%`,
            transform: 'translate(-50%, -100%)'
          }}>
            <div className="bg-gray-900 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap">
              {r.label}
              {r.type && <span className="text-gray-400 ml-1">({r.type})</span>}
            </div>
          </div>
        )}

        {/* Checkmark animation on correct click */}
        {justCorrect && (
          <div className="absolute flex items-center justify-center pointer-events-none"
            style={{
              left: `${c.x}%`, top: `${c.y}%`,
              width: `${c.w}%`, height: `${c.h}%`,
              zIndex: 10
            }}>
            <div style={{
              width: 48, height: 48,
              borderRadius: '50%',
              backgroundColor: '#22c55e',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 28, fontWeight: 'bold',
              boxShadow: '0 0 20px rgba(34,197,94,0.5)',
              animation: 'checkmark-bounce 0.6s ease-out'
            }}>✓</div>
          </div>
        )}

        {/* Explore mode: checkmark for explored */}
        {(mode === 'explore' && isExplored && !justCorrect) && (
          <div className="absolute flex items-center justify-center pointer-events-none"
            style={{
              left: `${c.x}%`, top: `${c.y}%`,
              width: `${c.w}%`, height: `${c.h}%`,
              zIndex: 5
            }}>
            <div style={{
              width: 32, height: 32,
              borderRadius: '50%',
              backgroundColor: '#22c55e',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 18, fontWeight: 'bold',
              boxShadow: '0 0 10px rgba(34,197,94,0.3)',
              animation: 'checkmark-bounce 0.6s ease-out'
            }}>✓</div>
          </div>
        )}
      </div>
    )
  })

  // Hover detection on mouse move
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (completed) { setHoverRegion(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    const hit = allRegions.find(r => {
      const c = toPercent(r.coords)
      return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h
    })
    setHoverRegion(hit?.id || null)
  }

  const progress = mode === 'guided'
    ? { current: completed ? correctRegions.length : currentStep, total: correctRegions.length }
    : { current: exploredIds.size, total: correctRegions.length }

  return (
    <>
      <style>{`
        @keyframes checkmark-bounce {
          0%   { transform: scale(0); opacity: 0 }
          50%  { transform: scale(1.3) }
          100% { transform: scale(1); opacity: 1 }
        }
      `}</style>
      <audio ref={audioRef} />
      <div className="flex gap-5">
        {/* LEFT: Screenshot */}
        <div className="flex-1 min-w-0">
          {block.image ? (
            <div className="relative select-none rounded-lg overflow-hidden border"
              style={{ borderColor: completed ? '#22c55e' : 'var(--t-border)', cursor: completed ? 'default' : 'pointer' }}
              onClick={handleClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverRegion(null)}>
              <img src={block.image} alt="" className="w-full block" draggable={false} />

              {renderRegions()}

              {/* Zoom button */}
              <button
                className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs transition opacity-60 hover:opacity-100"
                style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                title={t('training.zoomView')}
                onClick={(e) => { e.stopPropagation(); setZoomed(true) }}
              >🔍</button>
            </div>
          ) : (
            <div className="py-16 text-center border border-dashed rounded-lg"
              style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-dim)' }}>
              {t('training.imageNotSet')}
            </div>
          )}

          {/* Step progress bar */}
          {correctRegions.length > 1 && (
            <div className="flex items-center gap-1.5 mt-2 px-1">
              {correctRegions.map((r, idx) => {
                const isDone = mode === 'guided' ? idx < (completed ? correctRegions.length : currentStep)
                  : exploredIds.has(r.id)
                const isCurrent = mode === 'guided' && idx === currentStep && !completed
                return (
                  <div key={r.id} className="flex items-center gap-1.5">
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300"
                        style={{
                          backgroundColor: isDone ? '#22c55e' : isCurrent ? '#3b82f6' : 'var(--t-bg-inset, #e2e8f0)',
                          color: isDone || isCurrent ? 'white' : 'var(--t-text-dim)',
                          boxShadow: isCurrent ? '0 0 0 3px rgba(59,130,246,0.3)' : 'none'
                        }}>
                        {isDone ? '✓' : idx + 1}
                      </div>
                      {r.label && (
                        <span className="text-[8px] mt-0.5 max-w-[60px] truncate text-center" style={{ color: 'var(--t-text-dim)' }}>
                          {r.label}
                        </span>
                      )}
                    </div>
                    {idx < correctRegions.length - 1 && (
                      <div className="h-0.5 w-4 rounded transition-all duration-300"
                        style={{ backgroundColor: isDone ? '#22c55e' : 'var(--t-border)' }} />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* RIGHT: Info panel — sticky so test prompts stay visible when scrolling tall screenshots */}
        <div className="w-56 shrink-0 flex flex-col gap-2.5 text-xs sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto">
          {/* Instruction */}
          {block.instruction && (
            <div className="rounded-lg p-2.5 border" style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border)' }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>?</span>
                <span className="text-[10px] font-semibold" style={{ color: 'var(--t-text-muted)' }}>{t('training.instruction')}</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--t-text)' }}>{block.instruction}</p>
            </div>
          )}

          {/* Current step instruction (guided / test mode) */}
          {mode === 'guided' && currentTarget && !completed && (
            <div className="rounded-lg p-2.5 border-2 transition-all duration-300" style={{
              borderColor: isTestMode ? '#f59e0b' : '#3b82f6',
              backgroundColor: isTestMode ? 'rgba(245,158,11,0.06)' : 'rgba(59,130,246,0.06)'
            }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ backgroundColor: isTestMode ? '#f59e0b' : '#3b82f6', color: 'white' }}>
                  {currentStep + 1}
                </span>
                <span className="text-[10px] font-semibold" style={{ color: isTestMode ? '#f59e0b' : '#3b82f6' }}>
                  {isTestMode ? t('training.testMode') : t('training.step')} {currentStep + 1}/{correctRegions.length}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t-text)' }}>
                {isTestMode
                  ? t('training.findAndClick', { label: currentTarget.label || t('training.target') })
                  : (currentTarget.narration || t('training.pleaseClick', { label: currentTarget.label || t('training.target') }))
                }
              </p>
            </div>
          )}

          {/* Explore mode hint */}
          {mode === 'explore' && !completed && (
            <div className="rounded-lg p-2.5 border-2" style={{ borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.06)' }}>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t-text-secondary)' }}>
                <span className="font-semibold" style={{ color: '#a855f7' }}>{t('training.exploreHint')}</span>
                {t('training.exploreDesc')}
              </p>
              <div className="mt-1.5 flex items-center gap-1">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(exploredIds.size / Math.max(correctRegions.length, 1)) * 100}%`, backgroundColor: '#a855f7' }} />
                </div>
                <span className="text-[9px] shrink-0" style={{ color: 'var(--t-text-dim)' }}>
                  {exploredIds.size}/{correctRegions.length}
                </span>
              </div>
            </div>
          )}

          {/* Completed */}
          {completed && (
            <div className="rounded-lg p-2.5 border flex flex-col gap-2" style={{ borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)' }}>
              <div className="flex items-center gap-2">
                <span>✅</span>
                <span className="text-xs font-medium" style={{ color: '#22c55e' }}>
                  {block.completion_message || (mode === 'guided' ? t('training.allStepsComplete') : t('training.allExplored'))}
                </span>
              </div>
              <div className="flex gap-2">
                <button onClick={reset}
                  className="flex-1 text-[10px] py-1 rounded transition font-medium"
                  style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
                  {t('training.resetRetry')}
                </button>
                {!isLastSlide ? (
                  <button
                    onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))}
                    className="flex-1 text-[10px] py-1 rounded transition font-medium text-white"
                    style={{ backgroundColor: '#22c55e' }}>
                    {t('training.nextPage')}
                  </button>
                ) : (
                  <span className="flex-1 text-[10px] py-1 text-center font-medium" style={{ color: '#22c55e' }}>
                    {t('training.courseComplete')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Feedback */}
          {feedback && (
            <div className="px-2.5 py-2 rounded-lg flex items-start gap-2 border transition-all duration-300" style={{
              backgroundColor: feedback.correct ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              borderColor: feedback.correct ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
              color: feedback.correct ? 'var(--t-success, #22c55e)' : 'var(--t-danger, #ef4444)'
            }}>
              <span className="shrink-0">{feedback.correct ? '✅' : '❌'}</span>
              <span className="text-[11px] leading-relaxed">{feedback.text}</span>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button onClick={() => setMuted(!muted)}
              className="text-[10px] px-2 py-0.5 rounded transition"
              style={{ backgroundColor: 'var(--t-accent-subtle)', color: muted ? 'var(--t-text-dim)' : 'var(--t-accent)' }}>
              {muted ? t('training.muted') : t('training.unmuted')}
            </button>
            <span className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>
              {mode === 'guided' ? `${t('training.step')} ${progress.current}/${progress.total}` : `${t('training.explored')} ${progress.current}/${progress.total}`}
              {' · '}{t('training.attempts')} {attempts}
            </span>
          </div>

          {/* Element list — in test mode, only show after completed */}
          {correctRegions.length > 0 && (!isTestMode || completed) && (
            <div className="rounded-lg p-2 border space-y-0.5" style={{ backgroundColor: 'var(--t-bg-inset, var(--t-bg-card))', borderColor: 'var(--t-border)' }}>
              <div className="text-[9px] font-medium mb-1" style={{ color: 'var(--t-text-dim)' }}>
                {mode === 'guided' ? t('training.steps') : t('training.elements')}
              </div>
              {correctRegions.map((r, idx) => {
                const isDone = mode === 'guided' ? idx < (completed ? correctRegions.length : currentStep) : exploredIds.has(r.id)
                const isCurrent = mode === 'guided' && idx === currentStep && !completed
                return (
                  <div key={r.id} className="flex items-center gap-1.5 text-[10px] py-0.5 rounded px-1 transition"
                    style={{ backgroundColor: isCurrent ? 'rgba(59,130,246,0.08)' : 'transparent' }}>
                    <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0"
                      style={{
                        backgroundColor: isDone ? '#22c55e' : isCurrent ? '#3b82f6' : '#64748b',
                        color: 'white'
                      }}>
                      {isDone ? '✓' : idx + 1}
                    </span>
                    <span className="truncate" style={{
                      color: isCurrent ? 'var(--t-accent)' : isDone ? 'var(--t-text-secondary)' : 'var(--t-text-dim)',
                      fontWeight: isCurrent ? 600 : 400,
                      textDecoration: isDone && !isCurrent ? 'line-through' : 'none'
                    }}>
                      {r.label || t('training.element', { n: idx + 1 })}
                    </span>
                    {r.type && <span className="text-[8px] px-0.5 rounded shrink-0" style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-text-dim)' }}>{r.type}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Zoom overlay */}
      {zoomed && block.image && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
          onClick={() => setZoomed(false)}>
          <div className="relative max-w-[95vw] max-h-[95vh]" onClick={e => e.stopPropagation()}>
            <div className="relative select-none"
              style={{ cursor: completed ? 'default' : 'pointer' }}
              onClick={handleClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverRegion(null)}>
              <img src={block.image} alt="" className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg" draggable={false} />
              {renderRegions(true)}
            </div>
            <button
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm"
              style={{ backgroundColor: 'rgba(239,68,68,0.8)' }}
              onClick={() => setZoomed(false)}
              title={t('training.close')}
            >✕</button>
            {feedback && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  backgroundColor: feedback.correct ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)',
                  color: 'white'
                }}>
                {feedback.correct ? '✅' : '❌'} {feedback.text}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
