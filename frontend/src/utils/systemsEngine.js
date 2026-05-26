/**
 * systemsEngine.js — Brief 40 Part 2 (2026-05-19)
 *
 * Implements `computeSystemsDelivered(...)` which consumes the Brief 40
 * per-system array schema (`building.systems_config.{service}: [system, ...]`)
 * and produces a per-service / per-system delivered-energy breakdown,
 * comfort-vs-setpoint diagnostic, and totals.
 *
 * Coexists with the existing `computeServiceEnergy` / `computeDhwFuelMix` /
 * `computeVentilationEnergy` paths in `instantCalc.js` (which consume the
 * pre-Brief-40 `systems_config_v25` shape). When `building.systems_config` is
 * absent or has only empty service arrays, this engine returns `null` and
 * the caller falls back to the existing path — no behaviour change for
 * unmigrated projects.
 *
 * Schema reference: `docs/audit/40_systems_library_schema.md`.
 *
 * Architecture:
 *   - Heating / cooling / DHW: per-system delivered + source_energy via
 *     proportional split (§3.1). Comfort-vs-setpoint diagnostic (§5) when
 *     a system has a custom setpoint — the caller passes a `state2Recompute`
 *     closure so the engine can ask State 2 for `demand_at_this_setpoint`
 *     without circular imports.
 *   - DHW tap-mix correction (§4) — basis-independent: total_tap_litres
 *     per day is computed per `demand_basis` ('per_m2' or 'per_person'),
 *     then multiplied by `hot_fraction` to get boiler_litres_per_day.
 *   - Ventilation: per-system fan_electrical + recovery_kWh. Recovery
 *     credit composition: sum kWh, not % (§3.2).
 *   - Lighting / small_power (thin): `delivered_electrical = gain_from_
 *     internal_gains × control_factor × share/100` (§3.3). Heat gain stays
 *     sourced from Internal Gains upstream — no double-counting.
 *
 * Returns the §6 shape (extension of Brief 38 polish's `consumption` block).
 * Caller attaches the return under `consumption.brief40`.
 */

const VALID_SERVICES = ['heating', 'cooling', 'dhw', 'ventilation', 'lighting', 'small_power']

// Carbon factors (CIBSE TM65 2024 — matches BEIS_2024_FACTORS in instantCalc.js)
// Re-declared here to keep this module self-contained; cross-check on
// drift in a future cleanup pass.
const CARBON_KG_PER_KWH = {
  electricity:        0.193,
  gas:                0.183,
  oil:                0.249,
  biomass:            0.039,
  district_heating:   0.170,
  district_cooling:   0.193,
  ambient_air:        0,      // heat pump fuel is electricity — counted there
  ambient_ground:     0,
}

// Water specific heat: 4.18 kJ/(L·K) ÷ 3600 s/h
const WATER_SHC_KWH_PER_L_PER_K = 4.18 / 3600

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Filter to enabled systems. `enabled !== false` means the system is on
 * (default behaviour when `enabled` field is missing — preserves backward
 * compatibility with v40 entries that pre-date Part 5b's enable toggle).
 *
 * Brief 40 Part 5b Section A (2026-05-19): plumbed in even though no system
 * has `enabled === false` yet in Part 5b Section A. Section B adds the UI to
 * set the flag; A puts the filter in place so the validation + per-system
 * compute math is correct once the UI lands.
 */
function _enabledSystems(systems) {
  if (!Array.isArray(systems)) return []
  return systems.filter(s => s?.enabled !== false)
}

/**
 * Validate `share_pct` sums to 100 across ENABLED systems serving one
 * service. Returns true if valid (sum ≈ 100 within rounding tolerance) or
 * if there are no enabled systems (empty arrays = no service is fine; the
 * displacement check in _calculateState3 handles the "fall through to v25"
 * for the empty case).
 *
 * Brief 40 Part 5b Section A (2026-05-19): operates on enabled systems
 * only. A disabled system's share value is preserved on disk but excluded
 * from validation — the user toggles a system off, the share validator
 * checks the remaining enabled shares, and the user can re-Normalise.
 */
function _validateShares(enabledSystems) {
  if (!Array.isArray(enabledSystems) || enabledSystems.length === 0) return true
  const sum = enabledSystems.reduce((s, sys) => s + Number(sys?.share_pct ?? 0), 0)
  return Math.abs(sum - 100) < 0.5  // ½ pp rounding tolerance
}

/**
 * Resolve a service-level setpoint.
 *
 * Brief 42 Part 2 (2026-05-20): setpoint moved from per-system to
 * service-level on `systems_config_v40`. Reads `{service}_setpoint_mode`
 * + `{service}_setpoint_c` from the service-level block. Mode
 * `'follow_comfort'` substitutes the comfort band's corresponding
 * setpoint at compute time; mode `'custom'` uses `_c` verbatim.
 *
 * `serviceLevel` is the post-Brief-42 systems_config_v40 (the whole
 * object — same source as cfg in computeSystemsDelivered). Service
 * is 'heating' or 'cooling' (DHW has its own service-level fields
 * handled by _computeDhw directly).
 */
function _resolveSetpoint(serviceLevel, service, comfortBand) {
  const mode = serviceLevel?.[`${service}_setpoint_mode`]
  const value = serviceLevel?.[`${service}_setpoint_c`]
  if (mode === 'custom' && typeof value === 'number') return value
  // mode === 'follow_comfort' or unset: use comfort band
  if (service === 'heating') return comfortBand?.lower_c ?? 21
  if (service === 'cooling') return comfortBand?.upper_c ?? 24
  return null
}

/**
 * Brief 42 Part 2 — engine-side guard against stale data.
 *
 * If a per-system entry contains a building-level field (a v1-shape
 * field that should have been lifted to the service-level position by
 * the loader migration), the engine errors loudly. No silent fallbacks.
 *
 * Returns an error message string when stale data is detected, or null
 * when the per-system entries are clean.
 */
function _detectStalePerSystemFields(systems, service) {
  if (!Array.isArray(systems)) return null
  const STALE_FIELDS = {
    heating: ['setpoint'],
    cooling: ['setpoint'],
    dhw:     ['setpoint', 'tap_outlet_temp_c', 'cold_supply_temp_c',
              'demand_basis', 'demand_litres_per_person_per_day',
              'demand_litres_per_m2_day'],
  }
  const fieldsToCheck = STALE_FIELDS[service] ?? []
  for (const sys of systems) {
    if (!sys || typeof sys !== 'object') continue
    for (const field of fieldsToCheck) {
      if (field in sys) {
        return `Stale per-system field '${field}' on '${service}' system '${sys.id ?? sys.label ?? '?'}'. Brief 42 moved this to systems_config_v40.${field === 'setpoint' && service !== 'dhw' ? `${service}_setpoint_c` : (service === 'dhw' ? (field === 'setpoint' ? 'dhw_storage_setpoint_c' : (field === 'demand_litres_per_m2_day' ? 'dhw_demand_litres_per_m2_per_day' : `dhw_${field}`)) : `${service}_${field}`)}. Run the loader migration (Brief 42 Part 2) or scripts/42_systems_ux_migration.py (Brief 42 Part 4) to lift this field to the service-level position.`
      }
    }
  }
  return null
}

/**
 * Source fuel mapping — translates the schema `source` enum to the fuel
 * key used in `totals.fuel_split`. Heat-pump sources count electricity
 * (the actual drawn fuel); biomass / oil / gas / district_heating are
 * their own fuels.
 */
function _sourceToFuel(source) {
  switch (source) {
    case 'electricity':     return 'electricity'
    case 'gas':             return 'gas'
    case 'oil':             return 'oil'
    case 'biomass':         return 'biomass'
    case 'district_heating': return 'district_heating'
    case 'district_cooling': return 'district_cooling'
    case 'ambient_air':     return 'electricity'   // heat pump fuel
    case 'ambient_ground':  return 'electricity'   // heat pump fuel
    default:                return 'electricity'   // safe default
  }
}

// ── Per-service computation ──────────────────────────────────────────────────

/**
 * Compute per-system breakdown for heating / cooling.
 *
 * Inputs:
 *   service           — 'heating' | 'cooling'
 *   systems           — array of Brief 40 systems serving this service
 *   demandAtComfortMwh — total service demand at the comfort band setpoint
 *                        (already computed upstream by _calculateState2)
 *   comfortBand       — { lower_c, upper_c } from the homepage comfort band
 *   state2Recompute   — closure (override) => state2Result that produces
 *                        demand at a different setpoint; called once per
 *                        system whose setpoint differs from comfort.
 *                        Closures avoid circular imports back into
 *                        instantCalc.js.
 *
 * Returns service-level block per §6.
 */
function _computeHeatingOrCooling(service, systems, serviceLevel, demandAtComfortMwh, comfortBand, state2Recompute) {
  // Brief 40 Part 5b Section A (2026-05-19): filter enabled first; share
  // validation operates on enabled systems only. A disabled system's share
  // value is preserved on disk but excluded from compute + validation.
  const enabledSystems = _enabledSystems(systems)

  if (!Array.isArray(systems) || systems.length === 0) {
    // Empty array — signal to the caller's displacement check that v40 has
    // nothing here; caller falls through to v25 path.
    return {
      demand_at_comfort_mwh: round_mwh(demandAtComfortMwh),
      delivered_total_mwh:    0,
      blended_efficiency:     null,
      systems:                [],
    }
  }

  // Brief 42 Part 2 (2026-05-20): engine errors loudly when per-system
  // entries carry building-level fields. Per Principle 2 — no silent
  // fallbacks. The loader migration (Part 2) or migration script (Part 4)
  // should have lifted these to the service-level position before the
  // engine sees them.
  const staleError = _detectStalePerSystemFields(systems, service)
  if (staleError) {
    return {
      demand_at_comfort_mwh: round_mwh(demandAtComfortMwh),
      delivered_total_mwh:    0,
      blended_efficiency:     null,
      systems:                [],
      error: staleError,
    }
  }

  if (enabledSystems.length === 0) {
    // All systems present but all disabled — service "off". Engine emits
    // zeros; displacement DOES fire (consumption.{service} reflects zero
    // delivered). UI shows the service header with all-disabled state.
    return {
      demand_at_comfort_mwh: round_mwh(demandAtComfortMwh),
      delivered_total_mwh:    0,
      blended_efficiency:     null,
      systems:                [],
      all_disabled: true,
    }
  }

  if (!_validateShares(enabledSystems)) {
    const sum = enabledSystems.reduce((s, x) => s + Number(x?.share_pct ?? 0), 0)
    // Brief 40 Part 5b Section A.4: share validation BLOCKS compute. The
    // engine emits a controlled error; displacement still fires (so the
    // user can see the headline numbers drop to zero for this service)
    // but no delivered energy is attributed. The error field surfaces in
    // the UI section header + on the consumption.{service-block}.
    return {
      demand_at_comfort_mwh: round_mwh(demandAtComfortMwh),
      delivered_total_mwh:    0,
      blended_efficiency:     null,
      systems:                [],
      error: `share_pct of enabled systems sums to ${sum.toFixed(1)}%, not 100%, for service '${service}'`,
    }
  }

  // Brief 42 Part 2: setpoint is now service-level, not per-system. All
  // systems share the same resolved setpoint. The `setpointDiffers` check
  // becomes a per-service check, not per-system.
  const setpoint_resolved = _resolveSetpoint(serviceLevel, service, comfortBand)
  const comfortSetpoint = service === 'heating' ? comfortBand?.lower_c : comfortBand?.upper_c
  const setpointMode = serviceLevel?.[`${service}_setpoint_mode`] ?? 'follow_comfort'
  const setpointDiffers = setpointMode === 'custom'
                          && typeof setpoint_resolved === 'number'
                          && Math.abs(setpoint_resolved - (comfortSetpoint ?? setpoint_resolved)) > 0.05

  // Diagnostic recompute: when the service-level setpoint differs from
  // comfort, recompute State 2 demand once at the custom setpoint and use
  // that demand for all systems' deliveries.
  //
  // Brief 50 Part 4 (2026-05-25) — retired the offsetRatio workaround.
  // The pre-Brief-50 engine subtracted MVHR recovery from heating demand
  // at State 3 (instantCalc.js ~L4131); when the State 2 recompute returned
  // RAW demand at a new setpoint, a proportional offsetRatio ≈ 0.68 was
  // applied here to put both values on the same post-recovery boundary
  // (Brief 44 Part 2 / Part 5). With Brief 50 making State 2 the sole owner
  // of MVHR recovery (via the (1-HRE) factor on vent UA at instantCalc.js
  // L2551), the recomputed State 2 demand is ALREADY post-MVHR — no
  // offset correction needed. The recomputed value passes through directly.
  let demand_at_service_setpoint_mwh = demandAtComfortMwh
  if (setpointDiffers && typeof state2Recompute === 'function') {
    const overrideKey = service === 'heating' ? 'heating' : 'cooling'
    const recomputed = state2Recompute({ [overrideKey]: setpoint_resolved })
    const rawDemandAtSetpointMwh = service === 'heating'
      ? (recomputed?.demand?.heating_demand_mwh ?? demandAtComfortMwh)
      : (recomputed?.demand?.cooling_demand_mwh ?? demandAtComfortMwh)
    demand_at_service_setpoint_mwh = rawDemandAtSetpointMwh
  }

  // Per-system computation
  const out_systems = enabledSystems.map(sys => {
    const share = Number(sys?.share_pct ?? 0) / 100
    const eff   = Number(sys?.efficiency_metric ?? 0)

    const delivered_mwh     = demand_at_service_setpoint_mwh * share
    const source_energy_mwh = eff > 0 ? delivered_mwh / eff : 0
    const delta_vs_comfort_mwh = (demand_at_service_setpoint_mwh - demandAtComfortMwh) * share
    const delta_vs_comfort_pct = demandAtComfortMwh > 0
      ? 100 * delta_vs_comfort_mwh / (demandAtComfortMwh * share)
      : 0

    return {
      id:                          sys.id ?? null,
      label:                       sys.label ?? `${service} system`,
      share_pct:                   sys.share_pct ?? 0,
      // Brief 42: setpoint is service-level. Per-system `setpoint` echo on
      // result rows is the resolved service-level value (kept on result
      // shape for backward-compat with consumers that read this field).
      setpoint:                    setpoint_resolved,
      setpoint_resolved,
      demand_at_this_setpoint_mwh: round_mwh(demand_at_service_setpoint_mwh),
      delivered_mwh:               round_mwh(delivered_mwh),
      source_energy_mwh:           round_mwh(source_energy_mwh),
      source_fuel:                 _sourceToFuel(sys.source),
      efficiency:                  eff,
      delta_vs_comfort_mwh:        round_mwh(delta_vs_comfort_mwh),
      delta_vs_comfort_pct:        Math.round(delta_vs_comfort_pct * 10) / 10,
    }
  })

  const delivered_total_mwh = out_systems.reduce((s, sys) => s + sys.delivered_mwh, 0)

  // Blended efficiency = weighted harmonic mean: 1 / Σ (share_i × 1/efficiency_i)
  // Uses *resolved share* (share/100) of enabled systems only; skips zero-eff
  // systems to avoid div-by-zero.
  let harmonic_denom = 0
  for (const sys of enabledSystems) {
    const share = Number(sys?.share_pct ?? 0) / 100
    const eff   = Number(sys?.efficiency_metric ?? 0)
    if (eff > 0) harmonic_denom += share / eff
  }
  const blended_efficiency = harmonic_denom > 0 ? 1 / harmonic_denom : null

  return {
    demand_at_comfort_mwh: round_mwh(demandAtComfortMwh),
    delivered_total_mwh:    round_mwh(delivered_total_mwh),
    blended_efficiency:     blended_efficiency != null ? Math.round(blended_efficiency * 1000) / 1000 : null,
    // Brief 42 Part 2 — service-level setpoint echo on the service block
    setpoint_mode:          setpointMode,
    setpoint_c:             setpoint_resolved,
    setpoint_differs_from_comfort: setpointDiffers,
    systems:                out_systems,
  }
}

/**
 * Compute DHW per-system breakdown with tap-mix correction.
 *
 * Inputs:
 *   systems              — array of Brief 40 DHW systems (per-system entries
 *                          carry source / efficiency / share / control /
 *                          enabled only — see Brief 42 service-level move)
 *   serviceLevel         — the `systems_config_v40` object (so `dhw_*`
 *                          service-level fields can be read)
 *   gia                  — building GIA (m²), used for 'per_m2' basis
 *   building             — Brief 58 B3 (2026-05-26): read num_bedrooms,
 *                          people_per_room, occupancy_rate for the
 *                          headcount-basis 'per_person' DHW formula.
 *                          (Pre-B3 took `annualOccupantHours` instead;
 *                          that arg is gone — DHW is per-HEAD, not per
 *                          occupant-second.)
 *   presenceHourly       — Brief 58 B4 (2026-05-26): optional 8760
 *                          Float32Array of per-hour occupancy SCHEDULE
 *                          PRESENCE (0-1 schedule × monthly mult, post
 *                          exception-resolution) from State 2's
 *                          occupancy_summary. Used to shape the
 *                          hourly_kwh draw when
 *                          `dhw_load_shape === 'follow_occupancy'`.
 *                          The toggle follows the schedule SHAPE
 *                          (timing), not headcount — a calibration-zero
 *                          headcount still has a non-zero schedule.
 *                          Falls back to 'flat' if absent or zero-sum.
 *
 * Service-level fields drive the building DHW demand math:
 *   - dhw_demand_basis         — 'per_m2' or 'per_person'
 *   - dhw_demand_litres_per_*  — quantity per basis
 *   - dhw_storage_setpoint_c   — boiler storage temp (typically 60°C)
 *   - dhw_cold_supply_temp_c   — mains cold supply (typically 10°C)
 *   - dhw_tap_outlet_temp_c    — mixed tap outlet (typically 40°C hotel)
 *
 * Per-system fields (efficiency_metric, share_pct, source) drive the
 * source-energy split. All DHW systems share the same building demand;
 * share_pct splits delivery across them.
 */
function _computeDhw(systems, serviceLevel, gia, building, presenceHourly = null) {
  // Brief 42 Part 2 (2026-05-20): DHW building-level fields lifted to
  // service-level on `systems_config_v40`. Reads from `serviceLevel`
  // (the post-Brief-42 systems_config_v40 object); per-system entries
  // no longer carry demand or temperature fields. Engine errors loudly
  // if it sees stale per-system instances (per Principle 2).

  if (!Array.isArray(systems) || systems.length === 0) {
    return {
      demand_basis:             null,
      tap_outlet_temp_c:        null,
      cold_supply_temp_c:       null,
      setpoint:                 null,
      hot_fraction:             null,
      boiler_litres_per_day:    null,
      demand_at_comfort_mwh:    0,
      delivered_total_mwh:      0,
      blended_efficiency:       null,
      systems:                  [],
      diagnostic: { delivered_no_mix_mwh: 0, delta_mwh: 0, delta_pct: 0 },
    }
  }

  // Brief 42 Part 2: stale-data guard. Per-system entries must NOT carry
  // building-level fields after the migration. Loud error if violated.
  const staleError = _detectStalePerSystemFields(systems, 'dhw')
  if (staleError) {
    return {
      demand_basis: null, tap_outlet_temp_c: null, cold_supply_temp_c: null,
      setpoint: null, hot_fraction: null, boiler_litres_per_day: 0,
      demand_at_comfort_mwh: 0, delivered_total_mwh: 0, blended_efficiency: null,
      systems: [],
      error: staleError,
      diagnostic: { delivered_no_mix_mwh: 0, delta_mwh: 0, delta_pct: 0 },
    }
  }

  // Brief 40 Part 5b Section A: filter enabled DHW systems before
  // validation + compute. Service-level fields stay available regardless
  // of enabled state — the building's hot water demand doesn't vanish
  // when downstream systems toggle off.
  const enabledSystems = _enabledSystems(systems)

  // Brief 42 Part 2: building-level DHW physics fields read from the
  // service-level block (not from systems[0]).
  const demand_basis        = serviceLevel?.dhw_demand_basis ?? 'per_m2'
  const setpoint            = Number(serviceLevel?.dhw_storage_setpoint_c ?? 60)
  const cold_supply_temp_c  = Number(serviceLevel?.dhw_cold_supply_temp_c ?? 10)
  const tap_outlet_temp_c   = Number(serviceLevel?.dhw_tap_outlet_temp_c ?? 40)

  if (enabledSystems.length === 0) {
    return {
      demand_basis, tap_outlet_temp_c, cold_supply_temp_c, setpoint,
      hot_fraction: null, boiler_litres_per_day: 0,
      demand_at_comfort_mwh: 0, delivered_total_mwh: 0, blended_efficiency: null,
      systems: [],
      all_disabled: true,
      diagnostic: { delivered_no_mix_mwh: 0, delta_mwh: 0, delta_pct: 0 },
    }
  }

  if (!_validateShares(enabledSystems)) {
    const sum = enabledSystems.reduce((s, x) => s + Number(x?.share_pct ?? 0), 0)
    return {
      demand_basis: null, tap_outlet_temp_c: null, cold_supply_temp_c: null,
      setpoint: null, hot_fraction: null, boiler_litres_per_day: 0,
      demand_at_comfort_mwh: 0, delivered_total_mwh: 0, blended_efficiency: null,
      systems: [],
      error: `share_pct of enabled DHW systems sums to ${sum.toFixed(1)}%, not 100%`,
      diagnostic: { delivered_no_mix_mwh: 0, delta_mwh: 0, delta_pct: 0 },
    }
  }

  const setpoint_minus_cold = Math.max(setpoint - cold_supply_temp_c, 1)
  const hot_fraction        = Math.max(0, Math.min(1, (tap_outlet_temp_c - cold_supply_temp_c) / setpoint_minus_cold))

  // Total tap litres per day depends on basis — read from service-level.
  let total_tap_litres_per_day
  let demand_litres_per_m2_day_used = null
  let demand_litres_per_person_per_day_used = null
  if (demand_basis === 'per_person') {
    const litres_per_person_per_day = Number(serviceLevel?.dhw_demand_litres_per_person_per_day ?? 80)
    demand_litres_per_person_per_day_used = litres_per_person_per_day
    // Brief 58 B3 (2026-05-26): HEADCOUNT basis. Pre-B3, this branch
    // computed `total_tap = (annualOccupantHours / 24) × L_per_p_per_day
    // / 365`, which scales DHW with PRESENCE TIME. Wrong — DHW is a
    // per-HEAD event (one guest, one shower, regardless of dwell time).
    // The new formula reads peak headcount from building.{num_bedrooms,
    // people_per_room, occupancy_rate}, where occupancy_rate factors
    // in for partially-occupied projects (a 75 %-occupied hotel uses
    // 0.75 × peak DHW). B1 hand-calc on Bridgewater: 134 × 1.5 × 1.0
    // = 201 occupants → total_tap = 201 × 80 = 16,080 L/day →
    // annual thermal = 204.8 MWh (matches B1 hand-calc, B3 gate
    // ±0.5 MWh).
    const num_rooms = Number(building?.num_bedrooms ?? 0)
    const ppr       = Number(building?.people_per_room ?? 1.5)
    const occ_rate  = Number(building?.occupancy_rate ?? 1)
    const occupants = Math.max(0, num_rooms * ppr * occ_rate)
    total_tap_litres_per_day = occupants * litres_per_person_per_day
  } else {  // 'per_m2'
    const litres_per_m2_per_day = Number(serviceLevel?.dhw_demand_litres_per_m2_per_day ?? 1.1)
    demand_litres_per_m2_day_used = litres_per_m2_per_day
    total_tap_litres_per_day = litres_per_m2_per_day * gia
  }

  const boiler_litres_per_day  = total_tap_litres_per_day * hot_fraction
  const annual_dhw_thermal_kWh = boiler_litres_per_day * setpoint_minus_cold * WATER_SHC_KWH_PER_L_PER_K * 365
  const demand_at_comfort_mwh  = annual_dhw_thermal_kWh / 1000

  // Brief 58 B4 (2026-05-26): hourly DHW load-shape profile generation.
  //
  //   'flat'             — uniform: each hour gets annual / 8760.
  //   'follow_occupancy' — annual draw spread across the hourly
  //                        occupancy presence (0 kWh off-hours, peak
  //                        kWh peak-hours).
  //
  // Annual integral is identical across both shapes by construction
  // (each branch redistributes `annual_dhw_thermal_kWh` and nothing
  // else). Falls back to 'flat' if `presenceHourly` is missing,
  // wrong-shaped, or sums to zero. Float32 to keep memory ~35 KB.
  const load_shape = (serviceLevel?.dhw_load_shape === 'follow_occupancy')
    ? 'follow_occupancy'
    : 'flat'
  const hourly_kwh = new Float32Array(8760)
  let usedShape = 'flat'
  if (load_shape === 'follow_occupancy'
      && presenceHourly
      && presenceHourly.length === 8760) {
    let presence_sum = 0
    for (let i = 0; i < 8760; i++) presence_sum += presenceHourly[i]
    if (presence_sum > 0) {
      const weight = annual_dhw_thermal_kWh / presence_sum
      for (let i = 0; i < 8760; i++) hourly_kwh[i] = presenceHourly[i] * weight
      usedShape = 'follow_occupancy'
    }
  }
  if (usedShape === 'flat') {
    const per_h = annual_dhw_thermal_kWh / 8760
    for (let i = 0; i < 8760; i++) hourly_kwh[i] = per_h
  }

  // Per-system: split delivered by share, divide by per-system efficiency.
  // Loops over ENABLED systems only — disabled systems' share preserved on
  // disk but excluded from compute.
  const out_systems = enabledSystems.map(sys => {
    const share = Number(sys?.share_pct ?? 0) / 100
    const eff   = Number(sys?.efficiency_metric ?? 0)
    const delivered_mwh     = demand_at_comfort_mwh * share
    const source_energy_mwh = eff > 0 ? delivered_mwh / eff : 0
    return {
      id:                sys.id ?? null,
      label:             sys.label ?? 'dhw system',
      share_pct:         sys.share_pct ?? 0,
      // Brief 42: storage setpoint is service-level. Per-system echo on
      // the result row kept for backward-compat (UI / Sankey may consume).
      setpoint,
      delivered_mwh:     round_mwh(delivered_mwh),
      source_energy_mwh: round_mwh(source_energy_mwh),
      source_fuel:       _sourceToFuel(sys.source),
      efficiency:        eff,
    }
  })

  const delivered_total_mwh = out_systems.reduce((s, sys) => s + sys.delivered_mwh, 0)

  let harmonic_denom = 0
  for (const sys of enabledSystems) {
    const share = Number(sys?.share_pct ?? 0) / 100
    const eff   = Number(sys?.efficiency_metric ?? 0)
    if (eff > 0) harmonic_denom += share / eff
  }
  const blended_efficiency = harmonic_denom > 0 ? 1 / harmonic_denom : null

  // §5.2 diagnostic — what would delivered be without tap-mix (i.e. if tap
  // were delivered at full setpoint temperature). delivered_no_mix =
  // demand × (1/hot_fraction − 1) extra on top of demand_at_comfort.
  const delivered_no_mix_mwh = hot_fraction > 0 ? demand_at_comfort_mwh / hot_fraction : 0
  const delta_mwh = delivered_no_mix_mwh - demand_at_comfort_mwh
  const delta_pct = demand_at_comfort_mwh > 0 ? 100 * delta_mwh / demand_at_comfort_mwh : 0

  return {
    demand_basis,
    tap_outlet_temp_c,
    cold_supply_temp_c,
    setpoint,
    hot_fraction:               Math.round(hot_fraction * 10000) / 10000,
    boiler_litres_per_day:      Math.round(boiler_litres_per_day * 100) / 100,
    // Brief 42: legacy aliases for backward compatibility with any
    // consumer that reads the old field-name shape. Either is null when
    // the basis doesn't apply.
    demand_litres_per_m2_day:           demand_litres_per_m2_day_used,
    demand_litres_per_person_per_day:   demand_litres_per_person_per_day_used,
    demand_at_comfort_mwh:      round_mwh(demand_at_comfort_mwh),
    delivered_total_mwh:        round_mwh(delivered_total_mwh),
    blended_efficiency:         blended_efficiency != null ? Math.round(blended_efficiency * 1000) / 1000 : null,
    systems:                    out_systems,
    // Brief 58 B4 (2026-05-26): hourly DHW draw profile + load-shape
    // selector. Sum(hourly_kwh) == annual_dhw_thermal_kWh in both shapes
    // by construction (the toggle redistributes timing only — annual
    // total invariant). load_shape is the SHAPE ACTUALLY USED (falls
    // back to 'flat' when 'follow_occupancy' is requested but
    // presence data is missing/zero).
    load_shape:                 usedShape,
    hourly_kwh:                 hourly_kwh,
    diagnostic: {
      delivered_no_mix_mwh: round_mwh(delivered_no_mix_mwh),
      delta_mwh:            round_mwh(delta_mwh),
      delta_pct:            Math.round(delta_pct * 10) / 10,
    },
  }
}

/**
 * Compute ventilation per-system breakdown.
 *
 * Inputs:
 *   systems  — array of Brief 40 ventilation systems
 *   gia      — building GIA, used for 'per_m2' flow basis
 *   peakOccupants — peak people count, used for 'per_person' flow basis
 *   hoursActive   — hours per year ventilation runs (default 8760 = always on)
 *
 * Returns per-system fan_electrical + recovery numbers. Recovery composition:
 * sum recovered kWh per system (NOT compose recovery percentages).
 */
function _computeVentilation(systems, gia, peakOccupants, hoursActive = 8760) {
  // Brief 40 Part 5b Section A (2026-05-19): filter enabled; validate sum
  // of enabled shares; error blocks compute (same shape as heating/cooling/
  // DHW). Disabled vent systems preserved on disk but skipped in compute.
  const enabledSystems = _enabledSystems(systems)
  if (!Array.isArray(systems) || systems.length === 0) {
    return {
      systems: [], total_fan_electrical_mwh: 0,
      total_recovered_heating_mwh: 0, total_recovered_cooling_mwh: 0,
    }
  }
  if (enabledSystems.length === 0) {
    return {
      systems: [], total_fan_electrical_mwh: 0,
      total_recovered_heating_mwh: 0, total_recovered_cooling_mwh: 0,
      all_disabled: true,
    }
  }
  if (!_validateShares(enabledSystems)) {
    const sum = enabledSystems.reduce((s, x) => s + Number(x?.share_pct ?? 0), 0)
    return {
      systems: [], total_fan_electrical_mwh: 0,
      total_recovered_heating_mwh: 0, total_recovered_cooling_mwh: 0,
      error: `share_pct of enabled ventilation systems sums to ${sum.toFixed(1)}%, not 100%`,
    }
  }

  const out_systems = enabledSystems.map(sys => {
    const share = Number(sys?.share_pct ?? 0) / 100
    const eff   = sys?.efficiency_metric ?? {}
    const sfp_w_per_lps        = Number(eff?.sfp_w_per_lps ?? 0)
    const recovery_sensible_pct = Number(eff?.recovery_sensible_pct ?? 0)
    const recovery_latent_pct   = Number(eff?.recovery_latent_pct ?? 0)
    const flow_rate             = Number(sys?.flow_rate ?? 0)
    const flow_rate_basis       = sys?.flow_rate_basis ?? 'constant'

    let flow_lps
    if (flow_rate_basis === 'per_m2')         flow_lps = flow_rate * gia
    else if (flow_rate_basis === 'per_person') flow_lps = flow_rate * peakOccupants
    else                                       flow_lps = flow_rate   // 'constant'

    // Fan electrical = SFP × flow × hours_active × share
    // SFP units: W/(l/s); flow in l/s; result in Wh, /1000 → kWh
    const fan_electrical_kwh = sfp_w_per_lps * flow_lps * hoursActive * share / 1000
    const fan_electrical_mwh = fan_electrical_kwh / 1000

    // Recovery is per-system: the kWh recovered by this system's MVHR core
    // (if it has one) reduces heating/cooling demand seen by those services.
    // The actual recovered kWh depends on flow × ΔT × hours and is best
    // computed by the existing computeVentilationEnergy() (which has the
    // per-hour ΔT integration). For Brief 40 Part 2 the recovery numbers
    // here are placeholders (recovery_sensible_pct exposed; magnitude
    // computed by the existing engine path and surfaced separately). A
    // follow-up brief can either move that calc here or leave it where it
    // is — Brief 40's scope is the per-system schema + diagnostic; the
    // recovery integration is unchanged in this Part.
    const recovery_sensible_mwh_placeholder = 0
    const recovery_latent_mwh_placeholder   = 0

    return {
      id:                       sys.id ?? null,
      label:                    sys.label ?? 'ventilation system',
      share_pct:                sys.share_pct ?? 0,
      sfp_w_per_lps,
      flow_rate,
      flow_rate_basis,
      fan_electrical_mwh:       round_mwh(fan_electrical_mwh),
      recovery_sensible_pct,
      recovery_latent_pct,
      recovered_heating_mwh:    recovery_sensible_mwh_placeholder,
      recovered_cooling_mwh:    recovery_latent_mwh_placeholder,
      defrost_penalty_mwh:      Number(sys?.defrost_penalty_kwh ?? 0) / 1000,
      // Brief 53 Part 2 (2026-05-26): per-system free-cooling bypass flag.
      // Carries through to v40VentilationToV25List → computeVentilationEnergy
      // so the per-hour bypass trigger fires correctly when the user has
      // opted in. Default false → 128.20 anchor holds.
      summer_bypass:            sys.summer_bypass === true,
    }
  })

  const total_fan_electrical_mwh = out_systems.reduce((s, v) => s + v.fan_electrical_mwh, 0)

  return {
    systems:                     out_systems,
    total_fan_electrical_mwh:    round_mwh(total_fan_electrical_mwh),
    total_recovered_heating_mwh: 0,  // placeholder — see comment above
    total_recovered_cooling_mwh: 0,
  }
}

/**
 * Compute thin lighting / small_power per-system breakdown.
 *
 * gain_from_internal_gains_mwh comes from the upstream Internal Gains
 * accumulator (heat_balance.annual.gains.internal.{lighting,equipment}.kwh
 * on State 2's output). Per Brief 58 Part C (2026-05-26), that upstream
 * gain is already modulated by the same v40 systems list (enabled +
 * share + control_factor) via `effectiveSystemScalar` in
 * computeHourlyGains — load + gain are coupled. _computeThin's job is
 * to split the modulated gain across enabled systems pro-rata by their
 * weight (share × cf), so per-system breakdown still reflects each
 * system's relative contribution.
 *
 * Total invariant: Σ delivered_electrical_i == upstream gain (because
 * weight_i / Σ weight = 1, by construction).
 *
 * Default 1-system case (share=100, cf=1): weight_i/Σ = 1, delivered =
 * gain — identity, no behavioural change from pre-Part-C.
 */
function _computeThin(systems, gainFromInternalGainsMwh) {
  // Brief 40 Part 5b Section A (2026-05-19): same enabled-filter +
  // validation-blocks-compute pattern as the other services.
  const enabledSystems = _enabledSystems(systems)
  if (!Array.isArray(systems) || systems.length === 0) {
    return { systems: [], total_delivered_electrical_mwh: 0 }
  }
  if (enabledSystems.length === 0) {
    return { systems: [], total_delivered_electrical_mwh: 0, all_disabled: true }
  }
  if (!_validateShares(enabledSystems)) {
    const sum = enabledSystems.reduce((s, x) => s + Number(x?.share_pct ?? 0), 0)
    return {
      systems: [], total_delivered_electrical_mwh: 0,
      error: `share_pct of enabled thin systems sums to ${sum.toFixed(1)}%, not 100%`,
    }
  }

  // Brief 58 Part C: weighted pro-rata split. weight_i = share/100 × cf.
  // weight_total normalises so Σ delivered == upstream gain. For the
  // default 1-system case this is identity (weight = 1, total = 1).
  let weight_total = 0
  const weights = enabledSystems.map(sys => {
    const w = (Number(sys?.share_pct ?? 0) / 100) * Number(sys?.control_factor ?? 1.0)
    weight_total += w
    return w
  })

  const out_systems = enabledSystems.map((sys, i) => {
    const share          = Number(sys?.share_pct ?? 0) / 100
    const control_factor = Number(sys?.control_factor ?? 1.0)
    const weight_share   = weight_total > 0 ? weights[i] / weight_total : 0
    const delivered_electrical_mwh = gainFromInternalGainsMwh * weight_share
    return {
      id:                         sys.id ?? null,
      label:                      sys.label ?? 'system',
      share_pct:                  sys.share_pct ?? 0,
      control_mechanism:          sys.control_mechanism ?? 'constant',
      control_factor,
      // Brief 58 Part C: each system's "share of the gain" reported as
      // its pro-rata of the modulated upstream (matches delivered when
      // 1:1 gain-to-electricity, as for lighting / small_power).
      gain_from_internal_gains_mwh: round_mwh(gainFromInternalGainsMwh * weight_share),
      delivered_electrical_mwh:   round_mwh(delivered_electrical_mwh),
    }
  })

  const total_delivered_electrical_mwh = out_systems.reduce((s, sys) => s + sys.delivered_electrical_mwh, 0)
  return {
    systems:                          out_systems,
    total_delivered_electrical_mwh:   round_mwh(total_delivered_electrical_mwh),
  }
}

// ── Rounding helper ──────────────────────────────────────────────────────────

function round_mwh(x) { return Math.round((x || 0) * 1000) / 1000 }  // 0.001 MWh = 1 kWh

// ── Top-level computeSystemsDelivered ────────────────────────────────────────

/**
 * Brief 40 Part 2 entry point. Returns the per-service / per-system breakdown
 * + totals shape (audit doc §6). Returns null when `building.systems_config`
 * is absent or has only empty service arrays — caller falls back to the
 * pre-Brief-40 path (computeServiceEnergy etc.).
 *
 * @param {object} args
 * @param {object} args.building            — building_config (read systems_config from here)
 * @param {object} args.state2Result        — State 2 output (for demand + gains + occupancy)
 * @param {object} args.comfortBand         — { lower_c, upper_c }
 * @param {Function} args.state2Recompute   — (override) => state2Result with setpointOverride
 * @param {number}   [args.heatingDemandOverrideMwh]    — post-MVHR-recovery demand
 *   (Brief 40 Part 5b: caller passes State 2 heating_demand_mwh, which is
 *   ALREADY post-MVHR via the (1-HRE) factor on vent UA at instantCalc.js
 *   L2551). Defaults to state2Result.demand.heating_demand_mwh when not
 *   supplied — same post-MVHR boundary.
 *
 * Brief 50 Part 4 (2026-05-25) — heatingRecoveryOffsetMwh param removed.
 * Pre-Brief-50 it was Brief 44 Part 2's workaround for State 3's now-
 * deleted -effective_recovery_mwh subtraction (instantCalc.js ~L4131).
 * With State 2 as the sole owner of MVHR recovery, the recomputed State 2
 * demand at a custom setpoint is already post-MVHR — no offset
 * correction needed.
 */
export function computeSystemsDelivered({ building, state2Result, comfortBand, state2Recompute, heatingDemandOverrideMwh }) {
  // Brief 40 shape lives at `systems_config_v40` to avoid clash with the
  // legacy `systems_config` fallback used by State 3 (line 4018 in
  // instantCalc.js: `building.systems_config_v25 ?? building.systems_config`).
  const cfg = building?.systems_config_v40
  if (!cfg) return null

  // Bail if every service array is empty — no Brief 40 config to compute
  const anyServiceConfigured = VALID_SERVICES.some(s => Array.isArray(cfg[s]) && cfg[s].length > 0)
  if (!anyServiceConfigured) return null

  // ── Inputs from State 2 ──
  const gia = state2Result?.metadata?.gia_m2 ?? state2Result?.heat_balance?.metadata?.gia_m2 ?? 0
  // Brief 40 Part 5b Section A (2026-05-19): heatingDemandOverrideMwh
  // accepts the post-MVHR-recovery demand from _calculateState3 so the v40
  // path matches v25's heating demand exactly. Without this override, v40
  // would compute heating delivered against the RAW state-2 demand (no
  // MVHR offset) and overstate by the recovery amount. Defaults to
  // state2Result.demand.heating_demand_mwh (raw, no recovery) when not
  // supplied — preserves the existing diagnostic-tab-only behaviour for
  // callers that don't know about post-recovery demand.
  const heatingDemandMwh = (typeof heatingDemandOverrideMwh === 'number')
                            ? heatingDemandOverrideMwh
                            : (state2Result?.demand?.heating_demand_mwh ?? 0)
  const coolingDemandMwh = state2Result?.demand?.cooling_demand_mwh ?? 0
  // Brief 58 B3 (2026-05-26): annualOccupantHours retired from the DHW
  // path — see _computeDhw signature comment. Still read from state2 for
  // ventilation (peakOccupants below) and any future per-second flow
  // calculations.
  const peakOccupants       = state2Result?.occupancy_summary?.peak_people ?? 0
  const lightingGainMwh     = (state2Result?.heat_balance?.annual?.gains?.internal?.lighting?.kwh ?? 0) / 1000
  const equipmentGainMwh    = (state2Result?.heat_balance?.annual?.gains?.internal?.equipment?.kwh ?? 0) / 1000

  // ── Per-service compute ──
  // Brief 42 Part 2 (2026-05-20): pass the whole `cfg` (systems_config_v40)
  // to heating/cooling/dhw so they can read service-level setpoint/demand
  // fields. ventilation/lighting/small_power don't have service-level
  // fields and continue to take just the per-system array.
  // Brief 50 Part 4 (2026-05-25): recoveryOffsetMwh param dropped — State 2
  // owns MVHR recovery exclusively after Brief 50 (see signature comment).
  const heating = _computeHeatingOrCooling('heating', cfg.heating ?? [], cfg, heatingDemandMwh, comfortBand, state2Recompute)
  const cooling = _computeHeatingOrCooling('cooling', cfg.cooling ?? [], cfg, coolingDemandMwh, comfortBand, state2Recompute)
  // Brief 58 B4 (2026-05-26): pass State 2's per-hour occupancy
  // schedule presence (0-1) for the DHW load-shape toggle.
  // _computeDhw falls back to 'flat' when this is missing — no error.
  const presenceHourly = state2Result?.occupancy_summary?.presence_hourly ?? null
  const dhw     = _computeDhw(cfg.dhw ?? [], cfg, gia, building, presenceHourly)
  const ventilation = _computeVentilation(cfg.ventilation ?? [], gia, peakOccupants)
  const lighting    = _computeThin(cfg.lighting ?? [], lightingGainMwh)
  const small_power = _computeThin(cfg.small_power ?? [], equipmentGainMwh)

  // ── Totals: fuel split + EUI + carbon ──
  // Heating + cooling + DHW source_energy is summed per fuel; ventilation +
  // lighting + small_power are all electricity.
  const fuel_split = {
    electricity: 0, gas: 0, oil: 0, biomass: 0,
    district_heating: 0, district_cooling: 0,
  }
  const addFuel = (sys) => { fuel_split[sys.source_fuel] = (fuel_split[sys.source_fuel] || 0) + sys.source_energy_mwh * 1000 }
  heating.systems.forEach(addFuel)
  cooling.systems.forEach(addFuel)
  dhw.systems.forEach(addFuel)
  fuel_split.electricity += ventilation.total_fan_electrical_mwh * 1000
  fuel_split.electricity += lighting.total_delivered_electrical_mwh * 1000
  fuel_split.electricity += small_power.total_delivered_electrical_mwh * 1000

  const annual_source_kWh = Object.values(fuel_split).reduce((s, x) => s + x, 0)
  const eui_kWh_per_m2    = gia > 0 ? annual_source_kWh / gia : 0

  let carbon_kg = 0
  for (const [fuel, kWh] of Object.entries(fuel_split)) {
    carbon_kg += kWh * (CARBON_KG_PER_KWH[fuel] ?? 0)
  }
  const carbon_kgCO2_per_m2 = gia > 0 ? carbon_kg / gia : 0

  return {
    heating,
    cooling,
    dhw,
    ventilation,
    lighting,
    small_power,
    totals: {
      eui_kWh_per_m2:       Math.round(eui_kWh_per_m2 * 10) / 10,
      annual_source_kWh:    Math.round(annual_source_kWh),
      fuel_split: {
        electricity_kWh:        Math.round(fuel_split.electricity),
        gas_kWh:                Math.round(fuel_split.gas),
        oil_kWh:                Math.round(fuel_split.oil),
        biomass_kWh:            Math.round(fuel_split.biomass),
        district_heating_kWh:   Math.round(fuel_split.district_heating),
        district_cooling_kWh:   Math.round(fuel_split.district_cooling),
      },
      carbon_kgCO2_per_m2:  Math.round(carbon_kgCO2_per_m2 * 100) / 100,
    },
  }
}

// ── Brief 40 Part 5b Section A: v25-compatible adapters ─────────────────────
//
// These adapters convert Brief 40 per-system arrays into the v25-shaped
// blocks the existing consumers (Sankey, Live Results, headline EUI) read.
// When v40 is populated for a service, `_calculateState3` calls these
// adapters and uses the result instead of the v25 compute functions
// (computeServiceEnergy / computeDhwFuelMix / computeVentilationEnergy).
// When v40 is empty for a service, displacement falls through to v25.
//
// The adapters preserve the v25 consumer contract exactly — same field
// names, same shape, same units. Sankey / Live Results don't need to know
// which path produced the block.

/**
 * Convert a brief40 heating / cooling / DHW service block to the v25
 * `{ primary_perf, secondary_perf, total_perf, fuel_split }` shape that
 * `_calculateState3` downstream lines consume.
 *
 * Mapping rule (N enabled systems):
 *   - First system  → primary_perf (preserves Brief 38 Sankey's primary
 *     ribbon contract)
 *   - Second system → secondary_perf (preserves Brief 38 secondary ribbon)
 *   - 3rd+ systems  → folded into secondary's totals (delivered + fuel
 *     summed; secondary's fuel label = second system's fuel for display
 *     consistency). Loss of resolution above N == 2 is acceptable for the
 *     Sankey; per-system detail remains visible in the Brief 40
 *     Diagnostic centre tab. A future enhancement could split the Sankey
 *     ribbons N-way.
 *   - total_perf = sum across ALL enabled systems
 *   - fuel_split[fuel].{primary_mwh, secondary_mwh} aggregates per-fuel
 *     fuel_mwh across systems (first system contributes to primary_mwh
 *     of its fuel; rest contribute to secondary_mwh of their fuel)
 *
 * Returns:
 *   - null when block is empty or absent (caller falls through to v25)
 *   - {error, ...zeros...} when block has error field set (validation
 *     failure — caller displaces with zeros + surfaces error in UI)
 *   - {primary_perf, secondary_perf, total_perf, fuel_split} otherwise
 *
 * The `all_disabled: true` case returns {primary_perf:null, secondary_perf:
 * null, total_perf:{0,0}, fuel_split:{}} — service "off", same shape as
 * v25's `enabled: false` `computeServiceEnergy` empty return.
 */
export function v40ServiceBlockToV25Shape(brief40Block) {
  if (!brief40Block) return null

  // Validation failure: produce zeros + propagate error
  if (brief40Block.error) {
    return {
      primary_perf:   null,
      secondary_perf: null,
      total_perf:     { delivered_mwh: 0, fuel_mwh: 0 },
      fuel_split:     {},
      error:          brief40Block.error,
    }
  }

  // All systems disabled
  if (brief40Block.all_disabled) {
    return {
      primary_perf:   null,
      secondary_perf: null,
      total_perf:     { delivered_mwh: 0, fuel_mwh: 0 },
      fuel_split:     {},
      all_disabled:   true,
    }
  }

  const sysList = brief40Block.systems ?? []
  if (sysList.length === 0) return null  // nothing to displace — fall through to v25

  const out = {
    primary_perf:   null,
    secondary_perf: null,
    total_perf:     { delivered_mwh: 0, fuel_mwh: 0 },
    fuel_split:     {},
  }

  for (let i = 0; i < sysList.length; i++) {
    const s = sysList[i]
    const delivered = s.delivered_mwh ?? 0
    const fuel_mwh  = s.source_energy_mwh ?? 0
    const fuel      = s.source_fuel ?? 'electricity'
    const eff       = s.efficiency ?? s.blended_efficiency ?? null
    const perf      = { delivered_mwh: delivered, fuel_mwh, avg_cop_or_eff: eff, fuel }

    if (i === 0) {
      out.primary_perf = perf
    } else if (i === 1) {
      out.secondary_perf = perf
    } else {
      // 3rd+ system: fold into secondary's totals. Display fields (fuel,
      // avg_cop_or_eff) keep the second system's values so the Sankey
      // ribbon labels stay coherent; the extra delivered + fuel kWh are
      // accounted in the totals (and in the fuel_split per the system's
      // actual fuel).
      out.secondary_perf = {
        delivered_mwh:  (out.secondary_perf?.delivered_mwh ?? 0) + delivered,
        fuel_mwh:       (out.secondary_perf?.fuel_mwh ?? 0) + fuel_mwh,
        avg_cop_or_eff: out.secondary_perf?.avg_cop_or_eff ?? eff,
        fuel:           out.secondary_perf?.fuel ?? fuel,
      }
    }

    out.total_perf.delivered_mwh += delivered
    out.total_perf.fuel_mwh      += fuel_mwh

    const role = i === 0 ? 'primary' : 'secondary'
    const bucket = out.fuel_split[fuel] ?? (out.fuel_split[fuel] = { primary_mwh: 0, secondary_mwh: 0 })
    bucket[`${role}_mwh`] += fuel_mwh
  }

  return out
}

/**
 * Convert a brief40 ventilation block to the v25-shaped array
 * `computeVentilationEnergy` expects (one entry per ventilation system).
 *
 * Mapping:
 *   v40.system.flow_rate         → v25.flow_l_s
 *   v40.system.efficiency_metric.sfp_w_per_lps      → v25.sfp_w_per_l_s
 *   v40.system.efficiency_metric.recovery_sensible_pct / 100 → v25.hre
 *   v40.system.control_schedule_id  → v25.schedule_ref
 *   v40.system.enabled (default true) → v25.enabled
 *
 * `library_id` is left as `null` for the synthesised entries (the v25 path
 * doesn't strictly require a library_id when the inline fields are
 * present; `resolveAndValidateSystems` only validates library_id when
 * present).
 *
 * Used by `_calculateState3` when `building.systems_config_v40.ventilation`
 * is non-empty — the v25 `computeVentilationEnergy` runs against the
 * synthesised list, preserving the Brief 28j hourly recovery cap math.
 *
 * Returns:
 *   - null when v40 vent block is absent OR has no systems (caller falls
 *     back to v25 — the legitimate "nothing to displace" case).
 *   - empty array [] when v40 vent has a validation error OR all systems
 *     disabled. Caller treats either as "no ventilation" → fan + recovery
 *     both zero. (Brief 50 Part 5 (2026-05-25): on error, returning []
 *     replaces the pre-Brief-50 `return null` which caused silent
 *     fallback to v25 — that masked validation failures and made the v40
 *     MVHR disable toggle inert when shares didn't rebalance to 100%.
 *     The error string itself remains on brief40VentBlock.error for UI
 *     surfacing — this function just controls the engine consumption.)
 *   - array of v25-shaped vent entries otherwise.
 */
export function v40VentilationToV25List(brief40VentBlock) {
  if (!brief40VentBlock) return null
  if (brief40VentBlock.error) return []        // Brief 50 Part 5 — was `return null` (silent fallback to v25).
  if (brief40VentBlock.all_disabled) return [] // user disabled all vents: empty list = no vent compute
  const sysList = brief40VentBlock.systems ?? []
  if (sysList.length === 0) return null       // nothing to displace
  return sysList.map(s => ({
    id:             s.id,
    name:           s.label,
    enabled:        true,   // already filtered to enabled in _computeVentilation
    hre_enabled:    Number(s.recovery_sensible_pct ?? 0) > 0,
    library_id:     null,   // not required when inline fields are present
    flow_l_s:       Number(s.flow_rate ?? 0),
    sfp_w_per_l_s:  Number(s.sfp_w_per_lps ?? 0),
    hre:            Number(s.recovery_sensible_pct ?? 0) / 100,
    hours:          8760,
    schedule_ref:   'always_on',  // Part 5b: scheduled vent in v40 deferred; future enhancement
    summer_bypass:  s.summer_bypass === true,   // Brief 53 Part 2 — free-cooling damper
  }))
}

/**
 * Brief 40 Part 5b Section A: scalar electrical kWh from a brief40
 * lighting / small_power block. Used by `_calculateState3` to displace the
 * `state2Result.heat_balance.annual.gains.internal.{lighting,equipment}.kwh`
 * pass-through when v40 is populated.
 *
 * Returns:
 *   - null when v40 thin block has error or empty (caller uses Internal
 *     Gains gain pass-through)
 *   - 0 when all_disabled (lighting service "off")
 *   - delivered_electrical_mwh × 1000 otherwise (kWh)
 *
 * Note: when v40's `control_factor` is 1.0 (the DEFAULT_PARAMS seed), the
 * resulting kWh equals the Internal Gains gain figure exactly (1:1 — no
 * controls applied). When the user dials in daylight_dimming (0.70),
 * delivered electrical drops to 70% of the gain, surfacing in the
 * headline EUI as expected.
 */
export function v40ThinBlockToKwh(brief40ThinBlock) {
  if (!brief40ThinBlock) return null
  if (brief40ThinBlock.error) return null
  if (brief40ThinBlock.all_disabled) return 0
  const sysList = brief40ThinBlock.systems ?? []
  if (sysList.length === 0) return null
  return (brief40ThinBlock.total_delivered_electrical_mwh ?? 0) * 1000
}
