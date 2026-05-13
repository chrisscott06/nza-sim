/**
 * OccupancySection.jsx — Internal Gains module, OCCUPANCY block.
 *
 * Brief 27 Revised Part 7. Schedule editor moved OUT of this left-panel
 * section and into the centre canvas (`canvas/ScheduleEditorCanvas.jsx`)
 * per the v2.4 contract's UI rule. Left panel keeps magnitude /
 * structural inputs + a read-only mini-profile + an "Edit schedule →"
 * affordance that activates the centre-canvas Schedule tab on Occupancy.
 *
 * Reads / writes `params.occupancy.*` per v2.4 (unchanged from v2.3 for
 * occupancy specifically — only lighting + equipment become multi-profile):
 *   - density.{value, basis}
 *   - occupancy_rate
 *   - sensible_w_per_person
 *   - latent_w_per_person
 *   - schedule.{weekday, saturday, sunday, monthly_multipliers, exceptions}
 *     (edited via the centre canvas now)
 */

import { useContext, useCallback } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import MiniProfile from './MiniProfile.jsx'
import { GAIN_COLOURS } from './gainColours.js'

// ── Small editable field components (unchanged from Part 5) ─────────────────
function NumField({ label, suffix, value, onChange, min = 0, max, step = 1, disabled }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xxs text-mid-grey">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value ?? ''}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="w-16 px-1.5 py-0.5 text-xxs text-navy text-right tabular-nums border border-light-grey rounded focus:outline-none focus:border-mid-grey disabled:opacity-50"
        />
        {suffix && <span className="text-xxs text-mid-grey w-12">{suffix}</span>}
      </div>
    </div>
  )
}

function PercentSlider({ label, value, onChange, disabled }) {
  const pct = Math.round(((value ?? 0)) * 100)
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xxs">
        <label className="text-mid-grey">{label}</label>
        <span className="text-navy font-medium tabular-nums">{pct}%</span>
      </div>
      <input
        type="range" min={0} max={100} step={1}
        value={pct}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value) / 100)}
        className="w-full h-[3px] accent-navy disabled:opacity-50"
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options, disabled }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xxs text-mid-grey">{label}</label>
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="flex-1 max-w-[7rem] px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-mid-grey disabled:opacity-50"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

const DENSITY_BASIS_OPTIONS = [
  { value: 'per_room',         label: 'people/room' },
  { value: 'per_m2',           label: 'people/m²'   },
  { value: 'total',            label: 'total'       },
  { value: 'per_workstation',  label: 'per workstation' },
]

// ── Main section ─────────────────────────────────────────────────────────────
export default function OccupancySection({ annual, onEditSchedule }) {
  const { params, updateParam } = useContext(ProjectContext)
  const occ = params?.occupancy ?? {}
  const p = annual?.people

  const patchOccupancy = useCallback((patch) => {
    updateParam('occupancy', { ...occ, ...patch })
  }, [occ, updateParam])

  const setDensityValue = (v) => {
    patchOccupancy({ density: { ...(occ.density ?? {}), value: v ?? 0 } })
  }
  const setDensityBasis = (b) => {
    patchOccupancy({ density: { ...(occ.density ?? {}), basis: b } })
  }

  const totalOccupants100 = (() => {
    const v = Number(occ.density?.value ?? 0)
    switch (occ.density?.basis) {
      case 'per_room':         return Number(params?.num_bedrooms ?? 0) * v
      case 'per_m2':           return (annual?.gia_m2 ?? 0) * v
      case 'total':            return v
      case 'per_workstation':  return v
      default:                 return Number(params?.num_bedrooms ?? 0) * v
    }
  })()
  const effectiveOccupants = totalOccupants100 * Number(occ.occupancy_rate ?? 0)

  return (
    <div className="space-y-3 text-caption">
      {/* ── Live readout ──────────────────────────────────────────────── */}
      <div className="px-2 py-1.5 bg-off-white border-l-2 rounded-r text-xxs tabular-nums"
           style={{ borderLeftColor: GAIN_COLOURS.occupancy }}>
        <div className="flex justify-between">
          <span className="text-mid-grey">Annual</span>
          <span className="text-navy font-medium">
            {p?.kwh != null ? `${(p.kwh / 1000).toFixed(1)} MWh` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-mid-grey">Peak</span>
          <span className="text-navy font-medium">
            {p?.peak_kw != null ? `${p.peak_kw.toFixed(1)} kW` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-mid-grey">At 100% × rate</span>
          <span className="text-navy font-medium">
            {totalOccupants100 > 0 ? `${effectiveOccupants.toFixed(0)} / ${totalOccupants100.toFixed(0)} people` : '—'}
          </span>
        </div>
      </div>

      {/* ── Density value + basis ──────────────────────────────────────── */}
      <div className="space-y-1.5">
        <NumField
          label="Density"
          value={occ.density?.value}
          onChange={setDensityValue}
          step={0.1}
          min={0}
        />
        <SelectField
          label="Basis"
          value={occ.density?.basis ?? 'per_room'}
          onChange={setDensityBasis}
          options={DENSITY_BASIS_OPTIONS}
        />
        {occ.density?.basis === 'per_room' && (
          <p className="text-xxs italic text-mid-grey/70 pl-1">
            Uses Building → num_bedrooms (= {params?.num_bedrooms ?? 0}) as
            the room count.
          </p>
        )}
      </div>

      {/* ── Occupancy rate ─────────────────────────────────────────────── */}
      <PercentSlider
        label="Occupancy rate"
        value={occ.occupancy_rate}
        onChange={v => patchOccupancy({ occupancy_rate: v })}
      />

      {/* ── Heat per person ───────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <NumField
          label="Sensible heat"
          suffix="W/person"
          value={occ.sensible_w_per_person ?? 75}
          onChange={v => patchOccupancy({ sensible_w_per_person: v ?? 75 })}
          step={5}
          min={0}
          max={500}
        />
        <NumField
          label="Latent heat"
          suffix="W/person"
          value={occ.latent_w_per_person ?? 55}
          onChange={v => patchOccupancy({ latent_w_per_person: v ?? 55 })}
          step={5}
          min={0}
          max={500}
        />
      </div>

      {/* ── Read-only mini-profile + Edit-schedule link ────────────────── */}
      <div className="border-t border-light-grey/60 pt-2">
        <MiniProfile
          schedule={occ.schedule}
          accent={GAIN_COLOURS.occupancy}
          onEdit={onEditSchedule}
          label="Weekday schedule"
        />
        <p className="text-xxs italic text-mid-grey/70 mt-1.5">
          Click the mini-profile, or use the Schedule tab in the centre
          canvas, to author the full 24-hour schedule with day-type
          variations, monthly multipliers, and exception periods.
        </p>
      </div>
    </div>
  )
}
