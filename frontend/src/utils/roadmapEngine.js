/**
 * roadmapEngine.js — Brief 28-IM Gate IM-M6 (Retrofit Roadmap).
 *
 * Sequenced, dated intervention roadmap with per-year per-intervention
 * leave-one-out marginal attribution (Philosophy B). Each intervention's
 * saving compounds with grid decarbonisation and with later interventions
 * — the marginal contribution of an intervention I_k at year Y is computed
 * by re-running the engine with I_k removed from the roadmap, then
 * subtracting the full-roadmap result for that year. This means the same
 * intervention can show different attributions at different years —
 * because the building's state, the grid intensity, and the prior /
 * later interventions all change the marginal.
 *
 * §10.4 / §10.9 algorithm:
 *   for each year Y in 2026..2050:
 *     active = interventions where i.year <= Y
 *     state_full = applyAll(baseline, active)
 *     result_full = engine.compute(state_full)
 *     carbon_full = elec_full × grid(Y) + gas_full × GAS
 *     for each intervention I_k in active:
 *       state_without_k = applyAll(baseline, active.filter(i => i !== I_k))
 *       result_without_k = engine.compute(state_without_k)
 *       carbon_without_k = elec_wo × grid(Y) + gas_wo × GAS
 *       marginal_I_k_at_Y = carbon_without_k - carbon_full
 *         // positive marginal = saving (carbon higher without the intervention)
 *     interaction_residual = (baseline_carbon - carbon_full) - sum(marginals)
 *
 * Performance: 25 years × (N+1) Static runs ≈ 50ms each → ~11s for N=8
 * interventions. Caller-side debounce/memoise required for live UI editing.
 */

import { calculateInstant } from './instantCalc.js'
import {
  ukGridIntensityForYear,
  GAS_CARBON_FACTOR_gCO2_per_kWh,
} from '../data/ukGridCarbonTrajectory.js'
import { crremTargetForYear } from '../data/crremTargets.js'

const ROADMAP_START_YEAR = 2026
const ROADMAP_END_YEAR   = 2050

/* ───────────────────────────────────────────────────────────────────────────
   Intervention schema + apply
   ─────────────────────────────────────────────────────────────────────── */

/**
 * Apply a single intervention to a building_config (returns a shallow-cloned
 * mutation; caller is responsible for not sharing the result with parallel
 * year-states). Each `type` is handled with a small switch — extend the
 * switch when new intervention types are added in the UI.
 *
 * V1 intervention types (walked example coverage + the common cases):
 *   - fabric_airtightness  { q50: number }
 *   - fabric_walls         { u_value_override: number }
 *   - fabric_roof          { u_value_override: number }
 *   - fabric_glazing       { u_value_override?: number, g_value_override?: number }
 *   - systems_dhw_swap     { fuel_mix: {gas, electric_resistance, heat_pump}, scop_hp?: number }
 *   - systems_heating_swap { library_id, scop?: number }
 *   - ventilation_add_hre  { vent_index: number, hre: number, sfp_w_per_l_s?: number }
 *   - operation_lpd        { reduction_pct: number }  // -30 means cut 30%
 *   - operation_setpoint   { heating_c?: number, cooling_c?: number }
 *
 * Unknown types are no-ops with a console.warn (so a stale serialised
 * intervention doesn't break the engine on reload).
 */
export function applyIntervention(state, intervention) {
  const out = structuredClone(state)
  const ov  = intervention?.overrides ?? {}
  switch (intervention?.type) {
    case 'fabric_airtightness': {
      out.fabric = { ...(out.fabric ?? {}), air_permeability_q50: Number(ov.q50 ?? out.fabric?.air_permeability_q50 ?? 5) }
      return out
    }
    case 'fabric_walls': {
      const ch = { ...(out.construction_choices ?? {}) }
      const cur = ch.external_wall
      ch.external_wall = (typeof cur === 'object' && cur !== null)
        ? { ...cur, u_value_override: Number(ov.u_value_override) }
        : { library_id: cur ?? 'cavity_wall_standard', u_value_override: Number(ov.u_value_override) }
      out.construction_choices = ch
      return out
    }
    case 'fabric_roof': {
      const ch = { ...(out.construction_choices ?? {}) }
      const cur = ch.roof
      ch.roof = (typeof cur === 'object' && cur !== null)
        ? { ...cur, u_value_override: Number(ov.u_value_override) }
        : { library_id: cur ?? 'flat_roof_standard', u_value_override: Number(ov.u_value_override) }
      out.construction_choices = ch
      return out
    }
    case 'fabric_glazing': {
      const ch = { ...(out.construction_choices ?? {}) }
      const cur = ch.glazing
      const patch = {}
      if (ov.u_value_override != null) patch.u_value_override = Number(ov.u_value_override)
      if (ov.g_value_override != null) patch.g_value_override = Number(ov.g_value_override)
      ch.glazing = (typeof cur === 'object' && cur !== null) ? { ...cur, ...patch } : { library_id: cur ?? 'double_low_e', ...patch }
      out.construction_choices = ch
      return out
    }
    case 'systems_dhw_swap': {
      const v25 = { ...(out.systems_config_v25 ?? {}) }
      const dhw = { ...(v25.dhw ?? {}) }
      if (ov.fuel_mix) dhw.fuel_mix = { ...ov.fuel_mix }
      v25.dhw = dhw
      out.systems_config_v25 = v25
      return out
    }
    case 'systems_heating_swap': {
      const v25 = { ...(out.systems_config_v25 ?? {}) }
      const h = { ...(v25.heating ?? {}) }
      if (ov.library_id) {
        h.primary = { ...(h.primary ?? {}), library_id: ov.library_id }
      }
      v25.heating = h
      out.systems_config_v25 = v25
      return out
    }
    case 'ventilation_add_hre': {
      const v25 = { ...(out.systems_config_v25 ?? {}) }
      const list = Array.isArray(v25.ventilation) ? v25.ventilation.map(v => ({ ...v })) : []
      const idx = Number(ov.vent_index ?? 0)
      if (list[idx]) {
        list[idx].hre_enabled = true
        list[idx].hre = Number(ov.hre ?? 0.75)
        if (ov.sfp_w_per_l_s != null) list[idx].sfp_w_per_l_s = Number(ov.sfp_w_per_l_s)
      }
      v25.ventilation = list
      out.systems_config_v25 = v25
      return out
    }
    case 'operation_lpd': {
      // Reduce installed lighting power density by `reduction_pct` (e.g. -30
      // means 30% saving). Reads building.gains.lighting.{profiles[i].magnitude
      // | density_W_per_m2} and scales. Falls back to the legacy
      // lighting_power_density top-level if v2.3 isn't present.
      const factor = 1 + Math.min(0, Math.max(-0.95, Number(ov.reduction_pct ?? 0) / 100))
      if (out.gains?.lighting?.profiles) {
        const profiles = out.gains.lighting.profiles.map(p => {
          const next = { ...p }
          if (typeof p.magnitude === 'object' && p.magnitude !== null) {
            next.magnitude = { ...p.magnitude }
            for (const k of Object.keys(next.magnitude)) {
              const v = Number(next.magnitude[k])
              if (Number.isFinite(v)) next.magnitude[k] = v * factor
            }
          } else if (Number.isFinite(Number(p.magnitude))) {
            next.magnitude = Number(p.magnitude) * factor
          }
          if (Number.isFinite(Number(p.density_W_per_m2))) {
            next.density_W_per_m2 = Number(p.density_W_per_m2) * factor
          }
          return next
        })
        out.gains = { ...out.gains, lighting: { ...out.gains.lighting, profiles } }
      }
      // Also scale the legacy flat field if present (back-compat).
      if (Number.isFinite(Number(out.lighting_power_density))) {
        out.lighting_power_density = Number(out.lighting_power_density) * factor
      }
      return out
    }
    case 'operation_setpoint': {
      const v25 = { ...(out.systems_config_v25 ?? {}) }
      if (ov.heating_c != null) v25.heating = { ...(v25.heating ?? {}), setpoint_c: Number(ov.heating_c) }
      if (ov.cooling_c != null) v25.cooling = { ...(v25.cooling ?? {}), setpoint_c: Number(ov.cooling_c) }
      out.systems_config_v25 = v25
      return out
    }
    default:
      // eslint-disable-next-line no-console
      if (intervention?.type) console.warn(`[roadmap] Unknown intervention type "${intervention.type}" — no-op`)
      return out
  }
}

/**
 * Apply an ordered set of interventions to the baseline. Returns the
 * resulting state. Interventions are applied in (year asc, sequence_in_year
 * asc) order — the UI guarantees the input order matches this, but we
 * re-sort defensively.
 */
export function applyAll(baseline, interventions) {
  const sorted = [...(interventions ?? [])].sort((a, b) =>
    (a.year - b.year) || ((a.sequence_in_year ?? 0) - (b.sequence_in_year ?? 0))
  )
  let s = baseline
  for (const intv of sorted) s = applyIntervention(s, intv)
  return s
}

/* ───────────────────────────────────────────────────────────────────────────
   Core engine — per-year carbon + leave-one-out attribution
   ─────────────────────────────────────────────────────────────────────── */

function _carbonForYear(elec_mwh, gas_mwh, year, gia) {
  if (gia <= 0) return 0
  const grid = ukGridIntensityForYear(year)
  const kgCO2 = elec_mwh * grid + gas_mwh * GAS_CARBON_FACTOR_gCO2_per_kWh
  return kgCO2 / gia
}

function _runEngine(state, constructions, systems, weatherData, hourlySolar, libraryData, comfortBand) {
  // construction_choices and systems_config live at PROJECT level (not nested
  // inside building_config) in the live ProjectContext + DB schema. Caller
  // passes them as separate args so the engine sees them correctly.
  // Apply-overrides intermediate states may carry a per-state
  // `construction_choices` patch from fabric_* interventions; merge it on
  // top of the project's baseline construction_choices.
  const stateChoices = state.construction_choices ?? {}
  const mergedConstructions = { ...(constructions ?? {}), ...stateChoices }
  const r = calculateInstant(
    { ...state, comfort_band: comfortBand },
    mergedConstructions,
    systems ?? {},
    libraryData,
    weatherData,
    hourlySolar,
    null,
    { mode: 'full', comfortBand, engine: 'v2.5' },
  )
  return {
    elec_mwh: r?.consumption?.total?.electricity_mwh ?? 0,
    gas_mwh:  r?.consumption?.total?.gas_mwh ?? 0,
    eui:      r?.consumption?.total?.kwh_per_m2_yr ?? 0,
    gia:      r?.metadata?.gia_m2 ?? r?.heat_balance?.metadata?.gia_m2 ?? 0,
  }
}

/**
 * Compute the full roadmap result. Performance: 25 × (N+1) Static runs.
 *
 * Returns:
 *   {
 *     years: [2026, 2027, ..., 2050],
 *     baseline_trajectory: [{ year, eui, kgCO2_per_m2_yr, ... }, ...],
 *     trajectory:          [{ year, eui, kgCO2_per_m2_yr, applied_intervention_ids,
 *                              grid_intensity, crrem_target,
 *                              elec_mwh, gas_mwh, delta_vs_baseline_kgCO2, ... }, ...],
 *     attribution:         { [intervention_id]: number[25] },  // per-year marginal saving (kgCO2/m²/yr)
 *     interaction_residual_per_year: number[25],
 *     intervention_summaries: [{ id, name, year, install_year_marginal_kgCO2, install_year_marginal_eui,
 *                                 mean_marginal_2026_2050, peak_marginal_year, sparkline: number[25] }, ...]
 *   }
 */
export function computeRoadmap({ baseline, constructions, systems, interventions, weatherData, hourlySolar, libraryData, comfortBand }) {
  const interv = Array.isArray(interventions) ? interventions : []
  const cb = comfortBand ?? { lower_c: 20, upper_c: 26 }
  // construction_choices and systems_config_v25 live at project level. The
  // engine needs both via the `constructions` arg (post-Brief-28k dict
  // shape) and through `building.systems_config_v25` (auto-detected). For
  // intervention application, fabric_* interventions patch
  // `state.construction_choices` and that patch wins over the project
  // baseline via the merge inside _runEngine.

  // Single canonical sort for stable per-year ordering
  const sortedAll = [...interv].sort((a, b) =>
    (a.year - b.year) || ((a.sequence_in_year ?? 0) - (b.sequence_in_year ?? 0))
  )

  // BASELINE (no interventions ever) — same engine, no overrides. One run per
  // unique year is sufficient since the building state doesn't change with
  // year for baseline; only grid intensity does. So run engine ONCE for
  // baseline and reuse the elec/gas across all 25 years.
  const baseRun = _runEngine(baseline, constructions, systems, weatherData, hourlySolar, libraryData, cb)
  const gia = baseRun.gia
  const baseline_trajectory = []
  for (let y = ROADMAP_START_YEAR; y <= ROADMAP_END_YEAR; y++) {
    baseline_trajectory.push({
      year: y,
      eui: baseRun.eui,
      kgCO2_per_m2_yr: Math.round(_carbonForYear(baseRun.elec_mwh, baseRun.gas_mwh, y, gia) * 100) / 100,
      grid_intensity_gCO2_per_kWh: ukGridIntensityForYear(y),
      crrem_target_kgCO2_per_m2: crremTargetForYear(y),
      elec_mwh: baseRun.elec_mwh,
      gas_mwh:  baseRun.gas_mwh,
    })
  }

  // Per-year full-stack runs: results cached by the SET of active intervention ids.
  // Same set → same physics; only the grid year changes carbon. Big speedup
  // when a year has no new intervention vs the prior year.
  const runCache = new Map()    // key: sorted ids joined → { elec_mwh, gas_mwh, eui }
  const runFor = (activeIds, state) => {
    const key = activeIds.slice().sort().join('|')
    if (runCache.has(key)) return runCache.get(key)
    const r = _runEngine(state, constructions, systems, weatherData, hourlySolar, libraryData, cb)
    runCache.set(key, r)
    return r
  }

  const trajectory   = []
  const attribution  = {}
  const interaction_residual_per_year = []

  // Initialise per-intervention attribution arrays
  for (const i of sortedAll) attribution[i.id] = []

  for (let y = ROADMAP_START_YEAR; y <= ROADMAP_END_YEAR; y++) {
    const active = sortedAll.filter(i => i.year <= y)
    const activeIds = active.map(i => i.id)
    const stateFull = applyAll(baseline, active)
    const runFull = runFor(activeIds, stateFull)
    const grid    = ukGridIntensityForYear(y)
    const carbonFull = _carbonForYear(runFull.elec_mwh, runFull.gas_mwh, y, gia)
    const carbonBase = _carbonForYear(baseRun.elec_mwh, baseRun.gas_mwh,  y, gia)

    // Leave-one-out for each active intervention
    let sumOfMarginals = 0
    for (const intv of active) {
      const withoutIds = active.filter(i => i.id !== intv.id).map(i => i.id)
      const stateWO    = applyAll(baseline, active.filter(i => i.id !== intv.id))
      const runWO      = runFor(withoutIds, stateWO)
      const carbonWO   = _carbonForYear(runWO.elec_mwh, runWO.gas_mwh, y, gia)
      const marginal   = carbonWO - carbonFull        // +ve = saving from this intervention
      attribution[intv.id].push(Math.round(marginal * 1000) / 1000)
      sumOfMarginals += marginal
    }
    // Pad attribution arrays for interventions not yet active (so all arrays
    // are length 25 indexed by year)
    for (const intv of sortedAll) {
      if (!activeIds.includes(intv.id)) attribution[intv.id].push(0)
    }

    // Interaction residual = total saving vs baseline - sum of marginal
    // contributions. With perfect additivity this is 0; non-linear physics
    // (e.g. SCOP shifts, HRE compounding with reduced demand) yields a
    // non-zero residual.
    const totalSaving = carbonBase - carbonFull
    const residual    = totalSaving - sumOfMarginals
    interaction_residual_per_year.push(Math.round(residual * 1000) / 1000)

    trajectory.push({
      year: y,
      eui: Math.round(runFull.eui * 10) / 10,
      kgCO2_per_m2_yr: Math.round(carbonFull * 100) / 100,
      applied_intervention_ids: activeIds,
      grid_intensity_gCO2_per_kWh: grid,
      crrem_target_kgCO2_per_m2: Math.round(crremTargetForYear(y) * 100) / 100,
      elec_mwh: Math.round(runFull.elec_mwh * 100) / 100,
      gas_mwh:  Math.round(runFull.gas_mwh * 100) / 100,
      delta_vs_baseline_kgCO2: Math.round(totalSaving * 100) / 100,
    })
  }

  // Per-intervention summary (install-year marginal headline, sparkline, etc.)
  const intervention_summaries = sortedAll.map(intv => {
    const arr = attribution[intv.id] ?? new Array(trajectory.length).fill(0)
    const yIdx = intv.year - ROADMAP_START_YEAR
    const installMarginal = (yIdx >= 0 && yIdx < arr.length) ? arr[yIdx] : 0
    let mean = 0, peakIdx = 0, peakVal = -Infinity, contributingYears = 0
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > 0.001) contributingYears++
      mean += arr[i]
      if (arr[i] > peakVal) { peakVal = arr[i]; peakIdx = i }
    }
    mean = contributingYears > 0 ? mean / contributingYears : 0
    return {
      id: intv.id,
      name: intv.name,
      type: intv.type,
      year: intv.year,
      sequence_in_year: intv.sequence_in_year ?? 0,
      install_year_marginal_kgCO2: Math.round(installMarginal * 100) / 100,
      mean_marginal_2026_2050: Math.round(mean * 100) / 100,
      peak_marginal_year: ROADMAP_START_YEAR + peakIdx,
      peak_marginal_kgCO2: Math.round(peakVal * 100) / 100,
      sparkline: arr.slice(),
    }
  })

  return {
    years: trajectory.map(t => t.year),
    baseline_trajectory,
    trajectory,
    attribution,
    interaction_residual_per_year,
    intervention_summaries,
    cache_runs: runCache.size,     // diagnostic — how many unique engine runs
  }
}
