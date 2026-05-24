/**
 * SystemsSection.jsx — Brief 46 Part 4 (2026-05-22)
 *
 * Editor-pane composer for the Systems section. Mounts the same
 * `InputsColumn` that the main `/systems` page renders in its left
 * column — Brief 46 Principle 3 (two contexts, one implementation).
 *
 * Subsection map (matches EditorNav `systems.*` ids):
 *   systems.heating     → InputsColumn (Heating accordion opens by default)
 *   systems.cooling     → InputsColumn (same — Heating opens; user can
 *                                       click Cooling to switch)
 *   systems.dhw         → InputsColumn
 *   systems.ventilation → InputsColumn
 *   systems.lighting    → InputsColumn
 *   systems.small_power → InputsColumn
 *
 * Why we don't dispatch to a focused per-service editor: InputsColumn
 * is a single-expand accordion that manages cross-service share +
 * service-level state coherently. Splitting it into six focused
 * editors would either (a) duplicate the share validation / normalise
 * helpers six times, or (b) lift them into a parent state holder that
 * defeats the self-containment design. The user clicking "Cooling" in
 * the editor nav and seeing the same Heating-default accordion is a
 * small UX cost; Part 5 may add an `initialOpenService` prop to
 * InputsColumn if Chris's walkthrough flags it.
 *
 * `consumption` is the editor's preview engine result (when wired) —
 * for now we pass `null` and InputsColumn degrades gracefully (the
 * inline comfort-vs-setpoint diagnostic on each system card shows
 * "—" rather than a number). Wiring through the editor's
 * `runInterventionStack` baseline result is a one-line change at
 * Part 6 if Chris wants the live preview inside system cards.
 *
 * `openScheduleEditor` is a no-op for now — per Brief 46 Q1 the
 * schedule sub-popout is deferred. Users can still edit schedules
 * from the main /systems page; the editor captures the resulting
 * params.systems_config_v40 snapshot which carries the
 * `control_schedule_id` references.
 *
 * Note on capture semantics: every InputsColumn write (add / update /
 * remove / share-change / normalise / service-level / setServiceEnabled)
 * funnels through `writeV40 = (next) => mutate('building.systems_config_v40', next)`.
 * In capture mode, that's a single whole-`systems_config_v40` patch at
 * the same path on every edit — patchCapture dedupe replaces the patch
 * each time so the latest snapshot wins. This is the correct shape for
 * a "set systems to this configuration" intervention pattern; granular
 * Brief-41 path-shaped patches (e.g. `building.systems_config_v40.heating
 * [id=sys_x].share_pct`) remain a future iteration if interventions need
 * to compose more flexibly with each other.
 */

import { useContext } from 'react'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'
import { InputsColumn } from '../../SystemsModule.jsx'

const ACCENT = '#DC2626'  // matches EditorNav systems accent

const SUBSECTION_LABELS = {
  'systems.heating':     'Heating',
  'systems.cooling':     'Cooling',
  'systems.dhw':         'DHW',
  'systems.ventilation': 'Ventilation',
  'systems.lighting':    'Lighting (electrical)',
  'systems.small_power': 'Small power',
}

export default function SystemsSection({ active }) {
  const { params, updateParam, comfortBand } = useContext(ProjectContext)
  const label = SUBSECTION_LABELS[active] ?? active

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-light-grey">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: ACCENT }} />
        <h3 className="text-caption font-semibold text-navy">Systems · {label}</h3>
        <span className="text-xxs text-mid-grey/70 ml-2 italic">All services shown — click an accordion to focus</span>
      </div>
      <InputsColumn
        params={params}
        updateParam={updateParam}
        consumption={null}
        comfortBand={comfortBand}
        openScheduleEditor={() => {}}
      />
    </div>
  )
}
