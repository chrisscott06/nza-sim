/**
 * TotalEnergyBar — magnitude anchor for the Profiles tab's stats column.
 *
 * Brief 28a Part 5 walkthrough Finding 3 (2026-05-14): the time-series
 * chart shows *shape* but not *magnitude* in an easy-to-anchor way. This
 * component is the magnitude anchor: a single vertical stacked bar
 * segmented by gain category, with a unit toggle.
 *
 * Behaviour:
 *   - kWh mode: window-scoped total. Updates as the user zooms / jumps
 *     to a calendar month / edits a schedule (via parent reactivity).
 *   - kWh/m²·yr mode: annual full-year EUI. Constant — annualising a
 *     sub-year window misleads, so the kWh/m²·yr value is always the
 *     full-year benchmark regardless of zoom.
 *   - Toggled-off gains (via the share-row DataCards) drop their segment.
 *
 * The bar reads as: top segment = People, middle = Lighting, bottom =
 * Equipment, matching the AreaChart stack order. Colours come from
 * GAIN_COLOURS through props so the component stays generic.
 */

const UNITS = [
  { key: 'kWh',        label: 'kWh' },
  { key: 'kWh_per_m2', label: 'kWh/m²·yr' },
]

function formatKWh(v) {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 100000) return `${(v / 1000).toFixed(0)}k`
  if (v >= 10000)  return `${(v / 1000).toFixed(0)}k`
  if (v >= 1000)   return `${(v / 1000).toFixed(1)}k`
  return Math.round(v).toLocaleString()
}

function formatEUI(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(1)
}

export default function TotalEnergyBar({
  unit,
  setUnit,
  windowTotals,    // { people, lighting, equipment } in kWh, visible window
  annualTotals,    // { people, lighting, equipment } in kWh, full year
  enabledGains,    // { people, lighting, equipment } booleans
  gia,             // m²
  windowLabel,     // human-readable label e.g. "7d window" / "Mar" / "annual"
  colors,          // { people, lighting, equipment } hex strings
}) {
  const isAnnual = unit === 'kWh_per_m2'
  // Source of truth differs per unit. Annual mode always reads from
  // annualTotals so the EUI is the full-year benchmark — annualising
  // sub-year windows would be misleading at low zooms.
  const totals = isAnnual ? annualTotals : windowTotals
  const denom = isAnnual && gia > 0 ? gia : 1

  const vP = enabledGains.people    ? (totals.people    ?? 0) : 0
  const vL = enabledGains.lighting  ? (totals.lighting  ?? 0) : 0
  const vE = enabledGains.equipment ? (totals.equipment ?? 0) : 0
  const sum = vP + vL + vE
  const total = sum > 0 ? sum / denom : 0

  const pct = (v) => (sum > 0 ? (v / sum) * 100 : 0)
  const fmt = isAnnual ? formatEUI : formatKWh

  return (
    <div
      className="bg-white rounded-lg shadow-sm overflow-hidden"
      style={{ borderLeft: '3px solid #2B2A4C' }}
    >
      {/* Header: title + unit toggle */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-between gap-2">
        <span className="text-xxs uppercase tracking-wider text-mid-grey font-medium">
          Total
        </span>
        <div className="flex bg-off-white rounded border border-light-grey p-0.5 gap-0.5">
          {UNITS.map(u => (
            <button
              key={u.key}
              onClick={() => setUnit(u.key)}
              className={`px-1.5 py-0 text-[10px] rounded transition-colors ${
                unit === u.key
                  ? 'bg-white text-navy font-medium shadow-sm'
                  : 'text-mid-grey hover:text-navy'
              }`}
              title={u.key === 'kWh_per_m2' ? 'Annual full-year EUI (kWh per m²·yr)' : 'Total kWh in the current window'}
            >
              {u.label}
            </button>
          ))}
        </div>
      </div>

      {/* Total value */}
      <div className="px-3 pb-1">
        <div className="flex items-baseline gap-1">
          <span className="text-metric font-medium text-navy leading-none tabular-nums">
            {fmt(total)}
          </span>
          <span className="text-xxs text-mid-grey">
            {isAnnual ? 'kWh/m²·yr' : 'kWh'}
          </span>
        </div>
        <p className="text-xxs text-mid-grey/70 mt-0.5 leading-tight">
          {isAnnual ? 'annual EUI · full year' : windowLabel}
        </p>
      </div>

      {/* Stacked vertical bar. Top = People, then Lighting, then Equipment
          — matches AreaChart stack order. Each segment height ∝ its share
          of the visible sum (toggled-off gains contribute 0). */}
      <div className="px-3 pt-1 pb-2">
        <div className="h-[80px] w-full rounded overflow-hidden bg-off-white flex flex-col border border-light-grey/60">
          {enabledGains.people && pct(vP) > 0 && (
            <div
              style={{ height: `${pct(vP)}%`, backgroundColor: colors.people }}
              title={`People · ${fmt(vP / denom)} ${isAnnual ? 'kWh/m²·yr' : 'kWh'}`}
            />
          )}
          {enabledGains.lighting && pct(vL) > 0 && (
            <div
              style={{ height: `${pct(vL)}%`, backgroundColor: colors.lighting }}
              title={`Lighting · ${fmt(vL / denom)} ${isAnnual ? 'kWh/m²·yr' : 'kWh'}`}
            />
          )}
          {enabledGains.equipment && pct(vE) > 0 && (
            <div
              style={{ height: `${pct(vE)}%`, backgroundColor: colors.equipment }}
              title={`Equipment · ${fmt(vE / denom)} ${isAnnual ? 'kWh/m²·yr' : 'kWh'}`}
            />
          )}
          {sum === 0 && (
            <div className="flex-1 flex items-center justify-center text-xxs text-mid-grey/60">
              empty
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
