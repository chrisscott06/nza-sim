/**
 * SystemsLiveResults.jsx
 *
 * Right column of the Systems module three-column layout.
 * Shows instant-calc results with demand-based breakdown — each demand
 * shows its assigned system, fuel type, and efficiency metric.
 * Updates live as system inputs change.
 */

import { useContext, useMemo } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useWeather } from '../../../context/WeatherContext.jsx'
import { useHourlySolar } from '../../../hooks/useHourlySolar.js'
import { calculateInstant } from '../../../utils/instantCalc.js'

// ── EUI bar gauge ─────────────────────────────────────────────────────────────
// Horizontal bar — stable rendering, no SVG arc floating-point jitter.

const EUI_MAX = 300
const CRREM_TARGET = 85

function EUIGauge({ eui }) {
  const clamped  = Math.max(0, Math.min(Math.round(eui ?? 0), EUI_MAX))
  const pct      = clamped / EUI_MAX
  const targetPct = CRREM_TARGET / EUI_MAX
  const color = clamped <= CRREM_TARGET ? '#16A34A'
              : clamped <= CRREM_TARGET * 1.5 ? '#F59E0B'
              : '#DC2626'

  return (
    <div className="flex flex-col items-center">
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">EUI (instant estimate)</p>
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>{clamped}</span>
        <span className="text-xxs text-mid-grey">kWh/m²</span>
      </div>
      <div className="relative w-full h-3 bg-light-grey rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.round(pct * 10000) / 100}%`, background: color }}
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-gold"
          style={{ left: `${Math.round(targetPct * 10000) / 100}%` }}
        />
      </div>
      <div className="relative w-full mt-0.5">
        <span
          className="absolute text-xxs text-gold"
          style={{ left: `${Math.round(targetPct * 10000) / 100}%`, transform: 'translateX(-50%)' }}
        >
          {CRREM_TARGET}
        </span>
      </div>
      <p className="text-xxs text-mid-grey mt-3">
        CRREM target <span className="text-gold font-medium">{CRREM_TARGET}</span> kWh/m²
        {clamped > CRREM_TARGET && (
          <span className="ml-1" style={{ color }}>(+{clamped - CRREM_TARGET})</span>
        )}
      </p>
    </div>
  )
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMWh(kWh, decimals = 0) {
  const mwh = kWh / 1000
  if (mwh < 0.05) return '< 0.1 MWh'
  return `${mwh.toFixed(decimals)} MWh`
}

function fmtMWhShort(kWh) {
  const mwh = Math.round(kWh / 1000)
  if (mwh === 0 && kWh > 0) return '< 1'
  return mwh
}

// ── Look up a systems_flow link ───────────────────────────────────────────────

function sfLink(sf, src, tgt) {
  return sf?.links?.find(l => l.source === src && l.target === tgt)?.value_kWh ?? 0
}

/** Sum all links FROM a node */
function sfOut(sf, nodeId) {
  return sf?.links?.filter(l => l.source === nodeId).reduce((s, l) => s + (l.value_kWh ?? 0), 0) ?? 0
}

/** Sum all links TO a node (all styles except 'waste') */
function sfIn(sf, nodeId) {
  return sf?.links?.filter(l => l.target === nodeId && l.style !== 'waste')
    .reduce((s, l) => s + (l.value_kWh ?? 0), 0) ?? 0
}

// ── Derive demand-based node IDs from systems state ───────────────────────────

function getDemandNodes(systems) {
  const sh_key    = systems.space_heating?.primary?.system    ?? systems.hvac_type        ?? 'vrf_standard'
  const sc_key    = systems.space_cooling?.primary?.system    ?? systems.hvac_type        ?? 'vrf_standard'
  const dhw_key   = systems.dhw?.primary?.system              ?? systems.dhw_primary      ?? 'gas_boiler_dhw'
  const dhwSec    = systems.dhw?.secondary
  const dhwSec_key = dhwSec?.system                           ?? systems.dhw_preheat
  const vent_key  = systems.ventilation?.primary?.system      ?? systems.ventilation_type ?? 'mev_standard'

  const sc_is_none = sc_key === 'none_cooling'
  const same_hvac  = !sc_is_none && sh_key === sc_key

  return {
    sh_node:      `sh_${sh_key}`,
    sc_node:      sc_is_none ? null : (same_hvac ? `sh_${sh_key}` : `sc_${sc_key}`),
    dhw_node:     `dhw_${dhw_key}`,
    dhw_sec_node: (dhwSec && dhwSec_key && dhwSec_key !== 'none') ? `dhw_sec_${dhwSec_key}` : null,
    vent_node:    `vent_${vent_key}`,
    same_hvac,
    sh_key, sc_key, dhw_key, dhwSec_key, vent_key,
    sc_is_none,
  }
}

// ── Pretty system name from key ───────────────────────────────────────────────

const SYS_LABELS = {
  vrf_standard:       'VRF Standard',
  vrf_high_efficiency:'VRF High-Eff',
  ashp_system:        'ASHP',
  ashp_heating:       'ASHP',
  gas_boiler_heating: 'Gas Boiler',
  gas_boiler_combi:   'Gas Combi',
  electric_panel:     'Electric Panel',
  vrf_cooling:        'VRF Cooling',
  split_system:       'Split System',
  none_cooling:       'None',
  gas_boiler_dhw:     'Gas Boiler',
  ashp_dhw_preheat:   'ASHP Preheat',
  electric_immersion: 'Electric Immersion',
  solar_thermal_dhw:  'Solar Thermal',
  mev_standard:       'MEV',
  mvhr_standard:      'MVHR',
  natural_ventilation:'Natural',
}

function sysLabel(key) {
  return SYS_LABELS[key] ?? key
}

// ── Fuel badge ────────────────────────────────────────────────────────────────

const FUEL_COLORS = {
  gas:         { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B' },
  electricity: { bg: '#FEFCE8', border: '#FDE68A', text: '#92400E' },
  renewable:   { bg: '#ECFDF5', border: '#6EE7B7', text: '#065F46' },
  none:        { bg: '#F9FAFB', border: '#E5E7EB', text: '#6B7280' },
}

function FuelBadge({ fuel }) {
  const c = FUEL_COLORS[fuel] ?? FUEL_COLORS.none
  const label = fuel === 'electricity' ? 'Elec' : fuel === 'gas' ? 'Gas'
              : fuel === 'renewable' ? 'Renew' : fuel ?? '—'
  return (
    <span className="text-xxs px-1 py-px rounded border font-medium"
      style={{ color: c.text, backgroundColor: c.bg, borderColor: c.border }}>
      {label}
    </span>
  )
}

// ── Demand row ────────────────────────────────────────────────────────────────

function DemandRow({ label, systemName, fuel, fuelMWh, thermalMWh, effLabel, flossNote }) {
  if (fuelMWh === 0 && thermalMWh === 0) return null
  return (
    <div className="py-1.5 border-b border-light-grey last:border-0">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xxs font-medium text-dark-grey">{label}</span>
        <div className="flex items-center gap-1">
          <span className="text-xxs text-mid-grey">{systemName}</span>
          {fuel && <FuelBadge fuel={fuel} />}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xxs text-mid-grey">
        {fuelMWh > 0 && <span>{fmtMWh(fuelMWh * 1000)} fuel</span>}
        {fuelMWh > 0 && thermalMWh > 0 && <span className="text-light-grey">→</span>}
        {thermalMWh > 0 && <span className="font-medium text-navy">{fmtMWh(thermalMWh * 1000)} delivered</span>}
        {effLabel && <span className="ml-auto text-teal font-medium">{effLabel}</span>}
      </div>
      {flossNote && (
        <div className="text-xxs text-amber-600 mt-0.5">{flossNote}</div>
      )}
    </div>
  )
}

// ── Fuel split bar ────────────────────────────────────────────────────────────

function FuelSplit({ fuel }) {
  const { electricity_kWh, gas_kWh, electricity_pct, gas_pct, total_kWh } = fuel
  if (total_kWh === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Fuel split</p>
        <span className="text-xxs text-navy font-medium">{Math.round(total_kWh / 1000)} MWh total</span>
      </div>
      <div className="flex h-4 rounded overflow-hidden">
        <div className="transition-all duration-200"
          style={{ width: `${electricity_pct}%`, backgroundColor: '#ECB01F' }}
          title={`Electricity: ${electricity_pct}%`} />
        <div className="transition-all duration-200"
          style={{ width: `${gas_pct}%`, backgroundColor: '#DC2626' }}
          title={`Gas: ${gas_pct}%`} />
      </div>
      <div className="flex gap-3 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#ECB01F' }} />
          <span className="text-xxs text-dark-grey">Elec {electricity_pct}% · {Math.round(electricity_kWh / 1000)} MWh</span>
        </div>
        {gas_kWh > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#DC2626' }} />
            <span className="text-xxs text-dark-grey">Gas {gas_pct}% · {Math.round(gas_kWh / 1000)} MWh</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Recovery callout ──────────────────────────────────────────────────────────

function RecoveryCallout({ label, recoveredMWh, costSavingPounds, carbonSavingKg }) {
  if (recoveredMWh < 1) return null
  return (
    <div className="bg-green-50 border border-green-200 rounded p-2">
      <p className="text-xxs font-semibold text-green-800 mb-0.5">↻ {label}</p>
      <p className="text-xxs text-green-700">{Math.round(recoveredMWh)} MWh recovered</p>
      {costSavingPounds > 0 && (
        <p className="text-xxs text-green-600 mt-0.5">≈ £{Math.round(costSavingPounds).toLocaleString()}/yr gas saving @ 5p/kWh</p>
      )}
      {carbonSavingKg > 0 && (
        <p className="text-xxs text-green-600">≈ {Math.round(carbonSavingKg / 1000).toLocaleString()} tCO₂/yr avoided</p>
      )}
    </div>
  )
}

// ── Metric row ────────────────────────────────────────────────────────────────

function Metric({ label, value, unit }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-light-grey last:border-0">
      <span className="text-xxs text-dark-grey">{label}</span>
      <span className="text-xxs font-semibold text-navy">
        {value} <span className="font-normal text-mid-grey">{unit}</span>
      </span>
    </div>
  )
}

// ── SYSTEM_DEFAULTS (mirrored from instantCalc to derive fuel type) ───────────

const SYSTEM_DEFAULTS = {
  vrf_standard:       { fuel: 'electricity', eff: 3.5,  eer: 3.2 },
  vrf_high_efficiency:{ fuel: 'electricity', eff: 4.2,  eer: 3.8 },
  ashp_system:        { fuel: 'electricity', eff: 3.2 },
  ashp_heating:       { fuel: 'electricity', eff: 3.2 },
  gas_boiler_heating: { fuel: 'gas',         eff: 0.92 },
  gas_boiler_combi:   { fuel: 'gas',         eff: 0.90 },
  electric_panel:     { fuel: 'electricity', eff: 1.0 },
  vrf_cooling:        { fuel: 'electricity', eer: 3.2 },
  split_system:       { fuel: 'electricity', eer: 2.8 },
  none_cooling:       { fuel: null },
  gas_boiler_dhw:     { fuel: 'gas',         eff: 0.92 },
  ashp_dhw_preheat:   { fuel: 'electricity', eff: 2.8 },
  electric_immersion: { fuel: 'electricity', eff: 1.0 },
  solar_thermal_dhw:  { fuel: 'renewable',   eff: 0.60 },
  mev_standard:       { fuel: 'electricity' },
  mvhr_standard:      { fuel: 'electricity' },
  natural_ventilation:{ fuel: null },
}

function sysFuel(key) { return (SYSTEM_DEFAULTS[key] ?? {}).fuel ?? 'electricity' }

// ── Main panel ────────────────────────────────────────────────────────────────

export default function SystemsLiveResults({ libraryData = {}, scheduleProfiles = null }) {
  const { params, constructions, systems } = useContext(ProjectContext)
  const { weatherData } = useWeather()
  const orientationDeg = Number(params?.orientation ?? 0)
  const hourlySolar = useHourlySolar(weatherData, orientationDeg)

  const result = useMemo(
    () => calculateInstant(params, constructions, systems, libraryData, weatherData, hourlySolar, scheduleProfiles),
    [params, constructions, systems, libraryData, weatherData, hourlySolar, scheduleProfiles]
  )

  const isIdeal = systems.mode !== 'detailed'
  const sf = result.systems_flow

  // Demand-based node IDs
  const dn = useMemo(() => getDemandNodes(systems), [systems])

  // ── Energy flows per demand via sfLink ──────────────────────────────────────
  // Space heating
  const sh_fuel_kWh   = sfLink(sf, 'gas_grid', dn.sh_node) + sfLink(sf, 'grid', dn.sh_node)
  const sh_del_kWh    = sfLink(sf, dn.sh_node, 'space_heat')
  const sh_flue_kWh   = sfLink(sf, dn.sh_node, 'heating_flue')
  const sh_fuel       = sysFuel(dn.sh_key)
  const sh_eff_label  = sh_fuel_kWh > 0 && sh_del_kWh > 0
    ? (sh_fuel === 'electricity'
        ? `SCOP ${(sh_del_kWh / sh_fuel_kWh).toFixed(1)}×`
        : `${Math.round((sh_del_kWh / sh_fuel_kWh) * 100)}% eff`)
    : undefined

  // Space cooling (same node as sh if same_hvac)
  const sc_fuel_kWh   = dn.sc_node && !dn.same_hvac ? sfLink(sf, 'grid', dn.sc_node) : 0
  const sc_del_kWh    = dn.sc_node ? sfLink(sf, dn.sc_node, 'space_cool') : 0
  const sc_reject_kWh = dn.sc_node ? sfLink(sf, dn.sc_node, 'heat_reject') : 0
  // If same_hvac, split VRF electricity between heating and cooling proportionally
  const sh_sc_total_del = sh_del_kWh + sc_del_kWh
  let sc_fuel_for_display = sc_fuel_kWh
  if (dn.same_hvac && sh_fuel_kWh > 0 && sh_sc_total_del > 0) {
    // Estimate the cooling share of the combined VRF node electricity
    sc_fuel_for_display = sh_fuel_kWh * (sc_del_kWh / sh_sc_total_del)
  }
  const sc_fuel       = sysFuel(dn.sc_key)
  const sc_eff_label  = sc_fuel_for_display > 0 && sc_del_kWh > 0
    ? `SEER ${(sc_del_kWh / sc_fuel_for_display).toFixed(1)}×`
    : undefined

  // DHW primary
  const dhw_fuel_kWh  = sfLink(sf, 'gas_grid', dn.dhw_node) + sfLink(sf, 'grid', dn.dhw_node)
  const dhw_del_kWh   = sfLink(sf, dn.dhw_node, 'dhw_del')
  const dhw_flue_kWh  = sfLink(sf, dn.dhw_node, 'dhw_flue')
  const dhw_prim_fuel = sysFuel(dn.dhw_key)
  const dhw_eff_label = dhw_fuel_kWh > 0 && dhw_del_kWh > 0
    ? (dhw_prim_fuel === 'electricity'
        ? `COP ${(dhw_del_kWh / dhw_fuel_kWh).toFixed(1)}×`
        : `${Math.round((dhw_del_kWh / dhw_fuel_kWh) * 100)}% eff`)
    : undefined

  // DHW secondary (ASHP preheat)
  const dhw_sec_elec_kWh = dn.dhw_sec_node ? sfLink(sf, 'grid', dn.dhw_sec_node) : 0
  const dhw_sec_recov_kWh = dn.dhw_sec_node ? sfLink(sf, dn.dhw_sec_node, dn.dhw_node) : 0

  // Ventilation
  const vent_fuel_kWh = sfLink(sf, 'grid', dn.vent_node)
  const vent_del_kWh  = sfLink(sf, dn.vent_node, 'vent_air')
  const vent_recov_kWh= sfLink(sf, dn.vent_node, 'recovered_heat') + sfLink(sf, 'recovered_heat', 'space_heat')
  const vent_exhaust_kWh = sfLink(sf, 'space_heat', 'vent_exhaust')
  const vent_fuel     = sysFuel(dn.vent_key)
  const isMVHR        = dn.vent_key.startsWith('mvhr')
  const vent_eff_label = isMVHR && vent_fuel_kWh > 0 && vent_recov_kWh > 0
    ? `${Math.round((vent_recov_kWh / (vent_recov_kWh + vent_fuel_kWh)) * 100)}% HR`
    : undefined

  // Lighting and small power (always electric)
  const lighting_kWh  = result.annual_lighting_kWh ?? 0
  const equipment_kWh = result.annual_equipment_kWh ?? 0

  // Waste totals
  const waste_heat_reject  = sc_reject_kWh
  const waste_heating_flue = sh_flue_kWh
  const waste_dhw_flue     = dhw_flue_kWh
  const waste_vent_exhaust = vent_exhaust_kWh
  const total_waste_kWh = waste_heat_reject + waste_heating_flue + waste_dhw_flue + waste_vent_exhaust
  const recoverable_kWh = waste_heat_reject + waste_vent_exhaust  // flue losses not practically recovered

  // Recovery callouts
  const has_ashp_dhw = dn.dhw_sec_node && dhw_sec_elec_kWh > 0
  const mvhr_cost_saving   = vent_recov_kWh * 0.05
  const mvhr_carbon_saving = vent_recov_kWh * 0.233
  const ashp_cost_saving   = dhw_sec_recov_kWh * 0.05
  const ashp_carbon_saving = dhw_sec_recov_kWh * 0.233

  const fanPct = result.fuel_split.total_kWh > 0
    ? Math.round((result.annual_fans_kWh / result.fuel_split.total_kWh) * 100)
    : 0

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-white border-l border-light-grey">
      <div className="p-3 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-xxs uppercase tracking-wider text-mid-grey">Live Results</p>
          <span className="text-xxs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
            ⚡ Instant estimate
          </span>
        </div>

        {isIdeal && (
          <div className="bg-amber-50 border border-amber-200 rounded p-2">
            <p className="text-xxs text-amber-700">Ideal Loads: all energy shown as electricity. Switch to Detailed for real fuel split.</p>
          </div>
        )}

        {/* EUI gauge */}
        <EUIGauge eui={result.eui_kWh_m2} />

        {/* Energy by demand */}
        {!isIdeal && (
          <div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Energy by demand</p>
            <div>
              {/* Space heating */}
              <DemandRow
                label="Space Heating"
                systemName={sysLabel(dn.sh_key)}
                fuel={sh_fuel}
                fuelMWh={dn.same_hvac ? (sh_fuel_kWh * (sh_del_kWh / Math.max(sh_sc_total_del, 1))) / 1000 : sh_fuel_kWh / 1000}
                thermalMWh={sh_del_kWh / 1000}
                effLabel={sh_eff_label}
                flossNote={sh_flue_kWh > 0 ? `Flue loss: ${fmtMWh(sh_flue_kWh)}` : undefined}
              />
              {/* Space cooling */}
              {!dn.sc_is_none && (
                <DemandRow
                  label={dn.same_hvac ? 'Space Cooling (VRF shared)' : 'Space Cooling'}
                  systemName={dn.same_hvac ? sysLabel(dn.sh_key) : sysLabel(dn.sc_key)}
                  fuel={sc_fuel}
                  fuelMWh={sc_fuel_for_display / 1000}
                  thermalMWh={sc_del_kWh / 1000}
                  effLabel={sc_eff_label}
                  flossNote={sc_reject_kWh > 0 ? `Heat rejection: ${fmtMWh(sc_reject_kWh)}` : undefined}
                />
              )}
              {/* DHW primary */}
              <DemandRow
                label={has_ashp_dhw ? `DHW (${sysLabel(dn.dhw_key)} + ${sysLabel(dn.dhwSec_key)})` : 'DHW'}
                systemName={sysLabel(dn.dhw_key)}
                fuel={dhw_prim_fuel}
                fuelMWh={(dhw_fuel_kWh + dhw_sec_elec_kWh) / 1000}
                thermalMWh={(dhw_del_kWh + (dn.dhw_sec_node ? dhw_sec_recov_kWh : 0)) / 1000}
                effLabel={dhw_eff_label}
                flossNote={dhw_flue_kWh > 0 ? `Flue loss: ${fmtMWh(dhw_flue_kWh)}` : undefined}
              />
              {/* Ventilation */}
              {vent_fuel_kWh > 0 && (
                <DemandRow
                  label="Ventilation"
                  systemName={sysLabel(dn.vent_key)}
                  fuel={vent_fuel}
                  fuelMWh={vent_fuel_kWh / 1000}
                  thermalMWh={vent_recov_kWh / 1000}
                  effLabel={vent_eff_label}
                  flossNote={vent_exhaust_kWh > 0 ? `Exhaust loss: ${fmtMWh(vent_exhaust_kWh)}` : undefined}
                />
              )}
              {/* Lighting */}
              {lighting_kWh > 0 && (
                <DemandRow
                  label="Lighting"
                  systemName="Electric"
                  fuel="electricity"
                  fuelMWh={lighting_kWh / 1000}
                  thermalMWh={0}
                  effLabel={undefined}
                />
              )}
              {/* Small power */}
              {equipment_kWh > 0 && (
                <DemandRow
                  label="Small Power"
                  systemName="Electric"
                  fuel="electricity"
                  fuelMWh={equipment_kWh / 1000}
                  thermalMWh={0}
                  effLabel={undefined}
                />
              )}
            </div>
          </div>
        )}

        {/* End-use bars in ideal mode (no fuel split data) */}
        {isIdeal && (
          <div>
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">Energy by end use</p>
            {[
              { label: 'Heating',     val: result.annual_heating_kWh,   color: '#DC2626' },
              { label: 'Cooling',     val: result.annual_cooling_kWh,   color: '#3B82F6' },
              { label: 'DHW',         val: result.annual_dhw_kWh,       color: '#F97316' },
              { label: 'Fans',        val: result.annual_fans_kWh,      color: '#06B6D4' },
              { label: 'Lighting',    val: result.annual_lighting_kWh,  color: '#F59E0B' },
              { label: 'Small power', val: result.annual_equipment_kWh, color: '#64748B' },
            ].map(u => {
              const max = Math.max(result.annual_heating_kWh, result.annual_cooling_kWh, result.annual_dhw_kWh, result.annual_fans_kWh, result.annual_lighting_kWh, result.annual_equipment_kWh, 1)
              return (
                <div key={u.label} className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-xxs text-mid-grey w-16 truncate">{u.label}</span>
                  <div className="flex-1 bg-off-white rounded h-3 overflow-hidden">
                    <div className="h-full rounded transition-all duration-200"
                      style={{ width: `${(u.val / max) * 100}%`, backgroundColor: u.color }} />
                  </div>
                  <span className="text-xxs text-dark-grey w-10 text-right">{fmtMWhShort(u.val)} MWh</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Fuel split */}
        <FuelSplit fuel={result.fuel_split} />

        {/* Waste summary */}
        {!isIdeal && total_waste_kWh > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded p-2">
            <p className="text-xxs font-semibold text-gray-700 mb-1">
              Total waste: {fmtMWh(total_waste_kWh)}
              {recoverable_kWh > 0 && (
                <span className="text-green-700 ml-1">— {fmtMWh(recoverable_kWh)} recoverable</span>
              )}
            </p>
            {waste_heat_reject > 0  && <p className="text-xxs text-gray-500">· Heat rejection: {fmtMWh(waste_heat_reject)}</p>}
            {waste_vent_exhaust > 0 && <p className="text-xxs text-gray-500">· Vent exhaust: {fmtMWh(waste_vent_exhaust)}</p>}
            {waste_heating_flue > 0 && <p className="text-xxs text-gray-500">· Heating flue: {fmtMWh(waste_heating_flue)}</p>}
            {waste_dhw_flue > 0     && <p className="text-xxs text-gray-500">· DHW flue: {fmtMWh(waste_dhw_flue)}</p>}
          </div>
        )}

        {/* Recovery callouts */}
        {isMVHR && vent_recov_kWh > 0 && (
          <RecoveryCallout
            label="MVHR Heat Recovery"
            recoveredMWh={vent_recov_kWh / 1000}
            costSavingPounds={mvhr_cost_saving}
            carbonSavingKg={mvhr_carbon_saving}
          />
        )}
        {has_ashp_dhw && dhw_sec_recov_kWh > 0 && (
          <RecoveryCallout
            label="ASHP DHW Preheat"
            recoveredMWh={dhw_sec_recov_kWh / 1000}
            costSavingPounds={ashp_cost_saving}
            carbonSavingKg={ashp_carbon_saving}
          />
        )}

        {/* System metrics */}
        <div>
          <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1.5">System metrics</p>
          <div>
            <Metric label="Carbon intensity"    value={result.carbon_kgCO2_m2} unit="kgCO₂/m²" />
            <Metric label="Fan energy share"    value={fanPct}                 unit="% of total" />
            <Metric label="DHW thermal"         value={Math.round(result.annual_dhw_kWh / 1000)} unit="MWh/yr" />
            {isMVHR && <Metric label="Heat recovery eff." value={
              systems.ventilation?.primary?.efficiency_override != null
                ? `${systems.ventilation.primary.efficiency_override}%`
                : (systems.hre_override != null ? `${systems.hre_override}%` : '82%')
            } unit="" />}
          </div>
        </div>

        {/* Run full simulation link */}
        <div className="pt-1 border-t border-light-grey">
          <p className="text-xxs text-mid-grey">
            These are simplified estimates.{' '}
            <button
              className="text-teal hover:underline"
              onClick={() => window.dispatchEvent(new CustomEvent('nza:run-simulation'))}
            >
              Run full EnergyPlus simulation →
            </button>
          </p>
        </div>

      </div>
    </div>
  )
}
