/**
 * ComfortDemandCard.jsx — Chris UX overhaul (2026-05-17)
 *
 * Compact card beneath the 3D viewer (or equivalent context image) holding
 * the comfort + demand surface for envelope-only mode. Replaces the
 * LiveResultsStrip on the Building module and absorbs the comfort-band
 * editor + comfort-hours strip + free-running stats that used to sit at
 * the bottom of the Heat Balance view.
 *
 * Layout (top to bottom, all small fonts):
 *   1. Comfort band — heating / cooling setpoint inputs
 *   2. Heating + cooling demand (two compact tiles)
 *   3. EUI (one line, static engine)
 *   4. Comfort hours — under / in / over micro bar with totals
 *   5. Free-running temps — winter min / mean / summer max
 *   6. Methodology footnote — why heating demand can exceed fabric loss
 *
 * Reads `instantResult` (envelope-only) + `comfortBand` + `setComfortBand`
 * from ProjectContext. No engine source toggle — that's app-global now.
 *
 * Props:
 *   instantResult — full result object from calculateInstant
 *   loading       — render skeleton when no result is available yet
 */

import { useEffect, useState } from 'react'
import { HEATING_COLOUR, COOLING_COLOUR } from '../../data/balanceColours.js'
import { useUISettings } from '../../context/UISettingsContext.jsx'

const COMFORT_COLOUR = '#16A34A'   // green-600

// ── Inline comfort-band editor ──────────────────────────────────────────────

function ComfortBandEditor({ comfortBand, onChange }) {
  // Local mirror — typing doesn't fire a save on every keystroke; commits
  // on blur or Enter. Validated client-side to the contract bounds.
  const [lower, setLower] = useState(comfortBand?.lower_c ?? 20)
  const [upper, setUpper] = useState(comfortBand?.upper_c ?? 26)
  useEffect(() => {
    setLower(comfortBand?.lower_c ?? 20)
    setUpper(comfortBand?.upper_c ?? 26)
  }, [comfortBand?.lower_c, comfortBand?.upper_c])

  const commit = () => {
    const lo = Number(lower), up = Number(upper)
    if (Number.isFinite(lo) && Number.isFinite(up) && lo < up && lo >= 8 && up <= 32) {
      onChange?.({ lower_c: lo, upper_c: up })
    } else {
      setLower(comfortBand?.lower_c ?? 20)
      setUpper(comfortBand?.upper_c ?? 26)
    }
  }
  const onKey = (e) => { if (e.key === 'Enter') e.currentTarget.blur() }
  const inputCls = 'w-10 px-1 py-0.5 text-xxs text-navy border border-light-grey rounded text-center tabular-nums focus:outline-none focus:border-teal bg-white'
  return (
    <div className="flex items-center justify-between gap-2 text-xxs">
      <span className="text-mid-grey">Comfort band</span>
      <div className="flex items-center gap-1">
        <input type="number" min={8} max={32} step={1}
          value={lower} onChange={e => setLower(e.target.value)}
          onBlur={commit} onKeyDown={onKey}
          className={inputCls} title="Heating setpoint (°C)" />
        <span className="text-light-grey">–</span>
        <input type="number" min={8} max={32} step={1}
          value={upper} onChange={e => setUpper(e.target.value)}
          onBlur={commit} onKeyDown={onKey}
          className={inputCls} title="Cooling setpoint (°C)" />
        <span className="text-mid-grey">°C</span>
      </div>
    </div>
  )
}

// ── KPI tile (smaller font than LiveResultsStrip) ──────────────────────────

function Tile({ label, value, unit, sub, accent }) {
  return (
    <div
      className="bg-white border border-light-grey rounded px-2 py-1.5"
      style={accent ? { borderTop: `2px solid ${accent}` } : undefined}
    >
      <p className="text-xxs text-mid-grey leading-tight">{label}</p>
      <p className="text-caption font-semibold text-navy tabular-nums leading-tight mt-0.5">
        {value}
        {unit && <span className="text-xxs text-mid-grey font-normal ml-1">{unit}</span>}
      </p>
      {sub && <p className="text-xxs text-mid-grey/80 leading-tight mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function ComfortDemandCard({ instantResult, comfortBand, onComfortBandChange, loading }) {
  const { unit } = useUISettings()

  if (loading || !instantResult) {
    return (
      <div className="border-t border-light-grey bg-off-white px-3 py-2" style={{ minHeight: 160 }}>
        <div className="h-2 bg-light-grey/60 rounded w-24 mb-2 animate-pulse" />
        <div className="h-12 bg-light-grey/40 rounded mb-2 animate-pulse" />
        <div className="h-2 bg-light-grey/60 rounded w-32 animate-pulse" />
      </div>
    )
  }

  const demand = instantResult?.demand ?? instantResult?.heat_balance?.demand
  const fr     = instantResult?.free_running ?? instantResult?.heat_balance?.free_running
  const gia    = instantResult?.heat_balance?.metadata?.gia_m2
            ?? instantResult?.metadata?.gia_m2 ?? 0

  const heat_mwh = demand?.heating_demand_mwh
  const cool_mwh = demand?.cooling_demand_mwh
  const heat_kwh = Number.isFinite(heat_mwh) ? heat_mwh * 1000 : null
  const cool_kwh = Number.isFinite(cool_mwh) ? cool_mwh * 1000 : null
  const heatVal = unit === 'kwh_per_m2'
    ? (gia > 0 && heat_kwh != null ? (heat_kwh / gia).toFixed(1) : '—')
    : (heat_mwh != null ? heat_mwh.toFixed(1) : '—')
  const coolVal = unit === 'kwh_per_m2'
    ? (gia > 0 && cool_kwh != null ? (cool_kwh / gia).toFixed(1) : '—')
    : (cool_mwh != null ? cool_mwh.toFixed(1) : '—')
  const demandUnit = unit === 'kwh_per_m2' ? 'kWh/m²·yr' : 'MWh/yr'

  const eui = (gia > 0 && (Number.isFinite(heat_mwh) || Number.isFinite(cool_mwh)))
    ? Math.round(((Number(heat_mwh ?? 0) + Number(cool_mwh ?? 0)) * 1000 / gia) * 10) / 10
    : null

  const under   = demand?.underheating_hours ?? 0
  const inBand  = demand?.comfort_hours      ?? 0
  const over    = demand?.overheating_hours  ?? 0
  const total   = under + inBand + over
  const pct = (h) => total > 0 ? (h / total) * 100 : 0
  const inPct = Math.round(pct(inBand))

  const meanT  = fr?.annual_mean_c
  const minT   = fr?.winter_min_c
  const maxT   = fr?.summer_max_c

  return (
    <div className="border-t border-light-grey bg-off-white px-3 py-2 space-y-2 overflow-y-auto"
         style={{ maxHeight: 340 }}>

      {/* 1. Comfort band editor */}
      <ComfortBandEditor comfortBand={comfortBand} onChange={onComfortBandChange} />

      {/* 2. Heating + cooling demand */}
      <div className="grid grid-cols-2 gap-1.5">
        <Tile label="Heating demand" value={heatVal} unit={demandUnit}
              sub={`below ${comfortBand?.lower_c ?? 20}°C`} accent={HEATING_COLOUR} />
        <Tile label="Cooling demand" value={coolVal} unit={demandUnit}
              sub={`above ${comfortBand?.upper_c ?? 26}°C`} accent={COOLING_COLOUR} />
      </div>

      {/* 3. EUI single line + free-running temps */}
      <div className="grid grid-cols-2 gap-1.5">
        <Tile label="EUI (static)" value={eui != null ? eui.toFixed(1) : '—'} unit="kWh/m²·yr"
              accent="#0F766E" />
        <Tile label="Annual mean T" value={Number.isFinite(meanT) ? meanT.toFixed(1) : '—'} unit="°C"
              sub="free-running" accent="#A1887F" />
      </div>

      {/* 4. Comfort hours strip */}
      {total > 0 && (
        <div>
          <div className="flex items-center justify-between text-xxs text-mid-grey mb-0.5">
            <span>Comfort hours (no system)</span>
            <span className="tabular-nums">{inBand.toLocaleString()} / {total.toLocaleString()} h ({inPct}%)</span>
          </div>
          <div className="flex h-2 rounded overflow-hidden bg-light-grey/30">
            {under > 0 && (
              <div title={`Under: ${under.toLocaleString()} h`}
                   style={{ width: `${pct(under)}%`, backgroundColor: HEATING_COLOUR, opacity: 0.75 }} />
            )}
            {inBand > 0 && (
              <div title={`In band: ${inBand.toLocaleString()} h`}
                   style={{ width: `${pct(inBand)}%`, backgroundColor: COMFORT_COLOUR, opacity: 0.75 }} />
            )}
            {over > 0 && (
              <div title={`Over: ${over.toLocaleString()} h`}
                   style={{ width: `${pct(over)}%`, backgroundColor: COOLING_COLOUR, opacity: 0.75 }} />
            )}
          </div>
          <div className="grid grid-cols-3 gap-1 text-xxs text-mid-grey/80 mt-0.5 tabular-nums">
            <span>↓ {under.toLocaleString()}</span>
            <span className="text-center text-green-700">✓ {inBand.toLocaleString()}</span>
            <span className="text-right">↑ {over.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* 5. Free-running winter/summer extremes */}
      {(Number.isFinite(minT) || Number.isFinite(maxT)) && (
        <div className="flex items-center justify-between text-xxs text-mid-grey px-0.5">
          <span>Winter min <span className="text-navy tabular-nums font-medium">{Number.isFinite(minT) ? minT.toFixed(1) : '—'}°C</span></span>
          <span>Summer max <span className="text-navy tabular-nums font-medium">{Number.isFinite(maxT) ? maxT.toFixed(1) : '—'}°C</span></span>
        </div>
      )}

      {/* 6. Methodology footnote — why heating demand can exceed fabric loss.
          Lives here (next to the demand numbers themselves) rather than in
          the Heat Balance bottom, so the explanation sits right where the
          question naturally surfaces. */}
      <details className="text-xxs text-mid-grey/85 leading-snug">
        <summary className="cursor-pointer hover:text-navy">
          Why heating demand can exceed fabric loss
        </summary>
        <div className="mt-1 pl-2 border-l-2 border-light-grey">
          Fabric loss integrates <code>(T_set − T_out) × U·A</code> at a
          constant setpoint. Heating demand integrates
          <code> max(0, T_set − T_zone) × H</code> hour by hour. The Static
          engine's lumped 2-node mass model lets T_zone swing below T_out
          on cold nights (radiative loss to sky), inflating demand by
          30–60% over fabric loss. Dynamic (EnergyPlus, full CTF) is closer
          to truth — switch the top-bar engine toggle to compare.
        </div>
      </details>
    </div>
  )
}
