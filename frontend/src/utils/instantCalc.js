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
import {
  buildWallModel,
  stepWallLinearized,
  combineLinearizedStep,
  solAirT,
  extractLayers,
  R_SI_WALL,
  R_SI_ROOF,
  R_SI_FLOOR,
  SOLAR_ABS_DEFAULT,
} from './wallModel.js'

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

// Brief 28a Part 5 walkthrough Finding HB1 root cause (2026-05-14):
// Accept both library-item shapes so the engine's g-value lookup
// produces the same result regardless of which consumer prepared
// libraryData:
//   - List endpoint `/api/library/constructions` returns items with
//     `g_value` at the top level (no `config_json` wrapper).
//   - Detail endpoint + raw library_items rows return the value nested
//     under `config_json.g_value`.
// Reading only the nested path silently fell back to DEFAULT_G_VALUE
// (0.40) for Bridgewater's `double_low_e` (real g = 0.42), giving a
// ~4.8% solar drift between modules — Building module (which stores
// API items as-is) saw default 0.40 while Internal Gains (which wraps
// items via `useStateComparison`) saw 0.42. Shared envelope physics
// must be byte-identical across State 1 and State 2 displays per
// zero-tolerance contract.
function getGValue(constructionChoices, libraryData) {
  const name = constructionChoices?.glazing
  if (name && libraryData?.constructions) {
    const item = libraryData.constructions.find(c => c.name === name)
    if (item) {
      const g = item.g_value ?? item.config_json?.g_value
      if (g != null) return Number(g)
    }
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
 * Find a library item for a construction-choice element by name.
 * Returns the item object (with layers) or null if not found.
 */
function getConstructionItem(constructions, libraryData, element) {
  const name = constructions?.[element]
  if (!name) return null
  return libraryData?.constructions?.find(c => c.name === name) ?? null
}

/**
 * State 1 envelope-only computation per `docs/state_contracts.md` § State 1.
 *
 * Brief 28b Part 3 (2026-05-14): refactored to use a multi-node implicit
 * RC wall thermal model per construction (`frontend/src/utils/wallModel.js`)
 * instead of the previous lumped two-node lumped-capacitance approach.
 * Outside boundary on opaque surfaces uses sol-air (T_out + α G / h_out),
 * which absorbs the prior "5% opaque roof solar gain" heuristic into the
 * conduction pathway naturally.
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
 * Physics summary (post Brief 28b Part 3):
 *   1. Solar gain through glazing per facade per hour (transmitted to zone air
 *      via g × (1−frame) × shading × WWR_area). Opaque solar absorption goes
 *      via sol-air on outside surface → conduction → inside surface flux,
 *      NOT as a separate gain term.
 *   2. Each opaque construction (external wall, roof, ground floor) is a
 *      multi-node thermal model. Implicit Euler step each hour. Inside
 *      surface flux derived from the last layer node temperature relative
 *      to zone air through R_si. Per-facade external walls collapsed to one
 *      element with area-weighted sol-air (v1; per-facade thermal state is
 *      a v2 improvement).
 *   3. Ventilation: fabric_leakage from infiltration_ach × volume × dT_air
 *      (steady-state UA × ΔT, gated on dT_air > 0). permanent_vents from
 *      louvres only via CIBSE AM10 single-sided wind. NEVER combined.
 *   4. Glazing: steady-state per-facade UA × ΔT (no thermal mass).
 *   5. Zone air balance solved each hour as a single linear equation using
 *      the wall steps' linearisation in T_air.
 *      Σ (wall_k.U_eff × (T_node_n_k − T_air) × A_k) + glaz_solar_in_zone
 *      − UA_glaz × (T_air − T_out) − UA_vent × (T_air − T_out) = 0
 *   6. Operative T = ½ × (T_air + T_radiant), where T_radiant is the
 *      area-weighted mean of inside-surface temperatures across all
 *      opaque elements (glazing inside surface ≈ T_air since no mass).
 *   7. Demand against comfort band (derived against T_op):
 *      heating_demand[h] = max(0, UA·(lower_c − T_out) − Q_solar) if T_op < lower_c
 *      cooling_demand[h] = max(0, Q_solar + UA·(T_out − upper_c)) if T_op > upper_c
 */
function _calculateEnvelopeOnly(building, constructions, libraryData, weatherData, hourlySolar, comfortBand, tuning = null) {
  // Brief 28b Part 3 v2 (2026-05-14 commit d7c7aad + this commit):
  // optional `tuning` overrides for the three thermal-mass /
  // solar-distribution / surface-resistance parameters. Defaults set
  // from the response-surface sweep in
  // docs/validation/state1_part3_response_surface_2026_05.md.
  // The sweep showed:
  //   - solar_radiative_fraction = 0.30 gives best mean-T match (rest
  //     leak too much heat outward through wall sol-air pathway)
  //   - internal_mass = 100 kJ/(K·m²) gives EXACT summer max match
  //     to EnergyPlus (35.5 °C vs EP 35.4 °C on Bridgewater)
  //   - R_si has no measurable response at Bridgewater's R_total
  //     (insulation dominates); kept at BS EN ISO 6946 defaults.
  // Structural gaps remain (mean T ~1.7 K cooler than EP, winter min
  // 4 K cooler, cooling demand 35% under) — these don't close with
  // these knobs and need Part 3 v3 (glazing-inside solar absorption).
  const TUNE_SOLAR_RAD_FRAC      = (tuning && Number.isFinite(tuning.solar_radiative_fraction))
    ? tuning.solar_radiative_fraction : 0.30
  const TUNE_INTERNAL_MASS_J_M2  = (tuning && Number.isFinite(tuning.internal_mass_J_per_K_per_m2))
    ? tuning.internal_mass_J_per_K_per_m2 : 250_000
  const TUNE_R_SI_WALL_OVR       = (tuning && Number.isFinite(tuning.R_si_wall))
    ? tuning.R_si_wall : R_SI_WALL
  const TUNE_R_SI_ROOF_OVR       = (tuning && Number.isFinite(tuning.R_si_roof))
    ? tuning.R_si_roof : R_SI_ROOF
  const TUNE_R_SI_FLOOR_OVR      = (tuning && Number.isFinite(tuning.R_si_floor))
    ? tuning.R_si_floor : R_SI_FLOOR
  // Brief 28b Part 3 v3 (2026-05-14): glazing inside-surface solar
  // absorption. Represents short-wave radiation absorbed at the glazing
  // interior surface (some from primary transmission absorbed in the
  // inner pane low-e coating; some from diffuse interior re-reflections).
  // EnergyPlus models this implicitly via the window energy balance;
  // our simplified static engine misses it without an explicit term.
  // Physically: heats the glazing inside surface, which convects directly
  // to T_air — adds a "loss-free" solar gain term that doesn't transit
  // through the wall stack. Default 0 (production code path unchanged
  // until sweep picks a value). Range explored: [0.03, 0.05, 0.07, 0.10, 0.15].
  const TUNE_GLAZ_INSIDE_ABS     = (tuning && Number.isFinite(tuning.glazing_inside_absorption_fraction))
    ? tuning.glazing_inside_absorption_fraction : 0.07

  const geo = computeGeometry(building)
  const { gia, volume, total_wall_opaque, total_glazing, glazing, wall_opaque, roof_area, ground_area } = geo
  if (gia <= 0) return _empty()

  // ── Library U / g values (used for glazing only post Brief 28b Part 3) ────
  const u_glaz  = getUValue(constructions, 'glazing', libraryData)
  const g_value = getGValue(constructions, libraryData)
  const FRAME_FRACTION = 0.20  // visible glass = 80% of WWR; framed area = 20%
  // Brief 26.1 follow-up: per-facade shading factors from overhang + fin geometry.
  const shadingFactors = computeShadingFactors(building)

  // ── Multi-node wall models (Brief 28b Part 3) ────────────────────────────
  // Opaque elements (external wall, roof, ground floor) get a full
  // multi-node implicit RC model per construction stack. Glazing stays
  // steady-state UA × ΔT since it has effectively zero thermal capacity
  // in the library.
  const extWallItem = getConstructionItem(constructions, libraryData, 'external_wall')
  const roofItem    = getConstructionItem(constructions, libraryData, 'roof')
  const floorItem   = getConstructionItem(constructions, libraryData, 'ground_floor')
  const extWallModel = buildWallModel(extractLayers(extWallItem), {
    R_si: TUNE_R_SI_WALL_OVR,
    solar_abs: 0.6,    // brick / render typical
    h_out: 25,
  })
  const roofModel = buildWallModel(extractLayers(roofItem), {
    R_si: TUNE_R_SI_ROOF_OVR,
    solar_abs: 0.7,    // tiles / dark roofing typical
    h_out: 25,
  })
  const floorModel = buildWallModel(extractLayers(floorItem), {
    R_so: 0.0,         // ground in direct contact, no external film
    R_si: TUNE_R_SI_FLOOR_OVR,
    solar_abs: 0,      // no solar on slab outer face
    h_out: 1e9,        // effectively bypasses sol-air (no convection lost to sky)
  })

  // ── Whole-wall U-values from the layer stack (for demand UA calc) ────────
  // Note: model.U_eff used in the zone-balance linearisation is the
  // node-to-air conductance (1/R_n), NOT the whole-wall U. For demand
  // calculations we need 1/R_total = whole-wall steady-state U.
  const wholeWallU_ext   = extWallModel.type === 'mass' ? 1 / extWallModel.R_total : (extWallModel.U ?? 0)
  const wholeWallU_roof  = roofModel.type    === 'mass' ? 1 / roofModel.R_total    : (roofModel.U ?? 0)
  const wholeWallU_floor = floorModel.type   === 'mass' ? 1 / floorModel.R_total   : (floorModel.U ?? 0)
  const UA_wall_whole  = wholeWallU_ext   * total_wall_opaque
  const UA_roof_whole  = wholeWallU_roof  * roof_area
  const UA_floor_whole = wholeWallU_floor * ground_area

  // ── UA products for non-mass elements (W/K) ──────────────────────────────
  const UA_glaz = u_glaz * total_glazing
  // Per-facade glazing conductances (W/K) — for the conduction-by-glazing-face split
  const glaz_face_UA = (f) => u_glaz * (glazing[f] ?? 0)

  // ── Ground temperature for ground-floor outside boundary ─────────────────
  // EnergyPlus defaults to ~12.6 °C deep ground when no Site:GroundTemperature
  // object is provided (which is the case in our envelope-only epJSON). Use
  // the Yeovilton annual mean as a reasonable simplified ground T constant.
  // (A monthly-mean lagged-air-T model is a future refinement.)
  let _T_out_sum = 0
  for (let h = 0; h < weatherData.temperature.length; h++) _T_out_sum += weatherData.temperature[h]
  const T_ground = _T_out_sum / weatherData.temperature.length

  // ── Ventilation (split) ──────────────────────────────────────────────────
  const ach = Number(building.infiltration_ach ?? 0.5)
  const UA_leakage = AIR_HEAT_CAPACITY * ach * volume   // W/K (Wh/K per hour)

  // Permanent openings (louvres only — operable windows are State 2.5)
  const openings = building.openings ?? {}
  const Cd = 0.6
  const Cw = ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })[openings.site_exposure] ?? 0.10
  const sqrtCw = Math.sqrt(Cw)
  const louvre_area_total = ['north','south','east','west']
    .reduce((s, f) => s + Number(openings?.[f]?.louvre_area_m2 ?? 0), 0)

  // ── Zone-air effective thermal capacitance (Brief 28b Part 3) ────────────
  // Represents zone air + internal mass (furniture, partitions, content)
  // well-coupled to T_air. Without this term the zone air balance is
  // purely quasi-steady, so T_air tracks the outside-air signal too
  // tightly in winter night periods (no buffering). EnergyPlus
  // "InternalMass" contributions typically fall in 30-200 kJ/(K·m²)
  // depending on building type; 100 kJ/(K·m²) is the v2 default, picked
  // from the response-surface sweep against EP on Bridgewater. Lighter
  // buildings (steel frame, partition-walled offices) may benefit from
  // 50; heavier (concrete frame, exposed slabs) from 200. Brief 28b
  // Part 5 candidate: derive from library construction stack instead
  // of fixed default.
  const INTERNAL_MASS_J_PER_K_PER_M2_GIA = TUNE_INTERNAL_MASS_J_M2  // J/(K·m²) — partitions + furniture estimate
  const C_air_air_J = (volume * 1.2 * 1005)   // pure zone-air heat capacity (J/K) — ≈ 13 MJ/K for Bridgewater
  const C_air_internal_J = INTERNAL_MASS_J_PER_K_PER_M2_GIA * gia
  const C_air_total_J = C_air_air_J + C_air_internal_J   // J/K coupled to T_air

  // ── 8760-hour loop ───────────────────────────────────────────────────────
  const n = weatherData.temperature.length
  const T_hourly = new Float32Array(n)
  const dt = 3600  // seconds per timestep

  // Initial state for each wall: uniform at comfortBand.lower_c. With masses
  // on the order of days, expect ~1-2 days of spin-up before transient
  // initial conditions are forgotten.
  let TS_wall  = new Float64Array(extWallModel.type === 'mass' ? extWallModel.n : 0).fill(comfortBand.lower_c)
  let TS_roof  = new Float64Array(roofModel.type    === 'mass' ? roofModel.n    : 0).fill(comfortBand.lower_c)
  let TS_floor = new Float64Array(floorModel.type   === 'mass' ? floorModel.n   : 0).fill(comfortBand.lower_c)
  let T_air = comfortBand.lower_c

  // Per-facade opaque-wall areas (used to area-weight sol-air G for the
  // collapsed single-state external-wall model; v1 fidelity)
  const wallOpaqueByFace = wall_opaque
  const _safe_wall_opaque_total = Math.max(total_wall_opaque, 1e-9)

  // Annual accumulators (Wh — divide by 1000 at the end for kWh)
  let acc_solar_n = 0, acc_solar_s = 0, acc_solar_e = 0, acc_solar_w = 0
  // No acc_solar_roof — the 5 % opaque-roof heuristic is dropped; solar on
  // opaque roof is now in sol-air → conduction → inside flux.
  let acc_cond_wall  = 0, acc_cond_roof = 0, acc_cond_floor = 0
  let acc_cond_glaz_n = 0, acc_cond_glaz_s = 0, acc_cond_glaz_e = 0, acc_cond_glaz_w = 0
  let acc_thermal_bridging = 0   // remains for the breakdown shape; populated only if Y-factor > 1 (not used yet)
  let acc_vent_leakage = 0, acc_vent_permanent = 0
  let acc_heating_demand_Wh = 0, acc_cooling_demand_Wh = 0
  let underheating_hours = 0, overheating_hours = 0, comfort_hours = 0
  let T_winter_min = Infinity, T_summer_max = -Infinity

  for (let h = 0; h < n; h++) {
    const T_out = weatherData.temperature[h]
    const v_wind = weatherData.wind_speed?.[h] ?? 0

    // Solar gains transmitted through glazing per facade (Wh into the zone)
    const sol_n = hourlySolar.f1[h] * (glazing.north ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.north
    const sol_e = hourlySolar.f2[h] * (glazing.east  ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.east
    const sol_s = hourlySolar.f3[h] * (glazing.south ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.south
    const sol_w = hourlySolar.f4[h] * (glazing.west  ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.west
    const Q_solar_glaz_zone = sol_n + sol_e + sol_s + sol_w
    acc_solar_n += sol_n; acc_solar_e += sol_e; acc_solar_s += sol_s; acc_solar_w += sol_w

    // Sol-air boundary T for opaque external wall.
    // Area-weighted average incident solar across the four opaque facade
    // segments. (Single shared wall state — per-facade thermal mass is a v2.)
    const G_wall_avg = (
      hourlySolar.f1[h] * wallOpaqueByFace.north +
      hourlySolar.f2[h] * wallOpaqueByFace.east  +
      hourlySolar.f3[h] * wallOpaqueByFace.south +
      hourlySolar.f4[h] * wallOpaqueByFace.west
    ) / _safe_wall_opaque_total
    const T_sa_wall = solAirT(T_out, G_wall_avg, extWallModel.solar_abs ?? 0.6, extWallModel.h_out ?? 25)
    const T_sa_roof = solAirT(T_out, hourlySolar.roof[h], roofModel.solar_abs ?? 0.7, roofModel.h_out ?? 25)
    // Floor outside BC = T_ground (constant simplification — EP default
    // deep-ground temperature ~12.6 °C; we use Yeovilton annual mean).

    // Permanent-vent UA this hour (wind-driven)
    const Q_louvre_m3s = Cd * louvre_area_total * sqrtCw * v_wind
    const UA_permanent = AIR_HEAT_CAPACITY * (Q_louvre_m3s * 3600)

    // ── Glazing-transmitted solar split: radiative + convective ──────────
    // Per EnergyPlus convention with default "FullInteriorAndExterior"
    // solar distribution: short-wave radiation transmitted through
    // glazing is absorbed at interior surfaces. Of that absorbed energy,
    // the fraction that reaches zone air on the same timestep depends
    // on the surface convective coupling (h_int × surf_area × dT). For
    // simulation hourly timesteps we use a fixed convective-fraction
    // split: a portion lands directly on zone air (representing
    // short-wave absorbed by furniture/floor that quickly re-radiates,
    // plus immediate convective gain from heated interior surfaces),
    // remainder absorbed at opaque interior surfaces where it enters
    // wall thermal mass.
    const SOLAR_RADIATIVE_FRACTION = TUNE_SOLAR_RAD_FRAC  // fraction absorbed slowly at opaque interior surfaces
    const SOLAR_CONVECTIVE_FRACTION = 1.0 - SOLAR_RADIATIVE_FRACTION
    const A_internal_opaque = total_wall_opaque + roof_area + ground_area
    const q_solar_to_inside_surf = (A_internal_opaque > 0)
      ? (SOLAR_RADIATIVE_FRACTION * Q_solar_glaz_zone) / A_internal_opaque
      : 0  // W/m² of inside surface

    // Brief 28b Part 3 v3: additional gain term from short-wave solar
    // absorbed AT the inside glazing surface. Scales with incident solar
    // on glazing (pre-g_value, post-frame, post-shading). Bypasses wall
    // mass and arrives directly at T_air via convection from the heated
    // glazing surface. Reports separately for accounting transparency.
    const Q_glaz_incident_post_shading = (
      hourlySolar.f1[h] * (glazing.north ?? 0) * shadingFactors.north +
      hourlySolar.f2[h] * (glazing.east  ?? 0) * shadingFactors.east  +
      hourlySolar.f3[h] * (glazing.south ?? 0) * shadingFactors.south +
      hourlySolar.f4[h] * (glazing.west  ?? 0) * shadingFactors.west
    ) * (1 - FRAME_FRACTION)
    const Q_solar_glazing_inside_abs = TUNE_GLAZ_INSIDE_ABS * Q_glaz_incident_post_shading

    const Q_solar_to_zone_air = SOLAR_CONVECTIVE_FRACTION * Q_solar_glaz_zone + Q_solar_glazing_inside_abs

    // ── Linearised implicit-Euler step for each opaque wall ───────────────
    // Each returns:
    //   T_state^{n+1} = T_part + T_homo × T_air
    //   T_inside_node = a + b × T_air
    //   Q_in_to_air   = (T_inside_node − T_air) × U_eff
    // We collect the linear coefficients across walls + glazing + vent and
    // solve the zone-air balance in one shot.
    const stepWall  = stepWallLinearized(extWallModel,  TS_wall,  T_sa_wall,  dt, q_solar_to_inside_surf)
    const stepRoof  = stepWallLinearized(roofModel,     TS_roof,  T_sa_roof,  dt, q_solar_to_inside_surf)
    const stepFloor = stepWallLinearized(floorModel,    TS_floor, T_ground,   dt, q_solar_to_inside_surf)

    // For each wall: Q_in_to_air (W) = U_eff × A × (T_inside_node − T_air)
    //   = U_eff × A × ((a + b × T_air) − T_air)
    //   = U_eff × A × a   +   U_eff × A × (b − 1) × T_air
    const UA_wall_eff  = stepWall.U_eff  * total_wall_opaque
    const UA_roof_eff  = stepRoof.U_eff  * roof_area
    const UA_floor_eff = stepFloor.U_eff * ground_area

    // ── Zone air energy balance (W; implicit Euler in T_air) ──────────────
    //   C_air/dt × (T_air^{n+1} − T_air^n) = Σ Q_in_to_air_k^{n+1}
    //                                       − UA_glaz × (T_air^{n+1} − T_out)
    //                                       − UA_vent × (T_air^{n+1} − T_out)
    //
    // Solar transmitted through glazing is NOT a direct zone-air gain at
    // State 1 — it's absorbed at opaque inside surfaces above and enters
    // T_air indirectly via wall step's q_in_to_air response.
    //
    //   C × T_air^{n+1} + D = 0  →  T_air = −D / C
    const C_air_per_dt = C_air_total_J / dt   // W/K
    const C_coef =
      UA_wall_eff  * (stepWall.b_inside_node  - 1) +
      UA_roof_eff  * (stepRoof.b_inside_node  - 1) +
      UA_floor_eff * (stepFloor.b_inside_node - 1) -
      UA_glaz - UA_leakage - UA_permanent -
      C_air_per_dt
    const D_coef =
      UA_wall_eff  * stepWall.a_inside_node  +
      UA_roof_eff  * stepRoof.a_inside_node  +
      UA_floor_eff * stepFloor.a_inside_node +
      (UA_glaz + UA_leakage + UA_permanent) * T_out +
      C_air_per_dt * T_air +   // T_air on RHS is the previous-hour value
      Q_solar_to_zone_air      // convective fraction of glazing-transmitted solar
    // Avoid division by ≈ 0 in degenerate cases (no walls, no vent)
    T_air = (Math.abs(C_coef) > 1e-9) ? (-D_coef / C_coef) : T_out

    // Reconstruct wall states with the solved T_air
    TS_wall  = combineLinearizedStep(stepWall,  T_air)
    TS_roof  = combineLinearizedStep(stepRoof,  T_air)
    TS_floor = combineLinearizedStep(stepFloor, T_air)

    // Inside surface T per wall (just inside R_si) — used for T_radiant.
    // T_in_surf = T_air + (T_inside_node − T_air) × (R_si × U_eff)
    // (R_si × U_eff = R_si / R_total is the fraction of the temperature drop
    // that falls across R_si). For air balance + losses we use T_inside_node
    // directly; for T_radiant we want the surface T users see.
    const t_node_wall  = stepWall.massless  ? T_sa_wall  : TS_wall[TS_wall.length   - 1]
    const t_node_roof  = stepRoof.massless  ? T_sa_roof  : TS_roof[TS_roof.length   - 1]
    const t_node_floor = stepFloor.massless ? T_ground   : TS_floor[TS_floor.length - 1]
    const T_in_surf_wall  = T_air + (t_node_wall  - T_air) * (stepWall.R_si  * stepWall.U_eff)
    const T_in_surf_roof  = T_air + (t_node_roof  - T_air) * (stepRoof.R_si  * stepRoof.U_eff)
    const T_in_surf_floor = T_air + (t_node_floor - T_air) * (stepFloor.R_si * stepFloor.U_eff)

    // T_radiant: area-weighted mean inside-surface T. Glazing inside surface
    // ≈ T_air (no mass), so it doesn't shift T_radiant much; include it for
    // completeness.
    const _A_total_surf = total_wall_opaque + roof_area + ground_area + total_glazing
    const T_radiant = (
      T_in_surf_wall  * total_wall_opaque +
      T_in_surf_roof  * roof_area +
      T_in_surf_floor * ground_area +
      T_air           * total_glazing
    ) / Math.max(_A_total_surf, 1e-9)

    const T_op = 0.5 * (T_air + T_radiant)
    T_hourly[h] = T_op

    // ── Loss accumulators ────────────────────────────────────────────────
    // Convention: report integrated annual loss via whole-wall U × area ×
    // dT_air_to_out for hours when zone is warmer than outside. This is the
    // "steady-state" conductive loss attributable to each fabric element.
    // The wall's dynamic mass response affects the T_air trace (and thus
    // the integrated dT), but the per-element loss accounting uses whole-
    // wall U so that the breakdown sums to the total fabric loss without
    // including transient storage swings. Same convention as glazing +
    // ventilation, and matches what EP reports for per-construction loss.
    const dT_air_for_loss = T_air - T_out
    const dT_air_to_ground = T_air - T_ground
    if (dT_air_for_loss > 0) {
      acc_cond_wall      += wholeWallU_ext   * total_wall_opaque * dT_air_for_loss
      acc_cond_roof      += wholeWallU_roof  * roof_area         * dT_air_for_loss
      acc_cond_glaz_n    += glaz_face_UA('north') * dT_air_for_loss
      acc_cond_glaz_e    += glaz_face_UA('east')  * dT_air_for_loss
      acc_cond_glaz_s    += glaz_face_UA('south') * dT_air_for_loss
      acc_cond_glaz_w    += glaz_face_UA('west')  * dT_air_for_loss
      acc_vent_leakage   += UA_leakage    * dT_air_for_loss
      acc_vent_permanent += UA_permanent  * dT_air_for_loss
    }
    if (dT_air_to_ground > 0) {
      acc_cond_floor     += wholeWallU_floor * ground_area * dT_air_to_ground
    }

    // Comfort hours + T extremes
    const month = weatherData.month[h]
    if (T_op < comfortBand.lower_c)      underheating_hours++
    else if (T_op > comfortBand.upper_c) overheating_hours++
    else                                  comfort_hours++
    if (month >= 12 || month <= 2) T_winter_min = Math.min(T_winter_min, T_op)
    if (month >= 6  && month <= 8) T_summer_max = Math.max(T_summer_max, T_op)

    // ── Demand derivation ───────────────────────────────────────────────
    // Count Wh a perfect system would have delivered to hold T_op at the
    // comfort band edge. UA totals use WHOLE-WALL U-values (1/Σ R from
    // the layer stack), not node-to-air conductance — the latter would
    // double-count the wall internals on the demand side.
    const UA_total_now =
      UA_wall_whole + UA_roof_whole + UA_floor_whole +
      UA_glaz + UA_leakage + UA_permanent
    const Q_solar_in_Wh_for_demand = Q_solar_glaz_zone   // glazing transmitted only
    if (T_op < comfortBand.lower_c) {
      const Q_loss_at_lower = UA_total_now * Math.max(0, comfortBand.lower_c - T_out)
      const heating_Wh = Math.max(0, Q_loss_at_lower - Q_solar_in_Wh_for_demand)
      acc_heating_demand_Wh += heating_Wh
    } else if (T_op > comfortBand.upper_c) {
      const Q_gain_at_upper = Q_solar_in_Wh_for_demand + UA_total_now * Math.max(0, T_out - comfortBand.upper_c)
      acc_cooling_demand_Wh += Q_gain_at_upper
    }
  }
  // No more roof solar heuristic — kept the variable name acc_solar_roof = 0
  // for output-shape compatibility with the previous engine.
  const acc_solar_roof = 0

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
 * Brief 27 Part 2 (initial). Brief 28c (2026-05-14): refactored the inner
 * loop to share the same multi-node CTF wall model used by State 1 (from
 * Brief 28b Part 3 v3). State 2 now recomputes losses on its OWN T_op
 * trace rather than inheriting State 1's static losses — closes the
 * contract gap. Same tuning values as State 1 v3:
 *   solar_radiative_fraction        = 0.30
 *   internal_mass_kJ_per_K_per_m2   = 250
 *   glazing_inside_absorption_frac  = 0.07
 * Internal gains use the same radiative/convective split as solar (30/70).
 *
 * Implementation: calls `_calculateEnvelopeOnly` first to get the
 * canonical State 1 baseline (state1Result, used for solar gains in the
 * heat_balance output + delta computations). Then runs an INDEPENDENT
 * 8760-hour loop with internal gains added to the zone air balance.
 */
function _calculateState2(building, constructions, libraryData, weatherData, hourlySolar, comfortBand) {
  // ── State 1 baseline ─────────────────────────────────────────────────────
  const state1Result = _calculateEnvelopeOnly(
    withMode(building, 'envelope-only'),
    constructions, libraryData, weatherData, hourlySolar, comfortBand,
  )
  if (state1Result.state !== 1) return state1Result   // bailout: _empty() or similar

  // ── State 2 inner loop (multi-node walls, sol-air, glazing inside absorption,
  //                       internal gains distributed radiative + convective) ──
  const geo = computeGeometry(building)
  const { gia, volume, total_wall_opaque, total_glazing, glazing, wall_opaque, roof_area, ground_area } = geo
  if (gia <= 0) return state1Result

  // Match State 1 v3 production tuning
  const TUNE_SOLAR_RAD_FRAC = 0.30
  const TUNE_INTERNAL_MASS_J_M2 = 250_000
  const TUNE_GLAZ_INSIDE_ABS = 0.07

  // Glazing U + g, shading factors (same as State 1)
  const u_glaz = getUValue(constructions, 'glazing', libraryData)
  const g_value = getGValue(constructions, libraryData)
  const FRAME_FRACTION = 0.20
  const shadingFactors = computeShadingFactors(building)

  // Multi-node wall models for opaque elements
  const extWallItem = getConstructionItem(constructions, libraryData, 'external_wall')
  const roofItem    = getConstructionItem(constructions, libraryData, 'roof')
  const floorItem   = getConstructionItem(constructions, libraryData, 'ground_floor')
  const extWallModel = buildWallModel(extractLayers(extWallItem), { R_si: R_SI_WALL,  solar_abs: 0.6, h_out: 25 })
  const roofModel    = buildWallModel(extractLayers(roofItem),    { R_si: R_SI_ROOF,  solar_abs: 0.7, h_out: 25 })
  const floorModel   = buildWallModel(extractLayers(floorItem),   { R_so: 0.0, R_si: R_SI_FLOOR, solar_abs: 0, h_out: 1e9 })

  // Whole-wall U-values (for loss + demand UA totals)
  const wholeWallU_ext   = extWallModel.type === 'mass' ? 1 / extWallModel.R_total : (extWallModel.U ?? 0)
  const wholeWallU_roof  = roofModel.type    === 'mass' ? 1 / roofModel.R_total    : (roofModel.U ?? 0)
  const wholeWallU_floor = floorModel.type   === 'mass' ? 1 / floorModel.R_total   : (floorModel.U ?? 0)

  // Glazing UA
  const UA_glaz = u_glaz * total_glazing
  const glaz_face_UA = (f) => u_glaz * (glazing[f] ?? 0)

  // Ground T (annual mean, constant — matches State 1)
  let _T_out_sum = 0
  for (let h = 0; h < weatherData.temperature.length; h++) _T_out_sum += weatherData.temperature[h]
  const T_ground = _T_out_sum / weatherData.temperature.length

  // Ventilation
  const ach = Number(building.infiltration_ach ?? 0.5)
  const UA_leakage = AIR_HEAT_CAPACITY * ach * volume
  const openings = building.openings ?? {}
  const Cd = 0.6
  const Cw = ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })[openings.site_exposure] ?? 0.10
  const sqrtCw = Math.sqrt(Cw)
  const louvre_area_total = ['north','south','east','west']
    .reduce((s, f) => s + Number(openings?.[f]?.louvre_area_m2 ?? 0), 0)

  // Zone-air effective mass (matches State 1 v3 tuning)
  const C_air_air_J = volume * 1.2 * 1005
  const C_air_internal_J = TUNE_INTERNAL_MASS_J_M2 * gia
  const C_air_total_J = C_air_air_J + C_air_internal_J

  // 8760-hour loop setup
  const n = weatherData.temperature.length
  const T_hourly = new Float32Array(n)
  const dt = 3600

  let TS_wall  = new Float64Array(extWallModel.type === 'mass' ? extWallModel.n : 0).fill(comfortBand.lower_c)
  let TS_roof  = new Float64Array(roofModel.type    === 'mass' ? roofModel.n    : 0).fill(comfortBand.lower_c)
  let TS_floor = new Float64Array(floorModel.type   === 'mass' ? floorModel.n   : 0).fill(comfortBand.lower_c)
  let T_air = comfortBand.lower_c

  const wallOpaqueByFace = wall_opaque
  const _safe_wall_opaque_total = Math.max(total_wall_opaque, 1e-9)

  // Internal-gain accumulators (existing State 2 pattern)
  let acc_people = 0, acc_lighting = 0
  let acc_equip_baseload = 0, acc_equip_active = 0
  let peak_people = 0, peak_lighting = 0, peak_equipment = 0
  let hours_people = 0, hours_lighting = 0, hours_equipment_active = 0
  let sum_effective_occupants = 0, peak_occupants = 0

  const lightingProfileAccum = new Map()
  const equipmentProfileAccum = new Map()
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

  // State 2 own loss + demand accumulators (Brief 28c — replaces state1Result inheritance)
  let acc_solar_n = 0, acc_solar_s = 0, acc_solar_e = 0, acc_solar_w = 0
  let acc_cond_wall = 0, acc_cond_roof = 0, acc_cond_floor = 0
  let acc_cond_glaz_n = 0, acc_cond_glaz_s = 0, acc_cond_glaz_e = 0, acc_cond_glaz_w = 0
  let acc_thermal_bridging = 0
  let acc_vent_leakage = 0, acc_vent_permanent = 0
  let acc_heating_demand_Wh = 0, acc_cooling_demand_Wh = 0
  let underheating_hours = 0, overheating_hours = 0, comfort_hours = 0
  let T_winter_min = Infinity, T_summer_max = -Infinity

  for (let h = 0; h < n; h++) {
    const T_out = weatherData.temperature[h]
    const v_wind = weatherData.wind_speed?.[h] ?? 0

    // Solar through glazing per facade (Wh into zone, post g × frame × shading)
    const sol_n = hourlySolar.f1[h] * (glazing.north ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.north
    const sol_e = hourlySolar.f2[h] * (glazing.east  ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.east
    const sol_s = hourlySolar.f3[h] * (glazing.south ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.south
    const sol_w = hourlySolar.f4[h] * (glazing.west  ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.west
    const Q_solar_glaz_zone = sol_n + sol_e + sol_s + sol_w
    acc_solar_n += sol_n; acc_solar_e += sol_e; acc_solar_s += sol_s; acc_solar_w += sol_w

    // Internal gains
    const gains = computeHourlyGains(building, h, weatherData, gia)
    acc_people += gains.people; acc_lighting += gains.lighting
    acc_equip_baseload += gains.equipment_baseload; acc_equip_active += gains.equipment_active
    if (gains.people > peak_people) peak_people = gains.people
    if (gains.lighting > peak_lighting) peak_lighting = gains.lighting
    if (gains.equipment > peak_equipment) peak_equipment = gains.equipment
    if (gains.people > 0.01) hours_people++
    if (gains.lighting > 0.01) hours_lighting++
    if (gains.equipment_active > 0.01) hours_equipment_active++
    sum_effective_occupants += gains.effective_occupants
    if (gains.effective_occupants > peak_occupants) peak_occupants = gains.effective_occupants
    if (gains.lighting_per_profile)  for (const p of gains.lighting_per_profile)  accumLighting(p.id, p.value)
    if (gains.equipment_per_profile) for (const p of gains.equipment_per_profile) accumEquipment(p.id, p.value, p.baseload, p.active)
    const Q_internal_total_Wh = gains.total

    // Sol-air outside boundary for opaque elements (area-weighted G)
    const G_wall_avg = (
      hourlySolar.f1[h] * wallOpaqueByFace.north +
      hourlySolar.f2[h] * wallOpaqueByFace.east  +
      hourlySolar.f3[h] * wallOpaqueByFace.south +
      hourlySolar.f4[h] * wallOpaqueByFace.west
    ) / _safe_wall_opaque_total
    const T_sa_wall = solAirT(T_out, G_wall_avg, extWallModel.solar_abs ?? 0.6, extWallModel.h_out ?? 25)
    const T_sa_roof = solAirT(T_out, hourlySolar.roof[h], roofModel.solar_abs ?? 0.7, roofModel.h_out ?? 25)

    // Permanent vents UA
    const Q_louvre_m3s = Cd * louvre_area_total * sqrtCw * v_wind
    const UA_permanent = AIR_HEAT_CAPACITY * (Q_louvre_m3s * 3600)

    // Glazing inside-surface absorption (extra direct-to-air term)
    const Q_glaz_incident_post_shading = (
      hourlySolar.f1[h] * (glazing.north ?? 0) * shadingFactors.north +
      hourlySolar.f2[h] * (glazing.east  ?? 0) * shadingFactors.east  +
      hourlySolar.f3[h] * (glazing.south ?? 0) * shadingFactors.south +
      hourlySolar.f4[h] * (glazing.west  ?? 0) * shadingFactors.west
    ) * (1 - FRAME_FRACTION)
    const Q_solar_glazing_inside_abs = TUNE_GLAZ_INSIDE_ABS * Q_glaz_incident_post_shading

    // Solar + internal gain distribution (same radiative/convective split for both)
    const Q_short_wave_total = Q_solar_glaz_zone + Q_internal_total_Wh
    const A_internal_opaque = total_wall_opaque + roof_area + ground_area
    const q_to_inside_surf = (A_internal_opaque > 0)
      ? (TUNE_SOLAR_RAD_FRAC * Q_short_wave_total) / A_internal_opaque
      : 0
    const Q_to_zone_air = (1 - TUNE_SOLAR_RAD_FRAC) * Q_short_wave_total + Q_solar_glazing_inside_abs

    // Linearised wall step
    const stepWall  = stepWallLinearized(extWallModel,  TS_wall,  T_sa_wall, dt, q_to_inside_surf)
    const stepRoof  = stepWallLinearized(roofModel,     TS_roof,  T_sa_roof, dt, q_to_inside_surf)
    const stepFloor = stepWallLinearized(floorModel,    TS_floor, T_ground,  dt, q_to_inside_surf)
    const UA_wall_eff  = stepWall.U_eff  * total_wall_opaque
    const UA_roof_eff  = stepRoof.U_eff  * roof_area
    const UA_floor_eff = stepFloor.U_eff * ground_area

    // Zone air implicit Euler balance
    const C_air_per_dt = C_air_total_J / dt
    const C_coef =
      UA_wall_eff  * (stepWall.b_inside_node  - 1) +
      UA_roof_eff  * (stepRoof.b_inside_node  - 1) +
      UA_floor_eff * (stepFloor.b_inside_node - 1) -
      UA_glaz - UA_leakage - UA_permanent -
      C_air_per_dt
    const D_coef =
      UA_wall_eff  * stepWall.a_inside_node +
      UA_roof_eff  * stepRoof.a_inside_node +
      UA_floor_eff * stepFloor.a_inside_node +
      (UA_glaz + UA_leakage + UA_permanent) * T_out +
      C_air_per_dt * T_air +
      Q_to_zone_air
    T_air = (Math.abs(C_coef) > 1e-9) ? (-D_coef / C_coef) : T_out

    TS_wall  = combineLinearizedStep(stepWall,  T_air)
    TS_roof  = combineLinearizedStep(stepRoof,  T_air)
    TS_floor = combineLinearizedStep(stepFloor, T_air)

    // Operative T = ½ (T_air + T_radiant)
    const t_node_wall  = stepWall.massless  ? T_sa_wall  : TS_wall[TS_wall.length   - 1]
    const t_node_roof  = stepRoof.massless  ? T_sa_roof  : TS_roof[TS_roof.length   - 1]
    const t_node_floor = stepFloor.massless ? T_ground   : TS_floor[TS_floor.length - 1]
    const T_in_surf_wall  = T_air + (t_node_wall  - T_air) * (stepWall.R_si  * stepWall.U_eff)
    const T_in_surf_roof  = T_air + (t_node_roof  - T_air) * (stepRoof.R_si  * stepRoof.U_eff)
    const T_in_surf_floor = T_air + (t_node_floor - T_air) * (stepFloor.R_si * stepFloor.U_eff)
    const _A_total_surf = total_wall_opaque + roof_area + ground_area + total_glazing
    const T_radiant = (
      T_in_surf_wall  * total_wall_opaque +
      T_in_surf_roof  * roof_area +
      T_in_surf_floor * ground_area +
      T_air           * total_glazing
    ) / Math.max(_A_total_surf, 1e-9)
    const T_op = 0.5 * (T_air + T_radiant)
    T_hourly[h] = T_op

    // Loss accumulators (whole-wall U × area × dT_pos, same convention as State 1)
    const dT_air_for_loss  = T_air - T_out
    const dT_air_to_ground = T_air - T_ground
    if (dT_air_for_loss > 0) {
      acc_cond_wall      += wholeWallU_ext   * total_wall_opaque * dT_air_for_loss
      acc_cond_roof      += wholeWallU_roof  * roof_area         * dT_air_for_loss
      acc_cond_glaz_n    += glaz_face_UA('north') * dT_air_for_loss
      acc_cond_glaz_e    += glaz_face_UA('east')  * dT_air_for_loss
      acc_cond_glaz_s    += glaz_face_UA('south') * dT_air_for_loss
      acc_cond_glaz_w    += glaz_face_UA('west')  * dT_air_for_loss
      acc_vent_leakage   += UA_leakage    * dT_air_for_loss
      acc_vent_permanent += UA_permanent  * dT_air_for_loss
    }
    if (dT_air_to_ground > 0) {
      acc_cond_floor     += wholeWallU_floor * ground_area * dT_air_to_ground
    }

    // Comfort hours + T extremes
    const month = weatherData.month[h]
    if (T_op < comfortBand.lower_c)      underheating_hours++
    else if (T_op > comfortBand.upper_c) overheating_hours++
    else                                  comfort_hours++
    if (month >= 12 || month <= 2) T_winter_min = Math.min(T_winter_min, T_op)
    if (month >= 6  && month <= 8) T_summer_max = Math.max(T_summer_max, T_op)

    // Demand derivation — use whole-wall U × area UA totals
    const UA_total_now =
      wholeWallU_ext   * total_wall_opaque +
      wholeWallU_roof  * roof_area +
      wholeWallU_floor * ground_area +
      UA_glaz + UA_leakage + UA_permanent
    const Q_gain_to_zone = Q_solar_glaz_zone + Q_internal_total_Wh
    if (T_op < comfortBand.lower_c) {
      const Q_loss_at_lower = UA_total_now * Math.max(0, comfortBand.lower_c - T_out)
      const heating_Wh = Math.max(0, Q_loss_at_lower - Q_gain_to_zone)
      acc_heating_demand_Wh += heating_Wh
    } else if (T_op > comfortBand.upper_c) {
      const Q_gain_at_upper = Q_gain_to_zone + UA_total_now * Math.max(0, T_out - comfortBand.upper_c)
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
    // Brief 28c (2026-05-14): State 2 now computes its OWN losses against
    // the State 2 T_op trace, instead of inheriting state1Result.losses.
    // Closes the contract gap where conduction losses didn't reflect the
    // gains-warmed zone. Shape mirrors state1Result.losses for HeatBalance
    // consumer compatibility.
    losses: {
      conduction: {
        external_wall: Math.round(acc_cond_wall  / 1000 * 10) / 10,
        roof:          Math.round(acc_cond_roof  / 1000 * 10) / 10,
        ground_floor:  Math.round(acc_cond_floor / 1000 * 10) / 10,
        glazing: {
          f1: Math.round(acc_cond_glaz_n / 1000 * 10) / 10,
          f2: Math.round(acc_cond_glaz_e / 1000 * 10) / 10,
          f3: Math.round(acc_cond_glaz_s / 1000 * 10) / 10,
          f4: Math.round(acc_cond_glaz_w / 1000 * 10) / 10,
        },
        thermal_bridging: Math.round(acc_thermal_bridging / 1000 * 10) / 10,
      },
      ventilation: {
        fabric_leakage:  Math.round(acc_vent_leakage   / 1000 * 10) / 10,
        permanent_vents: Math.round(acc_vent_permanent / 1000 * 10) / 10,
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
    // Brief 28c (2026-05-14): heat_balance.annual.losses now reflects State 2's
    // own accumulators (computed against the State 2 T_air trace), not
    // state1Result's. Solar gains still come from state1Result (envelope-only
    // physics, byte-identical between states by design). Internal gains added
    // nested under gains.internal per Brief 27 cleanup Part 3.
    heat_balance: (() => {
      const total_cond_glaz_Wh = acc_cond_glaz_n + acc_cond_glaz_e + acc_cond_glaz_s + acc_cond_glaz_w
      const total_loss_Wh = acc_cond_wall + acc_cond_roof + acc_cond_floor +
                            total_cond_glaz_Wh + acc_thermal_bridging +
                            acc_vent_leakage + acc_vent_permanent
      const perM2 = (Wh) => Math.round(Wh / 1000 / gia * 100) / 100
      return {
        annual: {
          losses: {
            external_wall:    { kwh: r1(acc_cond_wall),  kwh_per_m2: perM2(acc_cond_wall),  area_m2: Math.round(total_wall_opaque) },
            roof:             { kwh: r1(acc_cond_roof),  kwh_per_m2: perM2(acc_cond_roof),  area_m2: Math.round(roof_area) },
            ground_floor:     { kwh: r1(acc_cond_floor), kwh_per_m2: perM2(acc_cond_floor), area_m2: Math.round(ground_area) },
            glazing:          { kwh: r1(total_cond_glaz_Wh), kwh_per_m2: perM2(total_cond_glaz_Wh), area_m2: Math.round(total_glazing) },
            thermal_bridging: { kwh: r1(acc_thermal_bridging), kwh_per_m2: perM2(acc_thermal_bridging) },
            fabric_leakage:   { kwh: r1(acc_vent_leakage), kwh_per_m2: perM2(acc_vent_leakage), ach },
            permanent_vents:  { kwh: r1(acc_vent_permanent), kwh_per_m2: perM2(acc_vent_permanent) },
          },
          gains: {
            // Solar from State 1 (envelope-only physics — same as State 2 by design)
            ...state1Result.heat_balance.annual.gains,
            internal: {
              people:    { kwh: r1(acc_people),    kwh_per_m2: Math.round(acc_people / 1000 / gia * 100) / 100 },
              lighting:  { kwh: r1(acc_lighting),  kwh_per_m2: Math.round(acc_lighting / 1000 / gia * 100) / 100 },
              equipment: { kwh: r1(totalEquipmentWh), kwh_per_m2: Math.round(totalEquipmentWh / 1000 / gia * 100) / 100 },
            },
          },
          totals: {
            losses_kwh:         r1(total_loss_Wh),
            losses_kwh_per_m2:  perM2(total_loss_Wh),
            gains_kwh:          r1((state1Result.heat_balance.annual.totals.gains_kwh ?? 0) * 1000 + acc_people + acc_lighting + totalEquipmentWh),
            gains_kwh_per_m2:   Math.round(((state1Result.heat_balance.annual.totals.gains_kwh ?? 0) + (acc_people + acc_lighting + totalEquipmentWh) / 1000) / gia * 100) / 100,
          },
        },
        metadata: { gia_m2: Math.round(gia) },
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
    })(),
  }
}

// ── Brief 28f Part 2 (2026-05-15): State 3 skeleton (system overlay layer) ──
//
// State 3 = State 2 demand served by configured systems. Contract v2.5
// (docs/state_contracts.md):
//   - Heating + cooling each have primary + optional secondary (primary_pct split)
//   - DHW has primary + optional secondary (primary_pct split) + a FLAT
//     circulation pump baseload (systems.dhw.circulation_pump_w)
//   - Mech ventilation is an array of independent systems with per-system
//     library_id (optional), flow_l_s, sfp_w_per_l_s, hre, schedule_ref
//   - All efficiencies resolve through library system_template items by
//     library_id. V1 efficiency = scalar only (SCOP/SEER/seasonal_efficiency
//     /COP). No performance-curve lookups.
//   - Missing required library field → HALT with MissingLibraryField error
//     naming the sub-system path AND the missing field. No silent defaults.
//
// Part 2 ships the SKELETON ONLY: library validation + halt-on-missing-field
// + State 2 byte-identity pass-through. Energy-use values are all zero until
// Part 3 (heating + cooling math) lands. The byte-identity test in
// scripts/state3_part2_skeleton_test.mjs verifies that running State 3 with
// no systems configured returns the State 2 fields byte-identical.

/**
 * Error thrown by the State 3 engine when a system sub-system's referenced
 * library template is missing the field required to compute its service.
 * Carries the sub-system path AND the field name so callers (UI, tests) can
 * surface a clear, actionable message. Per contract v2.5 verification gate 5.
 */
export class MissingLibraryField extends Error {
  constructor(subSystemPath, libraryId, fieldName) {
    const msg = libraryId == null
      ? `MissingLibraryField: ${subSystemPath} requires a library_id`
      : `MissingLibraryField: ${subSystemPath} (library_id = "${libraryId}") is missing required field "${fieldName}"`
    super(msg)
    this.name = 'MissingLibraryField'
    this.subSystemPath = subSystemPath
    this.libraryId = libraryId
    this.fieldName = fieldName
  }
}

/**
 * Resolve a library system_template by id. Throws MissingLibraryField if the
 * sub-system has no library_id, or if the id does not resolve in libraryData.
 */
function resolveSystemTemplate(library_id, libraryData, subSystemPath) {
  if (library_id == null) {
    throw new MissingLibraryField(subSystemPath, null, 'library_id')
  }
  const templates = libraryData?.system_templates ?? []
  const template = templates.find(t => (t.id ?? t.library_id) === library_id)
  if (!template) {
    throw new MissingLibraryField(subSystemPath, library_id, '(template not found in library)')
  }
  return template
}

/**
 * Validate that a library template supports a service AND carries the
 * per-service required scalar efficiency field. Throws MissingLibraryField
 * on either failure with the sub-system path + the missing field name.
 *
 * Required scalar field per service (V1 — no curves):
 *   heating     → heating_scop          (alt: heating_seasonal_efficiency, heating_cop)
 *   cooling     → cooling_seer          (alt: cooling_scop_cool, cooling_eer)
 *   dhw         → dhw_seasonal_efficiency
 *   ventilation → hre                   (heat recovery effectiveness 0..1)
 */
function validateTemplateForService(template, service, subSystemPath) {
  const supports = template.supports_services ?? []
  const tid = template.id ?? template.library_id
  if (!Array.isArray(supports) || !supports.includes(service)) {
    throw new MissingLibraryField(subSystemPath, tid, `supports_services (does not include "${service}")`)
  }
  const primaryField = ({
    heating:     'heating_scop',
    cooling:     'cooling_seer',
    dhw:         'dhw_seasonal_efficiency',
    ventilation: 'hre',
  })[service]
  if (!primaryField) return
  if (template[primaryField] != null) return
  const altMap = ({
    heating_scop: ['heating_seasonal_efficiency', 'heating_cop'],
    cooling_seer: ['cooling_scop_cool', 'cooling_eer'],
  })[primaryField] ?? []
  if (altMap.some(a => template[a] != null)) return
  throw new MissingLibraryField(subSystemPath, tid, primaryField)
}

/**
 * Pull the scalar efficiency a template advertises for a service.
 * Mirrors the precedence used by validateTemplateForService. Assumes the
 * template has already passed validation; falls back to null if not (defensive).
 */
function templateEfficiency(template, service) {
  const primary = ({ heating: 'heating_scop', cooling: 'cooling_seer', dhw: 'dhw_seasonal_efficiency', ventilation: 'hre' })[service]
  if (primary && template[primary] != null) return template[primary]
  const altMap = ({
    heating: ['heating_seasonal_efficiency', 'heating_cop'],
    cooling: ['cooling_scop_cool', 'cooling_eer'],
  })[service] ?? []
  for (const alt of altMap) if (template[alt] != null) return template[alt]
  return null
}

/**
 * Validate + resolve every configured sub-system. Returns a Map keyed by
 * sub-system path → { template, efficiency, fuel, library_id }. Throws
 * MissingLibraryField on any missing template / required field / inline
 * ventilation field.
 *
 * This consolidates Part 2's six repeated `validateTemplateForService(
 * resolveSystemTemplate(...))` calls into a single pass and lets Part 3+
 * energy math read efficiencies without re-resolving.
 */
function resolveAndValidateSystems(sys, libraryData) {
  const m = new Map()
  const resolveOne = (subCfg, service, path) => {
    if (subCfg == null) return null
    const t = resolveSystemTemplate(subCfg.library_id, libraryData, path)
    validateTemplateForService(t, service, path)
    const efficiency = templateEfficiency(t, service)
    const fuel = t.fuel ?? 'electricity'
    const record = { template: t, efficiency, fuel, library_id: t.id ?? t.library_id }
    m.set(path, record)
    return record
  }
  resolveOne(sys.heating?.primary,   'heating', 'systems.heating.primary')
  resolveOne(sys.heating?.secondary, 'heating', 'systems.heating.secondary')
  resolveOne(sys.cooling?.primary,   'cooling', 'systems.cooling.primary')
  resolveOne(sys.cooling?.secondary, 'cooling', 'systems.cooling.secondary')
  resolveOne(sys.dhw?.primary,       'dhw',     'systems.dhw.primary')
  resolveOne(sys.dhw?.secondary,     'dhw',     'systems.dhw.secondary')
  const ventSystems = Array.isArray(sys.ventilation) ? sys.ventilation : []
  for (let i = 0; i < ventSystems.length; i++) {
    const vs = ventSystems[i]
    const path = `systems.ventilation[${i}](id="${vs.id ?? '?'}")`
    if (vs.library_id != null) {
      const t = resolveSystemTemplate(vs.library_id, libraryData, path)
      validateTemplateForService(t, 'ventilation', path)
      m.set(path, { template: t, efficiency: vs.hre ?? t.hre, fuel: 'electricity', library_id: t.id ?? t.library_id })
    }
    for (const field of ['flow_l_s', 'sfp_w_per_l_s', 'hre']) {
      if (vs[field] == null) {
        throw new MissingLibraryField(path, vs.library_id ?? null, field)
      }
    }
  }
  return m
}

/**
 * Compute primary + secondary energy split for one service (heating or cooling).
 *
 * Returns:
 *   {
 *     primary_perf:     { delivered_mwh, fuel_mwh, avg_cop_or_eff, fuel } | null,
 *     secondary_perf:   { delivered_mwh, fuel_mwh, avg_cop_or_eff, fuel } | null,
 *     total_perf:       { delivered_mwh, fuel_mwh },
 *     fuel_split:       { [fuel]: { primary_mwh, secondary_mwh } },
 *   }
 *
 * Math (per Brief 28f Part 3 scope):
 *   delivered_mwh    = demand_mwh × pct / 100
 *   fuel_mwh         = delivered_mwh / efficiency  (efficiency = SCOP / SEER scalar)
 *
 * Brief 28f Part 3 covers heating + cooling only. DHW + ventilation deferred
 * to Part 4. If serviceCfg.primary is null, returns all zeros / nulls (service
 * not configured — no energy attributed).
 */
function computeServiceEnergy(serviceCfg, service, demand_mwh, resolved) {
  const empty = { primary_perf: null, secondary_perf: null, total_perf: { delivered_mwh: 0, fuel_mwh: 0 }, fuel_split: {} }
  if (serviceCfg == null || serviceCfg.primary == null) return empty

  const primaryPct   = Number(serviceCfg.primary_pct ?? 100)
  const secondaryPct = serviceCfg.secondary == null ? 0 : Math.max(0, 100 - primaryPct)
  const primaryRec   = resolved.get(`systems.${service}.primary`)
  const secondaryRec = serviceCfg.secondary != null ? resolved.get(`systems.${service}.secondary`) : null

  const out = { primary_perf: null, secondary_perf: null, total_perf: { delivered_mwh: 0, fuel_mwh: 0 }, fuel_split: {} }
  const attribute = (rec, pct, role) => {
    if (!rec) return
    const delivered = demand_mwh * pct / 100
    const fuel      = rec.efficiency > 0 ? delivered / rec.efficiency : 0
    const perf      = { delivered_mwh: delivered, fuel_mwh: fuel, avg_cop_or_eff: rec.efficiency, fuel: rec.fuel }
    if (role === 'primary')   out.primary_perf   = perf
    if (role === 'secondary') out.secondary_perf = perf
    out.total_perf.delivered_mwh += delivered
    out.total_perf.fuel_mwh      += fuel
    const bucket = out.fuel_split[rec.fuel] ?? (out.fuel_split[rec.fuel] = { primary_mwh: 0, secondary_mwh: 0 })
    bucket[`${role}_mwh`] += fuel
  }
  attribute(primaryRec,   primaryPct,   'primary')
  attribute(secondaryRec, secondaryPct, 'secondary')
  return out
}

/**
 * BEIS 2024 fuel-to-CO2 factors (kg CO2e per kWh delivered).
 *
 * Source: BEIS / DESNZ 2024 conversion factors publication (UK government,
 * annual update). Pinned here as a snapshot of the 2024-published values.
 * Grid factors are per-year-global, not per-project — different from
 * construction U-values which are project-specific library items.
 *
 * **Update annually until per-year grid-factor infrastructure lands**
 * (which itself is queued behind CRREM-pathway work — future briefs).
 * Future CRREM work needs per-year curves to model decarbonisation
 * trajectories; that's distinct storage and out of scope for V1 systems.
 */
export const BEIS_2024_FACTORS = {
  electricity: 0.207,   // kg CO2e/kWh — UK grid average, BEIS 2024
  gas:         0.183,   // kg CO2e/kWh — natural gas, BEIS 2024
}

/**
 * DHW formula default constants (V1).
 * Each is overridable per-project via systems.dhw.{litres_per_person_per_day,
 * store_temperature_c, cold_mains_temperature_c} — Brief 28f Part 5.1.
 * Cold mains is a V1 constant (no seasonal variation); annual-energy impact
 * is small — refine if calibration shows a per-month profile is needed.
 *
 * Engine derives kWh/person/hour at call time as
 *   L × (T_store − T_cold) × 4.18 / 3600 / 24
 * which equals 0.1935 kWh/p/h at defaults (matches the Part 4 ship value).
 */
const DHW_DEFAULT_LITRES_PER_PERSON_DAY  = 80
const DHW_DEFAULT_STORE_TEMPERATURE_C    = 60
const DHW_DEFAULT_COLD_MAINS_TEMPERATURE_C = 10
const C_P_WATER_KJ_PER_KG_K              = 4.18

function dhwKwhPerPersonHour(litres_per_person_per_day, store_temp_c, cold_mains_c) {
  const L  = Number.isFinite(litres_per_person_per_day) ? litres_per_person_per_day : DHW_DEFAULT_LITRES_PER_PERSON_DAY
  const Th = Number.isFinite(store_temp_c)               ? store_temp_c              : DHW_DEFAULT_STORE_TEMPERATURE_C
  const Tc = Number.isFinite(cold_mains_c)               ? cold_mains_c              : DHW_DEFAULT_COLD_MAINS_TEMPERATURE_C
  const dT = Math.max(0, Th - Tc)                        // negative ΔT clamps to 0 (cold mains > store ⇒ no heating needed)
  return L * dT * C_P_WATER_KJ_PER_KG_K / 3600 / 24
}

/**
 * Find a schedule profile by id in the building's gain profile arrays.
 * Searches lighting profiles → equipment profiles → occupancy schedule.
 * Returns the matched profile object (with a `.schedule` field carrying
 * weekday/saturday/sunday arrays), or null if not found.
 *
 * Used by Brief 28f Part 5.2 to resolve ventilation `schedule_ref` against
 * the same schedule infrastructure State 2 uses for internal gains.
 */
function findScheduleProfileById(id, building) {
  if (id == null) return null
  const lighting = building?.gains?.lighting?.profiles
  if (Array.isArray(lighting)) {
    const m = lighting.find(p => p?.id === id)
    if (m) return m
  }
  const equipment = building?.gains?.equipment?.profiles
  if (Array.isArray(equipment)) {
    const m = equipment.find(p => p?.id === id)
    if (m) return m
  }
  const occ = building?.gains?.occupancy
  if (occ?.id === id) return occ
  if (occ?.schedule?.id === id) return occ.schedule
  return null
}

/**
 * Annual hours-active for a ventilation schedule_ref (Brief 28f Part 5.2).
 *
 *   - null / undefined / 'always_on' → 8760 hours (always-on default).
 *   - Resolvable profile id          → weighted day-count annualization:
 *                                       261 weekdays + 52 Saturdays + 52 Sundays
 *                                       × 24 h/day × mean hourly fraction
 *                                       (does not honour exceptions or
 *                                       monthly multipliers — V1 simplification;
 *                                       reasonable for vent systems with
 *                                       steady occupied-hours operation).
 *   - Unresolvable string            → 8760 + console.warn, so the system
 *                                       still runs but the diagnostic is
 *                                       visible (devtools). Tightening to a
 *                                       hard halt is a future contract bump.
 *
 * Returns { hours, source } so callers (and tests) can see how the lookup
 * resolved without re-doing the work.
 */
function hoursActiveForSchedule(schedule_ref, building) {
  if (schedule_ref == null || schedule_ref === 'always_on') {
    return { hours: 8760, source: 'always_on' }
  }
  const profile = findScheduleProfileById(schedule_ref, building)
  if (!profile) {
    // eslint-disable-next-line no-console
    console.warn(`[State 3 / ventilation] Unknown schedule_ref "${schedule_ref}" — falling back to always_on (8760 h). Define the profile in building.gains.{lighting,equipment,occupancy} or use 'always_on' explicitly.`)
    return { hours: 8760, source: 'unresolved_fallback' }
  }
  const sched = profile.schedule ?? profile
  const weekday  = Array.isArray(sched.weekday)  ? sched.weekday  : null
  if (!weekday) {
    // eslint-disable-next-line no-console
    console.warn(`[State 3 / ventilation] schedule_ref "${schedule_ref}" resolved but has no weekday array — falling back to always_on.`)
    return { hours: 8760, source: 'unresolved_fallback' }
  }
  const saturday = Array.isArray(sched.saturday) ? sched.saturday : weekday
  const sunday   = Array.isArray(sched.sunday)   ? sched.sunday   : saturday
  const avg = arr => arr.reduce((s, v) => s + Number(v ?? 0), 0) / Math.max(arr.length, 1)
  // 261 weekdays + 52 Sat + 52 Sun ≈ 365 days/year (rounded UK calendar).
  const hours = 24 * (261 * avg(weekday) + 52 * avg(saturday) + 52 * avg(sunday))
  return { hours, source: 'profile' }
}

/**
 * Compute mechanical-ventilation per-system fan energy + theoretical HRE
 * heat-recovery offset for State 3. Per Brief 28f Part 5.2:
 *   - schedule_ref = 'always_on' (or null/undefined) → 8760 hours active.
 *   - schedule_ref = profile id    → annualized hours from the resolved profile.
 *   - schedule_ref unresolved      → 8760 + console.warn (diagnosable fallback).
 *   - Recovery uses an annual ΔT_integral against the heating setpoint,
 *     scaled by (hours_active / 8760) for non-always-on systems (V1
 *     approximation — strict physics would integrate ΔT only over the
 *     vent-on hours; tightenable when calibration shows it matters).
 *   - Recovery is THEORETICAL here; caller caps to heating_demand_mwh.
 */
function computeVentilationEnergy(ventSystems, weatherData, T_setpoint_c, building) {
  if (!Array.isArray(ventSystems) || ventSystems.length === 0) {
    return { perSystem: [], totalFanKwh: 0, theoreticalRecoveryMwh: 0 }
  }
  const AIR_HC_J_PER_M3_K = 1.2 * 1005   // air heat capacity at ~20 °C

  // Annual heating ΔT integral (K·hours) — computed once, reused across systems.
  // Each system scales by its own schedule_factor for non-always-on.
  let dT_integral_K_hours = 0
  const n = weatherData?.temperature?.length ?? 0
  for (let h = 0; h < n; h++) {
    const dT = T_setpoint_c - weatherData.temperature[h]
    if (dT > 0) dT_integral_K_hours += dT
  }

  const perSystem = []
  let totalFanKwh = 0
  let theoreticalRecoveryMwh = 0

  for (let i = 0; i < ventSystems.length; i++) {
    const vs = ventSystems[i]
    const id = vs.id ?? `vent_${i}`
    const { hours: hours_active, source: schedule_source } = hoursActiveForSchedule(vs.schedule_ref, building)
    const fan_kwh = (vs.flow_l_s * vs.sfp_w_per_l_s * hours_active) / 1000

    // Recovery (theoretical, uncapped). Only relevant when HRE > 0.
    // schedule_factor: V1 approximation that recovery scales linearly with
    // vent-on hours. dT integration over actual vent-on hours is a future
    // refinement (tightenable if calibration shows it matters).
    let recovery_mwh = 0
    if (vs.hre > 0 && dT_integral_K_hours > 0) {
      const flow_m3s        = vs.flow_l_s / 1000
      const schedule_factor = hours_active / 8760
      const recovery_Wh     = flow_m3s * AIR_HC_J_PER_M3_K * vs.hre * dT_integral_K_hours * schedule_factor
      recovery_mwh = recovery_Wh / 1_000_000
    }

    perSystem.push({ id, fan_kwh, recovery_mwh, hours_active, schedule_source })
    totalFanKwh += fan_kwh
    theoreticalRecoveryMwh += recovery_mwh
  }

  return { perSystem, totalFanKwh, theoreticalRecoveryMwh }
}

/**
 * State 3 — Brief 28f Part 4 (full system overlay: heating + cooling + DHW
 * + ventilation + lighting/equipment + carbon).
 *
 * Returns the State 2 result UNCHANGED for every State 2 field (byte-identity
 * pass-through). Populates the contract-v2.5 system-overlay layer:
 *   - Heating + cooling primary + secondary (Part 3 math, unchanged)
 *   - DHW demand from State 2 occupancy × 80 L/person/day × ΔT × c_p
 *   - DHW primary + secondary energy via the same primary/secondary split
 *   - DHW circulation pump baseload (continuous W × 8760 h)
 *   - Mech ventilation per-system fan energy (flow × SFP × hours)
 *   - Mech ventilation HRE recovery: theoretical (flow × AIR_HC × HRE ×
 *     ΔT_integral) capped at State 2 heating demand. Effective recovery
 *     reduces the heating demand passed to the heating service (option a
 *     per Brief 28f Part 4 spec; recovery_mwh shown as discrete line in
 *     system_performance.ventilation.total for transparency — option b).
 *   - Lighting + equipment pass-through from State 2 heat_balance gains
 *   - Carbon = (elec_kWh × 0.207 + gas_kWh × 0.183) / gia_m2 (BEIS 2024)
 *
 * V1 limitations documented in brief:
 *   - DHW cold-mains temperature constant 10 °C (no seasonal variation)
 *   - HRE recovery is annual aggregate; cap at heating demand means peak-
 *     winter heating demand is under-represented when MVHR is oversized
 *     relative to building demand (as on Bridgewater).
 *   - Ventilation schedule_ref always_on; bespoke schedules deferred.
 *
 * Library refs validated upfront via resolveAndValidateSystems; throws
 * MissingLibraryField on any missing template / required field.
 */
function _calculateState3(building, constructions, libraryData, weatherData, hourlySolar, comfortBand) {
  const state2Result = _calculateState2(building, constructions, libraryData, weatherData, hourlySolar, comfortBand)
  if (state2Result.state !== 2) return state2Result   // bailout: _empty()

  const sys = building.systems_config ?? {}
  const resolved = resolveAndValidateSystems(sys, libraryData)

  // ── Demand inputs ─────────────────────────────────────────────────────────
  const heating_demand_state2_mwh = state2Result.demand?.heating_demand_mwh ?? 0
  const cooling_demand_mwh        = state2Result.demand?.cooling_demand_mwh ?? 0

  // DHW demand (Brief 28f Part 5.1): annual_occupant_hours × per-person DHW
  // load, where per-person load is derived from the three new DHW formula
  // inputs (litres_per_person_per_day, store_temperature_c, cold_mains_
  // temperature_c) with defaults 80/60/10. At defaults the per-person-hour
  // value is 0.1935 kWh — byte-identical to the Part 4 ship constant.
  const annual_occupant_hours = state2Result.occupancy_summary?.annual_occupant_hours ?? 0
  const dhw_kwh_per_person_hour = dhwKwhPerPersonHour(
    sys.dhw?.litres_per_person_per_day,
    sys.dhw?.store_temperature_c,
    sys.dhw?.cold_mains_temperature_c,
  )
  const dhw_demand_kwh = annual_occupant_hours * dhw_kwh_per_person_hour
  const dhw_demand_mwh = dhw_demand_kwh / 1000

  // ── Mech ventilation (Part 4): fans + HRE recovery ────────────────────────
  const T_heating_setpoint = sys.heating?.setpoint_c ?? comfortBand?.lower_c ?? 21
  const ventResult = computeVentilationEnergy(
    Array.isArray(sys.ventilation) ? sys.ventilation : [],
    weatherData,
    T_heating_setpoint,
    building,                  // Brief 28f Part 5.2: needed for schedule_ref lookup
  )

  // Effective recovery: cap at State 2 heating demand. The cap models the
  // physical limit (you can't recover more heat than the building actually
  // needs). Option (a) per Brief 28f spec: effective recovery reduces the
  // heating-system demand. Option (b) transparency: recovery_mwh is also
  // exposed as a discrete line in system_performance.ventilation.total.
  const effective_recovery_mwh = Math.min(ventResult.theoreticalRecoveryMwh, heating_demand_state2_mwh)
  const heating_demand_mwh     = Math.max(0, heating_demand_state2_mwh - effective_recovery_mwh)

  // ── Service energy math (heating, cooling, DHW) ───────────────────────────
  const heating = computeServiceEnergy(sys.heating, 'heating', heating_demand_mwh, resolved)
  const cooling = computeServiceEnergy(sys.cooling, 'cooling', cooling_demand_mwh, resolved)
  const dhw     = computeServiceEnergy(sys.dhw,     'dhw',     dhw_demand_mwh,     resolved)

  // DHW circulation pump (Part 4): continuous electrical baseload.
  // V1: schedule_ref hookup deferred — 8760 h hardcoded.
  const circulation_pump_w   = Number(sys.dhw?.circulation_pump_w ?? 0)
  const circulation_pump_kwh = circulation_pump_w * 8760 / 1000

  // ── Per-fuel split (kWh) for energy_use leaves ────────────────────────────
  const fuel_kwh = (svc, fuel, role) => (svc.fuel_split[fuel]?.[`${role}_mwh`] ?? 0) * 1000
  const elec_heat_prim = fuel_kwh(heating, 'electricity', 'primary')
  const elec_heat_sec  = fuel_kwh(heating, 'electricity', 'secondary')
  const gas_heat_prim  = fuel_kwh(heating, 'gas',         'primary')
  const gas_heat_sec   = fuel_kwh(heating, 'gas',         'secondary')
  const elec_cool_prim = fuel_kwh(cooling, 'electricity', 'primary')
  const elec_cool_sec  = fuel_kwh(cooling, 'electricity', 'secondary')
  const gas_cool_prim  = fuel_kwh(cooling, 'gas',         'primary')
  const gas_cool_sec   = fuel_kwh(cooling, 'gas',         'secondary')
  const elec_dhw_prim  = fuel_kwh(dhw,     'electricity', 'primary')
  const elec_dhw_sec   = fuel_kwh(dhw,     'electricity', 'secondary')
  const gas_dhw_prim   = fuel_kwh(dhw,     'gas',         'primary')
  const gas_dhw_sec    = fuel_kwh(dhw,     'gas',         'secondary')

  const elec_heat_total = elec_heat_prim + elec_heat_sec
  const elec_cool_total = elec_cool_prim + elec_cool_sec
  const gas_heat_total  = gas_heat_prim  + gas_heat_sec
  const gas_cool_total  = gas_cool_prim  + gas_cool_sec
  const elec_dhw_total  = elec_dhw_prim  + elec_dhw_sec + circulation_pump_kwh
  const gas_dhw_total   = gas_dhw_prim   + gas_dhw_sec

  // Lighting + equipment pass-through from State 2 internal-gain accumulators.
  // 100% of installed electricity becomes heat in zone (already counted as a
  // gain in State 2 — here we count it as electricity-used in State 3).
  const lighting_kwh  = state2Result.heat_balance?.annual?.gains?.internal?.lighting?.kwh  ?? 0
  const equipment_kwh = state2Result.heat_balance?.annual?.gains?.internal?.equipment?.kwh ?? 0
  const total_fan_kwh = ventResult.totalFanKwh

  // ── Top-level fuel sums ───────────────────────────────────────────────────
  const electricity_total_kwh =
      elec_heat_total + elec_cool_total + elec_dhw_total +
      total_fan_kwh + lighting_kwh + equipment_kwh
  const gas_total_kwh         = gas_heat_total + gas_cool_total + gas_dhw_total
  const delivered_total_kwh   = electricity_total_kwh + gas_total_kwh
  const gia                   = state2Result.heat_balance?.metadata?.gia_m2 ?? state2Result.metadata?.gia_m2 ?? 0
  const eui_kwh_per_m2        = gia > 0 ? delivered_total_kwh / gia : 0

  // ── Carbon ────────────────────────────────────────────────────────────────
  const carbon_kg_co2 =
      electricity_total_kwh * BEIS_2024_FACTORS.electricity +
      gas_total_kwh         * BEIS_2024_FACTORS.gas
  const carbon_kg_co2_per_m2 = gia > 0 ? carbon_kg_co2 / gia : 0

  // ── Rounding helpers ──────────────────────────────────────────────────────
  const r_kwh = (x) => Math.round(x * 10) / 10            // 0.1 kWh
  const r_mwh = (x) => Math.round(x * 1000) / 1000        // 0.001 MWh = 1 kWh
  const r_eff = (x) => Math.round(x * 1000) / 1000        // 3 dp on COP/SCOP/SEER
  const r_co2 = (x) => Math.round(x * 100) / 100          // 0.01 kg/m²
  const perfOut = (p) => p == null ? null : ({
    delivered_mwh:   r_mwh(p.delivered_mwh),
    fuel_mwh:        r_mwh(p.fuel_mwh),
    avg_cop_or_eff:  r_eff(p.avg_cop_or_eff),
    fuel:            p.fuel,
  })

  return {
    ...state2Result,
    state: 3,
    mode: 'full',
    metadata: { gia_m2: gia },   // surfaced at top level for v2.5 contract symmetry with State 1
    energy_use: {
      electricity: {
        heating:   { primary: r_kwh(elec_heat_prim), secondary: r_kwh(elec_heat_sec), total: r_kwh(elec_heat_total) },
        cooling:   { primary: r_kwh(elec_cool_prim), secondary: r_kwh(elec_cool_sec), total: r_kwh(elec_cool_total) },
        fans:      {
          per_system: ventResult.perSystem.map(v => ({ id: v.id, kwh: r_kwh(v.fan_kwh) })),
          total:      r_kwh(total_fan_kwh),
        },
        dhw: {
          primary:      r_kwh(elec_dhw_prim),
          secondary:    r_kwh(elec_dhw_sec),
          circulation:  r_kwh(circulation_pump_kwh),
          total:        r_kwh(elec_dhw_total),
        },
        lighting:  r_kwh(lighting_kwh),
        equipment: r_kwh(equipment_kwh),
        total:     r_kwh(electricity_total_kwh),
      },
      gas: {
        heating: { primary: r_kwh(gas_heat_prim), secondary: r_kwh(gas_heat_sec), total: r_kwh(gas_heat_total) },
        dhw:     { primary: r_kwh(gas_dhw_prim),  secondary: r_kwh(gas_dhw_sec),  total: r_kwh(gas_dhw_total) },
        total:   r_kwh(gas_total_kwh),
      },
      totals: {
        electricity_kwh:      r_kwh(electricity_total_kwh),
        gas_kwh:              r_kwh(gas_total_kwh),
        delivered_energy_kwh: r_kwh(delivered_total_kwh),
        eui_kwh_per_m2:       Math.round(eui_kwh_per_m2 * 10) / 10,
      },
    },
    system_performance: {
      heating: {
        primary:   perfOut(heating.primary_perf),
        secondary: perfOut(heating.secondary_perf),
        total:     { delivered_mwh: r_mwh(heating.total_perf.delivered_mwh), fuel_mwh: r_mwh(heating.total_perf.fuel_mwh) },
      },
      cooling: {
        primary:   perfOut(cooling.primary_perf),
        secondary: perfOut(cooling.secondary_perf),
        total:     { delivered_mwh: r_mwh(cooling.total_perf.delivered_mwh), fuel_mwh: r_mwh(cooling.total_perf.fuel_mwh) },
      },
      dhw: {
        primary:               perfOut(dhw.primary_perf),
        secondary:             perfOut(dhw.secondary_perf),
        circulation_pump_kwh:  r_kwh(circulation_pump_kwh),
        total:                 { delivered_mwh: r_mwh(dhw.total_perf.delivered_mwh), fuel_mwh: r_mwh(dhw.total_perf.fuel_mwh) },
      },
      ventilation: {
        systems: ventResult.perSystem.map(v => ({
          id:              v.id,
          fan_kwh:         r_kwh(v.fan_kwh),
          recovery_mwh:    r_mwh(v.recovery_mwh),    // theoretical per-system (uncapped)
          hours_active:    Math.round(v.hours_active),
          schedule_source: v.schedule_source,        // Brief 28f Part 5.2 — 'always_on' | 'profile' | 'unresolved_fallback'
        })),
        total: {
          fan_kwh:                   r_kwh(total_fan_kwh),
          recovery_mwh:              r_mwh(effective_recovery_mwh),       // capped, applied to heating
          recovery_theoretical_mwh:  r_mwh(ventResult.theoreticalRecoveryMwh), // uncapped, informational
        },
      },
    },
    carbon_kg_co2_per_m2: r_co2(carbon_kg_co2_per_m2),
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
      options.tuning ?? null,
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

  // State 3 v2.5 engine path (Brief 28f Part 2 skeleton). Opt-in via
  // `options.engine === 'v2.5'` while the legacy 'full' code below is still
  // wired into UI consumers. In Part 2 this returns State 2 outputs
  // byte-identical, plus an empty system-overlay layer per contract v2.5.
  // Heating/cooling/DHW/ventilation energy math lands in Part 3+. Library
  // references validated upfront — throws MissingLibraryField on missing
  // template or missing required scalar efficiency field.
  if (mode === 'full' && options.engine === 'v2.5') {
    return _calculateState3(
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
