/**
 * SchedulePopout.jsx — Brief 36 Part 3 (2026-05-18).
 *
 * Draggable, non-blocking schedule-editor pop-out. Shared chrome used by:
 *   - Internal Gains module (centre-canvas Schedule tab replaced by
 *     pop-out opened via the existing "Edit schedule →" links per the
 *     §3.4 alternative)
 *   - Systems module (replaces the inset-0 fixed modal — the "stuck"
 *     editor Chris flagged)
 *
 * The pop-out is chrome only. The body content is whatever the consumer
 * passes via children. Each consumer's existing schedule-editor content
 * (ScheduleEditorCanvas for Internal Gains, profiles/ScheduleEditor for
 * Systems) plugs into the body slot unchanged.
 *
 * Behaviour:
 *   - Header bar is the drag handle (entire bar grabs)
 *   - Position persists in localStorage under `persistKey`; defaults to
 *     centred on first open
 *   - "Reset position" link in header restores centred default
 *   - Close button (×) calls onClose
 *   - Esc key calls onClose
 *   - Backdrop is transparent — main window stays interactive while pop-
 *     out is open (per brief §3.1: "backdrop does not block clicks on
 *     the main window")
 *   - Internal vertical scroll when content exceeds max-height
 *   - Fixed width 1000 px; max-height calc(100vh - 4rem)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

const POPOUT_WIDTH = 1000
const POPOUT_MAX_HEIGHT = 'calc(100vh - 4rem)'

function loadPosition(persistKey) {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(persistKey)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p
  } catch {}
  return null
}

function savePosition(persistKey, pos) {
  try { localStorage.setItem(persistKey, JSON.stringify(pos)) } catch {}
}

function defaultCentredPosition() {
  if (typeof window === 'undefined') return { x: 100, y: 60 }
  const x = Math.max(20, Math.round((window.innerWidth - POPOUT_WIDTH) / 2))
  const y = 60
  return { x, y }
}

export default function SchedulePopout({
  isOpen,
  onClose,
  title = 'Schedule editor',
  accent = '#8B5CF6',
  persistKey = 'nza-schedule-popout-position',
  children,
}) {
  const [position, setPosition] = useState(() => loadPosition(persistKey) ?? defaultCentredPosition())
  const dragOriginRef = useRef(null)   // { startX, startY, offsetX, offsetY }
  const [dragging, setDragging] = useState(false)

  // Re-centre on first open if no persisted position. (Position is sticky
  // across opens once the user has dragged it once.)
  useEffect(() => {
    if (!isOpen) return
    if (!loadPosition(persistKey)) {
      setPosition(defaultCentredPosition())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Esc → close.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Drag handlers. We capture pointer events on the header; mouse-move +
  // mouse-up are bound on window so a fast drag that leaves the header
  // doesn't lose tracking.
  const startDrag = useCallback((e) => {
    // Only respond to primary-button drags on the header itself (not on
    // the close button — that has its own onClick).
    if (e.button !== 0) return
    dragOriginRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: position.x,
      offsetY: position.y,
    }
    setDragging(true)
    e.preventDefault()
  }, [position.x, position.y])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => {
      const origin = dragOriginRef.current
      if (!origin) return
      const newX = origin.offsetX + (e.clientX - origin.startX)
      const newY = origin.offsetY + (e.clientY - origin.startY)
      // Clamp so the header doesn't escape the viewport. 40 px is the
      // approximate header height — keep at least that much visible.
      const maxX = (typeof window !== 'undefined' ? window.innerWidth : 1920) - 80
      const maxY = (typeof window !== 'undefined' ? window.innerHeight : 1080) - 40
      const clamped = {
        x: Math.max(-POPOUT_WIDTH + 200, Math.min(maxX, newX)),
        y: Math.max(0, Math.min(maxY, newY)),
      }
      setPosition(clamped)
    }
    const onUp = () => {
      setDragging(false)
      dragOriginRef.current = null
      savePosition(persistKey, position)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, persistKey, position])

  const resetPosition = useCallback(() => {
    const def = defaultCentredPosition()
    setPosition(def)
    savePosition(persistKey, def)
  }, [persistKey])

  if (!isOpen) return null

  return (
    <div
      className="fixed z-50 bg-white rounded-xl shadow-2xl border border-light-grey overflow-hidden flex flex-col"
      style={{
        left: position.x,
        top:  position.y,
        width: POPOUT_WIDTH,
        maxHeight: POPOUT_MAX_HEIGHT,
      }}
      role="dialog"
      aria-modal="false"
      aria-label={title}
    >
      {/* Header — entire bar is the drag handle */}
      <div
        onMouseDown={startDrag}
        className={`flex-shrink-0 flex items-center justify-between px-4 py-2 select-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{
          backgroundColor: accent,
          color: 'white',
        }}
      >
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-caption font-semibold truncate">{title}</span>
          <span className="text-xxs opacity-70 truncate">Drag to move · Esc to close</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); resetPosition() }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-xxs opacity-80 hover:opacity-100 underline underline-offset-2"
            title="Restore default centred position"
          >
            Reset position
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.() }}
            onMouseDown={(e) => e.stopPropagation()}
            className="rounded p-0.5 hover:bg-white/20 transition-colors"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body — internal scroll when content exceeds max-height */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  )
}
