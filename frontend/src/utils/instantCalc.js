/**
 * instantCalc.js
 *
 * Simplified steady-state energy calculations for instant UI feedback.
 * NOT a replacement for EnergyPlus — used only for the live results
 * panels while the user is dragging sliders.
 *
 * Accuracy target: within ±30% of EnergyPlus for comparative purposes.
 * The important thing is that "better" inputs produce "better" results.
 *
 * Method: degree-day steady-state heat balance (CIBSE Guide A simplified)
 */

import { resolveCmass } from './thermalMass.js'

// ── System efficiency defaults (by library key) ───────────────────────────────
// Used for instant calc lookups without needing the full library API response.
// efficiency for gas systems = fraction (0–1); for heat pumps = COP/SCOP/SEER.

const SYSTEM_DEFAULTS = {
  // Heating
  gas_boiler_standard:    { fuel: 'gas',         eff: 0.92 },
  gas_boiler_heating:     { fuel: 'gas',         eff: 0.92 },
  vrf_standard:           { fuel: 'electricity', eff: 3.5,  eer: 3.2 },
  vrf_high_efficiency:    { fuel: 'electricity', eff: 4.2,  eer: 4.0 },
  vrf_heating:            { fuel: 'electricity', eff: 3.5 },
  ashp_heating:           { fuel: 'electricity', eff: 3.2 },
  ashp_space:             { fuel: 'electricity', eff: 3.0 },
  electric_panel_heating: { fuel: 'electricity', eff: 1.0 },
  // Cooling
  vrf_cooling:            { fuel: 'electricity', eer: 3.2 },
  split_system_cooling:   { fuel: 'electricity', eer: 2.8 },
  none_cooling:           { fuel: null,          eer: null },
  // DHW
  gas_boiler_dhw:         { fuel: 'gas',         eff: 0.92 },
  ashp_dhw:               { fuel: 'electricity', eff: 2.8 },
  ashp_dhw_preheat:       { fuel: 'electricity', eff: 2.8 },
  electric_immersion:     { fuel: 'electricity', eff: 1.0 },
  solar_thermal_dhw:      { fuel: 'renewable',   eff: 0.5 },
  // Ventilation
  mev_standard:           { fuel: 'electricity', sfp: 1.5,  hre: 0.0 },
  mvhr_standard:          { fuel: 'electricity', sfp: 1.8,  hre: 0.82 },
}

/** Look up a system default, falling back gracefully */
function sysDefaults(systemKey) {
  return SYSTEM_DEFAULTS[systemKey] ?? { fuel: 'electricity', eff: 1.0 }
}

/**
 * Lighting-control multiplier on LPD.
 * Coarse approximation of EP Daylighting:Controls — kept in sync with
 * nza_engine/generators/epjson_assembler.py:_lighting_control_factors so live
 * calc and simulation see the same effective LPD. Direction is real:
 *   manual            → 1.20  (people leave lights on)
 *   occupancy_sensing → 0.80  (~20% PIR saving, CIBSE LG09)
 *   daylight_dimming  → 0.60  (~40% photocell + dimming)
 */
function lightingControlFactor(control) {
  switch (control) {
    case 'manual':            return 1.20
    case 'occupancy_sensing': return 0.80
    case 'daylight_dimming':  return 0.60
    default:                  return 1.0
  }
}

// ── UK Climate defaults ────────────────────────────────────────────────────────

const UK_HDD   = 2200   // Heating degree days (15.5°C base, UK average)
const UK_CDD   = 150    // Cooling degree days (22°C base, UK average)
const HOURS    = 8760   // Hours per year

// Annual incident solar irradiance by TRUE compass direction (kWh/m²/yr, UK)
const SOLAR_BY_COMPASS = {
  N: 350, NE: 400, E: 500, SE: 650, S: 750, SW: 650, W: 500, NW: 400,
}

/**
 * Return the true compass direction for a facade given building orientation.
 * orientationDeg: degrees clockwise from north (EnergyPlus north_axis convention).
 * facadeLabel:   'north' | 'east' | 'south' | 'west' (relative to building geometry).
 */
function getActualDirection(facadeLabel, orientationDeg) {
  const baseAngles = { north: 0, east: 90, south: 180, west: 270 }
  const trueAngle = ((baseAngles[facadeLabel] ?? 0) + Number(orientationDeg ?? 0)) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const index = Math.round(trueAngle / 45) % 8
  return directions[index]
}

export function getSolarRadiation(facadeLabel, orientationDeg) {
  return SOLAR_BY_COMPASS[getActualDirection(facadeLabel, orientationDeg)]
}

export { SOLAR_BY_COMPASS }

// Glazing g-value (solar heat gain coefficient) default
const DEFAULT_G_VALUE = 0.4

// Air properties
const AIR_HEAT_CAPACITY = 0.33  // kWh/m³/K (ρ × Cp for air)

// Hotel operating hours per year — calibrated against EnergyPlus results
const HOTEL_OPERATING_HOURS    = 2200  // Effective lighting hours (hotel bedroom)
const HOTEL_EQUIP_HOURS        = 1800  // Equipment operating hours (lower than lighting)
const HOTEL_OCCUPIED_FRACTION  = 0.35  // Fraction of time people present

// Carbon factors
const GRID_INTENSITY_2026  = 0.145  // kgCO₂/kWh (UK grid 2026, FES Leading the Way)
const GAS_CARBON_KG_KWH    = 0.183  // kgCO₂/kWh (constant)

// DHW constants — area-based benchmark (CIBSE Guide F UK hotels)
const DHW_LITRES_PER_M2_DAY = 1.1  // L/m² GIA/day (CIBSE Guide F UK hotels) — gives ≈84 MWh thermal for 3600 m² GIA
const WATER_SHC             = 4.18 / 3600  // kWh/L/K
const DHW_COLD_TEMP         = 10   // °C
const DHW_SETPOINT          = 60   // °C

// ── Shading factors (live preview only) ──────────────────────────────────────
//
// Annual-average solar reduction factor per facade, given per-facade overhang
// and fin geometry. EnergyPlus does the proper per-timestep shading calc with
// real sun positions; this lightweight approximation gives the user immediate
// feedback in the live engine while they iterate on shading depth.
//
// Approach: combine an overhang projection-factor (depth ÷ window-height)
// with a simple seasonal-incidence reduction curve, weighted by typical sun
// angle per orientation in the UK. Empirical fit to within ±10-15% of
// EnergyPlus annual results for projection factors 0–1.5.
//
// Inputs (read from building.shading_overhang and shading_fin):
//   overhang.depth_m / offset_m  per face
//   fin.left_depth_m / right_depth_m  per face
//
// Returns: { north, south, east, west } each a multiplier in [0.4, 1.0]

const WINDOW_HEIGHT_DEFAULT = 1.5  // matches geometry.py WINDOW_HEIGHT

// Per-orientation overhang effectiveness — scaling on the projection factor.
// South sees the highest sun, so overhangs shade most effectively there.
const ORIENT_OVERHANG_EFF = {
  north: 0.30,   // sun rarely hits in N hemisphere; overhangs do little
  south: 0.85,
  east:  0.55,
  west:  0.55,
}
const ORIENT_FIN_EFF = {
  north: 0.20,
  south: 0.30,
  east:  0.65,   // east fins block low morning sun effectively
  west:  0.65,   // west fins block low afternoon sun effectively
}

function computeShadingFactors(building) {
  const overhang = building?.shading_overhang ?? {}
  const fin      = building?.shading_fin      ?? {}
  const winH     = WINDOW_HEIGHT_DEFAULT
  const out = { north: 1.0, south: 1.0, east: 1.0, west: 1.0 }

  for (const face of ['north', 'south', 'east', 'west']) {
    const o = overhang[face] ?? {}
    const f = fin[face]      ?? {}
    const depth  = Math.max(0, Number(o.depth_m  ?? 0))
    const offset = Math.max(0, Number(o.offset_m ?? 0))
    const finL   = Math.max(0, Number(f.left_depth_m  ?? 0))
    const finR   = Math.max(0, Number(f.right_depth_m ?? 0))

    // Overhang projection factor: depth / (window height + offset)
    const pfOverhang = depth / Math.max(winH + offset, 0.1)
    // Saturation: pf > 1.5 has diminishing effect
    const reductionOverhang = ORIENT_OVERHANG_EFF[face] *
      Math.min(0.65, pfOverhang * 0.5 / (1 + pfOverhang * 0.3))

    // Fin reduction: depth / window-width approximation. Window width depends
    // on WWR + wall length but we approximate using a typical 6 m width.
    const finWidth = 6
    const pfFin = (finL + finR) / Math.max(finWidth, 0.1)
    const reductionFin = ORIENT_FIN_EFF[face] * Math.min(0.45, pfFin * 0.4)

    out[face] = Math.max(0.4, 1.0 - reductionOverhang - reductionFin)
  }
  return out
}

// Exported for first-principles drill-down + tests
export { computeShadingFactors }

// ── Geometry helpers ──────────────────────────────────────────────────────────

function computeGeometry(building) {
  const { length = 60, width = 15, num_floors = 4, floor_height = 3.2, wwr = {} } = building
  const gia        = length * width * num_floors
  const volume     = gia * floor_height
  const floor_area = length * width

  // Perimeter facades
  const north_area = length * floor_height * num_floors
  const south_area = length * floor_height * num_floors
  const east_area  = width  * floor_height * num_floors
  const west_area  = width  * floor_height * num_floors

  const wwr_n = wwr.north ?? 0.25
  const wwr_s = wwr.south ?? 0.25
  const wwr_e = wwr.east  ?? 0.25
  const wwr_w = wwr.west  ?? 0.25

  const glazing = {
    north: north_area * wwr_n,
    south: south_area * wwr_s,
    east:  east_area  * wwr_e,
    west:  west_area  * wwr_w,
  }
  const wall_opaque = {
    north: north_area * (1 - wwr_n),
    south: south_area * (1 - wwr_s),
    east:  east_area  * (1 - wwr_e),
    west:  west_area  * (1 - wwr_w),
  }
  const total_wall_opaque = Object.values(wall_opaque).reduce((a, b) => a + b, 0)
  const total_glazing     = Object.values(glazing).reduce((a, b) => a + b, 0)
  const roof_area         = floor_area
  const ground_area       = floor_area

  return { gia, volume, total_wall_opaque, total_glazing, glazing, wall_opaque, roof_area, ground_area }
}

// ── G-value lookup ────────────────────────────────────────────────────────────

function getGValue(constructionChoices, libraryData) {
  const name = constructionChoices?.glazing
  if (name && libraryData?.constructions) {
    const item = libraryData.constructions.find(c => c.name === name)
    if (item?.config_json?.g_value != null) return Number(item.config_json.g_value)
  }
  return DEFAULT_G_VALUE
}

// ── State 1 envelope-only helpers (Brief 26 Part 3) ───────────────────────────

/**
 * Effective heat capacity per m² of GIA by CIBSE TM52 thermal-mass class.
 * Used by the State 1 lumped-capacitance free-running temperature model.
 * Values in J/(K·m²) GIA — quite coarse, deliberately so for fast feedback;
 * EnergyPlus is canonical for the absolute temperature trace.
 */
const THERMAL_MASS_J_PER_K_PER_M2 = {
  light:   80_000,   // steel-frame / partition-walled / lightweight
  medium:  160_000,  // typical brick/block masonry
  heavy:   280_000,  // exposed concrete / heavy masonry / earth
}

/**
 * Strip a building config down to ONLY the inputs honoured by the requested
 * State per `docs/state_contracts.md`. Any read from a forbidden input via
 * the returned object is a contract violation — that's the whole point of
 * routing through this helper. Sprinkle `if (mode === 'envelope-only')`
 * around the codebase and isolation leaks. Channel one call site here.
 *
 * Per Brief 26 Part 3, returns:
 *   - Geometry: length, width, num_floors, floor_height, orientation
 *   - Glazing:  wwr, window_count
 *   - Shading:  shading_overhang, shading_fin
 *   - Fabric:   infiltration_ach, thermal_mass_category
 *   - Permanent openings: openings.{face}.louvre_area_m2 + openings.site_exposure
 *   - Location: for solar lat (also overridable from EPW)
 *
 * Explicitly omitted: num_bedrooms / occupancy_rate / people_per_room,
 * openings.schedule, openings.{face}.openable_fraction, and anything in
 * `systems.*`.
 */
function withMode(building, mode) {
  if (mode !== 'envelope-only' && mode !== 'envelope-gains') return building
  const ops = building?.openings ?? {}
  // Keep only the louvre permanent-openings half of the openings dict; drop
  // operable-window fraction + schedule entirely so the State 1/2 paths can't
  // see them even by accident (operable windows are State 2.5 territory).
  const permanentOpenings = {
    site_exposure: ops.site_exposure ?? 'normal',
    north: { louvre_area_m2: ops?.north?.louvre_area_m2 ?? 0 },
    south: { louvre_area_m2: ops?.south?.louvre_area_m2 ?? 0 },
    east:  { louvre_area_m2: ops?.east?.louvre_area_m2  ?? 0 },
    west:  { louvre_area_m2: ops?.west?.louvre_area_m2  ?? 0 },
    // No `schedule`, no `openable_fraction` — state isolation.
  }
  const base = {
    length:        building?.length,
    width:         building?.width,
    num_floors:    building?.num_floors,
    floor_height:  building?.floor_height,
    orientation:   building?.orientation,
    wwr:           building?.wwr,
    window_count:  building?.window_count,
    shading_overhang: building?.shading_overhang,
    shading_fin:      building?.shading_fin,
    infiltration_ach:      building?.infiltration_ach,
    thermal_mass_mode:     building?.thermal_mass_mode ?? 'auto',
    thermal_mass_category: building?.thermal_mass_category ?? 'light',
    openings:      permanentOpenings,
    location:      building?.location,
    // weather_file kept off — solar latitude comes from EPW location directly.
  }
  if (mode === 'envelope-only') return base
  // mode === 'envelope-gains': add State 2 inputs (occupancy + gains), keep
  // legacy num_bedrooms for `per_room` density basis. Systems stay stripped.
  return {
    ...base,
    num_bedrooms: building?.num_bedrooms,
    occupancy:    building?.occupancy,
    gains:        building?.gains,
  }
}

/**
 * State 1 envelope-only computation per `docs/state_contracts.md` § State 1.
 *
 * Inputs: a building config (already filtered through withMode), constructions,
 * library data, EPW hourly weather, pre-computed hourly solar per facade, and
 * the project's comfort band { lower_c, upper_c }.
 *
 * Outputs the contract's State 1 shape:
 *   {
 *     state: 1, mode: 'envelope-only', inputs_used: [...],
 *     comfort_band_used: { lower_c, upper_c },
 *     gains:  { solar: { f1..f4, roof, total } },
 *     losses: {
 *       conduction: { external_wall, roof, ground_floor, glazing:{f1..f4}, thermal_bridging },
 *       ventilation: { fabric_leakage, permanent_vents },
 *     },
 *     free_running: { annual_mean_c, winter_min_c, summer_max_c, hourly_temperature_c },
 *     demand: { heating_demand_mwh, cooling_demand_mwh, underheating_hours, overheating_hours, comfort_hours },
 *     heat_balance: { ...same gains/losses re-shaped for the Heat Balance view },
 *   }
 *
 * Physics summary:
 *   1. Solar gain per facade per hour (already in hourlySolar) × g × frame × shading.
 *   2. Conduction loss/gain per element at the free-running zone temperature.
 *      Thermal bridging surfaces as Y-factor × centre-of-element U × area × ΔT
 *      (already baked into getUValue's return — kept as a separate accumulator).
 *   3. Ventilation split: fabric_leakage from infiltration_ach × volume × ΔT,
 *      permanent_vents from louvres only via CIBSE AM10 single-sided wind.
 *      The two streams are NEVER combined.
 *   4. Free-running zone temperature via lumped capacitance:
 *      dT/dt × C_zone = Σ Q_solar - Σ Q_cond - Σ Q_vent
 *      C_zone = thermal_mass × GIA (J/K). Discretised hour-by-hour, T_t-1 used
 *      for the loss rates (small explicit-Euler step, stable at 1-hour Δt).
 *   5. Demand against comfort band:
 *      heating_demand[h] = max(0, UA·(lower_c - T_out) - Q_solar) if T_free < lower_c
 *      cooling_demand[h] = max(0, Q_solar + UA·(T_out - upper_c)) if T_free > upper_c
 */
function _calculateEnvelopeOnly(building, constructions, libraryData, weatherData, hourlySolar, comfortBand) {
  const geo = computeGeometry(building)
  const { gia, volume, total_wall_opaque, total_glazing, glazing, wall_opaque, roof_area, ground_area } = geo
  if (gia <= 0) return _empty()

  // ── U-values (Y-factor baked in by getUValue) ─────────────────────────────
  const u_wall  = getUValue(constructions, 'external_wall', libraryData)
  const u_roof  = getUValue(constructions, 'roof',          libraryData)
  const u_floor = getUValue(constructions, 'ground_floor',  libraryData)
  const u_glaz  = getUValue(constructions, 'glazing',       libraryData)

  const g_value = getGValue(constructions, libraryData)
  const FRAME_FRACTION = 0.20  // visible glass = 80% of WWR; framed area = 20%
  // Brief 26.1 follow-up: per-facade shading factors from overhang + fin geometry.
  // The State 1 path previously used a hardcoded `SHADING_FACTOR = 1.0` —
  // shading inputs were stripped silently. State 3 (full mode) was always
  // wired through computeShadingFactors; bringing State 1 to parity.
  const shadingFactors = computeShadingFactors(building)

  // ── UA products (W/K) — independent of zone temperature ───────────────────
  const UA_wall  = u_wall  * total_wall_opaque
  const UA_roof  = u_roof  * roof_area
  const UA_floor = u_floor * ground_area
  const UA_glaz  = u_glaz  * total_glazing
  const UA_fabric = UA_wall + UA_roof + UA_floor + UA_glaz

  // Thermal bridging — Y-factor uplift is already in the U-values returned
  // by getUValue (multiplied through there). Track it separately so we can
  // report `thermal_bridging` as its own line item per the contract.
  // Sum of (effective U - centre U) × area across all four elements:
  const getCentreU = (element) => {
    const name = constructions?.[element]
    if (name && libraryData?.constructions) {
      const item = libraryData.constructions.find(c => c.name === name)
      if (item?.u_value_W_per_m2K != null) return Number(item.u_value_W_per_m2K)
    }
    return DEFAULT_U_VALUES[element] ?? 1.0
  }
  const UA_bridging =
    Math.max(0, (u_wall  - getCentreU('external_wall')) * total_wall_opaque) +
    Math.max(0, (u_roof  - getCentreU('roof'))          * roof_area) +
    Math.max(0, (u_floor - getCentreU('ground_floor'))  * ground_area) +
    Math.max(0, (u_glaz  - getCentreU('glazing'))       * total_glazing)
  // UA_fabric_centre = UA_fabric - UA_bridging (the "centre of element" portion
  // for the State 1 conduction line items, with bridging surfaced separately)

  // ── Ventilation (split) ───────────────────────────────────────────────────
  const ach = Number(building.infiltration_ach ?? 0.5)
  const UA_leakage = AIR_HEAT_CAPACITY * ach * volume   // W/K (Wh/K per hour)

  // Permanent openings (louvres only — operable windows are State 2.5)
  const openings = building.openings ?? {}
  const Cd = 0.6
  const Cw = ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })[openings.site_exposure] ?? 0.10
  const sqrtCw = Math.sqrt(Cw)
  const louvre_area_total = ['north','south','east','west']
    .reduce((s, f) => s + Number(openings?.[f]?.louvre_area_m2 ?? 0), 0)

  // ── Two-node lumped-capacitance setup (Brief 26.1 Part 3) ─────────────────
  // The pre-26.1 model was single-node: every Q_solar landed directly on
  // indoor air (T_zone), with no surface-absorption delay. Bridgewater's
  // summer max came out at ~43°C vs EP's 34°C — solar gain dumping straight
  // into a small air heat capacity with nowhere to buffer it.
  //
  // Option A two-node model:
  //   - T_mass: thermal-mass surface temperature (structural mass node)
  //   - T_air:  indoor air temperature
  //   - Solar lands on T_mass first
  //   - Heat exchanges between mass and air via convective+radiative coupling
  //     h_am ≈ 6 W/m²K × A_internal_surface (CIBSE Guide A working value)
  //   - Air loses to outside via UA_total
  //
  // The air node has tiny heat capacity (~3.7 kWh/K for Bridgewater) but
  // strong coupling to mass (~22 kWh/K total). Air-node relaxation time is
  // ~10 min — way below the 1-hour timestep, so the explicit-Euler step
  // would be unstable on T_air. Instead T_air is solved at quasi-steady
  // state each hour:
  //     h_am × A × (T_mass − T_air)  =  UA_total × (T_air − T_out)
  // which gives T_air = weighted mean of T_mass and T_out, weighted by
  // their respective couplings. T_mass advances explicitly — its time
  // constant is hours-to-days, so the explicit step is stable.
  // Brief 26.1 Part 5 — thermal mass resolved from construction stack
  // when `params.thermal_mass_mode === 'auto'` (default). Falls back to
  // the legacy thermal_mass_category × GIA path if library isn't loaded
  // or constructions aren't assigned yet.
  //
  // For Bridgewater: auto-derived ≈ 138 kWh/K vs legacy 'light' = 77 kWh/K
  // (1.8× more). This is the magnitude lever the Part 3 topology was
  // waiting on — slows the integration enough for diurnal damping to bite.
  const cmass = resolveCmass(building, constructions, libraryData)
  const C_mass_J = cmass.C_mass_J
  const C_mass_Wh = cmass.C_mass_Wh
  // (T_air heat capacity is folded into the quasi-steady solve; not used directly.)

  // Internal surface area for air-to-mass coupling. Approximate single-zone
  // model: floor + ceiling on each floor (collapsed to top + bottom of the
  // building since inter-floor surfaces are mass-internal) + interior gross
  // wall surface. Glazing inside-face couples to air too but at a different
  // h, so it's already partially captured in the conduction term — including
  // it again here would double-count.
  const A_internal_surface = roof_area + ground_area + total_wall_opaque  // m²
  // CIBSE Guide A range 2.5–8 W/m²K. Picking 3.0 (lower-mid of range) on
  // purpose now that Part 5's derived mass is larger: with the bigger
  // C_mass, slightly weaker coupling lets T_air swing closer to T_out at
  // night without sacrificing the diurnal damping that bigger mass provides
  // during the day. (At h_am=6 with light mass, mass and air locked
  // together; at h_am=2.5 with light mass, mass over-charged. The sweet
  // spot moves with C_mass.)
  const H_AM_W_PER_M2K = 4.5
  const h_am_total = H_AM_W_PER_M2K * A_internal_surface   // Wh/K per hour

  // ── 8760-hour loop ────────────────────────────────────────────────────────
  const n = weatherData.temperature.length
  const T_hourly = new Float32Array(n)
  // Initial condition — both nodes start at lower comfort bound. Air will
  // immediately re-equilibrate against T_out in the first hour; mass takes
  // longer.
  let T_mass = comfortBand.lower_c
  let T_air  = comfortBand.lower_c

  // Annual accumulators (Wh — divide by 1000 at the end for kWh)
  let acc_solar_n = 0, acc_solar_s = 0, acc_solar_e = 0, acc_solar_w = 0, acc_solar_roof = 0
  let acc_cond_wall  = 0, acc_cond_roof = 0, acc_cond_floor = 0
  let acc_cond_glaz_n = 0, acc_cond_glaz_s = 0, acc_cond_glaz_e = 0, acc_cond_glaz_w = 0
  let acc_thermal_bridging = 0
  let acc_vent_leakage = 0, acc_vent_permanent = 0
  let acc_heating_demand_Wh = 0, acc_cooling_demand_Wh = 0
  let underheating_hours = 0, overheating_hours = 0, comfort_hours = 0
  let T_winter_min = Infinity, T_summer_max = -Infinity

  // Per-facade UA fractions for the conduction-by-glazing-face split
  // (proportional to glazing area on that face)
  const glaz_face_UA = (f) => u_glaz * (glazing[f] ?? 0)

  for (let h = 0; h < n; h++) {
    const T_out = weatherData.temperature[h]
    const v_wind = weatherData.wind_speed?.[h] ?? 0

    // Solar gains through glazing per facade (Wh into the zone this hour)
    const sol_n = hourlySolar.f1[h] * (glazing.north ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.north
    const sol_e = hourlySolar.f2[h] * (glazing.east  ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.east
    const sol_s = hourlySolar.f3[h] * (glazing.south ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.south
    const sol_w = hourlySolar.f4[h] * (glazing.west  ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.west
    const sol_roof = hourlySolar.roof[h] * roof_area * 0.05  // weak solar contribution through opaque roof
    const Q_solar_in_Wh = sol_n + sol_e + sol_s + sol_w + sol_roof

    acc_solar_n += sol_n; acc_solar_e += sol_e; acc_solar_s += sol_s; acc_solar_w += sol_w
    acc_solar_roof += sol_roof

    // Permanent-vent UA this hour (wind-driven; ach contribution to UA)
    const Q_louvre_m3s = Cd * louvre_area_total * sqrtCw * v_wind
    const UA_permanent = AIR_HEAT_CAPACITY * (Q_louvre_m3s * 3600)  // W/K-equivalent for this hour
    const UA_total = UA_fabric + UA_leakage + UA_permanent

    // ── Two-node thermal step (Brief 26.1 Part 3) ─────────────────────────
    // T_air is the air node; couples to T_mass (h_am × A_internal) and to
    // T_out (UA_total). Air heat capacity is small enough vs these
    // couplings that we solve it at quasi-steady state:
    //     h_am_total × (T_mass − T_air)  =  UA_total × (T_air − T_out)
    //   → T_air = (h_am_total × T_mass + UA_total × T_out) / (h_am_total + UA_total)
    T_air = (h_am_total * T_mass + UA_total * T_out) / (h_am_total + UA_total)

    // Mass node advances explicitly. Solar lands on mass first; mass exchanges
    // with air per the just-solved T_air. Net energy on the mass node:
    //     Q_mass_net = Q_solar  −  h_am × A × (T_mass − T_air)
    const Q_mass_to_air = h_am_total * (T_mass - T_air)
    const Q_mass_net = Q_solar_in_Wh - Q_mass_to_air
    T_mass = T_mass + Q_mass_net / C_mass_Wh
    // Bound mass too, in case of extreme inputs
    if (T_mass < -20) T_mass = -20
    if (T_mass > 60)  T_mass = 60

    // Operative temperature = mean of air and mass (per CIBSE Guide A;
    // simplifies the radiant component to "mean surface temp" = T_mass).
    // Used for comfort hours and demand triggers — what occupants feel.
    const T_op = 0.5 * (T_air + T_mass)
    T_hourly[h] = T_op

    // Heat balance for the hour — conduction losses driven by (T_air − T_out)
    const dT_air = T_air - T_out
    const Q_cond_walls_Wh   = (u_wall  * total_wall_opaque) * dT_air
    const Q_cond_roof_Wh    = (u_roof  * roof_area)         * dT_air
    const Q_cond_floor_Wh   = (u_floor * ground_area)       * dT_air
    const Q_cond_glaz_n_Wh  = glaz_face_UA('north') * dT_air
    const Q_cond_glaz_e_Wh  = glaz_face_UA('east')  * dT_air
    const Q_cond_glaz_s_Wh  = glaz_face_UA('south') * dT_air
    const Q_cond_glaz_w_Wh  = glaz_face_UA('west')  * dT_air
    const Q_bridging_Wh     = UA_bridging   * dT_air
    const Q_vent_leak_Wh    = UA_leakage    * dT_air
    const Q_vent_perm_Wh    = UA_permanent  * dT_air

    // Loss accumulators — for the contract's annual losses output. Only
    // accumulate the POSITIVE (heat-leaving-zone) direction; summer hours
    // where the zone is cooler than outside contribute negative dT and
    // would otherwise subtract.
    if (dT_air > 0) {
      acc_cond_wall  += Q_cond_walls_Wh
      acc_cond_roof  += Q_cond_roof_Wh
      acc_cond_floor += Q_cond_floor_Wh
      acc_cond_glaz_n += Q_cond_glaz_n_Wh
      acc_cond_glaz_e += Q_cond_glaz_e_Wh
      acc_cond_glaz_s += Q_cond_glaz_s_Wh
      acc_cond_glaz_w += Q_cond_glaz_w_Wh
      acc_thermal_bridging += Q_bridging_Wh
      acc_vent_leakage   += Q_vent_leak_Wh
      acc_vent_permanent += Q_vent_perm_Wh
    }

    // Comfort hours + min/max temp tracking — based on operative temp.
    const month = weatherData.month[h]
    if (T_op < comfortBand.lower_c)      underheating_hours++
    else if (T_op > comfortBand.upper_c) overheating_hours++
    else                                  comfort_hours++
    if (month >= 12 || month <= 2) T_winter_min = Math.min(T_winter_min, T_op)
    if (month >= 6  && month <= 8) T_summer_max = Math.max(T_summer_max, T_op)

    // Demand derivation: what a perfect system would need to provide to hold
    // operative temperature at the comfort bound. Only counted when
    // free-running T_op is outside the band (i.e., the envelope alone fails).
    if (T_op < comfortBand.lower_c) {
      // Heating: UA × (lower_c - T_out) is the loss rate if held at lower_c.
      // Solar gains offset part of it. Demand = max(0, deficit - solar).
      const Q_loss_at_lower = UA_total * Math.max(0, comfortBand.lower_c - T_out)
      const heating_Wh = Math.max(0, Q_loss_at_lower - Q_solar_in_Wh)
      acc_heating_demand_Wh += heating_Wh
    } else if (T_op > comfortBand.upper_c) {
      // Cooling: solar gains + heat coming IN from outside (if T_out > upper).
      // Q_loss_at_upper sign is reversed when T_out > upper.
      const Q_gain_at_upper = Q_solar_in_Wh + UA_total * Math.max(0, T_out - comfortBand.upper_c)
      acc_cooling_demand_Wh += Q_gain_at_upper
    }
  }

  // ── Aggregates ────────────────────────────────────────────────────────────
  const r1 = (Wh) => Math.round(Wh / 1000 * 10) / 10
  const perM2 = (Wh) => Math.round(Wh / 1000 / gia * 100) / 100
  const T_mean = T_hourly.reduce((s, v) => s + v, 0) / n

  const total_solar_Wh = acc_solar_n + acc_solar_e + acc_solar_s + acc_solar_w + acc_solar_roof
  const total_cond_glaz_Wh = acc_cond_glaz_n + acc_cond_glaz_e + acc_cond_glaz_s + acc_cond_glaz_w
  const total_cond_Wh = acc_cond_wall + acc_cond_roof + acc_cond_floor + total_cond_glaz_Wh + acc_thermal_bridging
  const total_vent_Wh = acc_vent_leakage + acc_vent_permanent

  // ── Heat Balance view shape (gains/losses/etc.) so the existing
  //    HeatBalance component renders State 1 without further changes.
  //    Heating/cooling appear in `demand` only, NOT in `gains` — per contract.
  const heat_balance = {
    annual: {
      losses: {
        external_wall:    { kwh: r1(acc_cond_wall),  kwh_per_m2: perM2(acc_cond_wall),  area_m2: Math.round(total_wall_opaque) },
        roof:             { kwh: r1(acc_cond_roof),  kwh_per_m2: perM2(acc_cond_roof),  area_m2: Math.round(roof_area) },
        ground_floor:     { kwh: r1(acc_cond_floor), kwh_per_m2: perM2(acc_cond_floor), area_m2: Math.round(ground_area) },
        glazing:          { kwh: r1(total_cond_glaz_Wh), kwh_per_m2: perM2(total_cond_glaz_Wh), area_m2: Math.round(total_glazing) },
        thermal_bridging: { kwh: r1(acc_thermal_bridging), kwh_per_m2: perM2(acc_thermal_bridging) },
        fabric_leakage:   { kwh: r1(acc_vent_leakage), kwh_per_m2: perM2(acc_vent_leakage), ach },
        permanent_vents:  { kwh: r1(acc_vent_permanent), kwh_per_m2: perM2(acc_vent_permanent) },
        // No `cooling` here — State 1 has no mechanical cooling, full stop.
      },
      gains: {
        solar: {
          north: { kwh: r1(acc_solar_n), kwh_per_m2: perM2(acc_solar_n), area_m2: Math.round(glazing.north ?? 0) },
          south: { kwh: r1(acc_solar_s), kwh_per_m2: perM2(acc_solar_s), area_m2: Math.round(glazing.south ?? 0) },
          east:  { kwh: r1(acc_solar_e), kwh_per_m2: perM2(acc_solar_e), area_m2: Math.round(glazing.east  ?? 0) },
          west:  { kwh: r1(acc_solar_w), kwh_per_m2: perM2(acc_solar_w), area_m2: Math.round(glazing.west  ?? 0) },
          total_kwh: r1(total_solar_Wh),
          total_kwh_per_m2: perM2(total_solar_Wh),
        },
        // No people / equipment / lighting / heating — State 1 has no gains
        // beyond solar.
      },
      totals: {
        losses_kwh: r1(total_cond_Wh + total_vent_Wh),
        gains_kwh:  r1(total_solar_Wh),
        losses_kwh_per_m2: perM2(total_cond_Wh + total_vent_Wh),
        gains_kwh_per_m2:  perM2(total_solar_Wh),
      },
    },
    metadata: { gia_m2: Math.round(gia) },
    // State 1 extras — surfaced inside heat_balance so the Heat Balance
    // component can render the "demand below bars" + free-running stats
    // + comfort band readout without a separate prop. Per state contract.
    demand: {
      heating_demand_mwh: Math.round(acc_heating_demand_Wh / 1_000_000 * 10) / 10,
      cooling_demand_mwh: Math.round(acc_cooling_demand_Wh / 1_000_000 * 10) / 10,
      underheating_hours,
      overheating_hours,
      comfort_hours,
    },
    free_running: {
      annual_mean_c: Math.round(T_mean * 10) / 10,
      winter_min_c:  isFinite(T_winter_min) ? Math.round(T_winter_min * 10) / 10 : null,
      summer_max_c:  isFinite(T_summer_max) ? Math.round(T_summer_max * 10) / 10 : null,
    },
    comfort_band_used: { lower_c: comfortBand.lower_c, upper_c: comfortBand.upper_c },
  }

  return {
    state: 1,
    mode: 'envelope-only',
    inputs_used: [
      'length', 'width', 'num_floors', 'floor_height', 'orientation',
      'wwr', 'window_count', 'shading_overhang', 'shading_fin',
      'infiltration_ach', 'thermal_mass_category',
      'openings.site_exposure', 'openings.{face}.louvre_area_m2',
      'constructions.{external_wall, roof, ground_floor, glazing}',
      'weather (EPW)',
    ],
    comfort_band_used: { lower_c: comfortBand.lower_c, upper_c: comfortBand.upper_c },

    gains: {
      solar: {
        f1: r1(acc_solar_n), f2: r1(acc_solar_e), f3: r1(acc_solar_s), f4: r1(acc_solar_w),
        roof: r1(acc_solar_roof),
        total: r1(total_solar_Wh),
      },
    },
    losses: {
      conduction: {
        external_wall: r1(acc_cond_wall),
        roof:          r1(acc_cond_roof),
        ground_floor:  r1(acc_cond_floor),
        glazing: {
          f1: r1(acc_cond_glaz_n), f2: r1(acc_cond_glaz_e),
          f3: r1(acc_cond_glaz_s), f4: r1(acc_cond_glaz_w),
        },
        thermal_bridging: r1(acc_thermal_bridging),
      },
      ventilation: {
        fabric_leakage:  r1(acc_vent_leakage),
        permanent_vents: r1(acc_vent_permanent),
      },
    },
    free_running: {
      annual_mean_c: Math.round(T_mean * 10) / 10,
      winter_min_c:  isFinite(T_winter_min) ? Math.round(T_winter_min * 10) / 10 : null,
      summer_max_c:  isFinite(T_summer_max) ? Math.round(T_summer_max * 10) / 10 : null,
      hourly_temperature_c: T_hourly,
    },
    demand: {
      heating_demand_mwh: Math.round(acc_heating_demand_Wh / 1_000_000 * 10) / 10,
      cooling_demand_mwh: Math.round(acc_cooling_demand_Wh / 1_000_000 * 10) / 10,
      underheating_hours,
      overheating_hours,
      comfort_hours,
    },
    heat_balance,
  }
}

// ── Brief 27 — State 2 (envelope + internal gains) helpers ─────────────────────

const _CUM_DAYS_NON_LEAP = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/**
 * Decompose an hour-of-year index (0..8759) into the fields the schedule
 * lookup needs: dayType (weekday|saturday|sunday), hourOfDay (0..23),
 * monthIdx (0..11), dateMMDD ("MM-DD"). Uses weatherData.month / day / hour
 * where available; otherwise derives from `h` assuming non-leap year.
 *
 * Day-of-week assumption: Jan 1 = Monday (TMY synthetic year). Adequate
 * for State 2 schedule lookup; a real-year EPW would carry a starting
 * day-of-week in its header but that's not currently parsed.
 */
function decomposeHour(h, weatherData) {
  let month, day, hourOfDay
  if (weatherData?.month && weatherData?.month[h] != null) {
    month = weatherData.month[h]                     // 1-12
    hourOfDay = (weatherData.hour?.[h] ?? 1) - 1     // EPW 1-24 → 0-23
    // Brief 28a Part 5 walkthrough fix (2026-05-14): derive `day` from
    // `h` if `weatherData.day` is missing, rather than silently defaulting
    // to 1. Previous `day = weatherData.day?.[h] ?? 1` caused every hour
    // in a month to be interpreted as the 1st of that month — broke both
    // day-of-week (months whose 1st was Sat/Sun read all-month as Sat/Sun)
    // AND date-range exception matching (every Jan hour matched the Xmas
    // exception "24-12 to 01-07", zeroing the People schedule for January).
    // The backend `parse_epw` was fixed in the same commit to populate
    // `day`; this fallback is defensive against any upstream loader (test
    // scripts, future routes) that forgets to populate it.
    if (weatherData.day?.[h] != null) {
      day = weatherData.day[h]                       // 1-31
    } else {
      const dayOfYear = Math.floor(h / 24)
      day = dayOfYear - _CUM_DAYS_NON_LEAP[month - 1] + 1
    }
  } else {
    // Fallback: derive from h
    const dayOfYear = Math.floor(h / 24) // 0..364
    hourOfDay = h % 24
    let m = 0
    while (m < 11 && _CUM_DAYS_NON_LEAP[m + 1] <= dayOfYear) m++
    month = m + 1
    day = dayOfYear - _CUM_DAYS_NON_LEAP[m] + 1
  }
  const dayOfYear = _CUM_DAYS_NON_LEAP[month - 1] + (day - 1)
  // Jan 1 = Monday → dayOfWeek 0=Mon..4=Fri, 5=Sat, 6=Sun
  const dow = dayOfYear % 7
  const dayType = dow === 5 ? 'saturday' : (dow === 6 ? 'sunday' : 'weekday')
  const dateMMDD = String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
  return { monthIdx: month - 1, dayType, hourOfDay, dateMMDD }
}

/** Lexicographic MM-DD comparison with year-wrap support. */
function isDateInRange(dateMMDD, startMMDD, endMMDD) {
  if (!startMMDD || !endMMDD) return false
  if (startMMDD <= endMMDD) return dateMMDD >= startMMDD && dateMMDD <= endMMDD
  // Wraps year (e.g., 12-22 through 01-05)
  return dateMMDD >= startMMDD || dateMMDD <= endMMDD
}

/** Return the first exception whose date range covers dateMMDD, or null. */
function findActiveException(exceptions, dateMMDD) {
  if (!exceptions || exceptions.length === 0) return null
  for (const exc of exceptions) {
    if (isDateInRange(dateMMDD, exc.start_date, exc.end_date)) return exc
  }
  return null
}

/**
 * Total possible occupants at 100% — converts density.value × density.basis
 * into an absolute headcount. Subsequent occupancy_rate × presence scaling
 * happens per-hour.
 */
function computeTotalOccupants(occupancy, building, gia) {
  const d = occupancy?.density ?? { value: 1.5, basis: 'per_room' }
  const value = Number(d.value ?? 1.5)
  switch (d.basis) {
    case 'per_room':         return Math.max(0, Number(building.num_bedrooms ?? 0)) * value
    case 'per_m2':           return gia * value
    case 'total':            return value
    case 'per_workstation':  return value   // schema may extend with a workstation count later
    default:                 return Math.max(0, Number(building.num_bedrooms ?? 0)) * value
  }
}

/**
 * Convert magnitude {value, unit} to W/m² of GIA. Magnitudes can be
 * w_per_m2 (the default), w_per_room (scale by bedrooms ÷ GIA), or
 * total_w (divide by GIA).
 */
function magnitudeToWPerM2(magnitude, building, gia) {
  if (!magnitude) return 0
  const v = Number(magnitude.value ?? 0)
  switch (magnitude.unit) {
    case 'w_per_m2':   return v
    case 'w_per_room': return v * Math.max(0, Number(building.num_bedrooms ?? 0)) / Math.max(1, gia)
    case 'total_w':    return v / Math.max(1, gia)
    default:           return v
  }
}

/**
 * Per-hour fractional contribution for a gain whose `relationship_to_occupancy`
 * controls how its schedule derives.
 *
 * `presence` is the per-hour occupancy fraction (schedule × monthly multiplier,
 * BEFORE the building-level occupancy_rate scaling — that's threaded through
 * the explicit `occupancyRate` arg). Semantics by relationship:
 *
 *   independent           — Pure lighting schedule lookup. No occupancy
 *                           dependence at all. Use for timer-driven exterior
 *                           lighting or buildings where lights run regardless
 *                           of occupancy.
 *   always_on             — Constant 1.0.
 *   proportional          — Tracks occupancy presence × occupancy_rate. Use
 *                           for motion-sensor / detect-and-illuminate setups.
 *   proportional_with_spill (DEFAULT) — Lighting follows its own schedule for
 *                           time-of-day shape (so hotel-bedroom lights aren't
 *                           on at 90% overnight just because guests are
 *                           sleeping), scaled by occupancy_rate for building-
 *                           level occupancy. Daylight dimming during 9-16.
 *                           Matches BREDEM "lighting tracks design intent ×
 *                           building occupancy rate" model.
 */
function lightingFractionForHour(lighting, presence, hourOfDay, monthIdx, dayType, occupancySchedule, occupancyRate) {
  const rel = lighting?.relationship_to_occupancy ?? 'proportional_with_spill'
  if (rel === 'always_on') return 1.0
  if (rel === 'independent') {
    const s = lighting?.schedule ?? occupancySchedule
    const v = s?.[dayType]?.[hourOfDay] ?? 0
    const mm = s?.monthly_multipliers?.[monthIdx] ?? 1
    return v * mm
  }
  if (rel === 'proportional') {
    return presence * occupancyRate
  }
  // 'proportional_with_spill' — follow the lighting schedule for time pattern,
  // scaled by occupancy_rate for building-level occupancy. Daylight dimming
  // during 09:00–16:00 (brief specifies "60% factor reduces LPD by 40% in
  // daylight hours" — implemented as fraction × daylight_factor in window).
  // spill_minutes is captured at EP-schedule generation (Part 3); for the
  // hourly live engine, sub-hourly spill is implicit in the schedule shape.
  const s = lighting?.schedule ?? occupancySchedule
  const v = s?.[dayType]?.[hourOfDay] ?? 0
  const mm = s?.monthly_multipliers?.[monthIdx] ?? 1
  let frac = v * mm * occupancyRate
  const daylightFactor = lighting?.daylight_factor ?? 0.6
  if (hourOfDay >= 9 && hourOfDay <= 16 && daylightFactor < 1) {
    frac *= daylightFactor
  }
  return frac
}

function equipmentFractionForHour(equipment, presence, hourOfDay, monthIdx, dayType, occupancySchedule, occupancyRate) {
  const rel = equipment?.relationship_to_occupancy ?? 'proportional'
  if (rel === 'independent') {
    const s = equipment?.schedule ?? occupancySchedule
    const v = s?.[dayType]?.[hourOfDay] ?? 0
    const mm = s?.monthly_multipliers?.[monthIdx] ?? 1
    return v * mm
  }
  // 'proportional' — active equipment follows the equipment schedule × the
  // building-level occupancy_rate, with a standby floor. (Baseload is
  // separate — added at the call site as occupancy-independent 24/7 load.)
  const s = equipment?.schedule ?? occupancySchedule
  const v = s?.[dayType]?.[hourOfDay] ?? 0
  const mm = s?.monthly_multipliers?.[monthIdx] ?? 1
  const scheduledFraction = v * mm * occupancyRate
  const standby = equipment?.standby_factor ?? 0.10
  return Math.max(standby, scheduledFraction)
}

/**
 * Compute hourly internal gains for State 2. Returns Wh per hour
 * (= W since dt = 1 hr).
 *
 * Returns { people, lighting, equipment_baseload, equipment_active,
 *           equipment, total, presence, effective_occupants }.
 */
function computeHourlyGains(building, h, weatherData, gia) {
  const occ = building?.occupancy
  if (!occ) {
    return {
      people: 0, lighting: 0,
      equipment_baseload: 0, equipment_active: 0, equipment: 0,
      total: 0, presence: 0, effective_occupants: 0,
    }
  }

  const { monthIdx, dayType, hourOfDay, dateMMDD } = decomposeHour(h, weatherData)
  const sched = occ.schedule ?? {}
  const exc = findActiveException(sched.exceptions, dateMMDD)

  let presence
  if (exc) {
    presence = Number(exc[dayType]?.[hourOfDay] ?? 0)
    if (!exc.ignore_monthly_multipliers) {
      presence *= Number(sched.monthly_multipliers?.[monthIdx] ?? 1)
    }
  } else {
    presence = Number(sched[dayType]?.[hourOfDay] ?? 0)
              * Number(sched.monthly_multipliers?.[monthIdx] ?? 1)
  }

  const totalOccupantsAt100 = computeTotalOccupants(occ, building, gia)
  const occupancy_rate = Number(occ.occupancy_rate ?? 0.75)
  const effective_occupants = totalOccupantsAt100 * occupancy_rate * presence

  // People sensible heat (W = Wh in a 1-hour step)
  const sensible = Number(occ.sensible_w_per_person ?? 75)
  const Q_people = effective_occupants * sensible

  // ── Lighting — sum across profiles (v2.4 multi-profile) ─────────────────
  //
  // Each profile contributes (LPD × area_share × fraction) to the building-
  // averaged lighting load. fraction depends on the profile's
  // relationship_to_occupancy. profile.schedule carries its own exceptions
  // (independent mode) — proportional / proportional_with_spill cascade
  // from the OCCUPANCY schedule + presence value computed above.
  const lightingProfiles = building?.gains?.lighting?.profiles
  let Q_lighting = 0
  const lighting_per_profile = []
  if (Array.isArray(lightingProfiles)) {
    for (const profile of lightingProfiles) {
      const lpd = magnitudeToWPerM2(profile.magnitude, building, gia)
      const area_share = Number(profile.area_share ?? 1.0)
      // For 'independent' lighting profiles, the profile's own exception
      // calendar may differ from occupancy's — re-resolve here.
      let pFrac
      if (profile.relationship_to_occupancy === 'independent') {
        const pSched = profile.schedule ?? sched
        const pExc = findActiveException(pSched.exceptions, dateMMDD)
        if (pExc) {
          const v = Number(pExc[dayType]?.[hourOfDay] ?? 0)
          const mm = pExc.ignore_monthly_multipliers
            ? 1
            : Number(pSched.monthly_multipliers?.[monthIdx] ?? 1)
          pFrac = v * mm
        } else {
          pFrac = lightingFractionForHour(profile, presence, hourOfDay, monthIdx, dayType, sched, occupancy_rate)
        }
      } else {
        pFrac = lightingFractionForHour(profile, presence, hourOfDay, monthIdx, dayType, sched, occupancy_rate)
      }
      const Q = gia * lpd * area_share * pFrac
      Q_lighting += Q
      lighting_per_profile.push({ id: profile.id, value: Q, fraction: pFrac })
    }
  }

  // ── Equipment — sum across profiles, split baseload vs active ───────────
  //
  // baseload is occupancy-independent 24/7; active follows the relationship.
  // Each profile contributes baseload AND active scaled by its area_share.
  const equipmentProfiles = building?.gains?.equipment?.profiles
  let Q_equipment_baseload = 0
  let Q_equipment_active   = 0
  const equipment_per_profile = []
  if (Array.isArray(equipmentProfiles)) {
    for (const profile of equipmentProfiles) {
      const baseload_W = magnitudeToWPerM2(profile.baseload, building, gia)
      const active_W   = magnitudeToWPerM2(profile.active,   building, gia)
      const area_share = Number(profile.area_share ?? 1.0)
      let pFrac
      if (profile.relationship_to_occupancy === 'independent') {
        const pSched = profile.schedule ?? sched
        const pExc = findActiveException(pSched.exceptions, dateMMDD)
        if (pExc) {
          const v = Number(pExc[dayType]?.[hourOfDay] ?? 0)
          const mm = pExc.ignore_monthly_multipliers
            ? 1
            : Number(pSched.monthly_multipliers?.[monthIdx] ?? 1)
          pFrac = v * mm
        } else {
          pFrac = equipmentFractionForHour(profile, presence, hourOfDay, monthIdx, dayType, sched, occupancy_rate)
        }
      } else {
        pFrac = equipmentFractionForHour(profile, presence, hourOfDay, monthIdx, dayType, sched, occupancy_rate)
      }
      const Q_base = gia * baseload_W * area_share
      const Q_act  = gia * active_W   * area_share * pFrac
      Q_equipment_baseload += Q_base
      Q_equipment_active   += Q_act
      equipment_per_profile.push({
        id: profile.id,
        value:    Q_base + Q_act,
        baseload: Q_base,
        active:   Q_act,
        fraction: pFrac,
      })
    }
  }
  const Q_equipment = Q_equipment_baseload + Q_equipment_active

  return {
    people:             Q_people,
    lighting:           Q_lighting,
    equipment_baseload: Q_equipment_baseload,
    equipment_active:   Q_equipment_active,
    equipment:          Q_equipment,
    total:              Q_people + Q_lighting + Q_equipment,
    presence,
    effective_occupants,
    // v2.4 multi-profile breakdown — same numbers as the aggregates above,
    // sliced by profile id. Callers that need per-profile annual totals
    // accumulate from these arrays.
    lighting_per_profile,
    equipment_per_profile,
  }
}

// Export the gain helpers so test scripts and the State 2 UI can use them
// without re-implementing the contract logic.
export {
  computeHourlyGains,
  decomposeHour,
  findActiveException,
  computeTotalOccupants,
}

/**
 * State 2 envelope + internal gains computation per `docs/state_contracts.md`
 * § State 2 (v2.3).
 *
 * Brief 27 Part 2. Runs the same physics as State 1 (two-node lumped
 * capacitance, shading-aware solar, etc.) with internal gains added to
 * the energy balance on the T_mass node alongside solar. Returns the
 * State 2 contract output shape including `state1_delta` and
 * `occupancy_summary`.
 *
 * Implementation: calls `_calculateEnvelopeOnly` first to get the
 * canonical State 1 baseline (with State 1 input filter via withMode so
 * no gain inputs leak), then runs an INDEPENDENT 8760-hour loop with
 * gains added. Two parallel runs intentionally — the only difference
 * is Q_gains. state1_delta = state2_metrics − state1_metrics.
 */
function _calculateState2(building, constructions, libraryData, weatherData, hourlySolar, comfortBand) {
  // ── State 1 baseline ─────────────────────────────────────────────────────
  // The State 1 path uses withMode('envelope-only') internally to strip
  // forbidden inputs; doing it here too means our state1Result is
  // byte-identical to what `mode='envelope-only'` would return for this
  // building.
  const state1Result = _calculateEnvelopeOnly(
    withMode(building, 'envelope-only'),
    constructions, libraryData, weatherData, hourlySolar, comfortBand,
  )
  if (state1Result.state !== 1) return state1Result   // bailout: _empty() or similar

  // ── State 2 inner loop (clone of State 1 with gains added) ───────────────
  const geo = computeGeometry(building)
  const { gia, volume, total_wall_opaque, total_glazing, glazing, roof_area, ground_area } = geo
  if (gia <= 0) return state1Result

  const u_wall  = getUValue(constructions, 'external_wall', libraryData)
  const u_roof  = getUValue(constructions, 'roof',          libraryData)
  const u_floor = getUValue(constructions, 'ground_floor',  libraryData)
  const u_glaz  = getUValue(constructions, 'glazing',       libraryData)
  const g_value = getGValue(constructions, libraryData)
  const FRAME_FRACTION = 0.20
  const shadingFactors = computeShadingFactors(building)
  const UA_fabric = u_wall*total_wall_opaque + u_roof*roof_area + u_floor*ground_area + u_glaz*total_glazing
  const ach = Number(building.infiltration_ach ?? 0.5)
  const UA_leakage = AIR_HEAT_CAPACITY * ach * volume
  const openings = building.openings ?? {}
  const Cd = 0.6
  const Cw = ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })[openings.site_exposure] ?? 0.10
  const sqrtCw = Math.sqrt(Cw)
  const louvre_area_total = ['north','south','east','west']
    .reduce((s, f) => s + Number(openings?.[f]?.louvre_area_m2 ?? 0), 0)
  const cmass = resolveCmass(building, constructions, libraryData)
  const C_mass_Wh = cmass.C_mass_Wh
  const A_internal_surface = roof_area + ground_area + total_wall_opaque
  const h_am_total = 4.5 * A_internal_surface

  const n = weatherData.temperature.length
  const T_hourly = new Float32Array(n)
  let T_mass = comfortBand.lower_c
  let T_air  = comfortBand.lower_c

  // State 2 accumulators (Wh per year)
  let acc_people = 0, acc_lighting = 0
  let acc_equip_baseload = 0, acc_equip_active = 0
  let peak_people = 0, peak_lighting = 0, peak_equipment = 0
  let hours_people = 0, hours_lighting = 0, hours_equipment_active = 0
  let sum_effective_occupants = 0, peak_occupants = 0

  // v2.4 per-profile accumulators — keyed by profile.id. Each entry tracks
  // { kwh, peak_kw, hours_active, baseload_kwh, active_kwh (equipment only) }.
  // Built up incrementally during the 8,760-hour loop from the per-profile
  // breakdown computeHourlyGains now returns.
  const lightingProfileAccum = new Map()  // id → { acc_wh, peak_w, hours }
  const equipmentProfileAccum = new Map()  // id → { acc_wh, peak_w, hours, base_wh, active_wh }

  function accumLighting(id, value_w) {
    let a = lightingProfileAccum.get(id)
    if (!a) { a = { acc_wh: 0, peak_w: 0, hours: 0 }; lightingProfileAccum.set(id, a) }
    a.acc_wh += value_w
    if (value_w > a.peak_w) a.peak_w = value_w
    if (value_w > 0.01) a.hours++
  }
  function accumEquipment(id, total_w, base_w, active_w) {
    let a = equipmentProfileAccum.get(id)
    if (!a) { a = { acc_wh: 0, peak_w: 0, hours: 0, base_wh: 0, active_wh: 0 }; equipmentProfileAccum.set(id, a) }
    a.acc_wh    += total_w
    a.base_wh   += base_w
    a.active_wh += active_w
    if (total_w > a.peak_w) a.peak_w = total_w
    if (active_w > 0.01) a.hours++
  }

  // Plus a slim set of State 2 demand/comfort accumulators (same shape as
  // State 1 but recomputed with gains in the energy balance — that's the
  // whole point of running the loop again).
  let acc_heating_demand_Wh = 0, acc_cooling_demand_Wh = 0
  let underheating_hours = 0, overheating_hours = 0, comfort_hours = 0
  let T_winter_min = Infinity, T_summer_max = -Infinity

  for (let h = 0; h < n; h++) {
    const T_out = weatherData.temperature[h]
    const v_wind = weatherData.wind_speed?.[h] ?? 0

    const sol_n = hourlySolar.f1[h] * (glazing.north ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.north
    const sol_e = hourlySolar.f2[h] * (glazing.east  ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.east
    const sol_s = hourlySolar.f3[h] * (glazing.south ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.south
    const sol_w = hourlySolar.f4[h] * (glazing.west  ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.west
    const sol_roof = hourlySolar.roof[h] * roof_area * 0.05
    const Q_solar_in_Wh = sol_n + sol_e + sol_s + sol_w + sol_roof

    // ── Internal gains for this hour (the State 2 addition) ─────────────────
    const gains = computeHourlyGains(building, h, weatherData, gia)
    acc_people    += gains.people
    acc_lighting  += gains.lighting
    acc_equip_baseload += gains.equipment_baseload
    acc_equip_active   += gains.equipment_active
    if (gains.people    > peak_people)    peak_people    = gains.people
    if (gains.lighting  > peak_lighting)  peak_lighting  = gains.lighting
    if (gains.equipment > peak_equipment) peak_equipment = gains.equipment
    if (gains.people    > 0.01) hours_people++
    if (gains.lighting  > 0.01) hours_lighting++
    if (gains.equipment_active > 0.01) hours_equipment_active++
    sum_effective_occupants += gains.effective_occupants
    if (gains.effective_occupants > peak_occupants) peak_occupants = gains.effective_occupants
    // v2.4 per-profile accumulators
    if (gains.lighting_per_profile) {
      for (const p of gains.lighting_per_profile) accumLighting(p.id, p.value)
    }
    if (gains.equipment_per_profile) {
      for (const p of gains.equipment_per_profile) accumEquipment(p.id, p.value, p.baseload, p.active)
    }

    const Q_louvre_m3s = Cd * louvre_area_total * sqrtCw * v_wind
    const UA_permanent = AIR_HEAT_CAPACITY * (Q_louvre_m3s * 3600)
    const UA_total = UA_fabric + UA_leakage + UA_permanent

    // Two-node step — gains land on T_mass alongside solar (radiant/long-wave
    // absorption simplification matching the State 1 convention).
    T_air = (h_am_total * T_mass + UA_total * T_out) / (h_am_total + UA_total)
    const Q_mass_to_air = h_am_total * (T_mass - T_air)
    const Q_to_mass = Q_solar_in_Wh + gains.total
    const Q_mass_net = Q_to_mass - Q_mass_to_air
    T_mass = T_mass + Q_mass_net / C_mass_Wh
    if (T_mass < -20) T_mass = -20
    if (T_mass > 60)  T_mass = 60
    const T_op = 0.5 * (T_air + T_mass)
    T_hourly[h] = T_op

    const month = weatherData.month[h]
    if (T_op < comfortBand.lower_c)      underheating_hours++
    else if (T_op > comfortBand.upper_c) overheating_hours++
    else                                  comfort_hours++
    if (month >= 12 || month <= 2) T_winter_min = Math.min(T_winter_min, T_op)
    if (month >= 6  && month <= 8) T_summer_max = Math.max(T_summer_max, T_op)

    if (T_op < comfortBand.lower_c) {
      // Heating demand: deficit at the lower bound, minus the gain energy
      // already injected into the zone this hour (solar + internal gains
      // both offset heating demand).
      const Q_loss_at_lower = UA_total * Math.max(0, comfortBand.lower_c - T_out)
      const heating_Wh = Math.max(0, Q_loss_at_lower - Q_to_mass)
      acc_heating_demand_Wh += heating_Wh
    } else if (T_op > comfortBand.upper_c) {
      // Cooling: gain energy plus heat coming IN from outside (if T_out > upper)
      const Q_gain_at_upper = Q_to_mass + UA_total * Math.max(0, T_out - comfortBand.upper_c)
      acc_cooling_demand_Wh += Q_gain_at_upper
    }
  }

  const r1 = (Wh) => Math.round(Wh / 1000 * 10) / 10
  const T_mean = T_hourly.reduce((s, v) => s + v, 0) / n
  const totalEquipmentWh = acc_equip_baseload + acc_equip_active

  // v2.4 effective LPD = sum across lighting profiles of (LPD × area_share).
  // Built from the LIVE building config (not the accumulator) so it's the
  // user-stated effective LPD, not a back-derived value.
  const lightingProfiles = building?.gains?.lighting?.profiles ?? []
  const effective_lpd = lightingProfiles.reduce((s, p) => {
    const lpd = magnitudeToWPerM2(p.magnitude, building, gia)
    return s + lpd * Number(p.area_share ?? 1.0)
  }, 0)

  // v2.4 per-profile output arrays, ordered by the input profiles[] index so
  // the UI can render rows in the same order the user authored them.
  const lighting_profiles_out = lightingProfiles.map(p => {
    const a = lightingProfileAccum.get(p.id) ?? { acc_wh: 0, peak_w: 0, hours: 0 }
    return {
      id:           p.id,
      label:        p.label ?? p.id,
      kwh:          r1(a.acc_wh),
      peak_kw:      Math.round(a.peak_w) / 1000,
      hours_active: a.hours,
    }
  })
  const equipmentProfiles = building?.gains?.equipment?.profiles ?? []
  const equipment_profiles_out = equipmentProfiles.map(p => {
    const a = equipmentProfileAccum.get(p.id) ?? { acc_wh: 0, peak_w: 0, hours: 0, base_wh: 0, active_wh: 0 }
    return {
      id:           p.id,
      label:        p.label ?? p.id,
      kwh:          r1(a.acc_wh),
      peak_kw:      Math.round(a.peak_w) / 1000,
      baseload_kwh: r1(a.base_wh),
      active_kwh:   r1(a.active_wh),
      hours_active: a.hours,
    }
  })

  // ── State 1 → State 2 delta ──────────────────────────────────────────────
  const s1d = state1Result.demand ?? {}
  const s1fr = state1Result.free_running ?? {}
  const heating_change_mwh = Math.round((acc_heating_demand_Wh / 1_000_000 - (s1d.heating_demand_mwh ?? 0)) * 10) / 10
  const cooling_change_mwh = Math.round((acc_cooling_demand_Wh / 1_000_000 - (s1d.cooling_demand_mwh ?? 0)) * 10) / 10
  const overheating_change = overheating_hours - (s1d.overheating_hours ?? 0)
  const comfort_change     = comfort_hours    - (s1d.comfort_hours    ?? 0)
  const T_mean_change      = Math.round((T_mean - (s1fr.annual_mean_c ?? 0)) * 10) / 10

  return {
    state: 2,
    mode: 'envelope-gains',
    inputs_used: [
      ...(state1Result.inputs_used ?? []),
      'occupancy.density', 'occupancy.occupancy_rate', 'occupancy.sensible_w_per_person',
      'occupancy.schedule', 'occupancy.schedule.exceptions',
      // v2.4 multi-profile paths
      'gains.lighting.profiles[*].magnitude',
      'gains.lighting.profiles[*].relationship_to_occupancy',
      'gains.lighting.profiles[*].spill_minutes',
      'gains.lighting.profiles[*].daylight_factor',
      'gains.lighting.profiles[*].area_share',
      'gains.lighting.profiles[*].schedule',
      'gains.equipment.profiles[*].baseload',
      'gains.equipment.profiles[*].active',
      'gains.equipment.profiles[*].relationship_to_occupancy',
      'gains.equipment.profiles[*].standby_factor',
      'gains.equipment.profiles[*].area_share',
      'gains.equipment.profiles[*].schedule',
    ],
    comfort_band_used: { lower_c: comfortBand.lower_c, upper_c: comfortBand.upper_c },

    gains: {
      ...state1Result.gains,
      people: {
        sensible_kwh:  r1(acc_people),
        latent_kwh:    0,   // State 2 dry-bulb balance ignores latent for now
        total_kwh:     r1(acc_people),
        peak_kw:       Math.round(peak_people) / 1000,
        hours_active:  hours_people,
      },
      // v2.4 lighting output shape: profiles[] + aggregates.
      lighting: {
        profiles:               lighting_profiles_out,
        total_kwh:              r1(acc_lighting),
        total_peak_kw:          Math.round(peak_lighting) / 1000,
        effective_lpd_w_per_m2: Math.round(effective_lpd * 100) / 100,
        total_hours_active:     hours_lighting,
      },
      // v2.4 equipment output shape: profiles[] + aggregates with split.
      equipment: {
        profiles:            equipment_profiles_out,
        total_kwh:           r1(totalEquipmentWh),
        total_peak_kw:       Math.round(peak_equipment) / 1000,
        total_baseload_kwh:  r1(acc_equip_baseload),
        total_active_kwh:    r1(acc_equip_active),
        total_hours_active:  hours_equipment_active,
      },
    },
    // State 2 keeps the State 1 losses unchanged (gains don't change fabric
    // UA × dT; the only change is the temperature trace which is captured in
    // free_running below).
    losses: state1Result.losses,
    free_running: {
      annual_mean_c: Math.round(T_mean * 10) / 10,
      winter_min_c:  isFinite(T_winter_min) ? Math.round(T_winter_min * 10) / 10 : null,
      summer_max_c:  isFinite(T_summer_max) ? Math.round(T_summer_max * 10) / 10 : null,
      hourly_temperature_c: T_hourly,
    },
    demand: {
      heating_demand_mwh: Math.round(acc_heating_demand_Wh / 1_000_000 * 10) / 10,
      cooling_demand_mwh: Math.round(acc_cooling_demand_Wh / 1_000_000 * 10) / 10,
      underheating_hours,
      overheating_hours,
      comfort_hours,
    },
    state1_delta: {
      heating_demand_change_mwh:               heating_change_mwh,
      cooling_demand_change_mwh:               cooling_change_mwh,
      overheating_hours_change:                overheating_change,
      comfort_hours_change:                    comfort_change,
      free_running_temp_change_annual_mean_c:  T_mean_change,
    },
    occupancy_summary: {
      average_occupants:       Math.round(sum_effective_occupants / n * 10) / 10,
      peak_occupants:          Math.round(peak_occupants * 10) / 10,
      annual_occupant_hours:   Math.round(sum_effective_occupants),
    },
    // Mirror the state1 heat_balance shape so the existing HeatBalance
    // component renders State 2 without further changes. The losses block
    // is identical to State 1; the gains block adds people/lighting/equipment
    // nested under .internal (the consumer's flattenGains in HeatBalance.jsx
    // looks for `gains.internal.{people,equipment,lighting}` -- placing them
    // directly under `gains.*` caused them to render empty. Brief 27 cleanup
    // Part 3 (2026-05-14) corrected this.) Solar stays at gains.solar.
    heat_balance: {
      ...state1Result.heat_balance,
      annual: {
        ...state1Result.heat_balance.annual,
        gains: {
          ...state1Result.heat_balance.annual.gains,
          internal: {
            people:    { kwh: r1(acc_people),    kwh_per_m2: Math.round(acc_people / 1000 / gia * 100) / 100 },
            lighting:  { kwh: r1(acc_lighting),  kwh_per_m2: Math.round(acc_lighting / 1000 / gia * 100) / 100 },
            equipment: { kwh: r1(totalEquipmentWh), kwh_per_m2: Math.round(totalEquipmentWh / 1000 / gia * 100) / 100 },
          },
        },
        // Update totals to include internal gains (was solar-only when
        // people/lighting/equipment were placed at gains.* directly).
        totals: {
          losses_kwh:         state1Result.heat_balance.annual.totals.losses_kwh,
          losses_kwh_per_m2:  state1Result.heat_balance.annual.totals.losses_kwh_per_m2,
          gains_kwh:          r1((state1Result.heat_balance.annual.totals.gains_kwh ?? 0) * 1000 + acc_people + acc_lighting + totalEquipmentWh),
          gains_kwh_per_m2:   Math.round(((state1Result.heat_balance.annual.totals.gains_kwh ?? 0) + (acc_people + acc_lighting + totalEquipmentWh) / 1000) / gia * 100) / 100,
        },
      },
      demand: {
        heating_demand_mwh: Math.round(acc_heating_demand_Wh / 1_000_000 * 10) / 10,
        cooling_demand_mwh: Math.round(acc_cooling_demand_Wh / 1_000_000 * 10) / 10,
        underheating_hours,
        overheating_hours,
        comfort_hours,
      },
      free_running: {
        annual_mean_c: Math.round(T_mean * 10) / 10,
        winter_min_c:  isFinite(T_winter_min) ? Math.round(T_winter_min * 10) / 10 : null,
        summer_max_c:  isFinite(T_summer_max) ? Math.round(T_summer_max * 10) / 10 : null,
      },
    },
  }
}

// ── U-value lookup ────────────────────────────────────────────────────────────

const DEFAULT_U_VALUES = {
  external_wall:  0.28,
  roof:           0.18,
  ground_floor:   0.22,
  glazing:        1.4,
}

function getUValue(constructionChoices, element, libraryData) {
  const name = constructionChoices?.[element]
  if (name && libraryData?.constructions) {
    const item = libraryData.constructions.find(c => c.name === name)
    if (item?.u_value_W_per_m2K != null) {
      // Apply thermal-bridging Y-factor if the library item has one. This
      // makes the live engine consistent with the BR443/SAP/Passivhaus
      // convention of uplifting U to account for 2-D heat flow at junctions.
      // EnergyPlus 1-D conduction can't see junctions, so the simulation
      // run uses the centre-of-element U — the resulting drill-down
      // divergence is the bridging contribution made visible.
      const u_centre = Number(item.u_value_W_per_m2K)
      const y = Number(item.y_factor ?? 1.0)
      return u_centre * (isFinite(y) && y > 0 ? y : 1.0)
    }
  }
  return DEFAULT_U_VALUES[element] ?? 1.0
}

// ── Hotel schedule fractions (simplified for hourly instant calc) ──────────────

/** Fraction of max occupancy for a hotel bedroom at each hour of day (0-23) */
function hotelOccupancyFraction(hour) {
  if (hour >= 22 || hour < 7)  return 0.85  // overnight — rooms occupied
  if (hour >= 10 && hour < 16) return 0.15  // midday — rooms empty
  return 0.45                                 // morning/evening transition
}

/** Fraction of installed lighting power in use at each hour of day */
function hotelLightingFraction(hour) {
  if (hour >= 22 || hour < 7)  return 0.40  // nightlights + corridor only
  if (hour >= 9  && hour < 18) return 0.55  // daytime — natural light supplement
  return 0.85                                 // evening — full occupancy lighting
}

/** Fraction of installed equipment power in use at each hour of day */
function hotelEquipmentFraction(hour) {
  if (hour >= 22 || hour < 7)  return 0.50  // TVs standby/sleep
  if (hour >= 10 && hour < 16) return 0.20  // low room occupancy
  return 0.70                                 // morning/evening peak
}

// ── Degree-day steady-state calc (fallback) ───────────────────────────────────

/**
 * Calculate simplified annual energy using degree-day steady-state method.
 * Used as fallback when EPW weather data is not yet loaded.
 *
 * @param {object} building     — ProjectContext building_config
 * @param {object} constructions — ProjectContext construction_choices
 * @param {object} systems      — ProjectContext systems_config
 * @param {object} libraryData  — { constructions: [...] } from library API
 * @returns {object} Energy breakdown in kWh (see below)
 */
export function calculateInstantDegreeDay(building = {}, constructions = {}, systems = {}, libraryData = {}) {
  const geo = computeGeometry(building)
  const { gia, volume, total_wall_opaque, total_glazing, glazing, roof_area, ground_area } = geo

  if (gia <= 0) return _empty()

  // ── U-values ─────────────────────────────────────────────────────────────
  const u_wall  = getUValue(constructions, 'external_wall', libraryData)
  const u_roof  = getUValue(constructions, 'roof',          libraryData)
  const u_floor = getUValue(constructions, 'ground_floor',  libraryData)
  const u_glaz  = getUValue(constructions, 'glazing',       libraryData)

  // ── Fabric heat losses (Q = U × A × HDD × 24 / 1000 kWh) ────────────────
  const walls_kWh       = u_wall  * total_wall_opaque * UK_HDD * 24 / 1000
  const roof_kWh        = u_roof  * roof_area         * UK_HDD * 24 / 1000
  const floor_kWh       = u_floor * ground_area       * UK_HDD * 24 / 1000
  const glazing_kWh     = u_glaz  * total_glazing     * UK_HDD * 24 / 1000
  const total_fabric    = walls_kWh + roof_kWh + floor_kWh + glazing_kWh

  // ── Infiltration heat loss ────────────────────────────────────────────────
  const ach = Number(building.infiltration_ach ?? 0.5)
  const infiltration_kWh = AIR_HEAT_CAPACITY * ach * volume * UK_HDD * 24 / 1000

  // ── Ventilation heat loss (demand-based) ─────────────────────────────────
  const vent_sys_key  = systems.ventilation?.primary?.system ?? systems.ventilation_type ?? 'mev_standard'
  const ventDef       = sysDefaults(vent_sys_key)
  const is_mvhr       = ventDef.hre != null ? ventDef.hre > 0 : vent_sys_key.startsWith('mvhr')
  // Efficiency override is a percentage (0-100), convert to fraction
  const hre_fraction  = systems.ventilation?.primary?.efficiency_override != null
    ? systems.ventilation.primary.efficiency_override / 100
    : (ventDef.hre ?? (is_mvhr ? 0.82 : 0.0))
  const vent_ach      = 0.5   // Design ventilation rate (typical hotel)
  const heat_recovery = hre_fraction
  const vent_kWh      = AIR_HEAT_CAPACITY * vent_ach * volume * UK_HDD * 24 / 1000 * (1 - heat_recovery)
  // SFP override (flat key used by ventilation SFP slider in UI)
  const sfp_override  = systems.sfp_override

  // ── Solar gains (orientation-aware) — all values in kWh ─────────────────
  // IMPORTANT: do NOT divide by 1000 here — keep in kWh so units match
  // internal gains and fabric losses for the heat balance calculation.
  // Division to MWh happens only in the gains_losses display output below.
  const orientation = Number(building.orientation ?? 0)
  const g_value = getGValue(constructions, libraryData)
  const sf = computeShadingFactors(building)
  const solar_gains = {
    north: glazing.north * getSolarRadiation('north', orientation) * g_value * sf.north,
    south: glazing.south * getSolarRadiation('south', orientation) * g_value * sf.south,
    east:  glazing.east  * getSolarRadiation('east',  orientation) * g_value * sf.east,
    west:  glazing.west  * getSolarRadiation('west',  orientation) * g_value * sf.west,
  }

  // ── Sol-air opaque conduction gains (kWh) ─────────────────────────────────
  // Fraction of incident solar on opaque wall that conducts through as internal gain
  const OPAQUE_GAIN_FRACTION = 0.04   // ~4% of incident irradiance per CIBSE simplified
  const UK_HORIZONTAL_SOLAR  = 950    // kWh/m²/yr (horizontal irradiance, UK average)
  const wall_op = geo.wall_opaque     // { north, south, east, west } in m²
  const opaque_wall_solar = {
    north: getSolarRadiation('north', orientation) * (wall_op.north ?? 0) * OPAQUE_GAIN_FRACTION,
    south: getSolarRadiation('south', orientation) * (wall_op.south ?? 0) * OPAQUE_GAIN_FRACTION,
    east:  getSolarRadiation('east',  orientation) * (wall_op.east  ?? 0) * OPAQUE_GAIN_FRACTION,
    west:  getSolarRadiation('west',  orientation) * (wall_op.west  ?? 0) * OPAQUE_GAIN_FRACTION,
  }
  const opaque_wall_total = Object.values(opaque_wall_solar).reduce((a, b) => a + b, 0)
  const roof_solar_kWh = UK_HORIZONTAL_SOLAR * roof_area * OPAQUE_GAIN_FRACTION

  const total_solar = Object.values(solar_gains).reduce((a, b) => a + b, 0) + opaque_wall_total + roof_solar_kWh

  // ── Occupancy ─────────────────────────────────────────────────────────────
  const num_bedrooms    = Number(building.num_bedrooms    ?? 138)
  const occupancy_rate  = Math.max(0, Math.min(1, Number(building.occupancy_rate  ?? 0.75)))
  const people_per_room = Number(building.people_per_room ?? 1.5)
  const avg_occupants   = num_bedrooms * occupancy_rate * people_per_room

  // ── Internal gains ────────────────────────────────────────────────────────
  const lpd_raw = Number(systems.lighting_power_density ?? 8)   // W/m²
  const lpd = lpd_raw * lightingControlFactor(systems.lighting_control)
  const epd = Number(systems.equipment_power_density ?? 10) // W/m² (CIBSE hotel bedroom)
  const OCC_WATTS = 60  // W/person (metabolic)
  // Lighting: area-based (corridors, public areas always lit regardless of occupancy)
  const lighting_internal = lpd * gia * HOTEL_OPERATING_HOURS / 1000
  // Equipment: scales with occupancy — more rooms occupied = more TVs, chargers running
  const equip_internal    = epd * gia * HOTEL_EQUIP_HOURS * occupancy_rate / 1000
  // People: occupant count directly from occupancy inputs
  const people_internal   = OCC_WATTS * avg_occupants * HOTEL_OCCUPIED_FRACTION * HOTEL_EQUIP_HOURS / 1000
  const total_internal    = lighting_internal + equip_internal + people_internal

  // ── Heating demand ────────────────────────────────────────────────────────
  const heat_losses = total_fabric + infiltration_kWh + vent_kWh
  const heat_gains  = total_solar + total_internal
  // Utilisation factor — not all gains reduce heating demand (summer gains don't help winter heating).
  // 0.60 chosen for a 24-hour hotel: gains occur throughout the day but heating peaks in early
  // morning; less of the gain is temporally coincident with the heating need vs an office building.
  // EnergyPlus consistently shows positive heating for MVHR hotels; 0.75 was too generous.
  const util_factor = 0.60
  const heating_thermal = Math.max(0, heat_losses - heat_gains * util_factor)

  // ── Space heating — demand-based system assignment ────────────────────────
  const sh_primary    = systems.space_heating?.primary
  const sh_sys_key    = sh_primary?.system ?? systems.hvac_type ?? 'vrf_standard'
  const shDef         = sysDefaults(sh_sys_key)
  const sh_eff        = sh_primary?.efficiency_override ?? shDef.eff ?? 3.5
  const sh_secondary  = systems.space_heating?.secondary
  const sh_sec_key    = sh_secondary?.system
  const shSecDef      = sh_sec_key ? sysDefaults(sh_sec_key) : null
  const sh_sec_eff    = sh_secondary?.efficiency_override ?? shSecDef?.eff ?? 1.0
  const sh_prim_share = sh_secondary ? (1 - (sh_secondary.share ?? 0)) : 1.0
  const sh_sec_share  = sh_secondary?.share ?? 0

  let heating_electricity = 0
  let heating_gas         = 0
  // Primary system
  if (shDef.fuel === 'gas') {
    heating_gas += heating_thermal * sh_prim_share / sh_eff
  } else if (shDef.fuel === 'electricity') {
    heating_electricity += heating_thermal * sh_prim_share / sh_eff
  }
  // Secondary (bivalent) — e.g. ASHP primary + gas boiler backup
  if (shSecDef && sh_sec_share > 0) {
    if (shSecDef.fuel === 'gas') {
      heating_gas += heating_thermal * sh_sec_share / sh_sec_eff
    } else if (shSecDef.fuel === 'electricity') {
      heating_electricity += heating_thermal * sh_sec_share / sh_sec_eff
    }
  }
  const cop_heating = sh_eff  // backward-compat alias for _inputs

  // ── Cooling demand — demand-based system assignment ───────────────────────
  const sc_primary  = systems.space_cooling?.primary
  const sc_sys_key  = sc_primary?.system ?? systems.hvac_type ?? 'vrf_standard'
  const scDef       = sysDefaults(sc_sys_key)
  const sc_eer_val  = sc_primary?.efficiency_override ?? scDef.eer ?? 3.2
  const sc_is_none  = sc_sys_key === 'none_cooling' || scDef.fuel === null

  // Simplified: excess solar + internal gains in summer, minus natural cooling effect
  const COOLING_GAIN_FRACTION = 0.25  // ~25% of gains become cooling load (UK climate)
  const cooling_thermal = Math.max(0, (total_solar + total_internal) * COOLING_GAIN_FRACTION - UK_CDD * gia * 0.001)
  const cop_cooling = sc_eer_val  // backward-compat alias for _inputs
  const cooling_electricity = sc_is_none ? 0 : cooling_thermal / (sc_eer_val || 1)

  // ── Lighting annual ───────────────────────────────────────────────────────
  const lighting_kWh = lpd * gia * HOTEL_OPERATING_HOURS / 1000

  // ── Equipment annual ──────────────────────────────────────────────────────
  const equipment_kWh = epd * gia * HOTEL_EQUIP_HOURS / 1000

  // ── Fan energy ────────────────────────────────────────────────────────────
  // VRF fans + ventilation fans
  const vrf_fan_sfp = 0.5       // W/(L/s) — VRF fan coil SFP
  // Use SFP override from UI slider if set, otherwise library default
  const vent_sfp    = sfp_override != null ? sfp_override : (is_mvhr ? 1.2 : 0.8)
  const q_vent_ls   = vent_ach * volume / 3.6  // L/s ventilation flow
  const vrf_fans_kWh  = vrf_fan_sfp  * (gia / 10) * HOTEL_OPERATING_HOURS / 1000
  const vent_fans_kWh = vent_sfp * q_vent_ls * HOTEL_OPERATING_HOURS / 1000
  const fans_kWh = vrf_fans_kWh + vent_fans_kWh

  // ── DHW energy ────────────────────────────────────────────────────────────
  // Occupant-based DHW — scales with actual occupants rather than area.
  // Calibrated against CIBSE Guide F area benchmark (1.1 L/m²/day):
  //   at default occupancy (155 people, 3750m² GIA) → 1.1×3750/155 ≈ 26.6 L/person/day
  const DHW_L_PER_PERSON_DAY = 26.6
  const daily_vol   = DHW_L_PER_PERSON_DAY * Math.max(1, avg_occupants)
  const dhw_thermal = daily_vol * 365 * WATER_SHC * (DHW_SETPOINT - DHW_COLD_TEMP)
  // ── DHW energy — demand-based system assignment ───────────────────────────
  const dhw_prim_slot  = systems.dhw?.primary
  const dhw_sec_slot   = systems.dhw?.secondary
  // Fall back to legacy flat keys if demand slots not set
  const dhw_prim_key   = dhw_prim_slot?.system  ?? systems.dhw_primary ?? 'gas_boiler_dhw'
  const _dhw_legacy_sec = (systems.dhw_preheat && systems.dhw_preheat !== 'none') ? systems.dhw_preheat : null
  const dhw_sec_key    = dhw_sec_slot?.system ?? _dhw_legacy_sec
  const dhwPrimDef     = sysDefaults(dhw_prim_key)
  const dhwSecDef      = dhw_sec_key ? sysDefaults(dhw_sec_key) : null

  const dhw_prim_eff   = dhw_prim_slot?.efficiency_override ?? dhwPrimDef.eff ?? 0.92
  const dhw_sec_eff    = dhw_sec_slot?.efficiency_override  ?? dhwSecDef?.eff ?? 2.8
  const dhw_prim_share = dhw_prim_slot?.share ?? (dhwSecDef ? 0.3 : 1.0)
  const dhw_sec_share  = dhw_sec_slot?.share  ?? (dhwSecDef ? 0.7 : 0.0)

  let dhw_gas_kWh  = 0
  let dhw_elec_kWh = 0

  // Primary DHW system
  if (dhwPrimDef.fuel === 'gas') {
    dhw_gas_kWh  += dhw_thermal * dhw_prim_share / (dhw_prim_eff || 1)
  } else if (dhwPrimDef.fuel === 'electricity') {
    dhw_elec_kWh += dhw_thermal * dhw_prim_share / (dhw_prim_eff || 1)
  }
  // Secondary DHW system (preheat, solar thermal, etc.)
  if (dhwSecDef && dhw_sec_share > 0) {
    if (dhwSecDef.fuel === 'gas') {
      dhw_gas_kWh  += dhw_thermal * dhw_sec_share / (dhw_sec_eff || 1)
    } else if (dhwSecDef.fuel === 'electricity') {
      dhw_elec_kWh += dhw_thermal * dhw_sec_share / (dhw_sec_eff || 1)
    }
    // renewable (solar_thermal_dhw): no grid energy counted — thermal demand just met
  }

  // Backward-compat aliases used by Sankey section below
  const dhw_primary = dhw_prim_key
  const dhw_preheat = dhw_sec_key ?? 'none'
  const boiler_eff  = dhw_prim_eff
  const ashp_cop    = dhw_sec_eff

  // ── Totals and fuel split ─────────────────────────────────────────────────
  const electricity_kWh = heating_electricity + cooling_electricity + lighting_kWh + equipment_kWh + fans_kWh + dhw_elec_kWh
  const gas_kWh         = dhw_gas_kWh + heating_gas
  const total_kWh       = electricity_kWh + gas_kWh
  const eui_kWh_m2      = gia > 0 ? total_kWh / gia : 0

  // ── Carbon (2026 grid) ────────────────────────────────────────────────────
  const carbon_kgCO2_m2 = (electricity_kWh * GRID_INTENSITY_2026 + gas_kWh * GAS_CARBON_KG_KWH) / gia

  // ── Systems flow data model (auto-generated Sankey) ──────────────────────
  const eer             = sc_eer_val
  const heat_rejected_kWh = (!sc_is_none && cooling_thermal > 0) ? cooling_thermal * (1 + 1 / (eer || 1)) : 0
  const vent_kWh_no_recovery = AIR_HEAT_CAPACITY * vent_ach * volume * UK_HDD * 24 / 1000
  const mvhr_recovery_kWh   = is_mvhr ? vent_kWh_no_recovery - vent_kWh : 0

  // Flue losses — gas boilers only (gas_input × (1 − efficiency))
  const heating_flue_kWh = (shDef.fuel === 'gas' && heating_gas > 0) ? heating_gas * (1 - sh_eff) : 0
  const dhw_flue_kWh     = (dhwPrimDef.fuel === 'gas' && dhw_gas_kWh > 0) ? dhw_gas_kWh * (1 - dhw_prim_eff) : 0

  // ── Node ID naming ────────────────────────────────────────────────────────
  // Prefixed IDs let the Sankey component resolve which demand accordion to open.
  // sh_ sc_ dhw_ dhw_sec_ vent_ prefixes are parsed in SystemSankey.jsx.
  const same_hvac    = !sc_is_none && sh_sys_key === sc_sys_key  // combined H+C (e.g. VRF)
  const sh_node_id   = `sh_${sh_sys_key}`
  const sc_node_id   = same_hvac ? null : (sc_is_none ? null : `sc_${sc_sys_key}`)
  const vent_node_id = `vent_${vent_sys_key}`
  const dhw_node_id  = `dhw_${dhw_prim_key}`
  const dhw_sec_node_id = (dhwSecDef && dhw_sec_share > 0) ? `dhw_sec_${dhw_sec_key}` : null

  const _addLink = (links, source, target, value_kWh, style) => {
    if (value_kWh > 0 && source && target)
      links.push({ source, target, value_kWh: Math.round(value_kWh), style })
  }
  const _sysLabel = key => key?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? 'System'

  const sf_nodes = []
  const sf_links = []

  // ── Source nodes ──────────────────────────────────────────────────────────
  if (electricity_kWh > 0) sf_nodes.push({ id: 'grid', label: 'Grid Electricity', type: 'source' })
  if (gas_kWh > 0)          sf_nodes.push({ id: 'gas',  label: 'Natural Gas',       type: 'source' })

  // ── Space heating / conditioning system node ──────────────────────────────
  if (heating_thermal > 0 || heating_electricity > 0 || heating_gas > 0) {
    const sh_metric = shDef.fuel === 'gas'
      ? `${Math.round(sh_eff * 100)}% eff`
      : `SCOP ${sh_eff.toFixed(1)}${same_hvac ? ` / EER ${(sc_eer_val ?? 3.2).toFixed(1)}` : ''}`
    const sh_label = same_hvac ? _sysLabel(sh_sys_key) + ' (H+C)' : _sysLabel(sh_sys_key)
    sf_nodes.push({ id: sh_node_id, label: sh_label, type: 'system', category: 'hvac', metric: sh_metric })
  }

  // ── Separate cooling system (only when a different system from heating) ───
  if (sc_node_id && cooling_thermal > 0) {
    sf_nodes.push({ id: sc_node_id, label: _sysLabel(sc_sys_key), type: 'system', category: 'hvac',
      metric: `EER ${(sc_eer_val ?? 3.2).toFixed(1)}` })
  }

  // ── Ventilation system node ───────────────────────────────────────────────
  if (vent_fans_kWh > 0) {
    const ventLabel = is_mvhr ? 'MVHR' : 'MEV'
    sf_nodes.push({ id: vent_node_id, label: ventLabel, type: 'system', category: 'ventilation',
      metric: is_mvhr ? `${Math.round(heat_recovery * 100)}% HR` : 'Extract only' })
  }

  // ── DHW secondary system node (ASHP preheat, solar thermal, etc.) ─────────
  if (dhw_sec_node_id) {
    const secLabel = dhw_sec_key?.includes('ashp')   ? 'ASHP DHW Preheat'
                   : dhw_sec_key?.includes('solar')  ? 'Solar Thermal'
                   : _sysLabel(dhw_sec_key)
    const secMetric = dhwSecDef.fuel === 'electricity' ? `COP ${dhw_sec_eff.toFixed(1)}`
                    : dhwSecDef.fuel === 'renewable'   ? 'Solar'
                    : `${Math.round(dhw_sec_eff * 100)}% eff`
    sf_nodes.push({ id: dhw_sec_node_id, label: secLabel, type: 'system', category: 'dhw', metric: secMetric })
  }

  // ── DHW primary system node ───────────────────────────────────────────────
  if (dhw_thermal > 0) {
    const dhwLabel  = dhwPrimDef.fuel === 'gas' ? 'DHW Boiler' : _sysLabel(dhw_prim_key)
    const dhwMetric = dhwPrimDef.fuel === 'gas'
      ? `${Math.round(dhw_prim_eff * 100)}% eff`
      : `COP ${dhw_prim_eff.toFixed(1)}`
    sf_nodes.push({ id: dhw_node_id, label: dhwLabel, type: 'system', category: 'dhw', metric: dhwMetric })
  }

  // ── Lighting / small power ────────────────────────────────────────────────
  if (lighting_kWh > 0)
    sf_nodes.push({ id: 'lighting',    label: 'Lighting',    type: 'system', category: 'lighting',  metric: `${lpd} W/m²` })
  if (equipment_kWh > 0)
    sf_nodes.push({ id: 'small_power', label: 'Small Power', type: 'system', category: 'equipment', metric: `${epd} W/m²` })

  // ── Recovery node ─────────────────────────────────────────────────────────
  if (mvhr_recovery_kWh > 0)
    sf_nodes.push({ id: 'mvhr_recov', label: 'Recovered Heat', type: 'recovered' })

  // ── Recovery opportunity hints (for waste node tooltips) ─────────────────
  // If a system is wasting heat that COULD be recovered, flag it on the node.
  const has_ashp_dhw_preheat = !!dhw_sec_node_id && (dhw_sec_key?.includes('ashp') || dhw_sec_key?.includes('heat_pump'))
  const heat_reject_hint = heat_rejected_kWh > 0 && !has_ashp_dhw_preheat
    ? 'Recovery opportunity: add ASHP preheat to DHW — use this heat to reduce gas consumption'
    : null
  const vent_exhaust_hint = vent_kWh > 0 && !is_mvhr
    ? 'Recovery opportunity: switch to MVHR to recover ~82% of this ventilation heat loss'
    : null

  // ── End-use / building nodes ──────────────────────────────────────────────
  // space_heat is a 'building' pass-through node — it receives heating from systems
  // and loses some to ventilation exhaust (vent_kWh). This makes the waste stream visible.
  if (heating_thermal > 0) sf_nodes.push({ id: 'space_heat',  label: 'Space Heating', type: 'building' })
  if (cooling_thermal > 0) sf_nodes.push({ id: 'space_cool',  label: 'Space Cooling', type: 'end_use' })
  if (dhw_thermal > 0)     sf_nodes.push({ id: 'dhw_del',     label: 'Hot Water',     type: 'end_use' })
  if (vent_fans_kWh > 0)   sf_nodes.push({ id: 'fresh_air',   label: 'Fresh Air',     type: 'end_use' })
  if (lighting_kWh > 0)    sf_nodes.push({ id: 'light_del',   label: 'Light',         type: 'end_use' })
  if (equipment_kWh > 0)   sf_nodes.push({ id: 'equip_del',   label: 'Equipment',     type: 'end_use' })

  // ── Waste nodes ───────────────────────────────────────────────────────────
  if (heat_rejected_kWh > 0) sf_nodes.push({
    id: 'heat_reject', label: 'Heat Rejection', type: 'waste',
    recovery_hint: heat_reject_hint,
  })
  // Ventilation exhaust: all heat lost via exhaust (vent_kWh), thick for MEV, thin for MVHR
  if (vent_kWh > 0) sf_nodes.push({
    id: 'vent_exhaust', label: 'Vent Exhaust', type: 'waste',
    recovery_hint: vent_exhaust_hint,
  })
  if (heating_flue_kWh > 0)  sf_nodes.push({ id: 'heating_flue', label: 'Heating Flue',  type: 'waste' })
  if (dhw_flue_kWh > 0)      sf_nodes.push({ id: 'dhw_flue',     label: 'DHW Flue Loss', type: 'waste' })

  // ── Links: Sources → Space heating / conditioning ─────────────────────────
  const sh_elec_total = same_hvac
    ? heating_electricity + cooling_electricity + vrf_fans_kWh
    : heating_electricity + vrf_fans_kWh
  _addLink(sf_links, 'grid', sh_node_id, sh_elec_total, 'electricity')
  _addLink(sf_links, 'gas',  sh_node_id, heating_gas,   'gas')

  // Sources → Separate cooling system
  if (sc_node_id)
    _addLink(sf_links, 'grid', sc_node_id, cooling_electricity, 'electricity')

  // Sources → Ventilation
  _addLink(sf_links, 'grid', vent_node_id, vent_fans_kWh, 'electricity')

  // Sources → DHW secondary (e.g. ASHP preheat powered by electricity)
  if (dhw_sec_node_id && dhwSecDef.fuel === 'electricity')
    _addLink(sf_links, 'grid', dhw_sec_node_id, dhw_elec_kWh, 'electricity')
  // renewable (solar): no grid link — free energy

  // Sources → DHW primary
  if (dhwPrimDef.fuel === 'gas') {
    _addLink(sf_links, 'gas', dhw_node_id, dhw_gas_kWh, 'gas')
  } else if (dhwPrimDef.fuel === 'electricity' && !dhw_sec_node_id) {
    // Primary electric with no secondary: electricity flows direct to DHW node
    _addLink(sf_links, 'grid', dhw_node_id, dhw_elec_kWh, 'electricity')
  }

  // Sources → Lighting / small power
  _addLink(sf_links, 'grid', 'lighting',    lighting_kWh,  'electricity')
  _addLink(sf_links, 'grid', 'small_power', equipment_kWh, 'electricity')

  // ── Links: Systems → End uses ─────────────────────────────────────────────
  _addLink(sf_links, sh_node_id, 'space_heat', heating_thermal, 'heating')
  if (same_hvac) {
    _addLink(sf_links, sh_node_id, 'space_cool', cooling_thermal, 'cooling')
  } else if (sc_node_id) {
    _addLink(sf_links, sc_node_id, 'space_cool', cooling_thermal, 'cooling')
  }
  _addLink(sf_links, dhw_node_id,   'dhw_del',   dhw_thermal,   'dhw')
  _addLink(sf_links, vent_node_id,  'fresh_air',  vent_fans_kWh, 'air')
  _addLink(sf_links, 'lighting',    'light_del',  lighting_kWh,  'electricity')
  _addLink(sf_links, 'small_power', 'equip_del',  equipment_kWh, 'electricity')

  // ── Links: Systems → Waste ────────────────────────────────────────────────
  const cooling_sys_id = same_hvac ? sh_node_id : sc_node_id
  _addLink(sf_links, cooling_sys_id, 'heat_reject',  heat_rejected_kWh, 'waste')
  _addLink(sf_links, sh_node_id,     'heating_flue', heating_flue_kWh,  'waste')
  _addLink(sf_links, dhw_node_id,    'dhw_flue',     dhw_flue_kWh,      'waste')
  // Ventilation exhaust: building heat lost via exhaust, routed through space_heat
  // space_heat is a 'building' pass-through so it can emit this waste stream
  _addLink(sf_links, 'space_heat',   'vent_exhaust', vent_kWh,           'waste')

  // ── Links: Recovery ───────────────────────────────────────────────────────
  // MVHR recovered heat → reduces space heating demand (shown as green recovered link)
  _addLink(sf_links, 'mvhr_recov', 'space_heat', mvhr_recovery_kWh, 'recovered')

  // DHW secondary → DHW primary: heat output feeds into the boiler/cylinder
  if (dhw_sec_node_id && dhw_thermal > 0) {
    const sec_heat_output = dhwSecDef.fuel === 'electricity'
      ? dhw_elec_kWh * dhw_sec_eff        // heat pump: electricity × COP
      : dhw_thermal * dhw_sec_share        // solar thermal / other: share of demand
    _addLink(sf_links, dhw_sec_node_id, dhw_node_id, sec_heat_output, 'recovered')
  }

  const systems_flow = { nodes: sf_nodes, links: sf_links }

  const heat_balance = _buildHeatBalance({
    geo,
    walls_kWh, roof_kWh, floor_kWh, glazing_kWh,
    infiltration_kWh, vent_kWh, cooling_thermal,
    solar_north: solar_gains.north,
    solar_south: solar_gains.south,
    solar_east:  solar_gains.east,
    solar_west:  solar_gains.west,
    people_kWh: people_internal,
    equipment_kWh: equip_internal,
    lighting_kWh: lighting_internal,
    heating_thermal,
    ach,
  })

  return {
    eui_kWh_m2:            Math.round(eui_kWh_m2 * 10) / 10,
    annual_heating_kWh:    Math.round(heating_thermal),
    annual_cooling_kWh:    Math.round(cooling_thermal),
    heat_balance,
    // ── Gains & Losses butterfly data — separated heating vs cooling contributions ──
    gains_losses: {
      heating_side: {
        // Losses in MWh (increase heating demand)
        wall_conduction:    walls_kWh       / 1000,
        roof_conduction:    roof_kWh        / 1000,
        floor_conduction:   floor_kWh       / 1000,
        glazing_conduction: glazing_kWh     / 1000,
        infiltration:       infiltration_kWh / 1000,
        ventilation:        vent_kWh        / 1000,
        // Offsets in MWh (reduce heating demand — only util_factor fraction is useful)
        // solar_gains are now in kWh → divide by 1000 for MWh display
        solar_south:  solar_gains.south / 1000 * util_factor,
        solar_east:   solar_gains.east  / 1000 * util_factor,
        solar_west:   solar_gains.west  / 1000 * util_factor,
        solar_north:  solar_gains.north / 1000 * util_factor,
        wall_solar:   opaque_wall_total / 1000 * util_factor,
        roof_solar:   roof_solar_kWh    / 1000 * util_factor,
        equipment:    equip_internal       * util_factor / 1000,
        lighting:     lighting_internal    * util_factor / 1000,
        people:       people_internal      * util_factor / 1000,
      },
      cooling_side: {
        // Drivers in MWh (increase cooling demand — only cooling_fraction drives cooling)
        // solar_gains are now in kWh → divide by 1000 for MWh display
        solar_south:  solar_gains.south / 1000 * COOLING_GAIN_FRACTION,
        solar_east:   solar_gains.east  / 1000 * COOLING_GAIN_FRACTION,
        solar_west:   solar_gains.west  / 1000 * COOLING_GAIN_FRACTION,
        solar_north:  solar_gains.north / 1000 * COOLING_GAIN_FRACTION,
        equipment:    equip_internal       * COOLING_GAIN_FRACTION / 1000,
        lighting:     lighting_internal    * COOLING_GAIN_FRACTION / 1000,
        people:       people_internal      * COOLING_GAIN_FRACTION / 1000,
        // Free cooling offsets in MWh (reduce cooling demand)
        infiltration_cooling: infiltration_kWh * 0.15 / 1000,
        ventilation_cooling:  vent_kWh         * 0.10 / 1000,
      },
    },
    annual_lighting_kWh:   Math.round(lighting_kWh),
    annual_equipment_kWh:  Math.round(equipment_kWh),
    annual_fans_kWh:       Math.round(fans_kWh),
    annual_dhw_kWh:        Math.round(dhw_thermal),
    fabric_losses: {
      walls_kWh:           Math.round(walls_kWh),
      roof_kWh:            Math.round(roof_kWh),
      floor_kWh:           Math.round(floor_kWh),
      glazing_kWh:         Math.round(glazing_kWh),
      infiltration_kWh:    Math.round(infiltration_kWh),
      ventilation_kWh:     Math.round(vent_kWh),
      total_kWh:           Math.round(total_fabric + infiltration_kWh + vent_kWh),
    },
    solar_gains: {
      north_kWh:       Math.round(solar_gains.north),
      south_kWh:       Math.round(solar_gains.south),
      east_kWh:        Math.round(solar_gains.east),
      west_kWh:        Math.round(solar_gains.west),
      opaque_wall_kWh: Math.round(opaque_wall_total),
      roof_solar_kWh:  Math.round(roof_solar_kWh),
      total_kWh:       Math.round(total_solar),
    },
    // Internal gains breakdown (kWh) — used by GainsLossesChart
    internal_gains: {
      lighting_kWh:   Math.round(lighting_internal),
      equipment_kWh:  Math.round(equip_internal),
      people_kWh:     Math.round(people_internal),
      total_kWh:      Math.round(total_internal),
    },
    fuel_split: {
      electricity_kWh: Math.round(electricity_kWh),
      gas_kWh:         Math.round(gas_kWh),
      total_kWh:       Math.round(total_kWh),
      electricity_pct: total_kWh > 0 ? Math.round(electricity_kWh / total_kWh * 100) : 100,
      gas_pct:         total_kWh > 0 ? Math.round(gas_kWh / total_kWh * 100) : 0,
    },
    carbon_kgCO2_m2: Math.round(carbon_kgCO2_m2 * 10) / 10,
    gia_m2:  Math.round(gia),
    systems_flow,
    _inputs: { u_wall, u_roof, u_floor, u_glaz, ach, is_mvhr, heat_recovery, lpd, cop_heating, cop_cooling,
               sh_sys_key, sc_sys_key, vent_sys_key, dhw_prim_key },
  }
}

function _empty() {
  const _gl = {
    heating_side: {
      wall_conduction: 0, roof_conduction: 0, floor_conduction: 0,
      glazing_conduction: 0, infiltration: 0, ventilation: 0,
      solar_south: 0, solar_east: 0, solar_west: 0, solar_north: 0,
      wall_solar: 0, roof_solar: 0, equipment: 0, lighting: 0, people: 0,
    },
    cooling_side: {
      solar_south: 0, solar_east: 0, solar_west: 0, solar_north: 0,
      equipment: 0, lighting: 0, people: 0,
      infiltration_cooling: 0, ventilation_cooling: 0,
    },
  }
  return {
    eui_kWh_m2: 0, annual_heating_kWh: 0, annual_cooling_kWh: 0,
    annual_lighting_kWh: 0, annual_equipment_kWh: 0, annual_fans_kWh: 0, annual_dhw_kWh: 0,
    gains_losses: _gl,
    heat_balance: _buildHeatBalance({ geo: { gia: 0, total_wall_opaque: 0, total_glazing: 0, roof_area: 0, ground_area: 0, glazing: { north: 0, south: 0, east: 0, west: 0 }, wall_opaque: { north: 0, south: 0, east: 0, west: 0 } } }),
    fabric_losses: { walls_kWh: 0, roof_kWh: 0, floor_kWh: 0, glazing_kWh: 0, infiltration_kWh: 0, ventilation_kWh: 0, total_kWh: 0 },
    solar_gains: { north_kWh: 0, south_kWh: 0, east_kWh: 0, west_kWh: 0, opaque_wall_kWh: 0, roof_solar_kWh: 0, total_kWh: 0 },
    internal_gains: { lighting_kWh: 0, equipment_kWh: 0, people_kWh: 0, total_kWh: 0 },
    fuel_split: { electricity_kWh: 0, gas_kWh: 0, total_kWh: 0, electricity_pct: 100, gas_pct: 0 },
    carbon_kgCO2_m2: 0, gia_m2: 0,
    systems_flow: { nodes: [], links: [] },
    monthly: { heating_kWh: new Array(12).fill(0), cooling_kWh: new Array(12).fill(0), solar_kWh: new Array(12).fill(0) },
    _inputs: {},
  }
}

// ── Heat balance shape (matches backend get_heat_balance) ────────────────────
//
// Builds the same JSON shape returned by GET .../simulations/{run_id}/balance
// so the HeatBalance component can read either source via a single prop.
//
// All inputs in kWh (annual). geo is the object returned by computeGeometry.

function _buildHeatBalance({
  geo,
  walls_kWh = 0, roof_kWh = 0, floor_kWh = 0, glazing_kWh = 0,
  infiltration_kWh = 0, vent_kWh = 0, cooling_thermal = 0,
  openings_louvre_kWh = 0, openings_window_kWh = 0,
  solar_north = 0, solar_south = 0, solar_east = 0, solar_west = 0,
  people_kWh = 0, equipment_kWh = 0, lighting_kWh = 0,
  heating_thermal = 0,
  ach = 0,
}) {
  const gia = Math.max(geo?.gia || 0, 1)
  const r1   = (kwh) => Math.round(kwh * 10) / 10
  const perM = (kwh) => Math.round((kwh / gia) * 100) / 100

  const wall_opaque = geo?.wall_opaque ?? { north: 0, south: 0, east: 0, west: 0 }
  const totalWallArea = (wall_opaque.north + wall_opaque.south + wall_opaque.east + wall_opaque.west) || 1
  const wallByFace = {
    north: r1(walls_kWh * (wall_opaque.north / totalWallArea)),
    south: r1(walls_kWh * (wall_opaque.south / totalWallArea)),
    east:  r1(walls_kWh * (wall_opaque.east  / totalWallArea)),
    west:  r1(walls_kWh * (wall_opaque.west  / totalWallArea)),
  }

  const losses = {
    external_wall: { kwh: r1(walls_kWh),       kwh_per_m2: perM(walls_kWh),       area_m2: Math.round(geo?.total_wall_opaque || 0), by_face: wallByFace },
    roof:          { kwh: r1(roof_kWh),        kwh_per_m2: perM(roof_kWh),        area_m2: Math.round(geo?.roof_area || 0) },
    ground_floor:  { kwh: r1(floor_kWh),       kwh_per_m2: perM(floor_kWh),       area_m2: Math.round(geo?.ground_area || 0) },
    glazing:       { kwh: r1(glazing_kWh),     kwh_per_m2: perM(glazing_kWh),     area_m2: Math.round(geo?.total_glazing || 0) },
    infiltration:  { kwh: r1(infiltration_kWh),kwh_per_m2: perM(infiltration_kWh),ach },
    openings_louvre: { kwh: r1(openings_louvre_kWh), kwh_per_m2: perM(openings_louvre_kWh) },
    openings_window: { kwh: r1(openings_window_kWh), kwh_per_m2: perM(openings_window_kWh) },
    ventilation:   { kwh: r1(vent_kWh),        kwh_per_m2: perM(vent_kWh) },
    cooling:       { kwh: r1(cooling_thermal), kwh_per_m2: perM(cooling_thermal) },
  }

  const glazingFace = geo?.glazing ?? { north: 0, south: 0, east: 0, west: 0 }
  const solarTotal  = solar_north + solar_south + solar_east + solar_west
  const solar = {
    north: { kwh: r1(solar_north), kwh_per_m2: perM(solar_north), area_m2: Math.round(glazingFace.north) },
    south: { kwh: r1(solar_south), kwh_per_m2: perM(solar_south), area_m2: Math.round(glazingFace.south) },
    east:  { kwh: r1(solar_east),  kwh_per_m2: perM(solar_east),  area_m2: Math.round(glazingFace.east) },
    west:  { kwh: r1(solar_west),  kwh_per_m2: perM(solar_west),  area_m2: Math.round(glazingFace.west) },
    total_kwh:        r1(solarTotal),
    total_kwh_per_m2: perM(solarTotal),
  }

  const internalTotal = people_kWh + equipment_kWh + lighting_kWh
  const internal = {
    people:    { kwh: r1(people_kWh),    kwh_per_m2: perM(people_kWh) },
    equipment: { kwh: r1(equipment_kWh), kwh_per_m2: perM(equipment_kWh) },
    lighting:  { kwh: r1(lighting_kWh),  kwh_per_m2: perM(lighting_kWh) },
    total_kwh:        r1(internalTotal),
    total_kwh_per_m2: perM(internalTotal),
  }

  const gains = { solar, internal, heating: { kwh: r1(heating_thermal), kwh_per_m2: perM(heating_thermal) } }

  const totalLosses = walls_kWh + roof_kWh + floor_kWh + glazing_kWh + infiltration_kWh
                    + openings_louvre_kWh + openings_window_kWh + vent_kWh + cooling_thermal
  const totalGains  = solarTotal + internalTotal + heating_thermal

  return {
    annual: {
      losses,
      gains,
      totals: {
        losses_kwh:        r1(totalLosses),
        gains_kwh:         r1(totalGains),
        losses_kwh_per_m2: perM(totalLosses),
        gains_kwh_per_m2:  perM(totalGains),
        net_kwh_per_m2:    perM(totalGains - totalLosses),
      },
    },
    metadata: { gia_m2: Math.round(gia) },
  }
}

// ── Hourly instant calc ────────────────────────────────────────────────────────

/**
 * Calculate simplified annual energy using hourly EPW weather data.
 * Falls back to degree-day method if weather/solar data is not available.
 *
 * @param {object} building      — ProjectContext building_config
 * @param {object} constructions — ProjectContext construction_choices
 * @param {object} systems       — ProjectContext systems_config
 * @param {object} libraryData   — { constructions: [...] } from library API
 * @param {object|null} weatherData  — EPW hourly arrays from WeatherContext
 * @param {object|null} hourlySolar  — { f1,f2,f3,f4,roof } Float32Array from solarCalc
 * @param {object|null} scheduleProfiles — per-hour schedule fractions
 * @param {object} [options]       — { mode } — state-routing per `docs/state_contracts.md`.
 *                                   `mode='state-3'` (default) preserves current full-model behaviour.
 *                                   `mode='state-1'` enters the envelope-only path (Brief 26 Part 2).
 *                                   Future: 'state-2', 'state-2.5'.
 * @returns {object} Same structure as calculateInstantDegreeDay + monthly breakdown,
 *                   plus `state` and `mode` metadata fields.
 */
export function calculateInstant(building = {}, constructions = {}, systems = {}, libraryData = {}, weatherData = null, hourlySolar = null, scheduleProfiles = null, options = {}) {
  // Mode strings match the state contract's `mode` field exactly:
  //   'envelope-only' (State 1) | 'envelope-gains' (State 2) |
  //   'envelope-gains-operation' (State 2.5) | 'full' (State 3, default).
  const mode = options.mode ?? 'full'
  const stateNum = ({ 'envelope-only': 1, 'envelope-gains': 2,
                      'envelope-gains-operation': 2.5, 'full': 3 })[mode] ?? 3

  if (!weatherData || !hourlySolar) {
    const result = calculateInstantDegreeDay(building, constructions, systems, libraryData)
    return { ...result, state: stateNum, mode }
  }

  // State 1 envelope-only path (Brief 26 Part 3) — strict input enforcement,
  // free-running zone temperature, demand derived against the comfort band.
  // Per the state contract, must produce identical output regardless of any
  // value in gains/operation/systems. The withMode() helper enforces this.
  if (mode === 'envelope-only') {
    return _calculateEnvelopeOnly(
      withMode(building, mode),
      constructions, libraryData, weatherData, hourlySolar,
      options.comfortBand ?? building.comfort_band ?? { lower_c: 20, upper_c: 26 },
    )
  }

  // State 2 envelope + internal gains path (Brief 27 Part 2). Same physics
  // as State 1 with people / lighting / equipment gains added to the energy
  // balance. Returns the State 2 contract shape including `state1_delta`
  // and `occupancy_summary`.
  if (mode === 'envelope-gains') {
    return _calculateState2(
      withMode(building, mode),
      constructions, libraryData, weatherData, hourlySolar,
      options.comfortBand ?? building.comfort_band ?? { lower_c: 20, upper_c: 26 },
    )
  }

  const geo = computeGeometry(building)
  const { gia, volume, total_wall_opaque, total_glazing, glazing, wall_opaque, roof_area, ground_area } = geo

  if (gia <= 0) return _empty()

  // ── U-values ─────────────────────────────────────────────────────────────
  const u_wall  = getUValue(constructions, 'external_wall', libraryData)
  const u_roof  = getUValue(constructions, 'roof',          libraryData)
  const u_floor = getUValue(constructions, 'ground_floor',  libraryData)
  const u_glaz  = getUValue(constructions, 'glazing',       libraryData)

  // ── Infiltration / ventilation ────────────────────────────────────────────
  const ach = Number(building.infiltration_ach ?? 0.5)
  const vent_sys_key = systems.ventilation?.primary?.system ?? systems.ventilation_type ?? 'mev_standard'
  const ventDef      = sysDefaults(vent_sys_key)
  const is_mvhr      = ventDef.hre != null ? ventDef.hre > 0 : vent_sys_key.startsWith('mvhr')
  const hre_fraction = systems.ventilation?.primary?.efficiency_override != null
    ? systems.ventilation.primary.efficiency_override / 100
    : (ventDef.hre ?? (is_mvhr ? 0.82 : 0.0))
  const vent_ach     = 0.5
  const heat_recovery = hre_fraction
  const sfp_override  = systems.sfp_override

  // ── Solar / g-value ───────────────────────────────────────────────────────
  const g_value = getGValue(constructions, libraryData)
  const OPAQUE_GAIN_FRACTION = 0.04

  // ── Shading factors per facade (live preview) ─────────────────────────────
  // EnergyPlus does the proper per-timestep shading calc; this is a simple
  // annual-average projection-factor approximation for sub-second feedback
  // as the user drags the overhang/fin sliders. Output is multiplied by the
  // facade's solar gain inside the hourly loop.
  const shadingFactors = computeShadingFactors(building)

  // ── Setpoints and util factors ────────────────────────────────────────────
  const T_heat_setpoint   = 21   // °C
  const T_cool_setpoint   = 24   // °C
  const util_factor       = 0.60
  const COOLING_GAIN_FRACTION = 0.25

  // ── Occupancy ─────────────────────────────────────────────────────────────
  const num_bedrooms    = Number(building.num_bedrooms    ?? 138)
  const occupancy_rate  = Math.max(0, Math.min(1, Number(building.occupancy_rate  ?? 0.75)))
  const people_per_room = Number(building.people_per_room ?? 1.5)
  const avg_occupants   = num_bedrooms * occupancy_rate * people_per_room

  // ── Internal gain watts (peak, before schedule fraction) ──────────────────
  const lpd = Number(systems.lighting_power_density ?? 8) * lightingControlFactor(systems.lighting_control)
  const epd = Number(systems.equipment_power_density ?? 10)
  const OCC_WATTS = 60
  const lpd_W = lpd * gia                           // W — lighting
  const epd_W = epd * gia * occupancy_rate          // W — equipment (scales with occupancy)
  const occ_W = OCC_WATTS * avg_occupants           // W — people

  // ── UA products (Wh/K per hour = W/K, used as: kWh = UA * dT / 1000) ─────
  const UA_wall       = u_wall  * total_wall_opaque
  const UA_roof       = u_roof  * roof_area
  const UA_floor      = u_floor * ground_area
  const UA_glaz       = u_glaz  * total_glazing
  const UA_infil      = AIR_HEAT_CAPACITY * ach     * volume   // Wh/K — crack infiltration only
  const UA_vent_no_hr = AIR_HEAT_CAPACITY * vent_ach * volume
  const UA_vent       = UA_vent_no_hr * (1 - heat_recovery)
  const UA_fabric_cool = UA_wall + UA_glaz + UA_roof + UA_infil  // for fabric heat gain in cooling

  // ── Openings (wind-driven natural ventilation) ────────────────────────────
  // Per-facade always-open louvre area + operable window fraction. Q = Cd · A · √Cw · v_wind
  // (no stack term per single-zone model — see CIBSE AM10 single-sided wind formula).
  const openings = building.openings ?? {}
  const Cd = 0.6
  const Cw = ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })[openings.site_exposure] ?? 0.10
  const sqrtCw = Math.sqrt(Cw)
  const louvre_area_total = ['north','south','east','west']
    .reduce((s, f) => s + Number(openings?.[f]?.louvre_area_m2 ?? 0), 0)
  const openable_area_per_face = (f) => Number(openings?.[f]?.openable_fraction ?? 0) * (glazing[f] ?? 0)
  const openable_area_total = openable_area_per_face('north') + openable_area_per_face('south') +
                              openable_area_per_face('east') + openable_area_per_face('west')

  // ── 8760-hour loop ────────────────────────────────────────────────────────
  let total_heating = 0, total_cooling = 0

  // Annual fabric loss accumulators (heating-season only where dT_heat > 0)
  let acc_walls_loss = 0, acc_roof_loss = 0, acc_floor_loss = 0, acc_glaz_loss = 0
  let acc_infil_loss = 0, acc_vent_loss = 0, acc_vent_no_hr = 0
  // Openings: split into louvres (always open) vs operable windows (schedule-gated)
  let acc_openings_louvre_loss = 0, acc_openings_window_loss = 0

  // Annual solar gain accumulators (all hours — used for butterfly chart & display)
  let acc_solar_n = 0, acc_solar_e = 0, acc_solar_s = 0, acc_solar_w = 0
  let acc_roof_solar = 0, acc_opaque_wall_solar = 0

  // Annual internal gain accumulators (all hours)
  let acc_lighting_internal = 0, acc_equip_internal = 0, acc_people_internal = 0

  // Monthly accumulators (0-indexed, Jan=0)
  const monthly_heating = new Float32Array(12)
  const monthly_cooling = new Float32Array(12)
  const monthly_solar   = new Float32Array(12)

  const n = weatherData.temperature.length
  for (let h = 0; h < n; h++) {
    const T_out    = weatherData.temperature[h]
    const mo_idx   = (weatherData.month[h] - 1) | 0    // 0-11
    const hourOfDay = (weatherData.hour[h] - 1) | 0    // 0-23

    const dT_heat = Math.max(0, T_heat_setpoint - T_out)
    const dT_cool = Math.max(0, T_out - T_cool_setpoint)

    // Schedule fractions this hour (used by openings + internal gains)
    const occ_frac   = scheduleProfiles?.occupancy?.[hourOfDay]  ?? hotelOccupancyFraction(hourOfDay)
    const light_frac = scheduleProfiles?.lighting?.[hourOfDay]   ?? hotelLightingFraction(hourOfDay)
    const equip_frac = scheduleProfiles?.equipment?.[hourOfDay]  ?? hotelEquipmentFraction(hourOfDay)

    // Fabric losses this hour (kWh — only non-zero when T_out < heating setpoint)
    const hour_walls     = UA_wall    * dT_heat / 1000
    const hour_roof_loss = UA_roof    * dT_heat / 1000
    const hour_floor     = UA_floor   * dT_heat / 1000
    const hour_glaz      = UA_glaz    * dT_heat / 1000
    const hour_infil     = UA_infil   * dT_heat / 1000
    const hour_vent      = UA_vent    * dT_heat / 1000
    const hour_vent_nohr = UA_vent_no_hr * dT_heat / 1000

    // Openings — wind-driven flow (m³/s) → ACH-equivalent → Wh/K → kWh
    const v_wind = weatherData.wind_speed?.[h] ?? 0
    const Q_louvre = Cd * louvre_area_total * sqrtCw * v_wind
    const windowsOpen = (
      openings.schedule === 'always' ||
      (openings.schedule === 'occupied'   && occ_frac > 0.1) ||
      (openings.schedule === 'summer_day' && (mo_idx >= 4 && mo_idx <= 8) && hourOfDay >= 8 && hourOfDay <= 20)
    )
    const Q_window = windowsOpen ? Cd * openable_area_total * sqrtCw * v_wind : 0
    const hour_openings_louvre = AIR_HEAT_CAPACITY * (Q_louvre * 3600) * dT_heat / 1000
    const hour_openings_window = AIR_HEAT_CAPACITY * (Q_window * 3600) * dT_heat / 1000

    const fabric_loss = hour_walls + hour_roof_loss + hour_floor + hour_glaz + hour_infil
                      + hour_vent + hour_openings_louvre + hour_openings_window

    // Solar gains this hour from precomputed facade arrays (kWh)
    const solar_n    = hourlySolar.f1[h] * glazing.north * g_value * shadingFactors.north / 1000
    const solar_e    = hourlySolar.f2[h] * glazing.east  * g_value * shadingFactors.east  / 1000
    const solar_s    = hourlySolar.f3[h] * glazing.south * g_value * shadingFactors.south / 1000
    const solar_w    = hourlySolar.f4[h] * glazing.west  * g_value * shadingFactors.west  / 1000
    const solar_roof_h = hourlySolar.roof[h] * roof_area * OPAQUE_GAIN_FRACTION / 1000
    const solar_opq_h  = (
      hourlySolar.f1[h] * wall_opaque.north +
      hourlySolar.f2[h] * wall_opaque.east  +
      hourlySolar.f3[h] * wall_opaque.south +
      hourlySolar.f4[h] * wall_opaque.west
    ) * OPAQUE_GAIN_FRACTION / 1000
    const solar_kWh  = solar_n + solar_e + solar_s + solar_w + solar_roof_h + solar_opq_h

    // Internal gains this hour from schedules (kWh)
    const light_h    = lpd_W * light_frac / 1000
    const equip_h    = epd_W * equip_frac / 1000
    const people_h   = occ_W * occ_frac   / 1000
    const internal_kWh = light_h + equip_h + people_h

    // Hourly heat balance
    const net_loss = fabric_loss - solar_kWh - internal_kWh

    if (net_loss > 0) {
      // Heating needed
      total_heating += net_loss
      monthly_heating[mo_idx] += net_loss
      // Accumulate fabric losses only in heating hours
      acc_walls_loss  += hour_walls
      acc_roof_loss   += hour_roof_loss
      acc_floor_loss  += hour_floor
      acc_glaz_loss   += hour_glaz
      acc_infil_loss  += hour_infil
      acc_vent_loss   += hour_vent
      acc_vent_no_hr  += hour_vent_nohr
      acc_openings_louvre_loss += hour_openings_louvre
      acc_openings_window_loss += hour_openings_window
    } else {
      // Excess gains → cooling; add fabric heat gain from hot exterior
      const excess = -net_loss
      const fabric_heat_gain = UA_fabric_cool * dT_cool / 1000
      const cooling_h = excess + fabric_heat_gain
      if (cooling_h > 0) {
        total_cooling += cooling_h
        monthly_cooling[mo_idx] += cooling_h
      }
    }

    // Annual accumulators (all hours regardless of heating/cooling)
    acc_solar_n           += solar_n
    acc_solar_e           += solar_e
    acc_solar_s           += solar_s
    acc_solar_w           += solar_w
    acc_roof_solar        += solar_roof_h
    acc_opaque_wall_solar += solar_opq_h
    monthly_solar[mo_idx] += solar_kWh
    acc_lighting_internal += light_h
    acc_equip_internal    += equip_h
    acc_people_internal   += people_h
  }

  const heating_thermal = total_heating
  const cooling_thermal = total_cooling
  const total_solar     = acc_solar_n + acc_solar_e + acc_solar_s + acc_solar_w + acc_roof_solar + acc_opaque_wall_solar
  const total_internal  = acc_lighting_internal + acc_equip_internal + acc_people_internal

  // MVHR recovery: ventilation heat that would have been lost without HRE
  const mvhr_recovery_kWh = is_mvhr ? acc_vent_no_hr - acc_vent_loss : 0

  // ── Space heating system dispatch ─────────────────────────────────────────
  const sh_primary    = systems.space_heating?.primary
  const sh_sys_key    = sh_primary?.system ?? systems.hvac_type ?? 'vrf_standard'
  const shDef         = sysDefaults(sh_sys_key)
  const sh_eff        = sh_primary?.efficiency_override ?? shDef.eff ?? 3.5
  const sh_secondary  = systems.space_heating?.secondary
  const sh_sec_key    = sh_secondary?.system
  const shSecDef      = sh_sec_key ? sysDefaults(sh_sec_key) : null
  const sh_sec_eff    = sh_secondary?.efficiency_override ?? shSecDef?.eff ?? 1.0
  const sh_prim_share = sh_secondary ? (1 - (sh_secondary.share ?? 0)) : 1.0
  const sh_sec_share  = sh_secondary?.share ?? 0

  let heating_electricity = 0
  let heating_gas         = 0
  if (shDef.fuel === 'gas') {
    heating_gas += heating_thermal * sh_prim_share / sh_eff
  } else if (shDef.fuel === 'electricity') {
    heating_electricity += heating_thermal * sh_prim_share / sh_eff
  }
  if (shSecDef && sh_sec_share > 0) {
    if (shSecDef.fuel === 'gas') {
      heating_gas += heating_thermal * sh_sec_share / sh_sec_eff
    } else if (shSecDef.fuel === 'electricity') {
      heating_electricity += heating_thermal * sh_sec_share / sh_sec_eff
    }
  }
  const cop_heating = sh_eff

  // ── Space cooling system dispatch ─────────────────────────────────────────
  const sc_primary  = systems.space_cooling?.primary
  const sc_sys_key  = sc_primary?.system ?? systems.hvac_type ?? 'vrf_standard'
  const scDef       = sysDefaults(sc_sys_key)
  const sc_eer_val  = sc_primary?.efficiency_override ?? scDef.eer ?? 3.2
  const sc_is_none  = sc_sys_key === 'none_cooling' || scDef.fuel === null
  const cop_cooling = sc_eer_val
  const cooling_electricity = sc_is_none ? 0 : cooling_thermal / (sc_eer_val || 1)

  // ── Lighting / equipment annual electricity (for Sankey) ──────────────────
  const lighting_kWh  = lpd * gia * HOTEL_OPERATING_HOURS / 1000
  const equipment_kWh = epd * gia * HOTEL_EQUIP_HOURS / 1000

  // ── Fan energy ────────────────────────────────────────────────────────────
  const vrf_fan_sfp   = 0.5
  const vent_sfp      = sfp_override != null ? sfp_override : (is_mvhr ? 1.2 : 0.8)
  const q_vent_ls     = vent_ach * volume / 3.6
  const vrf_fans_kWh  = vrf_fan_sfp * (gia / 10) * HOTEL_OPERATING_HOURS / 1000
  const vent_fans_kWh = vent_sfp * q_vent_ls * HOTEL_OPERATING_HOURS / 1000
  const fans_kWh      = vrf_fans_kWh + vent_fans_kWh

  // ── DHW energy ────────────────────────────────────────────────────────────
  const DHW_L_PER_PERSON_DAY = 26.6
  const daily_vol   = DHW_L_PER_PERSON_DAY * Math.max(1, avg_occupants)
  const dhw_thermal = daily_vol * 365 * WATER_SHC * (DHW_SETPOINT - DHW_COLD_TEMP)

  const dhw_prim_slot  = systems.dhw?.primary
  const dhw_sec_slot   = systems.dhw?.secondary
  const dhw_prim_key   = dhw_prim_slot?.system  ?? systems.dhw_primary ?? 'gas_boiler_dhw'
  const _dhw_legacy_sec = (systems.dhw_preheat && systems.dhw_preheat !== 'none') ? systems.dhw_preheat : null
  const dhw_sec_key    = dhw_sec_slot?.system ?? _dhw_legacy_sec
  const dhwPrimDef     = sysDefaults(dhw_prim_key)
  const dhwSecDef      = dhw_sec_key ? sysDefaults(dhw_sec_key) : null

  const dhw_prim_eff   = dhw_prim_slot?.efficiency_override ?? dhwPrimDef.eff ?? 0.92
  const dhw_sec_eff    = dhw_sec_slot?.efficiency_override  ?? dhwSecDef?.eff ?? 2.8
  const dhw_prim_share = dhw_prim_slot?.share ?? (dhwSecDef ? 0.3 : 1.0)
  const dhw_sec_share  = dhw_sec_slot?.share  ?? (dhwSecDef ? 0.7 : 0.0)

  let dhw_gas_kWh  = 0
  let dhw_elec_kWh = 0
  if (dhwPrimDef.fuel === 'gas') {
    dhw_gas_kWh  += dhw_thermal * dhw_prim_share / (dhw_prim_eff || 1)
  } else if (dhwPrimDef.fuel === 'electricity') {
    dhw_elec_kWh += dhw_thermal * dhw_prim_share / (dhw_prim_eff || 1)
  }
  if (dhwSecDef && dhw_sec_share > 0) {
    if (dhwSecDef.fuel === 'gas') {
      dhw_gas_kWh  += dhw_thermal * dhw_sec_share / (dhw_sec_eff || 1)
    } else if (dhwSecDef.fuel === 'electricity') {
      dhw_elec_kWh += dhw_thermal * dhw_sec_share / (dhw_sec_eff || 1)
    }
  }

  // ── Totals and fuel split ─────────────────────────────────────────────────
  const electricity_kWh = heating_electricity + cooling_electricity + lighting_kWh + equipment_kWh + fans_kWh + dhw_elec_kWh
  const gas_kWh         = dhw_gas_kWh + heating_gas
  const total_kWh       = electricity_kWh + gas_kWh
  const eui_kWh_m2      = gia > 0 ? total_kWh / gia : 0
  const carbon_kgCO2_m2 = (electricity_kWh * GRID_INTENSITY_2026 + gas_kWh * GAS_CARBON_KG_KWH) / gia

  // ── Systems flow (Sankey) ─────────────────────────────────────────────────
  const eer = sc_eer_val
  const heat_rejected_kWh = (!sc_is_none && cooling_thermal > 0) ? cooling_thermal * (1 + 1 / (eer || 1)) : 0
  const vent_kWh = acc_vent_loss       // heating-season vent loss with HRE
  const vent_kWh_no_recovery = acc_vent_no_hr
  const heating_flue_kWh = (shDef.fuel === 'gas' && heating_gas > 0) ? heating_gas * (1 - sh_eff) : 0
  const dhw_flue_kWh     = (dhwPrimDef.fuel === 'gas' && dhw_gas_kWh > 0) ? dhw_gas_kWh * (1 - dhw_prim_eff) : 0

  const same_hvac      = !sc_is_none && sh_sys_key === sc_sys_key
  const sh_node_id     = `sh_${sh_sys_key}`
  const sc_node_id     = same_hvac ? null : (sc_is_none ? null : `sc_${sc_sys_key}`)
  const vent_node_id   = `vent_${vent_sys_key}`
  const dhw_node_id    = `dhw_${dhw_prim_key}`
  const dhw_sec_node_id = (dhwSecDef && dhw_sec_share > 0) ? `dhw_sec_${dhw_sec_key}` : null

  const _addLink = (links, source, target, value_kWh, style) => {
    if (value_kWh > 0 && source && target)
      links.push({ source, target, value_kWh: Math.round(value_kWh), style })
  }
  const _sysLabel = key => key?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? 'System'

  const sf_nodes = []
  const sf_links = []

  if (electricity_kWh > 0) sf_nodes.push({ id: 'grid', label: 'Grid Electricity', type: 'source' })
  if (gas_kWh > 0)          sf_nodes.push({ id: 'gas',  label: 'Natural Gas',       type: 'source' })

  if (heating_thermal > 0 || heating_electricity > 0 || heating_gas > 0) {
    const sh_metric = shDef.fuel === 'gas'
      ? `${Math.round(sh_eff * 100)}% eff`
      : `SCOP ${sh_eff.toFixed(1)}${same_hvac ? ` / EER ${(sc_eer_val ?? 3.2).toFixed(1)}` : ''}`
    const sh_label = same_hvac ? _sysLabel(sh_sys_key) + ' (H+C)' : _sysLabel(sh_sys_key)
    sf_nodes.push({ id: sh_node_id, label: sh_label, type: 'system', category: 'hvac', metric: sh_metric })
  }
  if (sc_node_id && cooling_thermal > 0) {
    sf_nodes.push({ id: sc_node_id, label: _sysLabel(sc_sys_key), type: 'system', category: 'hvac',
      metric: `EER ${(sc_eer_val ?? 3.2).toFixed(1)}` })
  }
  if (vent_fans_kWh > 0) {
    const ventLabel = is_mvhr ? 'MVHR' : 'MEV'
    sf_nodes.push({ id: vent_node_id, label: ventLabel, type: 'system', category: 'ventilation',
      metric: is_mvhr ? `${Math.round(heat_recovery * 100)}% HR` : 'Extract only' })
  }
  if (dhw_sec_node_id) {
    const secLabel = dhw_sec_key?.includes('ashp')  ? 'ASHP DHW Preheat'
                   : dhw_sec_key?.includes('solar') ? 'Solar Thermal'
                   : _sysLabel(dhw_sec_key)
    const secMetric = dhwSecDef.fuel === 'electricity' ? `COP ${dhw_sec_eff.toFixed(1)}`
                    : dhwSecDef.fuel === 'renewable'   ? 'Solar'
                    : `${Math.round(dhw_sec_eff * 100)}% eff`
    sf_nodes.push({ id: dhw_sec_node_id, label: secLabel, type: 'system', category: 'dhw', metric: secMetric })
  }
  if (dhw_thermal > 0) {
    const dhwLabel  = dhwPrimDef.fuel === 'gas' ? 'DHW Boiler' : _sysLabel(dhw_prim_key)
    const dhwMetric = dhwPrimDef.fuel === 'gas'
      ? `${Math.round(dhw_prim_eff * 100)}% eff`
      : `COP ${dhw_prim_eff.toFixed(1)}`
    sf_nodes.push({ id: dhw_node_id, label: dhwLabel, type: 'system', category: 'dhw', metric: dhwMetric })
  }
  if (lighting_kWh > 0)
    sf_nodes.push({ id: 'lighting',    label: 'Lighting',    type: 'system', category: 'lighting',  metric: `${lpd} W/m²` })
  if (equipment_kWh > 0)
    sf_nodes.push({ id: 'small_power', label: 'Small Power', type: 'system', category: 'equipment', metric: `${epd} W/m²` })
  if (mvhr_recovery_kWh > 0)
    sf_nodes.push({ id: 'mvhr_recov', label: 'Recovered Heat', type: 'recovered' })

  const has_ashp_dhw_preheat = !!dhw_sec_node_id && (dhw_sec_key?.includes('ashp') || dhw_sec_key?.includes('heat_pump'))
  const heat_reject_hint = heat_rejected_kWh > 0 && !has_ashp_dhw_preheat
    ? 'Recovery opportunity: add ASHP preheat to DHW — use this heat to reduce gas consumption' : null
  const vent_exhaust_hint = vent_kWh > 0 && !is_mvhr
    ? 'Recovery opportunity: switch to MVHR to recover ~82% of this ventilation heat loss' : null

  if (heating_thermal > 0) sf_nodes.push({ id: 'space_heat',  label: 'Space Heating', type: 'building' })
  if (cooling_thermal > 0) sf_nodes.push({ id: 'space_cool',  label: 'Space Cooling', type: 'end_use' })
  if (dhw_thermal > 0)     sf_nodes.push({ id: 'dhw_del',     label: 'Hot Water',     type: 'end_use' })
  if (vent_fans_kWh > 0)   sf_nodes.push({ id: 'fresh_air',   label: 'Fresh Air',     type: 'end_use' })
  if (lighting_kWh > 0)    sf_nodes.push({ id: 'light_del',   label: 'Light',         type: 'end_use' })
  if (equipment_kWh > 0)   sf_nodes.push({ id: 'equip_del',   label: 'Equipment',     type: 'end_use' })
  if (heat_rejected_kWh > 0) sf_nodes.push({ id: 'heat_reject', label: 'Heat Rejection', type: 'waste', recovery_hint: heat_reject_hint })
  if (vent_kWh > 0) sf_nodes.push({ id: 'vent_exhaust', label: 'Vent Exhaust', type: 'waste', recovery_hint: vent_exhaust_hint })
  if (heating_flue_kWh > 0)  sf_nodes.push({ id: 'heating_flue', label: 'Heating Flue',  type: 'waste' })
  if (dhw_flue_kWh > 0)      sf_nodes.push({ id: 'dhw_flue',     label: 'DHW Flue Loss', type: 'waste' })

  const sh_elec_total = same_hvac
    ? heating_electricity + cooling_electricity + vrf_fans_kWh
    : heating_electricity + vrf_fans_kWh
  _addLink(sf_links, 'grid', sh_node_id,    sh_elec_total,       'electricity')
  _addLink(sf_links, 'gas',  sh_node_id,    heating_gas,         'gas')
  if (sc_node_id) _addLink(sf_links, 'grid', sc_node_id, cooling_electricity, 'electricity')
  _addLink(sf_links, 'grid', vent_node_id,  vent_fans_kWh,       'electricity')
  if (dhw_sec_node_id && dhwSecDef.fuel === 'electricity')
    _addLink(sf_links, 'grid', dhw_sec_node_id, dhw_elec_kWh,   'electricity')
  if (dhwPrimDef.fuel === 'gas') {
    _addLink(sf_links, 'gas',  dhw_node_id, dhw_gas_kWh,         'gas')
  } else if (dhwPrimDef.fuel === 'electricity' && !dhw_sec_node_id) {
    _addLink(sf_links, 'grid', dhw_node_id, dhw_elec_kWh,        'electricity')
  }
  _addLink(sf_links, 'grid', 'lighting',    lighting_kWh,        'electricity')
  _addLink(sf_links, 'grid', 'small_power', equipment_kWh,       'electricity')
  _addLink(sf_links, sh_node_id, 'space_heat', heating_thermal,  'heating')
  if (same_hvac) {
    _addLink(sf_links, sh_node_id, 'space_cool', cooling_thermal, 'cooling')
  } else if (sc_node_id) {
    _addLink(sf_links, sc_node_id, 'space_cool', cooling_thermal, 'cooling')
  }
  _addLink(sf_links, dhw_node_id,   'dhw_del',    dhw_thermal,   'dhw')
  _addLink(sf_links, vent_node_id,  'fresh_air',  vent_fans_kWh, 'air')
  _addLink(sf_links, 'lighting',    'light_del',  lighting_kWh,  'electricity')
  _addLink(sf_links, 'small_power', 'equip_del',  equipment_kWh, 'electricity')
  const cooling_sys_id = same_hvac ? sh_node_id : sc_node_id
  _addLink(sf_links, cooling_sys_id, 'heat_reject',  heat_rejected_kWh, 'waste')
  _addLink(sf_links, sh_node_id,     'heating_flue', heating_flue_kWh,  'waste')
  _addLink(sf_links, dhw_node_id,    'dhw_flue',     dhw_flue_kWh,      'waste')
  _addLink(sf_links, 'space_heat',   'vent_exhaust', vent_kWh,           'waste')
  _addLink(sf_links, 'mvhr_recov',   'space_heat',   mvhr_recovery_kWh, 'recovered')
  if (dhw_sec_node_id && dhw_thermal > 0) {
    const sec_heat_output = dhwSecDef.fuel === 'electricity'
      ? dhw_elec_kWh * dhw_sec_eff
      : dhw_thermal * dhw_sec_share
    _addLink(sf_links, dhw_sec_node_id, dhw_node_id, sec_heat_output, 'recovered')
  }

  const systems_flow = { nodes: sf_nodes, links: sf_links }

  const heat_balance = _buildHeatBalance({
    geo,
    walls_kWh: acc_walls_loss,
    roof_kWh:  acc_roof_loss,
    floor_kWh: acc_floor_loss,
    glazing_kWh: acc_glaz_loss,
    infiltration_kWh: acc_infil_loss,
    openings_louvre_kWh: acc_openings_louvre_loss,
    openings_window_kWh: acc_openings_window_loss,
    vent_kWh: acc_vent_loss,
    cooling_thermal,
    solar_north: acc_solar_n,
    solar_south: acc_solar_s,
    solar_east:  acc_solar_e,
    solar_west:  acc_solar_w,
    people_kWh: acc_people_internal,
    equipment_kWh: acc_equip_internal,
    lighting_kWh: acc_lighting_internal,
    heating_thermal,
    ach,
  })

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    state:                 stateNum,   // numeric per state contract: 1 | 2 | 2.5 | 3
    mode,                              // string per state contract: 'envelope-only' | 'full' | ...
    eui_kWh_m2:            Math.round(eui_kWh_m2 * 10) / 10,
    annual_heating_kWh:    Math.round(heating_thermal),
    annual_cooling_kWh:    Math.round(cooling_thermal),
    heat_balance,
    gains_losses: {
      heating_side: {
        wall_conduction:    acc_walls_loss      / 1000,
        roof_conduction:    acc_roof_loss       / 1000,
        floor_conduction:   acc_floor_loss      / 1000,
        glazing_conduction: acc_glaz_loss       / 1000,
        infiltration:       acc_infil_loss      / 1000,
        ventilation:        acc_vent_loss       / 1000,
        solar_south:  acc_solar_s           / 1000 * util_factor,
        solar_east:   acc_solar_e           / 1000 * util_factor,
        solar_west:   acc_solar_w           / 1000 * util_factor,
        solar_north:  acc_solar_n           / 1000 * util_factor,
        wall_solar:   acc_opaque_wall_solar / 1000 * util_factor,
        roof_solar:   acc_roof_solar        / 1000 * util_factor,
        equipment:    acc_equip_internal    * util_factor / 1000,
        lighting:     acc_lighting_internal * util_factor / 1000,
        people:       acc_people_internal   * util_factor / 1000,
      },
      cooling_side: {
        solar_south:  acc_solar_s           / 1000 * COOLING_GAIN_FRACTION,
        solar_east:   acc_solar_e           / 1000 * COOLING_GAIN_FRACTION,
        solar_west:   acc_solar_w           / 1000 * COOLING_GAIN_FRACTION,
        solar_north:  acc_solar_n           / 1000 * COOLING_GAIN_FRACTION,
        equipment:    acc_equip_internal    * COOLING_GAIN_FRACTION / 1000,
        lighting:     acc_lighting_internal * COOLING_GAIN_FRACTION / 1000,
        people:       acc_people_internal   * COOLING_GAIN_FRACTION / 1000,
        infiltration_cooling: acc_infil_loss * 0.15 / 1000,
        ventilation_cooling:  acc_vent_loss  * 0.10 / 1000,
      },
    },
    annual_lighting_kWh:   Math.round(lighting_kWh),
    annual_equipment_kWh:  Math.round(equipment_kWh),
    annual_fans_kWh:       Math.round(fans_kWh),
    annual_dhw_kWh:        Math.round(dhw_thermal),
    fabric_losses: {
      walls_kWh:        Math.round(acc_walls_loss),
      roof_kWh:         Math.round(acc_roof_loss),
      floor_kWh:        Math.round(acc_floor_loss),
      glazing_kWh:      Math.round(acc_glaz_loss),
      infiltration_kWh: Math.round(acc_infil_loss),
      ventilation_kWh:  Math.round(acc_vent_loss),
      total_kWh:        Math.round(acc_walls_loss + acc_roof_loss + acc_floor_loss + acc_glaz_loss + acc_infil_loss + acc_vent_loss),
    },
    solar_gains: {
      north_kWh:       Math.round(acc_solar_n),
      south_kWh:       Math.round(acc_solar_s),
      east_kWh:        Math.round(acc_solar_e),
      west_kWh:        Math.round(acc_solar_w),
      opaque_wall_kWh: Math.round(acc_opaque_wall_solar),
      roof_solar_kWh:  Math.round(acc_roof_solar),
      total_kWh:       Math.round(total_solar),
    },
    internal_gains: {
      lighting_kWh:   Math.round(acc_lighting_internal),
      equipment_kWh:  Math.round(acc_equip_internal),
      people_kWh:     Math.round(acc_people_internal),
      total_kWh:      Math.round(total_internal),
    },
    fuel_split: {
      electricity_kWh: Math.round(electricity_kWh),
      gas_kWh:         Math.round(gas_kWh),
      total_kWh:       Math.round(total_kWh),
      electricity_pct: total_kWh > 0 ? Math.round(electricity_kWh / total_kWh * 100) : 100,
      gas_pct:         total_kWh > 0 ? Math.round(gas_kWh / total_kWh * 100) : 0,
    },
    carbon_kgCO2_m2: Math.round(carbon_kgCO2_m2 * 10) / 10,
    gia_m2:  Math.round(gia),
    systems_flow,
    monthly: {
      heating_kWh: Array.from(monthly_heating),
      cooling_kWh: Array.from(monthly_cooling),
      solar_kWh:   Array.from(monthly_solar),
    },
    _inputs: { u_wall, u_roof, u_floor, u_glaz, ach, is_mvhr, heat_recovery, lpd, cop_heating, cop_cooling,
               sh_sys_key, sc_sys_key, vent_sys_key, dhw_prim_key },
  }
}
