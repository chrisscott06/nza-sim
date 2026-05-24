/**
 * EditorChromeContext.jsx — Brief 46 Part 6 fix (2026-05-22)
 *
 * Small context that exposes the editor's chrome-level callbacks to
 * deeply nested section composers. Currently carries:
 *
 *   - openOccupancyScheduleEditor()    — open the embedded occupancy
 *                                        schedule (params.occupancy.schedule)
 *   - openGainsProfileScheduleEditor(category, profileIdx)
 *                                      — open the embedded schedule on
 *                                        params.gains.<category>.profiles[idx]
 *   - openNamedScheduleEditor(scheduleName)
 *                                      — open a named project-level
 *                                        schedule (params.schedules[name])
 *
 * Without this context the section composers would each need their own
 * SchedulePopout + UnifiedScheduleEditor wiring — but the schedule
 * editor needs to float ABOVE the intervention editor popout, so it
 * has to be mounted at the InterventionEditorPopout level. This
 * context bridges that gap.
 *
 * The default value is a set of no-ops so the same components can
 * render on the main app pages (where the main module owns its own
 * schedule popout via its own state) without crashing if they happen
 * to read the chrome context outside an editor.
 */

import { createContext, useContext } from 'react'

const noop = () => {}

const DEFAULT_VALUE = {
  openOccupancyScheduleEditor:    noop,
  openGainsProfileScheduleEditor: noop,
  openNamedScheduleEditor:        noop,
}

export const EditorChromeContext = createContext(DEFAULT_VALUE)

export function useEditorChrome() {
  return useContext(EditorChromeContext)
}

export function EditorChromeProvider({ value, children }) {
  return (
    <EditorChromeContext.Provider value={value ?? DEFAULT_VALUE}>
      {children}
    </EditorChromeContext.Provider>
  )
}
