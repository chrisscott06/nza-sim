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
  natural_vent_windows:   { fuel: null,          sfp: 0.0,  hre: 0.0 },
}

/** Look up a system default, falling back gracefully */
function sysDefaults(systemKey) {
  return SYSTEM_DEFAULTS[systemKey] ?? { fuel: 'electricity', eff: 1.0 }
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
    if (item?.u_value_W_per_m2K != null) return Number(item.u_value_W_per_m2K)
  }
  return DEFAULT_U_VALUES[element] ?? 1.0
}

// ── Main calculation ──────────────────────────────────────────────────────────

/**
 * Calculate simplified annual energy for a building.
 *
 * @param {object} building     — ProjectContext building_config
 * @param {object} constructions — ProjectContext construction_choices
 * @param {object} systems      — ProjectContext systems_config
 * @param {object} libraryData  — { constructions: [...] } from library API
 * @returns {object} Energy breakdown in kWh (see below)
 */
export function calculateInstant(building = {}, constructions = {}, systems = {}, libraryData = {}) {
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
  const solar_gains = {
    north: glazing.north * getSolarRadiation('north', orientation) * g_value,
    south: glazing.south * getSolarRadiation('south', orientation) * g_value,
    east:  glazing.east  * getSolarRadiation('east',  orientation) * g_value,
    west:  glazing.west  * getSolarRadiation('west',  orientation) * g_value,
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
  const lpd = Number(systems.lighting_power_density ?? 8)   // W/m²
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
    const ventLabel = is_mvhr ? 'MVHR'
      : vent_sys_key === 'natural_vent_windows' ? 'Natural Vent' : 'MEV'
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

  return {
    eui_kWh_m2:            Math.round(eui_kWh_m2 * 10) / 10,
    annual_heating_kWh:    Math.round(heating_thermal),
    annual_cooling_kWh:    Math.round(cooling_thermal),
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
    fabric_losses: { walls_kWh: 0, roof_kWh: 0, floor_kWh: 0, glazing_kWh: 0, infiltration_kWh: 0, ventilation_kWh: 0, total_kWh: 0 },
    solar_gains: { north_kWh: 0, south_kWh: 0, east_kWh: 0, west_kWh: 0, opaque_wall_kWh: 0, roof_solar_kWh: 0, total_kWh: 0 },
    internal_gains: { lighting_kWh: 0, equipment_kWh: 0, people_kWh: 0, total_kWh: 0 },
    fuel_split: { electricity_kWh: 0, gas_kWh: 0, total_kWh: 0, electricity_pct: 100, gas_pct: 0 },
    carbon_kgCO2_m2: 0, gia_m2: 0,
    systems_flow: { nodes: [], links: [] },
    _inputs: {},
  }
}
