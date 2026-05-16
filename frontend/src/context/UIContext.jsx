/**
 * UIContext — ephemeral UI selection state (Brief 28e Gate E5a).
 *
 * Holds bidirectional 3D selection state for the OperationModule:
 *   - selectedOpeningId: id of the currently-focused operable opening
 *                       (matches building_config.operable_openings[*].id),
 *                       or null
 *   - selectedFacade:    'north' | 'east' | 'south' | 'west' | null
 *
 * Deliberately NOT in ProjectContext because:
 *   1. Selection state is ephemeral — should not be DB-persisted or
 *      auto-saved on the 1s scheduleSave debounce
 *   2. Selection state has no notion of "the project's current selection";
 *      it's a per-tab UI state. Different browser tabs viewing the same
 *      project should each have their own selection
 *   3. Keeping ProjectContext lean — Brief 28e shouldn't pile more state
 *      into the already-large ProjectContext
 *
 * Gate E5a wires panel → state (clicking a row in OperationModule sets
 * selectedOpeningId). Gate E5b wires state → 3D (BuildingViewer3D reads
 * selectedOpeningId + selectedFacade and renders highlights) AND
 * 3D → state (clicking a window/door rectangle sets selectedOpeningId).
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export const UIContext = createContext(null)

export function UIProvider({ children }) {
  const [selectedOpeningId, setSelectedOpeningIdState] = useState(null)
  const [selectedFacade,    setSelectedFacadeState]    = useState(null)

  // Setters are stable callbacks so consumers can depend on them in
  // useEffect / useMemo without churn.
  const setSelectedOpeningId = useCallback((id) => {
    setSelectedOpeningIdState(id ?? null)
    // Selecting an opening also implicitly clears facade-only selection —
    // the two are mutually exclusive (you've focused something more
    // specific than the whole facade).
    if (id) setSelectedFacadeState(null)
  }, [])

  const setSelectedFacade = useCallback((facade) => {
    setSelectedFacadeState(facade ?? null)
    if (facade) setSelectedOpeningIdState(null)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedOpeningIdState(null)
    setSelectedFacadeState(null)
  }, [])

  const value = useMemo(() => ({
    selectedOpeningId,
    selectedFacade,
    setSelectedOpeningId,
    setSelectedFacade,
    clearSelection,
  }), [selectedOpeningId, selectedFacade, setSelectedOpeningId, setSelectedFacade, clearSelection])

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) {
    throw new Error('useUI must be used inside <UIProvider>')
  }
  return ctx
}
