/**
 * ProjectContext.jsx
 *
 * Central state for the current project. Handles:
 *  - Loading the most-recent project on startup (or creating a default)
 *  - Exposing building params, construction choices, and systems config
 *  - Auto-saving changes to the API with 1 second debounce
 *  - Providing a save-status string for the TopBar indicator
 *  - Project list for the project picker
 *  - createProject / loadProject / deleteProject actions
 *
 * Interface intentionally mirrors the old BuildingContext so existing
 * components can keep using the same keys (params, updateParam, etc.)
 * — only the import path changes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { publishState, onInitialStateRequest } from '../utils/broadcastChannel.js'
import { SCHEDULE_PRESETS, findPreset } from '../data/schedulePresets.js'

export const ProjectContext = createContext(null)

// ── Defaults (mirror api/db/database.py) ─────────────────────────────────────

// Default occupancy schedule: hotel-bedroom-overnight preset (matches the
// seeded Bridgewater building_type). Migration may overwrite this from
// a different preset if building_type indicates Office / Retail / etc.
const _hotelOccPreset = findPreset('occupancy', 'hotel_bedroom_overnight')
const _hotelLightPreset = findPreset('lighting', 'hotel_bedroom_lighting')
const _hotelEquipPreset = findPreset('equipment', 'hotel_bedroom_equipment')

const DEFAULT_OCCUPANCY = {
  // Annual modulation: fraction of rooms / units typically occupied
  occupancy_rate: 0.75,
  // Density — value + basis. basis ∈ {per_room, per_m2, total, per_workstation}
  density: { value: 1.5, basis: 'per_room' },
  // Metabolic. Typical hotel-bedroom-rest values (CIBSE Guide A).
  sensible_w_per_person: 75,
  latent_w_per_person:   55,
  // Schedule — when a room IS occupied, when is the occupant present
  schedule: {
    weekday:             [..._hotelOccPreset.schedule.weekday],
    saturday:            [..._hotelOccPreset.schedule.saturday],
    sunday:              [..._hotelOccPreset.schedule.sunday],
    monthly_multipliers: [..._hotelOccPreset.schedule.monthly_multipliers],
    exceptions:          [],
  },
  _provenance: { source: 'seeded_default', confidence: 'medium' },
}

// v2.4 (Brief 27 Revised) — lighting and equipment are arrays of load-type
// profiles. Each profile contributes profile.area_share fraction of GIA at
// its own LPD/EPD with its own relationship_to_occupancy + schedule.
// Single-profile (this default) reproduces v2.3 behaviour exactly.
const DEFAULT_GAINS = {
  lighting: {
    profiles: [
      {
        id: 'default_lighting',
        label: 'Lighting',
        magnitude: { value: 8, unit: 'w_per_m2' },
        // relationship_to_occupancy:
        //   'proportional_with_spill' — schedule follows occupancy, shifted by `spill_minutes`
        //   'proportional'            — schedule equals occupancy
        //   'independent'             — schedule comes from this profile's `schedule` field
        //   'always_on'               — fraction is 1.0 every hour
        relationship_to_occupancy: 'proportional_with_spill',
        spill_minutes:   15,
        daylight_factor: 0.6,
        // Fraction of GIA this profile applies to. Sum across profiles
        // SHOULD equal 1.0 (warning surfaced in UI if not); engine
        // weights each profile's contribution by area_share.
        area_share: 1.0,
        // Only consulted when relationship_to_occupancy === 'independent';
        // kept on every profile so users can switch relationship without
        // losing the curve they may have authored.
        schedule: {
          weekday:             [..._hotelLightPreset.schedule.weekday],
          saturday:            [..._hotelLightPreset.schedule.saturday],
          sunday:              [..._hotelLightPreset.schedule.sunday],
          monthly_multipliers: [..._hotelLightPreset.schedule.monthly_multipliers],
          exceptions:          [],
        },
        _provenance: { source: 'seeded_default', confidence: 'medium' },
      },
    ],
  },
  equipment: {
    profiles: [
      {
        id: 'default_equipment',
        label: 'Equipment',
        baseload: { value: 3, unit: 'w_per_m2' },  // 24/7 component
        active:   { value: 7, unit: 'w_per_m2' },  // occupancy-driven component
        // 'proportional' or 'independent'
        relationship_to_occupancy: 'proportional',
        // Fraction of `active` that runs when unoccupied (active floor)
        standby_factor: 0.10,
        area_share: 1.0,
        schedule: {
          weekday:             [..._hotelEquipPreset.schedule.weekday],
          saturday:            [..._hotelEquipPreset.schedule.saturday],
          sunday:              [..._hotelEquipPreset.schedule.sunday],
          monthly_multipliers: [..._hotelEquipPreset.schedule.monthly_multipliers],
          exceptions:          [],
        },
        _provenance: { source: 'seeded_default', confidence: 'medium' },
      },
    ],
  },
}

const DEFAULT_PARAMS = {
  name:            'Bridgewater Hotel',
  // Corrected from 505 Design / Zeal Hotels data — GIA 4,215 m²
  // 63 × 13.4 × 5 = 4,221 m² ≈ 4,215 m² (confirmed from fire alarm drawings)
  length:          63.0,
  width:           13.4,
  num_floors:      5,      // GF + 4 upper floors
  floor_height:    3.0,    // typical Holiday Inn Express
  orientation:     0.0,
  wwr:             { north: 0.25, south: 0.25, east: 0.25, west: 0.25 },
  infiltration_ach: 0.5,
  // Thermal mass class for the State 1 lumped-capacitance free-running
  // temperature model. One of 'light' | 'medium' | 'heavy' per CIBSE TM52
  // effective heat capacity bands (80/160/280 kJ/K/m²-GIA).
  //
  // Two modes (Brief 26.1 Part 5):
  //   'auto' (default): live engine derives C_mass from the chosen
  //     construction stack — see frontend/src/utils/thermalMass.js.
  //     The thermal_mass_category field below is ignored.
  //   'override': live engine uses thermal_mass_category × GIA, the
  //     pre-26.1 path. For sensitivity studies.
  thermal_mass_mode: 'auto',
  thermal_mass_category: 'light',
  // Openings — wind-driven natural ventilation through windows and louvres.
  // Each facade can carry an always-open louvre (m²) and an operable window
  // fraction (% of glazing area). Both default off; user opts in per facade.
  openings: {
    schedule:      'never',   // 'never' | 'occupied' | 'summer_day' | 'always'
    site_exposure: 'normal',  // 'sheltered' | 'normal' | 'exposed'
    north: { louvre_area_m2: 0, openable_fraction: 0 },
    south: { louvre_area_m2: 0, openable_fraction: 0 },
    east:  { louvre_area_m2: 0, openable_fraction: 0 },
    west:  { louvre_area_m2: 0, openable_fraction: 0 },
  },
  window_count:    { north: 8, south: 8, east: 3, west: 3 },
  // Legacy occupancy fields — kept for backward compat with hvac_dhw.py
  // and existing State 1 code that reads them. Brief 27 introduces
  // `occupancy.*` as the v2.3 contract source of truth; these fields
  // mirror the same numbers and stay in sync via the migration on load.
  num_bedrooms:    134,
  occupancy_rate:  0.75,
  people_per_room: 1.5,
  // Brief 27 v2.3 — occupancy is a first-class building property.
  // Sensible/latent heat per person, presence schedule, exception
  // periods all live here. Density.basis controls how `density.value`
  // converts to total occupants.
  occupancy: DEFAULT_OCCUPANCY,
  // Brief 27 v2.3 — gains restructured. People are no longer in
  // gains (they're under occupancy); lighting and equipment carry
  // a relationship_to_occupancy field that controls whether their
  // schedule derives from occupancy or runs independently.
  gains: DEFAULT_GAINS,
  location: {
    latitude:  51.087,   // North Petherton / Bridgwater
    longitude: -2.985,
    name:      'Bridgwater, Somerset',
  },
}

// ── Brief 27 Part 1 — v2.3 migration helpers ─────────────────────────────────
//
// Persisted building_configs pre-Brief 27 don't have `occupancy.*` or
// `gains.*` blocks. These helpers build them from legacy fields (preserving
// any explicit user value) on load. Idempotent — running twice doesn't
// double-apply; explicit v2.3 fields win over derived defaults.

// v2.4 exception migration — assigns deterministic ids + copies parent
// curves into legacy exceptions that lacked them. Idempotent. Imported
// from the gains module's canvas helpers.
import { migrateExceptionsV24 } from '../components/modules/gains/canvas/exceptions.js'

function _migrateScheduleExceptions(sched) {
  if (!sched) return sched
  const migrated = migrateExceptionsV24(sched.exceptions, sched)
  if (migrated === sched.exceptions) return sched
  return { ...sched, exceptions: migrated }
}

function migrateOccupancyV23(bc) {
  // Already migrated? Preserve verbatim. Then run v2.4 exception migration
  // on the schedule (idempotent — no-op if curves + ids already in place).
  if (bc?.occupancy?.density?.value != null) {
    const merged = {
      ...DEFAULT_OCCUPANCY,
      ...bc.occupancy,
      density: { ...DEFAULT_OCCUPANCY.density, ...bc.occupancy.density },
      schedule: { ...DEFAULT_OCCUPANCY.schedule, ...(bc.occupancy.schedule ?? {}) },
    }
    merged.schedule = _migrateScheduleExceptions(merged.schedule)
    return merged
  }
  // Build from legacy fields where present.
  const result = {
    ...DEFAULT_OCCUPANCY,
    occupancy_rate: bc?.occupancy_rate ?? DEFAULT_OCCUPANCY.occupancy_rate,
    density: {
      value: bc?.people_per_room ?? DEFAULT_OCCUPANCY.density.value,
      basis: bc?.people_per_room != null ? 'per_room' : DEFAULT_OCCUPANCY.density.basis,
    },
    _provenance: { source: 'migrated_from_legacy', confidence: 'medium' },
  }
  result.schedule = _migrateScheduleExceptions(result.schedule)
  return result
}

// v2.3 → v2.4 lighting migration: single-quantity → profiles[0]. Wraps
// the v2.3 fields into a single default profile with area_share = 1.0
// so the engine output is byte-identical to v2.3 behaviour for migrated
// projects. Idempotent: profiles[] already present → preserve verbatim
// (just migrate exceptions on each profile's schedule).
function _lightingProfileFromV23(v23Lighting) {
  const sched = _migrateScheduleExceptions({
    ...DEFAULT_GAINS.lighting.profiles[0].schedule,
    ...(v23Lighting.schedule ?? {}),
  })
  return {
    id: 'default_lighting',
    label: 'Lighting',
    magnitude: { ...DEFAULT_GAINS.lighting.profiles[0].magnitude, ...(v23Lighting.magnitude ?? {}) },
    relationship_to_occupancy: v23Lighting.relationship_to_occupancy ?? DEFAULT_GAINS.lighting.profiles[0].relationship_to_occupancy,
    spill_minutes:   v23Lighting.spill_minutes   ?? DEFAULT_GAINS.lighting.profiles[0].spill_minutes,
    daylight_factor: v23Lighting.daylight_factor ?? DEFAULT_GAINS.lighting.profiles[0].daylight_factor,
    area_share: 1.0,
    schedule: sched,
    _provenance: v23Lighting._provenance ?? { source: 'migrated_v23_to_v24', confidence: 'medium' },
  }
}

function _equipmentProfileFromV23(v23Equipment) {
  const sched = _migrateScheduleExceptions({
    ...DEFAULT_GAINS.equipment.profiles[0].schedule,
    ...(v23Equipment.schedule ?? {}),
  })
  return {
    id: 'default_equipment',
    label: 'Equipment',
    baseload: { ...DEFAULT_GAINS.equipment.profiles[0].baseload, ...(v23Equipment.baseload ?? {}) },
    active:   { ...DEFAULT_GAINS.equipment.profiles[0].active,   ...(v23Equipment.active   ?? {}) },
    relationship_to_occupancy: v23Equipment.relationship_to_occupancy ?? DEFAULT_GAINS.equipment.profiles[0].relationship_to_occupancy,
    standby_factor: v23Equipment.standby_factor ?? DEFAULT_GAINS.equipment.profiles[0].standby_factor,
    area_share: 1.0,
    schedule: sched,
    _provenance: v23Equipment._provenance ?? { source: 'migrated_v23_to_v24', confidence: 'medium' },
  }
}

// Idempotently ensure each profile in an array has v2.4-required fields
// (area_share, schedule with v2.4 exceptions). Profiles already in the
// array keep their values; missing fields fall back to defaults.
function _ensureProfileFields(profiles, defaultProfile) {
  if (!Array.isArray(profiles) || profiles.length === 0) return profiles ?? []
  return profiles.map((p, i) => {
    const out = {
      ...defaultProfile,
      ...p,
      id: p.id ?? `${defaultProfile.id}_${i}`,
      magnitude: p.magnitude
        ? { ...defaultProfile.magnitude, ...p.magnitude }
        : defaultProfile.magnitude,
      area_share: p.area_share ?? 1.0 / profiles.length,
      schedule: _migrateScheduleExceptions({
        ...defaultProfile.schedule,
        ...(p.schedule ?? {}),
      }),
    }
    // Preserve equipment-specific fields if present.
    if (defaultProfile.baseload) {
      out.baseload = p.baseload ? { ...defaultProfile.baseload, ...p.baseload } : defaultProfile.baseload
    }
    if (defaultProfile.active) {
      out.active   = p.active   ? { ...defaultProfile.active,   ...p.active   } : defaultProfile.active
    }
    return out
  })
}

function migrateGainsV23(bc) {
  const haveV24Lighting  = Array.isArray(bc?.gains?.lighting?.profiles)
  const haveV24Equipment = Array.isArray(bc?.gains?.equipment?.profiles)
  const haveV23Lighting  = bc?.gains?.lighting?.magnitude?.value != null
  const haveV23Equipment = bc?.gains?.equipment?.baseload?.value != null
                        || bc?.gains?.equipment?.active?.value   != null

  // ── Lighting ─────────────────────────────────────────────────────────────
  let lighting
  if (haveV24Lighting) {
    // Already v2.4 — preserve profiles, just normalise per-profile shape.
    lighting = {
      profiles: _ensureProfileFields(bc.gains.lighting.profiles, DEFAULT_GAINS.lighting.profiles[0]),
    }
  } else if (haveV23Lighting) {
    // v2.3 single-quantity → wrap as single profile with area_share 1.0
    lighting = {
      profiles: [_lightingProfileFromV23(bc.gains.lighting)],
    }
  } else {
    // No gains block at all (pre-Brief-27 projects).
    lighting = {
      profiles: [{
        ...DEFAULT_GAINS.lighting.profiles[0],
        _provenance: { source: 'migrated_from_legacy', confidence: 'low' },
      }],
    }
  }

  // ── Equipment ────────────────────────────────────────────────────────────
  let equipment
  if (haveV24Equipment) {
    equipment = {
      profiles: _ensureProfileFields(bc.gains.equipment.profiles, DEFAULT_GAINS.equipment.profiles[0]),
    }
  } else if (haveV23Equipment) {
    equipment = {
      profiles: [_equipmentProfileFromV23(bc.gains.equipment)],
    }
  } else {
    equipment = {
      profiles: [{
        ...DEFAULT_GAINS.equipment.profiles[0],
        _provenance: { source: 'migrated_from_legacy', confidence: 'low' },
      }],
    }
  }

  return { lighting, equipment }
}

const DEFAULT_CONSTRUCTIONS = {
  external_wall: 'cavity_wall_standard',
  roof:          'flat_roof_standard',
  ground_floor:  'ground_floor_slab',
  glazing:       'double_low_e',
}

const DEFAULT_SYSTEMS = {
  mode: 'detailed',

  // ── Demand-based system assignments (Brief 13) ────────────────────────────
  space_heating: {
    primary:   { system: 'gas_boiler_standard', share: 1.0, efficiency_override: null },
    secondary: null,
    tertiary:  null,
  },
  space_cooling: {
    primary:   { system: 'vrf_standard', share: 1.0, efficiency_override: null },
    secondary: null,
    tertiary:  null,
  },
  dhw: {
    primary:   { system: 'gas_boiler_dhw', share: 1.0, efficiency_override: null },
    secondary: null,
    tertiary:  null,
  },
  ventilation: {
    primary:   { system: 'mvhr_standard', share: 1.0, efficiency_override: null },
    secondary: null,
    tertiary:  null,
  },

  // ── Direct parameters ─────────────────────────────────────────────────────
  lighting_power_density:   8.0,
  lighting_control:         'occupancy_sensing',
  equipment_power_density:  15.0,
  dhw_setpoint:             60.0,
  dhw_preheat_setpoint:     45.0,
  hre_override:             85,
  sfp_override:             1.8,

  // ── Backward-compat aliases (kept until UI migrated in Parts 3-5) ─────────
  hvac_type:        'vrf_standard',
  ventilation_type: 'mvhr_standard',
  dhw_primary:      'gas_boiler_dhw',
  dhw_preheat:      'none',
}

// ── Migrate old flat systems_config → demand-based structure ─────────────────

function migrateSystemsConfig(raw) {
  if (!raw) return DEFAULT_SYSTEMS
  // Already in new format if demand structure is present
  if (raw.space_heating?.primary) return raw

  const hvacType   = raw.hvac_type        ?? 'vrf_standard'
  const ventType   = raw.ventilation_type ?? 'mvhr_standard'
  const dhwPrimary = raw.dhw_primary      ?? 'gas_boiler_dhw'
  const dhwPreheat = raw.dhw_preheat      ?? 'none'

  // VRF types handle both heating and cooling from one system
  const isVRF = hvacType.startsWith('vrf')
  const coolingSystem = isVRF ? hvacType : 'vrf_standard'

  const dhwSecondary = (dhwPreheat && dhwPreheat !== 'none')
    ? { system: dhwPreheat, share: 0.7, efficiency_override: null }
    : null

  return {
    mode: raw.mode ?? 'detailed',

    space_heating: {
      primary:   { system: hvacType, share: 1.0, efficiency_override: raw.cop_override ?? null },
      secondary: null,
      tertiary:  null,
    },
    space_cooling: {
      primary:   { system: coolingSystem, share: 1.0, efficiency_override: raw.eer_override ?? null },
      secondary: null,
      tertiary:  null,
    },
    dhw: {
      primary:   { system: dhwPrimary, share: dhwSecondary ? 0.3 : 1.0, efficiency_override: null },
      secondary: dhwSecondary,
      tertiary:  null,
    },
    ventilation: {
      primary:   { system: ventType, share: 1.0, efficiency_override: null },
      secondary: null,
      tertiary:  null,
    },

    lighting_power_density:   raw.lighting_power_density   ?? 8.0,
    lighting_control:         raw.lighting_control         ?? 'occupancy_sensing',
    equipment_power_density:  raw.equipment_power_density  ?? 15.0,
    dhw_setpoint:             raw.dhw_setpoint             ?? 60.0,
    dhw_preheat_setpoint:     raw.dhw_preheat_setpoint     ?? 45.0,
    hre_override:             raw.hre_override             ?? 85,
    sfp_override:             raw.sfp_override             ?? 1.8,

    // Backward-compat aliases
    hvac_type:        hvacType,
    ventilation_type: ventType,
    dhw_primary:      dhwPrimary,
    dhw_preheat:      dhwPreheat,
  }
}

// ── Save status: 'idle' | 'saving' | 'saved' | 'error' ──────────────────────

// ── Provider ──────────────────────────────────────────────────────────────────

export function ProjectProvider({ children }) {
  // ── Project list & current project
  const [projects, setProjects]               = useState([])
  const [currentProjectId, setCurrentProjectId] = useState(null)
  const [isLoading, setIsLoading]             = useState(true)

  // ── Current project parameters
  const [params, setParams]           = useState(DEFAULT_PARAMS)
  const [constructions, setConstructions] = useState(DEFAULT_CONSTRUCTIONS)
  const [systems, setSystems]         = useState(DEFAULT_SYSTEMS)
  // ── Comfort band (Brief 26 Part 1, state contract project.comfort_band)
  //    Drives State 1/2/2.5 demand calculation in the absence of Systems
  //    setpoints. Defaults per the contract: 20°C heating / 26°C cooling.
  const [comfortBand, setComfortBandState] = useState({ lower_c: 20, upper_c: 26 })

  // ── Save status indicator
  const [saveStatus, setSaveStatus]   = useState('idle') // 'idle'|'saving'|'saved'|'error'
  // ── Save source — 'user' for explicit edits, 'system' for project-load
  //    normalisations/migrations/internal updates. Brief 27 cleanup
  //    walkthrough Finding 2 (2026-05-14): SimulationContext gates auto-
  //    simulate on saveSource === 'user' so system-saves don't trigger a
  //    surprise 30-45s Dynamic EP run on project load. Defaults to 'system'
  //    so a new save call site that forgets to tag itself fails safely
  //    (doesn't auto-simulate) rather than triggering a surprise EP run.
  const [saveSource, setSaveSource]   = useState(null) // null | 'user' | 'system'
  const saveTimerRef    = useRef(null)   // debounce timeout
  const savedTimerRef   = useRef(null)   // auto-dismiss 'saved' message
  const broadcastTimer  = useRef(null)   // debounced broadcast to pop-out

  // ── Broadcast helpers ─────────────────────────────────────────────────────
  // Called after any state change to publish to the pop-out window (debounced 200ms)
  function _broadcast(overrides = {}) {
    if (broadcastTimer.current) clearTimeout(broadcastTimer.current)
    broadcastTimer.current = setTimeout(() => {
      publishState({ building: params, constructions, systems, ...overrides })
    }, 200)
  }

  // ── API helpers ───────────────────────────────────────────────────────────

  async function _apiFetch(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
      throw new Error(err.detail ?? `HTTP ${res.status}`)
    }
    if (res.status === 204) return null
    return res.json()
  }

  // ── Load a project by ID into local state ────────────────────────────────

  function _applyProject(project) {
    setCurrentProjectId(project.id)
    const bc = project.building_config ?? {}
    setParams({
      // Project name lives on the top-level row (so the Home list shows it
      // correctly). Fall back to building_config.name for old projects, then default.
      name:         project.name    ?? bc.name ?? DEFAULT_PARAMS.name,
      length:       bc.length       ?? DEFAULT_PARAMS.length,
      width:        bc.width        ?? DEFAULT_PARAMS.width,
      num_floors:   bc.num_floors   ?? DEFAULT_PARAMS.num_floors,
      floor_height: bc.floor_height ?? DEFAULT_PARAMS.floor_height,
      orientation:  bc.orientation  ?? DEFAULT_PARAMS.orientation,
      wwr:             bc.wwr             ?? DEFAULT_PARAMS.wwr,
      infiltration_ach: bc.infiltration_ach ?? DEFAULT_PARAMS.infiltration_ach,
      window_count: bc.window_count ?? DEFAULT_PARAMS.window_count,
      num_bedrooms:    bc.num_bedrooms    ?? DEFAULT_PARAMS.num_bedrooms,
      occupancy_rate:  bc.occupancy_rate  ?? DEFAULT_PARAMS.occupancy_rate,
      people_per_room: bc.people_per_room ?? DEFAULT_PARAMS.people_per_room,
      location:     bc.location     ?? DEFAULT_PARAMS.location,
      // Project-level metadata stored alongside building_config for now
      address:       bc.address       ?? '',
      postcode:      bc.postcode      ?? '',
      building_type: bc.building_type ?? '',
      operator:      bc.operator      ?? '',
      weather_file:        bc.weather_file        ?? null,
      future_weather_file: bc.future_weather_file ?? null,
      // Shading defaults to zero on all four facades for older projects
      shading_overhang: bc.shading_overhang ?? {
        north: { depth_m: 0, offset_m: 0 },
        south: { depth_m: 0, offset_m: 0 },
        east:  { depth_m: 0, offset_m: 0 },
        west:  { depth_m: 0, offset_m: 0 },
      },
      shading_fin: bc.shading_fin ?? {
        north: { left_depth_m: 0, right_depth_m: 0 },
        south: { left_depth_m: 0, right_depth_m: 0 },
        east:  { left_depth_m: 0, right_depth_m: 0 },
        west:  { left_depth_m: 0, right_depth_m: 0 },
      },
      openings: bc.openings ?? DEFAULT_PARAMS.openings,
      thermal_mass_mode:     bc.thermal_mass_mode     ?? DEFAULT_PARAMS.thermal_mass_mode,
      thermal_mass_category: bc.thermal_mass_category ?? DEFAULT_PARAMS.thermal_mass_category,
      // Brief 28k Gate 3+ fabric-level inputs (e.g. thermal_bridging_alpha_pct
      // legacy fallback). Engine reads building.fabric.* via withMode passthrough;
      // previously dropped here, surfaced now so legacy Brief 28L projects
      // route correctly through the back-compat fallback.
      fabric:             bc.fabric             ?? null,
      // Brief 28-TB-Simple ISO 14683 junction-based thermal bridging config.
      // Engine reads building.thermal_bridges via withMode passthrough; without
      // this allowlist entry, the OperationModule + HeatBalance would never
      // see the seeded mode='iso14683_auto' and the engine helper would always
      // fall through to the legacy α fallback (or mode='absent').
      thermal_bridges:    bc.thermal_bridges    ?? null,
      // Brief 28e operable openings (doors / window banks / vents). Engine
      // reads via withMode; OperationModule (Gate E5a 4152e92) reads
      // params.operable_openings directly. Without this allowlist entry the
      // Bridgewater gf_entrance_door from the seed never reaches the UI
      // (confirmed via 4-tab baseline 43a35ea: Operation tab shows "No
      // operable openings yet" despite seed-persisted entry).
      operable_openings:  bc.operable_openings  ?? null,
      // Brief 28-IM IM-M4 Addition 1: project-scoped shared schedules.
      // Resolved first by scheduleLibrary.resolveScheduleAtHour, ahead of
      // the hardcoded baseline dict; editable via the ScheduleEditor's
      // target='project' mode (called from Operation + Systems Schedule).
      schedules:          bc.schedules          ?? [],
      // Brief 27 Part 1 — occupancy + gains migration. Persisted projects
      // pre-26.2 don't have these fields; build from legacy num_bedrooms /
      // occupancy_rate / people_per_room and the seeded hotel-bedroom
      // schedule presets. Idempotent: if the v2.3 fields already exist on
      // the persisted bc, preserve them verbatim.
      occupancy: migrateOccupancyV23(bc),
      gains:     migrateGainsV23(bc),
      // Brief 28f Part 5.6/5.7 — v2.5 systems config. Dual-format strategy:
      // legacy systems_config is loaded via setSystems() below; v2.5 lands
      // here under params.systems_config_v25 (the engine auto-detects this
      // field and routes to the State 3 v2.5 path).
      systems_config_v25: bc.systems_config_v25 ?? null,
    })
    setConstructions(project.construction_choices ?? DEFAULT_CONSTRUCTIONS)
    setSystems(migrateSystemsConfig(project.systems_config))
    // Comfort band — fall back to contract defaults (20 / 26) if the row
    // pre-dates the Brief 26 Part 1 migration.
    setComfortBandState({
      lower_c: Number(project.comfort_band_lower_c ?? 20),
      upper_c: Number(project.comfort_band_upper_c ?? 26),
    })
  }

  // ── Startup: fetch project list, load most recent (or create default) ────

  useEffect(() => {
    async function bootstrap() {
      try {
        const list = await _apiFetch('/api/projects')
        setProjects(list)

        if (list.length > 0) {
          const full = await _apiFetch(`/api/projects/${list[0].id}`)
          _applyProject(full)
        } else {
          // No projects yet — create the default
          const created = await _apiFetch('/api/projects', {
            method: 'POST',
            body: JSON.stringify({ name: 'New Project' }),
          })
          setProjects([created])
          _applyProject(created)
        }
      } catch (err) {
        console.error('[ProjectContext] Bootstrap failed:', err)
      } finally {
        setIsLoading(false)
      }
    }
    bootstrap()
  }, [])

  // ── Debounced save helpers ────────────────────────────────────────────────

  // endpoint: sub-path like 'building' → PUT /api/projects/{id}/building
  // endpoint: null → PUT /api/projects/{id} (for general updates like construction_choices)
  // source: 'user' for explicit user edits (form changes, slider drags),
  //         'system' for project-load normalisations, migrations, or other
  //         internal updates that shouldn't trigger auto-simulate.
  //         Default 'system' so forgetting to tag fails safely (Brief 27
  //         cleanup walkthrough Finding 2 fix, 2026-05-14).
  function _scheduleSave(endpoint, body, source = 'system') {
    if (!currentProjectId) return

    // Clear any pending save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)

    setSaveStatus('saving')
    setSaveSource(source)

    saveTimerRef.current = setTimeout(async () => {
      try {
        const url = endpoint
          ? `/api/projects/${currentProjectId}/${endpoint}`
          : `/api/projects/${currentProjectId}`
        await _apiFetch(url, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        setSaveStatus('saved')
        // Source stays set while status='saved' so SimulationContext can
        // decide whether to auto-simulate. Both reset to idle/null after 2s.
        savedTimerRef.current = setTimeout(() => {
          setSaveStatus('idle')
          setSaveSource(null)
        }, 2000)
        // Refresh project list (updated_at timestamp)
        const list = await _apiFetch('/api/projects')
        setProjects(list)
      } catch (err) {
        console.error('[ProjectContext] Save failed:', err)
        setSaveStatus('error')
        // saveSource intentionally retained on error for debugging.
      }
    }, 1000)
  }

  // ── updateParam — mirrors old BuildingContext.updateParam ────────────────

  const updateParam = useCallback((key, value) => {
    setParams(p => {
      let next
      if (key === 'wwr') {
        next = { ...p, wwr: { ...p.wwr, ...value } }
      } else if (key === 'window_count') {
        next = { ...p, window_count: { ...p.window_count, ...value } }
      } else if (key === 'location') {
        next = { ...p, location: { ...p.location, ...value } }
      } else if (key === 'shading_overhang' || key === 'shading_fin') {
        // Two levels: face → field. Deep-merge so a single face update
        // doesn't wipe the other faces or sibling fields.
        const current = p[key] ?? {}
        const merged = { ...current }
        for (const face of Object.keys(value ?? {})) {
          merged[face] = { ...(current[face] ?? {}), ...(value[face] ?? {}) }
        }
        next = { ...p, [key]: merged }
      } else if (key === 'openings') {
        // Two-level merge: top-level fields (schedule, site_exposure) plus
        // per-face nested objects ({north, south, east, west}).
        const current = p.openings ?? {}
        const merged = { ...current }
        for (const k of Object.keys(value ?? {})) {
          if (['north','south','east','west'].includes(k)) {
            merged[k] = { ...(current[k] ?? {}), ...(value[k] ?? {}) }
          } else {
            merged[k] = value[k]
          }
        }
        next = { ...p, openings: merged }
      } else {
        next = { ...p, [key]: value }
      }
      if (key === 'name') {
        // Name lives on the top-level project row (used by /api/projects list
        // for the Home page). Also persist building_config in the same PUT so
        // we don't lose other in-flight edits.
        _scheduleSave(null, { name: value, building_config: next }, 'user')
      } else {
        _scheduleSave('building', next, 'user')
      }
      _broadcast({ building: next })
      return next
    })
  }, [currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── updateConstruction ───────────────────────────────────────────────────

  const updateConstruction = useCallback((key, value) => {
    setConstructions(c => {
      const next = { ...c, [key]: value }
      _scheduleSave(null, { construction_choices: next }, 'user')
      _broadcast({ constructions: next })
      return next
    })
  }, [currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── setComfortBand ───────────────────────────────────────────────────────
  // Updates the project's comfort band (Brief 26 Part 1). Accepts a partial:
  // `{ lower_c }` or `{ upper_c }` or both. Validates against the contract
  // bounds (8°C ≤ lower < upper ≤ 32°C) on the client; backend re-validates.
  const setComfortBand = useCallback((partial) => {
    setComfortBandState(prev => {
      const next = {
        lower_c: Number(partial.lower_c ?? prev.lower_c),
        upper_c: Number(partial.upper_c ?? prev.upper_c),
      }
      // Client-side bounds check — backend repeats this. Bad input is
      // silently rejected here (return prev) so a half-typed slider value
      // doesn't fire a PUT that bounces back as 400.
      if (!(8.0 <= next.lower_c && next.lower_c < next.upper_c && next.upper_c <= 32.0)) {
        return prev
      }
      _scheduleSave(null, {
        comfort_band_lower_c: next.lower_c,
        comfort_band_upper_c: next.upper_c,
      }, 'user')
      return next
    })
  }, [currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── updateSystem ─────────────────────────────────────────────────────────
  // Supports both old flat keys (backward compat) and new demand-based keys.
  // Keeps both structures in sync so old and new components work simultaneously.

  const updateSystem = useCallback((key, value) => {
    setSystems(s => {
      let next = { ...s, [key]: value }

      // ── Old flat key → sync to new demand structure ────────────────────
      if (key === 'hvac_type') {
        const isVRF = value?.startsWith('vrf')
        next = {
          ...next,
          space_heating: { ...s.space_heating, primary: { ...(s.space_heating?.primary ?? {}), system: value } },
          space_cooling:  isVRF
            ? { ...s.space_cooling, primary: { ...(s.space_cooling?.primary ?? {}), system: value } }
            : s.space_cooling,
        }
      } else if (key === 'ventilation_type') {
        next = {
          ...next,
          ventilation: { ...s.ventilation, primary: { ...(s.ventilation?.primary ?? {}), system: value } },
        }
      } else if (key === 'dhw_primary') {
        next = {
          ...next,
          dhw: { ...s.dhw, primary: { ...(s.dhw?.primary ?? {}), system: value } },
        }
      } else if (key === 'dhw_preheat') {
        const hasPreheat = value && value !== 'none'
        next = {
          ...next,
          dhw: {
            ...s.dhw,
            secondary: hasPreheat ? { system: value, share: 0.7, efficiency_override: null } : null,
          },
        }

      // ── New demand key → sync to old flat aliases ─────────────────────
      } else if (key === 'space_heating') {
        next = { ...next, hvac_type: value?.primary?.system ?? s.hvac_type }
      } else if (key === 'space_cooling') {
        // no direct legacy alias — cooling was combined with hvac_type
      } else if (key === 'ventilation') {
        next = { ...next, ventilation_type: value?.primary?.system ?? s.ventilation_type }
      } else if (key === 'dhw') {
        next = {
          ...next,
          dhw_primary: value?.primary?.system ?? s.dhw_primary,
          dhw_preheat: value?.secondary?.system ?? 'none',
        }
      }

      _scheduleSave('systems', next, 'user')
      _broadcast({ systems: next })
      return next
    })
  }, [currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Respond to pop-out state requests ────────────────────────────────────
  useEffect(() => {
    return onInitialStateRequest(() => {
      publishState({ building: params, constructions, systems })
    })
  }, [params, constructions, systems]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Project management actions ────────────────────────────────────────────

  async function createProject(name = 'New Project') {
    const created = await _apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    const list = await _apiFetch('/api/projects')
    setProjects(list)
    _applyProject(created)
    return created
  }

  async function loadProject(id) {
    setIsLoading(true)
    try {
      const full = await _apiFetch(`/api/projects/${id}`)
      _applyProject(full)
    } finally {
      setIsLoading(false)
    }
  }

  async function deleteProject(id) {
    await _apiFetch(`/api/projects/${id}`, { method: 'DELETE' })
    const list = await _apiFetch('/api/projects')
    setProjects(list)

    // If we deleted the current project, load the first remaining or create new
    if (id === currentProjectId) {
      if (list.length > 0) {
        const full = await _apiFetch(`/api/projects/${list[0].id}`)
        _applyProject(full)
      } else {
        const created = await _apiFetch('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ name: 'New Project' }),
        })
        setProjects([created])
        _applyProject(created)
      }
    }
  }

  async function updateProjectName(name) {
    if (!currentProjectId) return
    await _apiFetch(`/api/projects/${currentProjectId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    })
    // Update local params and project list
    setParams(p => ({ ...p, name }))
    const list = await _apiFetch('/api/projects')
    setProjects(list)
  }

  // ── Context value ─────────────────────────────────────────────────────────

  return (
    <ProjectContext.Provider value={{
      // Project management
      currentProjectId,
      projects,
      isLoading,
      saveStatus,
      saveSource,

      // Building state (mirrors old BuildingContext interface)
      params,
      constructions,
      systems,

      // Comfort band (Brief 26 Part 1) — project-level State 1 demand bounds.
      comfortBand,
      setComfortBand,

      // Update actions
      updateParam,
      updateConstruction,
      updateSystem,
      updateProjectName,

      // Project CRUD
      createProject,
      loadProject,
      deleteProject,
    }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  return useContext(ProjectContext)
}
