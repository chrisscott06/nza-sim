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

  // ── Ventilation heat loss ─────────────────────────────────────────────────
  const vent_type      = systems.ventilation_type ?? 'mev_standard'
  const mvhr_eff       = Number(systems.mvhr_efficiency ?? 0.85)
  const is_mvhr        = vent_type.startsWith('mvhr')
  const vent_ach       = 0.5   // Design ventilation rate (typical hotel)
  const heat_recovery  = is_mvhr ? mvhr_eff : 0
  const vent_kWh       = AIR_HEAT_CAPACITY * vent_ach * volume * UK_HDD * 24 / 1000 * (1 - heat_recovery)

  // ── Solar gains (orientation-aware) ──────────────────────────────────────
  const orientation = Number(building.orientation ?? 0)
  const g_value = getGValue(constructions, libraryData)
  const solar_gains = {
    north: glazing.north * getSolarRadiation('north', orientation) * g_value / 1000,
    south: glazing.south * getSolarRadiation('south', orientation) * g_value / 1000,
    east:  glazing.east  * getSolarRadiation('east',  orientation) * g_value / 1000,
    west:  glazing.west  * getSolarRadiation('west',  orientation) * g_value / 1000,
  }

  // ── Sol-air opaque conduction gains ────────────────────────────────────────
  // Fraction of incident solar on opaque wall that conducts through as internal gain
  const OPAQUE_GAIN_FRACTION = 0.04   // ~4% of incident irradiance per CIBSE simplified
  const UK_HORIZONTAL_SOLAR  = 950    // kWh/m²/yr (horizontal irradiance, UK average)
  const wall_op = geo.wall_opaque     // { north, south, east, west } in m²
  const opaque_wall_solar = {
    north: getSolarRadiation('north', orientation) * (wall_op.north ?? 0) * OPAQUE_GAIN_FRACTION / 1000,
    south: getSolarRadiation('south', orientation) * (wall_op.south ?? 0) * OPAQUE_GAIN_FRACTION / 1000,
    east:  getSolarRadiation('east',  orientation) * (wall_op.east  ?? 0) * OPAQUE_GAIN_FRACTION / 1000,
    west:  getSolarRadiation('west',  orientation) * (wall_op.west  ?? 0) * OPAQUE_GAIN_FRACTION / 1000,
  }
  const opaque_wall_total = Object.values(opaque_wall_solar).reduce((a, b) => a + b, 0)
  const roof_solar_kWh = UK_HORIZONTAL_SOLAR * roof_area * OPAQUE_GAIN_FRACTION / 1000

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
  // Utilisation factor — not all gains reduce heating demand (summer gains don't help winter heating)
  const util_factor = 0.75
  const heating_thermal = Math.max(0, heat_losses - heat_gains * util_factor)

  // Heating electricity via VRF COP
  const cop_heating = Number(systems.cop_heating ?? 3.5)
  const heating_electricity = heating_thermal / cop_heating

  // ── Cooling demand ────────────────────────────────────────────────────────
  // Simplified: excess solar + internal gains in summer, minus natural cooling effect
  const COOLING_GAIN_FRACTION = 0.25  // ~25% of gains become cooling load (UK climate)
  const cooling_thermal = Math.max(0, (total_solar + total_internal) * COOLING_GAIN_FRACTION - UK_CDD * gia * 0.001)
  const cop_cooling = Number(systems.cop_cooling ?? 3.2)
  const cooling_electricity = cooling_thermal / cop_cooling

  // ── Lighting annual ───────────────────────────────────────────────────────
  const lighting_kWh = lpd * gia * HOTEL_OPERATING_HOURS / 1000

  // ── Equipment annual ──────────────────────────────────────────────────────
  const equipment_kWh = epd * gia * HOTEL_EQUIP_HOURS / 1000

  // ── Fan energy ────────────────────────────────────────────────────────────
  // VRF fans + ventilation fans
  const vrf_fan_sfp = 0.5       // W/(L/s) — VRF fan coil SFP
  const vent_sfp    = is_mvhr ? 1.2 : 0.8  // W/(L/s) — MEV or MVHR SFP
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
  const dhw_primary    = systems.dhw_primary ?? 'gas_boiler_dhw'
  const dhw_preheat    = systems.dhw_preheat ?? 'none'
  const boiler_eff     = Number(systems.dhw_efficiency ?? 0.92)
  const ashp_cop       = Number(systems.ashp_cop_dhw ?? 2.8)

  let dhw_gas_kWh  = 0
  let dhw_elec_kWh = 0

  if (dhw_primary === 'gas_boiler_dhw') {
    if (dhw_preheat === 'ashp_dhw') {
      // ASHP preheats 10→45°C, gas boosts 45→60°C
      const preheat_fraction = (45 - DHW_COLD_TEMP) / (DHW_SETPOINT - DHW_COLD_TEMP)
      const boost_fraction   = 1 - preheat_fraction
      dhw_elec_kWh = dhw_thermal * preheat_fraction / ashp_cop
      dhw_gas_kWh  = dhw_thermal * boost_fraction   / boiler_eff
    } else {
      dhw_gas_kWh = dhw_thermal / boiler_eff
    }
  } else {
    // Electric DHW (fallback)
    dhw_elec_kWh = dhw_thermal
  }

  // ── Totals and fuel split ─────────────────────────────────────────────────
  const electricity_kWh = heating_electricity + cooling_electricity + lighting_kWh + equipment_kWh + fans_kWh + dhw_elec_kWh
  const gas_kWh         = dhw_gas_kWh
  const total_kWh       = electricity_kWh + gas_kWh
  const eui_kWh_m2      = gia > 0 ? total_kWh / gia : 0

  // ── Carbon (2026 grid) ────────────────────────────────────────────────────
  const carbon_kgCO2_m2 = (electricity_kWh * GRID_INTENSITY_2026 + gas_kWh * GAS_CARBON_KG_KWH) / gia

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
        solar_south:  solar_gains.south    * util_factor,
        solar_east:   solar_gains.east     * util_factor,
        solar_west:   solar_gains.west     * util_factor,
        solar_north:  solar_gains.north    * util_factor,
        wall_solar:   opaque_wall_total    * util_factor,
        roof_solar:   roof_solar_kWh       * util_factor,
        equipment:    equip_internal       * util_factor / 1000,
        lighting:     lighting_internal    * util_factor / 1000,
        people:       people_internal      * util_factor / 1000,
      },
      cooling_side: {
        // Drivers in MWh (increase cooling demand — only cooling_fraction drives cooling)
        solar_south:  solar_gains.south    * COOLING_GAIN_FRACTION,
        solar_east:   solar_gains.east     * COOLING_GAIN_FRACTION,
        solar_west:   solar_gains.west     * COOLING_GAIN_FRACTION,
        solar_north:  solar_gains.north    * COOLING_GAIN_FRACTION,
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
    _inputs: { u_wall, u_roof, u_floor, u_glaz, ach, is_mvhr, heat_recovery, lpd, cop_heating, cop_cooling },
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
    carbon_kgCO2_m2: 0, gia_m2: 0, _inputs: {},
  }
}
