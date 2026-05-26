/**
 * ConfirmDialog.jsx — bespoke confirm modal replacing window.confirm().
 *
 * Sidecar fix (2026-05-25). The native `localhost:5176 says...` browser
 * confirm box is ugly and doesn't match the design system. This component
 * is mounted ONCE at the app root (App.jsx) and exposes a module-scoped
 * `confirm({...})` function any component can import + await.
 *
 * Usage at the call site (drop-in replacement for window.confirm):
 *
 *   import { confirm } from '@/components/shared/ConfirmDialog.jsx'
 *
 *   if (!(await confirm({
 *     title: 'Delete "VRF 4.0"?',
 *     message: '1 patch will be permanently removed. This cannot be undone.',
 *     confirmText: 'Delete',
 *     tone: 'danger',
 *   }))) return
 *
 * The function returns a Promise<boolean> — resolves true if the user
 * confirms, false if they cancel (Escape, click outside, Cancel button).
 *
 * Mechanism: module-level event-bus. The mounted <ConfirmDialogHost /> in
 * App.jsx subscribes to dialog-open requests; the imperative `confirm()`
 * function dispatches a request and returns a Promise resolved when the
 * dialog closes. No React context wiring required at call sites.
 *
 * Tones:
 *   - `'danger'`  — red confirm button. For deletes / destructive ops.
 *   - `'warning'` — amber confirm button. For discard-unsaved-changes.
 *   - `'neutral'` — teal confirm button. For benign confirmations.
 *
 * Defaults: `confirmText = 'OK'`, `cancelText = 'Cancel'`, `tone = 'neutral'`.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Trash2, Info } from 'lucide-react'

// ── Event bus ──────────────────────────────────────────────────────────────
//
// A single Set of listeners; the host subscribes on mount and unsubscribes
// on unmount. Multiple hosts would all receive the same event (each shows
// its own dialog), but the app mounts only one host at the root.
const _listeners = new Set()
let _seq = 0

/**
 * Imperative confirm — call from any event handler. Returns Promise<boolean>.
 * Resolves true on confirm, false on cancel.
 */
export function confirm({
  title = 'Are you sure?',
  message = '',
  confirmText = 'OK',
  cancelText = 'Cancel',
  tone = 'neutral',
} = {}) {
  return new Promise((resolve) => {
    const id = ++_seq
    const request = { id, title, message, confirmText, cancelText, tone, resolve }
    // Fan out to every mounted host; first responder wins.
    for (const fn of _listeners) fn(request)
  })
}

// ── Host component ────────────────────────────────────────────────────────
//
// Renders nothing when idle. When a confirm request fires, it stores the
// active request in state and renders a portal to <body> with the modal.
// The host is the single render-side consumer of confirm requests — mount
// exactly one at the app root.
export default function ConfirmDialogHost() {
  const [active, setActive] = useState(null)
  const confirmButtonRef = useRef(null)
  const lastFocusedRef   = useRef(null)

  useEffect(() => {
    const fn = (request) => {
      // Remember what had focus so we can restore on close.
      lastFocusedRef.current = (typeof document !== 'undefined') ? document.activeElement : null
      setActive(request)
    }
    _listeners.add(fn)
    return () => _listeners.delete(fn)
  }, [])

  // Auto-focus the confirm button when a dialog opens. Slightly delayed so
  // the portal has mounted.
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      confirmButtonRef.current?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [active])

  // Restore focus + close.
  function close(result) {
    if (!active) return
    const r = active
    setActive(null)
    // Restore focus to whatever the user was on before the dialog opened.
    const prev = lastFocusedRef.current
    if (prev && typeof prev.focus === 'function') {
      try { prev.focus() } catch { /* ignore */ }
    }
    r.resolve(result)
  }

  // Keyboard handling: Escape = cancel, Enter = confirm.
  useEffect(() => {
    if (!active) return
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        close(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // close is stable enough; we want the listener to react to the current
    // `active` request only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  if (!active || typeof document === 'undefined') return null

  // ── Visuals — match the design system ────────────────────────────────────
  // Tone → confirm button colour + icon.
  const TONE = {
    danger:  {
      btnClass: 'bg-red-600 hover:bg-red-700 text-white border-red-600',
      icon: Trash2,
      iconClass: 'text-red-600',
      iconBg: 'bg-red-50',
    },
    warning: {
      btnClass: 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500',
      icon: AlertTriangle,
      iconClass: 'text-amber-600',
      iconBg: 'bg-amber-50',
    },
    neutral: {
      btnClass: 'bg-teal hover:opacity-90 text-white border-teal',
      icon: Info,
      iconClass: 'text-teal',
      iconBg: 'bg-teal/10',
    },
  }
  const t = TONE[active.tone] ?? TONE.neutral
  const Icon = t.icon

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
    >
      {/* Backdrop — click to cancel */}
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => close(false)}
        className="absolute inset-0 bg-navy/40 backdrop-blur-sm cursor-default"
      />
      {/* Dialog card */}
      <div
        className="relative w-full max-w-md bg-white rounded-xl border border-light-grey shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 ${t.iconBg}`}>
            <Icon size={18} className={t.iconClass} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p id="confirm-dialog-title" className="text-caption font-semibold text-navy">
              {active.title}
            </p>
            {active.message ? (
              <p className="text-xxs text-mid-grey mt-1 leading-relaxed">
                {active.message}
              </p>
            ) : null}
          </div>
        </div>
        <div className="px-5 pb-5 pt-2 flex items-center justify-end gap-2 bg-off-white/40">
          <button
            type="button"
            onClick={() => close(false)}
            className="px-3 py-1.5 rounded text-xxs font-medium text-mid-grey hover:text-navy hover:bg-white border border-transparent hover:border-light-grey transition-colors"
          >
            {active.cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={() => close(true)}
            className={`px-3.5 py-1.5 rounded text-xxs font-medium border transition-opacity ${t.btnClass}`}
          >
            {active.confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
