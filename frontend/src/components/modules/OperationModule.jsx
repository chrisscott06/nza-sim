/**
 * OperationModule.jsx — /operation
 *
 * Ventilation & Operation: how the building is OPERATED by its occupants.
 * This is the "State 2.5" layer of the progressive heat balance per Brief 24:
 * envelope is set in Building, internal gains in Profiles, then OPERATION is
 * the time-varying way people use the building — primarily operable windows.
 *
 * Currently covers:
 *   - Operable windows: per-facade % of glazing area that can open,
 *     plus a building-wide Window-open schedule (never / occupied /
 *     summer day / always).
 *
 * Reads / writes:
 *   params.openings.schedule        (building-wide)
 *   params.openings.{face}.openable_fraction  (per facade)
 *
 * Permanent envelope openings (louvres) and site exposure live in Building →
 * Permanent openings — they're geometry, not behaviour.
 *
 * Engine flow (unchanged from when this lived in Building):
 *   - Live calc: instantCalc.js sums openable_fraction × glazing[face] across
 *     all faces, applies Q = Cd · A · √Cw · v_wind during schedule-on hours
 *     and accumulates into `openings_window` on the loss side.
 *   - EnergyPlus: _build_openings_objects emits one
 *     ZoneVentilation:WindandStackOpenArea per zone with the
 *     openings-aware schedule.
 */

import { useContext } from 'react'
import { NavLink } from 'react-router-dom'
import { ProjectContext } from '../../context/ProjectContext.jsx'

const ACCENT = '#0E7490'  // operation theme — cyan-700

// Same ordering and facadeLabel as Building so the user sees the same labels
// in both places. F1 = north at orientation 0, then E / S / W clockwise.
const FACADES = [
  { num: 1, key: 'north' },
  { num: 2, key: 'east'  },
  { num: 3, key: 'south' },
  { num: 4, key: 'west'  },
]
function facadeLabel(facadeNumber, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle = (baseAngles[facadeNumber] + (orientationDeg ?? 0)) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const compass = directions[Math.round(trueAngle / 45) % 8]
  return `F${facadeNumber} (${compass})`
}

export default function OperationModule() {
  const { params, updateParam } = useContext(ProjectContext)
  const openings = params?.openings ?? {}
  const orientation = Number(params?.orientation ?? 0)
  const wwr = params?.wwr ?? {}

  const setOpenableFor = (face, v) => {
    updateParam('openings', { [face]: { openable_fraction: v } })
  }
  const toggleOpenableInclude = (face, include) => {
    if (include) {
      // Default restore: 30% openable. (Building module's memory state was
      // local — when crossing module boundaries we can't share it, so we use
      // a sensible default here.)
      setOpenableFor(face, 0.30)
      // Auto-bump schedule from 'never' so the engine actually sees flow.
      if ((openings.schedule ?? 'never') === 'never') {
        updateParam('openings', { schedule: 'occupied' })
      }
    } else {
      setOpenableFor(face, 0)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-off-white">
      {/* Module header with operation accent */}
      <div
        className="bg-white border-b border-light-grey px-6 pt-3 pb-3"
        style={{ borderTopWidth: '3px', borderTopColor: ACCENT, borderTopStyle: 'solid' }}
      >
        <NavLink to="/project" className="text-xxs text-mid-grey hover:text-navy transition-colors">
          ← Overview
        </NavLink>
        <p className="text-caption font-medium mt-0.5" style={{ color: ACCENT }}>Operation</p>
        <p className="text-xxs text-mid-grey">
          How the building is operated by its occupants — currently: operable windows.
        </p>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">

        {/* Window-open schedule ─────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-light-grey p-5">
          <p className="text-caption font-semibold text-navy mb-1">Window-open schedule</p>
          <p className="text-xxs text-mid-grey mb-3">
            When operable windows can open. Set to <em>Never</em> to disable all operable
            windows regardless of per-facade settings.
          </p>
          <select
            value={openings.schedule ?? 'never'}
            onChange={e => updateParam('openings', { schedule: e.target.value })}
            className="w-full sm:w-72 px-3 py-2 text-caption text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-teal cursor-pointer"
          >
            <option value="never">Never — windows always shut</option>
            <option value="occupied">Occupied hours (~07:00–23:00)</option>
            <option value="summer_day">Summer day only (Jun–Aug, daytime)</option>
            <option value="always">Always open</option>
          </select>
        </div>

        {/* Per-facade operable windows ──────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-light-grey p-5">
          <p className="text-caption font-semibold text-navy mb-1">
            Operable windows
          </p>
          <p className="text-xxs text-mid-grey mb-3">
            For each facade, the % of glazing area that can actually open. Operable
            windows need glass — a facade with no glazing (set in Building → Glazing)
            cannot have operable windows.
          </p>

          <div className="space-y-1.5">
            {FACADES.map(fac => {
              const frac = Number(openings?.[fac.key]?.openable_fraction ?? 0)
              const glazingOn = (wwr[fac.key] ?? 0) > 0
              const included = frac > 0 && glazingOn
              const disabled = !glazingOn
              return (
                <div key={fac.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={e => toggleOpenableInclude(fac.key, e.target.checked)}
                    disabled={disabled}
                    className="accent-navy w-3.5 h-3.5 flex-shrink-0 disabled:opacity-30"
                    title={disabled
                      ? `${facadeLabel(fac.num, orientation)} has no glazing — set WWR > 0 in Building first`
                      : `Include operable windows on ${facadeLabel(fac.num, orientation)}`}
                  />
                  <span className={`text-caption w-16 flex-shrink-0 ${included ? 'text-navy' : 'text-light-grey'}`}>
                    {facadeLabel(fac.num, orientation)}
                  </span>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={Math.round(frac * 100)}
                    onChange={e => setOpenableFor(fac.key, Number(e.target.value) / 100)}
                    disabled={!included}
                    className="flex-1 h-[3px] accent-navy disabled:opacity-30"
                  />
                  <span className={`text-caption w-14 text-right tabular-nums ${included ? 'text-navy' : 'text-light-grey'}`}>
                    {disabled ? 'no glass' : `${Math.round(frac * 100)}%`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer note ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-light-grey p-5">
          <p className="text-xxs text-mid-grey">
            <span className="font-medium text-dark-grey">Where things live:</span> Permanent
            envelope openings (louvres, trickle vents) and site exposure are configured
            in <NavLink to="/building" className="text-navy underline">Building → Permanent openings</NavLink>.
            Occupancy schedules sit in <NavLink to="/gains" className="text-navy underline">Internal Gains</NavLink>.
            Mechanical ventilation (MEV / MVHR) lives in <NavLink to="/systems" className="text-navy underline">Systems</NavLink>.
          </p>
        </div>

      </div>
    </div>
  )
}
