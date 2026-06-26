/**
 * CrremPicker.jsx — Brief 89 (Brief C) Part 7: project-level CRREM pathway pick.
 *
 * v1 is single-pathway: only UK · Hotel · 1.5°C has a curve (data/crremPathwayUkHotel.js).
 * Country is fixed UK; property type is DERIVED from the project's `building_type`
 * (single source of truth — not duplicated here); pathway is selectable but only
 * combos present in the registry are enabled (others tagged "future"). The pick
 * applies to both the Library per-intervention chart and the Strategy stranding
 * diagram. Persisting a non-default pick + adding more curves is a future brief.
 */
import { CRREM_PATHWAYS } from '../../../../data/crremPathwayUkHotel.js'

const PATHWAYS = [['1.5C', '1.5°C'], ['2C', '2°C'], ['4C', '4°C']]
const PROPERTY_LABELS = { hotel: 'Hotel', office: 'Office', retail: 'Retail', residential: 'Residential' }
const chip = 'px-2 py-1 rounded-md border border-light-grey'

export default function CrremPicker({ pick, onPathwayChange }) {
  const propLabel = PROPERTY_LABELS[pick.property_type] ?? pick.property_type
  return (
    <div className="flex items-center gap-1.5 text-xxs">
      <span className="uppercase tracking-wider text-mid-grey/60 font-semibold mr-0.5">CRREM</span>
      <span className={`${chip} text-mid-grey`} title="UK only in v1">{pick.country}</span>
      <span className={`${chip} text-mid-grey`} title="Derived from the project building type">{propLabel}</span>
      <select
        value={pick.pathway}
        onChange={(e) => onPathwayChange?.(e.target.value)}
        className={`${chip} text-navy bg-white`}
      >
        {PATHWAYS.map(([k, l]) => {
          const available = !!CRREM_PATHWAYS[`${pick.country}|${pick.property_type}|${k}`]
          return <option key={k} value={k} disabled={!available}>{available ? l : `${l} — future`}</option>
        })}
      </select>
    </div>
  )
}
