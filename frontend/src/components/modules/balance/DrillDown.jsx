/**
 * DrillDown.jsx
 *
 * Side panel that opens when the user clicks an element on the HeatBalance.
 * Shows three numbers per element side-by-side:
 *   - First-principles  (A·U·HDH or A·g·G — pure formula, no engine)
 *   - instantCalc       (frontend live model)
 *   - EnergyPlus        (last simulation run)
 *
 * Plus the spread between them, with tolerance flagging:
 *   - within 10% → green tick
 *   - 10–25%     → amber notice
 *   - > 25%      → red notice + "Why might these differ?" expandable
 */

import { useEffect, useState } from 'react'
import { X as XIcon, ChevronDown, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { firstPrinciplesFor, computeSpread, classifySpread } from '../../../utils/firstPrinciples.js'
import { LABELS, colourForElement } from '../../../data/balanceColours.js'
import { solarLabel } from '../../../utils/facadeLabel.js'

// ── Element-specific notes for divergence ────────────────────────────────────

const DIVERGENCE_NOTES = {
  external_wall: 'EnergyPlus result includes thermal bridges and dynamic exterior conditions; first-principles assumes 1D heat flow against a static HDH.',
  roof:          'Roof conduction is sensitive to outdoor radiation (sky temp, solar absorption). EnergyPlus models these per timestep; first-principles uses HDH only.',
  ground_floor:  'Ground heat flow is non-trivial — EnergyPlus uses a ground temperature model. First-principles assumes constant ΔT against the heating-season HDH.',
  glazing:       'Window U-value via SimpleGlazingSystem includes frame and solar absorption effects in EnergyPlus. First-principles uses centre-of-glass U only.',
  infiltration:  'EnergyPlus may modulate infiltration with wind speed and stack effect (DesignFlowRate vs CalcMethod). First-principles assumes constant ACH.',
  ventilation:   'Mechanical ventilation rates and HRV efficiency vary with schedule. First-principles uses the design rate.',
  solar_north:   'Solar gain through windows depends on hour-by-hour sun angle, cloud cover, and shading. First-principles uses an annual orientation-averaged irradiation.',
  solar_east:    'Solar gain through windows depends on hour-by-hour sun angle, cloud cover, and shading. First-principles uses an annual orientation-averaged irradiation.',
  solar_south:   'Solar gain through windows depends on hour-by-hour sun angle, cloud cover, and shading. First-principles uses an annual orientation-averaged irradiation.',
  solar_west:    'Solar gain through windows depends on hour-by-hour sun angle, cloud cover, and shading. First-principles uses an annual orientation-averaged irradiation.',
  cooling:       'Cooling demand is the dynamic response of the building to heat surplus — there is no closed-form first-principles equivalent.',
  heating:       'Heating demand is the dynamic response of the building to heat deficit — there is no closed-form first-principles equivalent.',
  people:        'People heat gain depends on occupancy schedules and metabolic rate — schedule-driven so a closed-form first-principles is rough at best.',
  equipment:     'Equipment gain depends on power density and operating hours, both schedule-driven.',
  lighting:      'Lighting gain depends on power density and operating hours, both schedule-driven.',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readValue(node, unit) {
  if (!node) return null
  return unit === 'kwh_per_m2' ? (node.kwh_per_m2 ?? null) : (node.kwh ?? null)
}

function fmtVal(v, unit) {
  if (v == null) return '—'
  if (unit === 'kwh_per_m2') return `${v.toFixed(1)} kWh/m²·a`
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)} MWh/yr`
  return `${Math.round(v).toLocaleString()} kWh/yr`
}

// elementKey → (heatBalanceData) → node
function pickNode(elementKey, hb) {
  if (!hb?.annual) return null
  if (elementKey.startsWith('solar_')) {
    return hb.annual.gains?.solar?.[elementKey.slice(6)]
  }
  if (['people', 'equipment', 'lighting'].includes(elementKey)) {
    return hb.annual.gains?.internal?.[elementKey]
  }
  if (elementKey === 'heating') return hb.annual.gains?.heating
  return hb.annual.losses?.[elementKey]
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function DrillDown({
  elementKey,
  open,
  onClose,
  building,
  constructions,
  libraryData,
  liveData,
  simulationData,
  unit = 'kwh_per_m2',
  orientationDeg = 0,
}) {
  const [showNote, setShowNote] = useState(false)

  // Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !elementKey) return null

  const fp        = firstPrinciplesFor(elementKey, building, constructions, libraryData)
  const liveNode  = pickNode(elementKey, liveData)
  const simNode   = pickNode(elementKey, simulationData)

  const fpValue   = unit === 'kwh_per_m2' ? fp.kwh_per_m2 : fp.kwh
  const liveValue = readValue(liveNode, unit)
  const simValue  = readValue(simNode,  unit)

  const spread = computeSpread([fpValue, liveValue, simValue])
  const cls    = classifySpread(spread)

  const colour = colourForElement(elementKey)
  const label  = elementKey?.startsWith('solar_')
    ? solarLabel(elementKey.slice(6), orientationDeg)
    : (LABELS[elementKey] ?? elementKey)

  return (
    <div className="fixed inset-0 z-40 pointer-events-none" aria-hidden={!open}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 pointer-events-auto transition-opacity duration-200"
        onClick={onClose}
        style={{ opacity: open ? 1 : 0 }}
      />

      {/* Side panel */}
      <aside
        className="absolute top-0 right-0 h-full w-[380px] bg-white shadow-xl pointer-events-auto overflow-y-auto"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease-out',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-light-grey">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colour }} />
            <h3 className="text-caption font-semibold text-navy">{label}</h3>
          </div>
          <button onClick={onClose} className="text-mid-grey hover:text-navy p-1" title="Close (Esc)">
            <XIcon size={16} />
          </button>
        </div>

        {/* Three-row comparison */}
        <div className="px-5 py-4 space-y-2">
          <Row label="First-principles"
               sub={fp.formula}
               value={fpValue}
               unit={unit}
               muted={fpValue == null} />
          <Row label="instantCalc"
               sub="Live frontend model"
               value={liveValue}
               unit={unit}
               muted={liveValue == null} />
          <Row label="EnergyPlus"
               sub="Last Dynamic run"
               value={simValue}
               unit={unit}
               muted={simValue == null} />
        </div>

        {/* Spread / tolerance */}
        <div className="px-5 pb-3">
          {spread != null ? (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xxs"
              style={{
                backgroundColor: cls === 'tight'    ? '#F0FDF4'
                                : cls === 'moderate' ? '#FFFBEB'
                                : '#FEF2F2',
                borderColor:     cls === 'tight'    ? '#BBF7D0'
                                : cls === 'moderate' ? '#FDE68A'
                                : '#FECACA',
              }}
            >
              {cls === 'tight'
                ? <CheckCircle2 size={13} className="text-green-600" />
                : <AlertTriangle size={13} className={cls === 'moderate' ? 'text-amber-600' : 'text-red-600'} />}
              <span className="font-medium" style={{
                color: cls === 'tight' ? '#15803D' : cls === 'moderate' ? '#B45309' : '#B91C1C'
              }}>
                Spread: ±{spread.toFixed(1)}%
              </span>
              <span className="text-mid-grey">
                {cls === 'tight'    ? '— within tolerance'
                : cls === 'moderate' ? '— moderate divergence'
                                     : '— investigate'}
              </span>
            </div>
          ) : (
            <p className="text-xxs text-mid-grey px-3">
              Need at least two engines reporting to compute a spread.
            </p>
          )}
        </div>

        {/* Inputs used by first-principles */}
        {fp.terms?.length > 0 && (
          <div className="px-5 py-3 border-t border-light-grey">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
              First-principles inputs
            </p>
            <table className="w-full text-xxs">
              <tbody>
                {fp.terms.map(t => (
                  <tr key={t.label} className="border-b border-light-grey/40 last:border-b-0">
                    <td className="py-1.5 text-mid-grey">{t.label}</td>
                    <td className="py-1.5 tabular-nums text-right text-dark-grey">
                      {typeof t.value === 'number' ? t.value.toLocaleString() : t.value}
                    </td>
                    <td className="py-1.5 pl-2 text-mid-grey w-12">{t.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Why might these differ? */}
        {DIVERGENCE_NOTES[elementKey] && (
          <div className="px-5 py-3 border-t border-light-grey">
            <button
              onClick={() => setShowNote(s => !s)}
              className="flex items-center gap-1.5 text-xxs text-mid-grey hover:text-navy"
            >
              <ChevronDown
                size={11}
                className="transition-transform"
                style={{ transform: showNote ? 'rotate(180deg)' : 'none' }}
              />
              Why might these differ?
            </button>
            {showNote && (
              <p className="mt-2 text-xxs text-dark-grey leading-relaxed">
                {DIVERGENCE_NOTES[elementKey]}
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────

function Row({ label, sub, value, unit, muted }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 px-3 rounded-lg bg-off-white">
      <div className="min-w-0">
        <p className="text-caption font-medium text-navy">{label}</p>
        {sub && <p className="text-xxs text-mid-grey truncate">{sub}</p>}
      </div>
      <p className={`text-caption tabular-nums font-semibold flex-shrink-0 ${muted ? 'text-mid-grey/60' : 'text-navy'}`}>
        {fmtVal(value, unit)}
      </p>
    </div>
  )
}
