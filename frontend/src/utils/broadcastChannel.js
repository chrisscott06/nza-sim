/**
 * broadcastChannel.js
 *
 * Cross-window state sharing via the BroadcastChannel API.
 *
 * The main window publishes project state after every change.
 * The pop-out results window subscribes and re-runs the instant calc.
 *
 * Usage:
 *   publishState(payload)          — from ProjectContext / SimulationContext
 *   subscribeToState(callback)     — from PopOutResults (returns unsubscribe fn)
 *   requestInitialState()          — pop-out asks for a full state dump on open
 *   onInitialStateRequest(handler) — main window responds to the pop-out request
 */

const CHANNEL_NAME = 'nza-simulate-live'

let _channel = null

function getChannel() {
  if (!_channel && typeof BroadcastChannel !== 'undefined') {
    _channel = new BroadcastChannel(CHANNEL_NAME)
  }
  return _channel
}

// ── Publish ────────────────────────────────────────────────────────────────────

/**
 * Publish the current project state to any listening pop-out windows.
 * Debounce to ~200ms is handled by the caller (ProjectContext).
 */
export function publishState(payload) {
  try {
    getChannel()?.postMessage({
      type:      'STATE_UPDATE',
      timestamp: Date.now(),
      payload,
    })
  } catch {
    // BroadcastChannel not supported — fail silently
  }
}

/**
 * Pop-out window requests a full state dump when it first opens.
 * The main window listens for this and responds.
 */
export function requestInitialState() {
  try {
    getChannel()?.postMessage({ type: 'REQUEST_STATE', timestamp: Date.now() })
  } catch { /* ignore */ }
}

/**
 * Main window registers a handler to respond to REQUEST_STATE messages.
 * Returns an unsubscribe function.
 */
export function onInitialStateRequest(handler) {
  const ch = getChannel()
  if (!ch) return () => {}
  const fn = (event) => {
    if (event.data?.type === 'REQUEST_STATE') handler()
  }
  ch.addEventListener('message', fn)
  return () => ch.removeEventListener('message', fn)
}

// ── Subscribe ──────────────────────────────────────────────────────────────────

/**
 * Subscribe to STATE_UPDATE messages from the main window.
 * Returns an unsubscribe function.
 */
export function subscribeToState(callback) {
  const ch = getChannel()
  if (!ch) return () => {}
  const fn = (event) => {
    if (event.data?.type === 'STATE_UPDATE') {
      callback(event.data.payload)
    }
  }
  ch.addEventListener('message', fn)
  return () => ch.removeEventListener('message', fn)
}
