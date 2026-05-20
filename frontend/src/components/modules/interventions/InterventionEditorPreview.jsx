/**
 * InterventionEditorPreview.jsx — Brief 41 Part 4
 *
 * Right-half of the editor pop-out — the visualisation-as-verification
 * surface (Notion §10).
 *
 * Composition:
 *   - KPI strip: baseline | intervention | delta
 *     Rows: EUI, total delivered, heating demand, electricity, gas, carbon
 *   - Heat-balance comparison bars: baseline vs intervention,
 *     same scale, terms that moved highlighted
 *   - PatchList: patches in plain English (the visible record of what
 *     the user has changed)
 *
 * The intervention's effect is computed by the engine via the parent
 * — this component is pure presentation reading from the
 * `stackResult` prop (which is the result of
 * `runInterventionStack(baseline, [thisIntervention])` re-run on
 * every patch change).
 */

import PatchList from './PatchList.jsx'

function fmt(value, opts = {}) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  if (opts.fixed != null) return n.toFixed(opts.fixed)
  if (Math.abs(n) >= 100) return n.toFixed(0)
  if (Math.abs(n) >= 10)  return n.toFixed(1)
  if (Math.abs(n) >= 1)   return n.toFixed(2)
  return n.toFixed(3)
}

function pickFirst(result, paths) {
  if (!result) return null
  for (const path of paths) {
    let cur = result
    for (const seg of path.split('.')) {
      if (cur == null) break
      cur = cur[seg]
    }
    if (Number.isFinite(cur)) return cur
  }
  return null
}

function deltaColour(delta) {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.01) return 'text-mid-grey'
  return delta < 0 ? 'text-green-600' : 'text-red-600'
}

function KPIRow({ label, before, after, unit }) {
  const b = Number.isFinite(before) ? before : null
  const a = Number.isFinite(after)  ? after  : null
  const delta = (b != null && a != null) ? (a - b) : null
  const pct = (b != null && a != null && b !== 0) ? ((a - b) / b) * 100 : null
  return (
    <div className="grid grid-cols-[1fr_70px_70px_80px] gap-2 px-2 py-1.5 border-b border-light-grey/50 last:border-0">
      <span className="text-xxs text-mid-grey self-center">{label}</span>
      <span className="text-xxs tabular-nums text-right text-mid-grey/80 self-center">
        {b != null ? `${fmt(b)}${unit ?? ''}` : '—'}
      </span>
      <span className="text-xxs tabular-nums text-right text-navy font-medium self-center">
        {a != null ? `${fmt(a)}${unit ?? ''}` : '—'}
      </span>
      <span className={`text-xxs tabular-nums text-right font-medium self-center ${deltaColour(delta)}`}>
        {delta == null ? '—' : `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))}${pct != null ? ` (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%)` : ''}`}
      </span>
    </div>
  )
}

function HeatBalanceBar({ label, baselineValue, interventionValue, maxValue }) {
  const max = Math.max(Math.abs(baselineValue ?? 0), Math.abs(interventionValue ?? 0), Math.abs(maxValue ?? 0), 0.01)
  const baseW = Math.max(0, Math.min(100, Math.abs(baselineValue ?? 0) / max * 100))
  const intW  = Math.max(0, Math.min(100, Math.abs(interventionValue ?? 0) / max * 100))
  const moved = baselineValue != null && interventionValue != null && Math.abs((interventionValue - baselineValue) / Math.max(Math.abs(baselineValue), 0.0001)) > 0.01
  const baseColor = moved ? '#9CA3AF' : '#D1D5DB'
  const intColor  = moved ? '#E84393' : '#D1D5DB'
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xxs text-mid-grey">{label}</span>
        <span className={`text-xxs tabular-nums ${moved ? 'text-navy font-medium' : 'text-mid-grey/70'}`}>
          {fmt(baselineValue)} → {fmt(interventionValue)} MWh
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="h-2 rounded bg-light-grey/50 overflow-hidden">
          <div className="h-full" style={{ width: `${baseW}%`, backgroundColor: baseColor }} />
        </div>
        <div className="h-2 rounded bg-light-grey/50 overflow-hidden">
          <div className="h-full" style={{ width: `${intW}%`, backgroundColor: intColor }} />
        </div>
      </div>
    </div>
  )
}

export default function InterventionEditorPreview({
  baselineResult,
  interventionResult,
  patches,
  baselineConfig,
  libraryData,
  onRemovePatch,
  validationError,
}) {
  // Helper to pull numeric from either result. Supports State 3 v2.5
  // shape (consumption.total.* + results.energy.* + consumption.space_*.demand_mwh +
  // carbon_kg_co2_per_m2), the legacy "full" path shape (eui_kWh_m2 +
  // fuel_split.* + annual_*_kWh + carbon_kgCO2_m2), and historical
  // results_summary shapes. See audit doc §8.3.
  const eb = pickFirst(baselineResult,    ['consumption.total.kwh_per_m2_yr', 'results.energy.kwh_per_m2_yr', 'energy_use.totals.eui_kwh_per_m2', 'eui_kwh_per_m2', 'eui_kWh_per_m2', 'eui_kWh_m2', 'results_summary.eui_kWh_per_m2'])
  const ea = pickFirst(interventionResult,['consumption.total.kwh_per_m2_yr', 'results.energy.kwh_per_m2_yr', 'energy_use.totals.eui_kwh_per_m2', 'eui_kwh_per_m2', 'eui_kWh_per_m2', 'eui_kWh_m2', 'results_summary.eui_kWh_per_m2'])
  const heatB = pickFirst(baselineResult,    ['consumption.space_heating.demand_mwh', 'demand.heating_demand_mwh', 'consumption.heating_demand_mwh', 'annual_heating_kWh'])
  const heatA = pickFirst(interventionResult,['consumption.space_heating.demand_mwh', 'demand.heating_demand_mwh', 'consumption.heating_demand_mwh', 'annual_heating_kWh'])
  const coolB = pickFirst(baselineResult,    ['consumption.space_cooling.demand_mwh', 'demand.cooling_demand_mwh', 'consumption.cooling_demand_mwh', 'annual_cooling_kWh'])
  const coolA = pickFirst(interventionResult,['consumption.space_cooling.demand_mwh', 'demand.cooling_demand_mwh', 'consumption.cooling_demand_mwh', 'annual_cooling_kWh'])
  const elecB = pickFirst(baselineResult,    ['consumption.total.electricity_mwh', 'results.energy.by_carrier.electricity', 'consumption.electricity_mwh', 'annual_energy.electricity_kWh', 'fuel_split.electricity_kWh'])
  const elecA = pickFirst(interventionResult,['consumption.total.electricity_mwh', 'results.energy.by_carrier.electricity', 'consumption.electricity_mwh', 'annual_energy.electricity_kWh', 'fuel_split.electricity_kWh'])
  const gasB  = pickFirst(baselineResult,    ['consumption.total.gas_mwh', 'results.energy.by_carrier.gas', 'consumption.gas_mwh', 'annual_energy.gas_kWh', 'fuel_split.gas_kWh'])
  const gasA  = pickFirst(interventionResult,['consumption.total.gas_mwh', 'results.energy.by_carrier.gas', 'consumption.gas_mwh', 'annual_energy.gas_kWh', 'fuel_split.gas_kWh'])
  const cB    = pickFirst(baselineResult,    ['carbon_kg_co2_per_m2', 'results.carbon.today.kgCO2_per_m2_yr', 'carbon_kgco2_per_m2', 'carbon_kgCO2_m2', 'consumption.carbon_kgco2_per_m2'])
  const cA    = pickFirst(interventionResult,['carbon_kg_co2_per_m2', 'results.carbon.today.kgCO2_per_m2_yr', 'carbon_kgco2_per_m2', 'carbon_kgCO2_m2', 'consumption.carbon_kgco2_per_m2'])

  const heatMax = Math.max(heatB ?? 0, heatA ?? 0)

  return (
    <div className="space-y-4">
      {/* Validation error (if any) */}
      {validationError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2">
          <p className="text-xxs font-semibold text-red-700 uppercase tracking-wider mb-0.5">Engine validation</p>
          <p className="text-xxs text-red-700">{validationError}</p>
          <p className="text-xxs text-red-600/70 mt-1">Resolve before saving.</p>
        </div>
      )}

      {/* KPI strip */}
      <div className="rounded-lg border border-light-grey bg-white overflow-hidden">
        <div className="grid grid-cols-[1fr_70px_70px_80px] gap-2 px-2 py-1.5 bg-off-white/80 border-b border-light-grey">
          <span className="text-xxs text-mid-grey/80 font-medium uppercase tracking-wider">Metric</span>
          <span className="text-xxs text-mid-grey/80 font-medium uppercase tracking-wider text-right">Baseline</span>
          <span className="text-xxs text-mid-grey/80 font-medium uppercase tracking-wider text-right">Intervention</span>
          <span className="text-xxs text-mid-grey/80 font-medium uppercase tracking-wider text-right">Δ</span>
        </div>
        <KPIRow label="EUI"           before={eb}    after={ea}    unit=" kWh/m²" />
        <KPIRow label="Heating demand"   before={heatB} after={heatA} unit=" MWh" />
        <KPIRow label="Cooling demand"   before={coolB} after={coolA} unit=" MWh" />
        <KPIRow label="Electricity"   before={elecB} after={elecA} unit=" MWh" />
        <KPIRow label="Gas"           before={gasB}  after={gasA}  unit=" MWh" />
        <KPIRow label="Carbon"        before={cB}    after={cA}    unit=" kgCO₂/m²" />
      </div>

      {/* Heat balance comparison */}
      <div className="rounded-lg border border-light-grey bg-white px-3 py-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <p className="text-xxs font-semibold text-navy uppercase tracking-wider">Heat balance comparison</p>
          <div className="flex items-center gap-2 text-xxs text-mid-grey">
            <span className="inline-flex items-center gap-1">
              <span className="block w-3 h-1 rounded bg-mid-grey/60" /> baseline
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="block w-3 h-1 rounded" style={{ backgroundColor: '#E84393' }} /> intervention
            </span>
          </div>
        </div>
        <HeatBalanceBar label="Heating demand" baselineValue={heatB} interventionValue={heatA} maxValue={heatMax} />
        <HeatBalanceBar label="Cooling demand" baselineValue={coolB} interventionValue={coolA} maxValue={heatMax} />
        <HeatBalanceBar label="Electricity" baselineValue={elecB} interventionValue={elecA} />
        <HeatBalanceBar label="Gas" baselineValue={gasB} interventionValue={gasA} />
        {heatB == null && heatA == null && elecB == null && elecA == null && (
          <p className="text-xxs text-mid-grey italic">
            No engine numbers available — weather not loaded, or engine in degree-day fallback.
            Live numbers appear once Bridgewater weather is loaded (Weather module).
          </p>
        )}
      </div>

      {/* Patch list */}
      <div className="rounded-lg border border-light-grey bg-white px-3 py-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-xxs font-semibold text-navy uppercase tracking-wider">Patches</p>
          <span className="text-xxs text-mid-grey">{patches?.length ?? 0} change{(patches?.length ?? 0) === 1 ? '' : 's'}</span>
        </div>
        <PatchList
          patches={patches}
          baselineConfig={baselineConfig}
          libraryData={libraryData}
          onRemove={onRemovePatch}
        />
      </div>
    </div>
  )
}
