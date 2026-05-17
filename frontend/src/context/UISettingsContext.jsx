/**
 * UISettingsContext.jsx — Chris UX overhaul (2026-05-17)
 *
 * App-global toggles. Two settings live here:
 *
 *   engineMode  'static' | 'dynamic' | 'both'
 *   unit        'kwh' | 'kwh_per_m2'
 *
 * Toggling either in the top bar flips it everywhere — every chart,
 * every Σ badge, every strip — so the whole tool shows a single consistent
 * view. No per-module persistence; per-module toggles are removed.
 *
 * Both settings persist to localStorage so a refresh keeps the user's
 * choice.
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

const ENGINE_KEY = 'nza-ui-engine'
const UNIT_KEY   = 'nza-ui-unit'

const VALID_ENGINES = new Set(['static', 'dynamic', 'both'])
const VALID_UNITS   = new Set(['kwh', 'kwh_per_m2'])

const UISettingsContext = createContext(null)

function _readStored(key, validSet, fallback) {
  try {
    const v = localStorage.getItem(key)
    return validSet.has(v) ? v : fallback
  } catch {
    return fallback
  }
}

export function UISettingsProvider({ children }) {
  const [engineMode, setEngineModeState] = useState(() => _readStored(ENGINE_KEY, VALID_ENGINES, 'static'))
  const [unit,       setUnitState]       = useState(() => _readStored(UNIT_KEY,   VALID_UNITS,   'kwh_per_m2'))

  useEffect(() => {
    try { localStorage.setItem(ENGINE_KEY, engineMode) } catch {}
  }, [engineMode])

  useEffect(() => {
    try { localStorage.setItem(UNIT_KEY, unit) } catch {}
  }, [unit])

  const setEngineMode = useCallback((next) => {
    if (VALID_ENGINES.has(next)) setEngineModeState(next)
  }, [])

  const setUnit = useCallback((next) => {
    if (VALID_UNITS.has(next)) setUnitState(next)
  }, [])

  // Convenience cycle helper for the top-bar pill: static → dynamic → both → static
  const cycleEngineMode = useCallback(() => {
    setEngineModeState(prev => prev === 'static' ? 'dynamic' : prev === 'dynamic' ? 'both' : 'static')
  }, [])

  return (
    <UISettingsContext.Provider value={{ engineMode, setEngineMode, cycleEngineMode, unit, setUnit }}>
      {children}
    </UISettingsContext.Provider>
  )
}

export function useUISettings() {
  const ctx = useContext(UISettingsContext)
  if (!ctx) throw new Error('useUISettings must be used inside <UISettingsProvider>')
  return ctx
}
