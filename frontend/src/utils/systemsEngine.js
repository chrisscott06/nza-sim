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
 * Validate `share_pct` sums to 100 across the systems serving one service.
 * Returns true if valid (sum ≈ 100 within rounding tolerance). The UI's
 * share-validation logic should prevent users reaching the failing state,
 * but the engine validates as a defensive check (per brief Part 2 step 2.2).
 *
 * Empty arrays are considered valid (no service is fine).
 */
function _validateShares(systems) {
  if (!Array.isArray(systems) || systems.length === 0) return true
  const sum = systems.reduce((s, sys) => s + Number(sys?.share_pct ?? 0), 0)
  return Math.abs(sum - 100) < 0.5  // ½ pp rounding tolerance
}

/**
 * Resolve a per-system setpoint: `setpoint: null` → comfort band's
 * corresponding setpoint; non-null → use as-is.
 */
function _resolveSetpoint(system, service, comfortBand) {
  if (typeof system?.setpoint === 'number') return system.setpoint
  if (service === 'heating') return comfortBand?.lower_c ?? 21
  if (service === 'cooling') return comfortBand?.upper_c ?? 24
  return null  // DHW: setpoint MUST be set (validated above); ventilation/lighting/small_power: no setpoint
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
function _computeHeatingOrCooling(service, systems, demandAtComfortMwh, comfortBand, state2Recompute) {
  if (!Array.isArray(systems) || systems.length === 0) {
    return {
      demand_at_comfort_mwh: round_mwh(demandAtComfortMwh),
      delivered_total_mwh:    0,
      blended_efficiency:     null,
      systems:                [],
    }
  }

  if (!_validateShares(systems)) {
    return {
      demand_at_comfort_mwh: round_mwh(demandAtComfortMwh),
      delivered_total_mwh:    0,
      blended_efficiency:     null,
      systems:                [],
      validation_error: `share_pct does not sum to 100 for service '${service}'`,
    }
  }

  // Per-system computation with optional setpoint diagnostic recompute
  const out_systems = systems.map(sys => {
    const share = Number(sys?.share_pct ?? 0) / 100
    const eff   = Number(sys?.efficiency_metric ?? 0)
    const setpoint_resolved = _resolveSetpoint(sys, service, comfortBand)

    // Setpoint diagnostic: recompute demand at this system's setpoint if it
    // differs from the comfort band's setpoint. Recompute is *full* — the
    // closure calls _calculateState2 with setpointOverride; that's where the
    // setpoint parameterisation work lands (Brief 40 Part 2 step 2.1 + Rule
    // 14 parity). Skip the recompute when the setpoint matches comfort
    // (saves a State 2 evaluation per system in the common case).
    const comfortSetpoint = service === 'heating' ? comfortBand?.lower_c : comfortBand?.upper_c
    const setpointDiffers = (typeof sys?.setpoint === 'number') && Math.abs(sys.setpoint - comfortSetpoint) > 0.05

    let demand_at_this_setpoint_mwh
    if (setpointDiffers && typeof state2Recompute === 'function') {
      const overrideKey = service === 'heating' ? 'heating' : 'cooling'
      const recomputed = state2Recompute({ [overrideKey]: sys.setpoint })
      demand_at_this_setpoint_mwh = service === 'heating'
        ? (recomputed?.demand?.heating_demand_mwh ?? demandAtComfortMwh)
        : (recomputed?.demand?.cooling_demand_mwh ?? demandAtComfortMwh)
    } else {
      demand_at_this_setpoint_mwh = demandAtComfortMwh
    }

    const delivered_mwh     = demand_at_this_setpoint_mwh * share
    const source_energy_mwh = eff > 0 ? delivered_mwh / eff : 0
    const delta_vs_comfort_mwh = (demand_at_this_setpoint_mwh - demandAtComfortMwh) * share
    const delta_vs_comfort_pct = demandAtComfortMwh > 0
      ? 100 * delta_vs_comfort_mwh / (demandAtComfortMwh * share)
      : 0

    return {
      id:                          sys.id ?? null,
      label:                       sys.label ?? `${service} system`,
      share_pct:                   sys.share_pct ?? 0,
      setpoint:                    typeof sys?.setpoint === 'number' ? sys.setpoint : null,
      setpoint_resolved,
      demand_at_this_setpoint_mwh: round_mwh(demand_at_this_setpoint_mwh),
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
  // Uses *resolved share* (share/100) and skips zero-eff systems to avoid div-by-zero.
  let harmonic_denom = 0
  for (const sys of systems) {
    const share = Number(sys?.share_pct ?? 0) / 100
    const eff   = Number(sys?.efficiency_metric ?? 0)
    if (eff > 0) harmonic_denom += share / eff
  }
  const blended_efficiency = harmonic_denom > 0 ? 1 / harmonic_denom : null

  return {
    demand_at_comfort_mwh: round_mwh(demandAtComfortMwh),
    delivered_total_mwh:    round_mwh(delivered_total_mwh),
    blended_efficiency:     blended_efficiency != null ? Math.round(blended_efficiency * 1000) / 1000 : null,
    systems:                out_systems,
  }
}

/**
 * Compute DHW per-system breakdown with tap-mix correction.
 *
 * Inputs:
 *   systems              — array of Brief 40 DHW systems
 *   gia                  — building GIA (m²), used for 'per_m2' basis
 *   annualOccupantHours  — sum of occupants × hour over the year, used for
 *                          'per_person' basis (read from state2Result)
 *
 * The first system's `demand_basis` + `cold_supply_temp_c` + `setpoint` +
 * `tap_outlet_temp_c` drive the building-level DHW demand math (all DHW
 * systems on a building share the same physical hot water demand; the
 * share_pct splits *delivery* across systems). Per-system efficiency drives
 * source energy.
 */
function _computeDhw(systems, gia, annualOccupantHours) {
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

  if (!_validateShares(systems)) {
    return { systems: [], delivered_total_mwh: 0, validation_error: "share_pct does not sum to 100 for service 'dhw'" }
  }

  // Building-level DHW demand math reads from the FIRST system's params
  // (these are building-physical quantities, not per-system; the schema
  // permits per-system editing as a convenience but the building has one
  // hot water demand).
  const lead = systems[0]
  const demand_basis        = lead?.demand_basis ?? 'per_m2'
  const setpoint            = Number(lead?.setpoint ?? 60)
  const cold_supply_temp_c  = Number(lead?.cold_supply_temp_c ?? 10)
  const tap_outlet_temp_c   = Number(lead?.tap_outlet_temp_c ?? 40)

  const setpoint_minus_cold = Math.max(setpoint - cold_supply_temp_c, 1)
  const hot_fraction        = Math.max(0, Math.min(1, (tap_outlet_temp_c - cold_supply_temp_c) / setpoint_minus_cold))

  // Total tap litres per day depends on basis
  let total_tap_litres_per_day
  if (demand_basis === 'per_person') {
    const litres_per_person_per_day = Number(lead?.demand_litres_per_person_per_day ?? 80)
    // Per-person-day → annual L/yr from occupant-hours: L/yr = L/person/day ÷ 24 h × person·h/yr
    // Equivalent total_tap_litres_per_day = annual_L / 365
    const annual_litres = (annualOccupantHours / 24) * litres_per_person_per_day
    total_tap_litres_per_day = annual_litres / 365
  } else {  // 'per_m2'
    const litres_per_m2_per_day = Number(lead?.demand_litres_per_m2_day ?? 1.1)
    total_tap_litres_per_day = litres_per_m2_per_day * gia
  }

  const boiler_litres_per_day  = total_tap_litres_per_day * hot_fraction
  const annual_dhw_thermal_kWh = boiler_litres_per_day * setpoint_minus_cold * WATER_SHC_KWH_PER_L_PER_K * 365
  const demand_at_comfort_mwh  = annual_dhw_thermal_kWh / 1000

  // Per-system: split delivered by share, divide by per-system efficiency
  const out_systems = systems.map(sys => {
    const share = Number(sys?.share_pct ?? 0) / 100
    const eff   = Number(sys?.efficiency_metric ?? 0)
    const delivered_mwh     = demand_at_comfort_mwh * share
    const source_energy_mwh = eff > 0 ? delivered_mwh / eff : 0
    return {
      id:                sys.id ?? null,
      label:             sys.label ?? 'dhw system',
      share_pct:         sys.share_pct ?? 0,
      setpoint:          Number(sys?.setpoint ?? 60),
      delivered_mwh:     round_mwh(delivered_mwh),
      source_energy_mwh: round_mwh(source_energy_mwh),
      source_fuel:       _sourceToFuel(sys.source),
      efficiency:        eff,
    }
  })

  const delivered_total_mwh = out_systems.reduce((s, sys) => s + sys.delivered_mwh, 0)

  let harmonic_denom = 0
  for (const sys of systems) {
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
    demand_litres_per_m2_day:   lead?.demand_litres_per_m2_day ?? null,
    demand_litres_per_person_per_day: lead?.demand_litres_per_person_per_day ?? null,
    demand_at_comfort_mwh:      round_mwh(demand_at_comfort_mwh),
    delivered_total_mwh:        round_mwh(delivered_total_mwh),
    blended_efficiency:         blended_efficiency != null ? Math.round(blended_efficiency * 1000) / 1000 : null,
    systems:                    out_systems,
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
  if (!Array.isArray(systems) || systems.length === 0) {
    return {
      systems: [],
      total_fan_electrical_mwh: 0,
      total_recovered_heating_mwh: 0,
      total_recovered_cooling_mwh: 0,
    }
  }
  if (!_validateShares(systems)) {
    return { systems: [], total_fan_electrical_mwh: 0, validation_error: "share_pct does not sum to 100 for service 'ventilation'" }
  }

  const out_systems = systems.map(sys => {
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
 * on State 2's output). Multiplied by control_factor × share/100 →
 * delivered electrical kWh.
 */
function _computeThin(systems, gainFromInternalGainsMwh) {
  if (!Array.isArray(systems) || systems.length === 0) {
    return { systems: [], total_delivered_electrical_mwh: 0 }
  }
  if (!_validateShares(systems)) {
    return { systems: [], total_delivered_electrical_mwh: 0, validation_error: 'share_pct does not sum to 100' }
  }

  const out_systems = systems.map(sys => {
    const share          = Number(sys?.share_pct ?? 0) / 100
    const control_factor = Number(sys?.control_factor ?? 1.0)
    const delivered_electrical_mwh = gainFromInternalGainsMwh * control_factor * share
    return {
      id:                         sys.id ?? null,
      label:                      sys.label ?? 'system',
      share_pct:                  sys.share_pct ?? 0,
      control_mechanism:          sys.control_mechanism ?? 'constant',
      control_factor,
      gain_from_internal_gains_mwh: round_mwh(gainFromInternalGainsMwh * share),
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
 */
export function computeSystemsDelivered({ building, state2Result, comfortBand, state2Recompute }) {
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
  const heatingDemandMwh = state2Result?.demand?.heating_demand_mwh ?? 0
  const coolingDemandMwh = state2Result?.demand?.cooling_demand_mwh ?? 0
  const annualOccupantHours = state2Result?.occupancy_summary?.annual_occupant_hours ?? 0
  const peakOccupants       = state2Result?.occupancy_summary?.peak_people ?? 0
  const lightingGainMwh     = (state2Result?.heat_balance?.annual?.gains?.internal?.lighting?.kwh ?? 0) / 1000
  const equipmentGainMwh    = (state2Result?.heat_balance?.annual?.gains?.internal?.equipment?.kwh ?? 0) / 1000

  // ── Per-service compute ──
  const heating = _computeHeatingOrCooling('heating', cfg.heating ?? [], heatingDemandMwh, comfortBand, state2Recompute)
  const cooling = _computeHeatingOrCooling('cooling', cfg.cooling ?? [], coolingDemandMwh, comfortBand, state2Recompute)
  const dhw     = _computeDhw(cfg.dhw ?? [], gia, annualOccupantHours)
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
