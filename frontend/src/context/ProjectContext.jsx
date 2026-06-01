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
import { migrateInterventionPatches } from '../utils/interventionsEngine.js'  // Brief 42 Part 2

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
        // Brief 72 P4 (2026-05-29): gain_fraction — the fraction of the
        // profile's electricity consumption that becomes a zone-heat gain.
        // Independent of daylight_factor: daylight_factor reduces the
        // *load* (kWh of electricity), gain_fraction routes the *remaining
        // load's heat side* into the heat balance. Default 1.0 keeps the
        // pre-brief behaviour byte-identical (all electricity becomes heat,
        // the long-standing implicit assumption for lighting). External /
        // task lighting that radiates outdoors can drop this below 1.0
        // without altering the electrical load. Bounded [0, 1].
        gain_fraction: 1.0,
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
        // Brief 72 P4 (2026-05-29): gain_fraction — see lighting comment
        // above. Equipment's pre-brief implicit assumption was also 1.0
        // (computers, kitchen appliances, all radiate to the zone). Default
        // 1.0 keeps existing projects byte-identical. Catering equipment
        // with extract hoods (gain_fraction ≈ 0.5) is the canonical use
        // case for editing this below 1.0. Bounded [0, 1].
        gain_fraction: 1.0,
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
  // Brief 72 P4 (2026-05-29) — auxiliary loads. Top-level parallel to
  // lighting / equipment so the engine can iterate uniformly. Default
  // is an empty profiles array; new projects start with no auxiliary
  // loads (anchor unchanged for projects that don't opt in).
  //
  // The six P7 preset items (External lighting, Catering, Pumps, Small
  // power, Lifts, Custom) each build a profile with this minimum shape:
  //
  //   { id, label,
  //     magnitude: { value: <W/m²>, unit: 'w_per_m2' },
  //     gain_fraction: <0–1>,                  // brief default per preset
  //     relationship_to_occupancy: 'proportional' | 'independent' | 'always_on',
  //     spill_minutes: 0,
  //     area_share: 1.0,
  //     schedule: { weekday, saturday, sunday, monthly_multipliers, exceptions },
  //     _provenance: { source, confidence }
  //   }
  //
  // No `standby_factor` (auxiliary doesn't have equipment's active /
  // baseload split — single magnitude × schedule × gain_fraction).
  // No `daylight_factor` (auxiliary isn't daylight-responsive; External
  // Lighting is on at night by schedule, not by daylight curve).
  // No `baseload` / `active` (single magnitude).
  //
  // The shape is established here so P5 engine wiring and P7 UI can
  // both reference DEFAULT_GAINS.auxiliary; the empty default keeps P4
  // strictly schema-only (no behavioural change).
  auxiliary: {
    profiles: [],
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
  // Openings — passive wind-driven envelope openings.
  // Each facade can carry an always-open louvre (m²) and an operable window
  // fraction (% of glazing area). Both default off; user opts in per facade.
  //
  // Brief 33 / 34 (2026-05-18) — Building module is envelope-only. Permanent
  // vents are passive holes in the envelope (trickle vents, louvres, fixed
  // grilles). They have no relationship to any mechanical system; mechanical
  // ventilation lives in the Systems module. See CLAUDE.md "Module scopes"
  // and docs/audit/29_permanent_vent_methodology.md.
  //
  // flow_mode picks which wind-driven correlation governs Q:
  //   'cross'         — wind between opposite facades
  //                     Q = cd · A · sqrt(Cw) · v_wind
  //   'single_sided'  — empirical BS EN 16798-7 §6.4 with engineering correction
  //                     Q = 0.025 · A · v_wind · min(1.0, cd / 0.6)
  //
  // Default 'single_sided' — the more conservative correlation; the safe
  // assumption for any building whose internal air-path topology hasn't been
  // explicitly classified as cross-flow.
  //
  // Brief 34 (2026-05-18) simplified the C_d UI: one building-wide slider
  // replaced the Brief 33 Part 2 per-facade geometry calculator. The
  // calculator (`computeCd` in `frontend/src/utils/openingCoefficients.js`)
  // remains as a code utility; the methodology doc continues to reference
  // the lookup tables for users choosing a slider value manually.
  //
  // Brief 42 (2026-05-19) — per-opening cd + flow_mode. Each facade now
  // carries its own cd and flow_mode. Building-wide openings.cd and
  // openings.flow_mode are removed. A reception door (cd 0.60, cross) and a
  // trickle vent (cd 0.40, single_sided) on the same building no longer
  // share one slider. Site exposure (C_w) stays building-wide — it's a
  // property of where the building sits, not of any individual opening.
  //
  // Per-facade defaults below: cd 0.40 (louvre seed), flow_mode
  // 'single_sided'. Range cd 0.15 (very restrictive) to 0.65 (sharp
  // orifice). Defaults are seed values applied to new facades; once a
  // facade has a non-zero area the values are independent and editable
  // per-facade. Migration (Brief 42 Part 3) copies the persisted
  // building-wide value onto every facade so behaviour is unchanged at
  // migration time.
  //
  // ⚠ ALLOWLIST DRIFT: any new top-level or per-facade field added below
  // must also be allowlisted in withMode's passThroughOpenings
  // (frontend/src/utils/instantCalc.js) or the field will be silently
  // dropped on the way into the engine. See the Finding 1 fix comment
  // block in instantCalc.js around line 408.
  openings: {
    schedule:      'never',         // 'never' | 'occupied' | 'summer_day' | 'always'
    site_exposure: 'normal',        // 'sheltered' | 'normal' | 'exposed'
    // Building-wide cd + flow_mode REMOVED in Brief 42 — see per-facade
    // entries below. Migration writes persisted building-wide values onto
    // each facade at Part 3.
    north: { louvre_area_m2: 0, openable_fraction: 0, cd: 0.40, flow_mode: 'single_sided' },
    south: { louvre_area_m2: 0, openable_fraction: 0, cd: 0.40, flow_mode: 'single_sided' },
    east:  { louvre_area_m2: 0, openable_fraction: 0, cd: 0.40, flow_mode: 'single_sided' },
    west:  { louvre_area_m2: 0, openable_fraction: 0, cd: 0.40, flow_mode: 'single_sided' },
  },
  window_count:    { north: 8, south: 8, east: 3, west: 3 },
  // Legacy occupancy fields — kept for backward compat with hvac_dhw.py
  // and existing State 1 code that reads them. Brief 27 introduces
  // `occupancy.*` as the v2.3 contract source of truth; these fields
  // mirror the same numbers and stay in sync via the migration on load.
  //
  // Brief 72 P3 (2026-05-29): people_per_room retired (Principle 7).
  // The unified DHW headcount path reads `occupancy.density.value` via
  // computeTotalOccupants; the phantom field is no longer in DEFAULT_PARAMS
  // and is not threaded by the loader. Legacy projects whose persisted
  // building_config still carries people_per_room are detected in the
  // loader and the value is migrated into `occupancy.density.value`
  // exactly once (see `_buildOccupancyFromLegacy` below).
  num_bedrooms:    134,
  occupancy_rate:  0.75,
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
  // Brief 40 Part 4 (2026-05-19) — default Brief 40 systems config for new
  // projects. Heating / cooling / DHW / ventilation arrays start empty; the
  // user adds systems via the SystemEditorCard + AddSystemButton UI.
  // Lighting + small_power are seeded with thin entries at control_factor
  // 1.0 / share 100 (baseline-as-found) per Brief 40 Part 4 step 4.1 — these
  // mirror the heat-gain energy from Internal Gains 1:1 into Systems'
  // delivered electrical accounting. User can dial in daylight dimming /
  // occupancy sensors / etc by editing the control_mechanism on the card.
  //
  // Heat-gain provenance: lighting + small_power heat stays sourced from
  // Internal Gains (heat balance integrand unchanged). Systems' thin
  // entries account the delivered electrical energy only — no double-
  // counting in the heat balance because lighting heat is upstream of the
  // Systems split. Audit doc §13 "Thin Systems entries — cross-module
  // accounting" documents the wiring.
  //
  // Brief 42 Part 1 (2026-05-20) — service-level vs system-level schema
  // reorganisation. Building-level fields (setpoints, DHW demand + temps)
  // lift OUT of per-system entries to service-level positions on
  // `systems_config_v40`. Per-system entries retain only fields that
  // describe the specific kit installed (source, efficiency, share,
  // control, enabled). Engine reads service-level (Part 2). Migration
  // covers Bridgewater's persisted v1 shape via migratePatch +
  // loader-side lift (Parts 2 + 4).
  //
  // Full schema reference: docs/audit/42_systems_ux_schema.md
  // Brief 64 §B (2026-05-27): control_strategy is a building-wide
  // demand-model selector that governs how _calculateState2 derives
  // heating/cooling demand against the setpoints. Two options:
  //
  //   'active_setpoint' (default) — independent setpoint clamps. The
  //     cooling clamp holds T_air at the cooling setpoint in every
  //     hour the free-running zone would exceed it (gains-inclusive:
  //     fabric + solar + internal + ventilation air-change). The
  //     heating clamp behaves as before (gains + solar offset loss).
  //     This is what a properly-controlled conditioned building does
  //     and what you assume when sizing cooling plant.
  //
  //   'free_running' — preserved pre-Brief-64 weather-direction-bucketed
  //     three-way branch. The building has no active cooling system;
  //     cooling only occurs when the weather assists. Use this to
  //     show overheating risk for a naturally-ventilated / mixed-mode
  //     design. NOT labelled "weather-compensated" — that term means
  //     heating flow-temperature modulation and would misdescribe the
  //     physics.
  //
  // Engine reads at the State 2 demand-derivation branch site (see
  // instantCalc.js ~L3307). Legacy projects without the field default
  // to 'active_setpoint'; their cooling demand will rise on gains-
  // dominated buildings — that's correct per Chris's ratified clamp
  // decision (gates on consistency, not absolute EUI).
  //
  // ⚠ ALLOWLIST DRIFT: also added to withMode's `base` block in
  // instantCalc.js or the field would be silently dropped on the way
  // into the engine. Same shape of bug as Brief 33's flow_mode.
  control_strategy: 'active_setpoint',
  systems_config_v40: {
    // ── Heating service ────────────────────────────────────────────
    // setpoint_mode: 'follow_comfort' uses the comfort band's lower_c at
    // compute time; 'custom' uses heating_setpoint_c verbatim.
    heating_setpoint_mode: 'follow_comfort',
    heating_setpoint_c:    null,
    heating:               [],
    // ── Cooling service ────────────────────────────────────────────
    cooling_setpoint_mode: 'follow_comfort',
    cooling_setpoint_c:    null,
    cooling:               [],
    // ── DHW service ────────────────────────────────────────────────
    // Building-level demand + temperatures (single source of truth).
    // Multiple DHW systems share this demand via their share_pct.
    // Both demand fields kept populated so basis-switching is cheap.
    dhw_storage_setpoint_c:                60,   // legionella default
    dhw_tap_outlet_temp_c:                 40,   // hotel default (Brief 40 §2.3)
    dhw_cold_supply_temp_c:                10,
    dhw_demand_basis:                      'per_person',
    dhw_demand_litres_per_person_per_day:  80,
    dhw_demand_litres_per_m2_per_day:      1.1,
    // Brief 58 B4 (2026-05-26): DHW hourly load-shape toggle.
    //   'flat'             — constant L/h across all 8760 hours (storage
    //                        decouples timing from draw; default).
    //   'follow_occupancy' — same annual L spread over hourly occupancy
    //                        presence (0 L off-hours, peak L peak-hours).
    // Annual DHW demand is IDENTICAL across both shapes; only the
    // hourly distribution differs. Engine reads at compute time and
    // attaches an `hourly_kwh` array to the DHW result. Visualisation
    // of the hourly draw is the follow-up brief.
    dhw_load_shape:                        'flat',
    dhw:                                   [],
    // ── Ventilation, Lighting, Small power: per-system only ────────
    ventilation: [],
    lighting: [{
      id:                  'default_lighting',
      label:               'Lighting (baseline)',
      service:             'lighting',
      source:              'electricity',
      efficiency_metric:   null,
      setpoint:            null,
      control_mechanism:   'constant',
      control_schedule_id: null,
      control_factor:      1.0,
      share_pct:           100,
      capacity_kw:         null,
      notes:               '',
      enabled:             true,
    }],
    small_power: [{
      id:                  'default_small_power',
      label:               'Small power (baseline)',
      service:             'small_power',
      source:              'electricity',
      efficiency_metric:   null,
      setpoint:            null,
      control_mechanism:   'constant',
      control_schedule_id: null,
      control_factor:      1.0,
      share_pct:           100,
      capacity_kw:         null,
      notes:               '',
      enabled:             true,
    }],
  },
  // Brief 40 Part 3 (2026-05-19) — per-project systems library (Brief 37
  // pattern, 'systems' namespace). Populated by SystemEditorCard "Save to
  // library" action; consumed by AddSystemButton "From library" modal tab.
  // Library entries carry their full Brief 40 system shape + an additional
  // `saved_at` timestamp + `lib_${service}_*` id.
  library_systems: [],
  // Brief 41 Part 1 (2026-05-20) — Interventions module data model.
  // Ordered list of declarative patches against the baseline
  // (Pattern Y per Notion design note §1–2). Engine in Part 2 runs the
  // cumulative state for each enabled intervention in order. Schema +
  // patch shape + path conventions + schema-flexibility discipline
  // documented in docs/audit/41_interventions_schema.md.
  //
  // schema_version stamps the building_config schema version each
  // intervention's patches were authored against. Monotonically
  // increases — Brief 41 stamped 1, Brief 42 stamps 2 (service-level
  // vs system-level reorganisation of systems_config_v40). Future
  // schema-changing briefs increment by 1 AND register a
  // migratePatch dispatch alongside the schema change (Notion §7 /
  // audit doc 42 §6 schema version convention).
  interventions:  [],
  schema_version: 2,
  // Brief 41 Part 5 (2026-05-20) — per-project intervention library.
  // Mirrors Brief 37 (schedules) + Brief 40 (systems) library
  // patterns. Populated by InterventionLibrary "Save to library"
  // action; consumed by "Load from library" picker. Entries carry the
  // intervention shape (id, label, theme, notes, patches,
  // schema_version) plus a saved_at timestamp and a `lib_intervention_*`
  // id assigned at save time.
  library_interventions: [],
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
// Brief 37 Part 2 (2026-05-18): exceptions.js moved to shared/scheduleEditor/.
import { migrateExceptionsV24 } from '../components/shared/scheduleEditor/exceptions.js'

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
    // Brief 72 P4 (2026-05-29): gain_fraction defaults to 1.0 — anchor
    // preservation. v2.3 projects never carried this field; 1.0 means
    // all the electricity becomes heat (the pre-brief implicit assumption).
    gain_fraction:   v23Lighting.gain_fraction   ?? DEFAULT_GAINS.lighting.profiles[0].gain_fraction,
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
    // Brief 72 P4 (2026-05-29): gain_fraction defaults to 1.0 — anchor
    // preservation. v2.3 projects never carried this field; 1.0 means
    // all the electricity becomes heat (the pre-brief implicit assumption).
    gain_fraction:  v23Equipment.gain_fraction  ?? DEFAULT_GAINS.equipment.profiles[0].gain_fraction,
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

  // ── Auxiliary (Brief 72 P4, 2026-05-29) ──────────────────────────────────
  // No v2.3 source — auxiliary is wholly new in this brief. Two cases:
  //
  //   1. bc.gains.auxiliary.profiles already present  → preserve verbatim,
  //      just normalise per-profile shape via _ensureProfileFields so any
  //      future migration (e.g. v2.5 adding a new auxiliary field) lands.
  //   2. Absent                                       → seed empty profiles
  //      array. Existing projects get NO auxiliary loads automatically;
  //      anchor stays byte-identical. Users opt in by adding profiles
  //      via the AuxiliarySection preset picker (P7).
  //
  // The auxiliary "default profile" for _ensureProfileFields is shaped on
  // lighting (single magnitude, no baseload/active split, gain_fraction
  // present) but with gain-side fields stripped. We hand-build a minimal
  // default here rather than referencing DEFAULT_GAINS.auxiliary.profiles[0]
  // (which is empty — auxiliary has no canonical default profile).
  const _auxDefaultProfile = {
    id: 'auxiliary_profile',
    label: 'Auxiliary',
    magnitude: { value: 0, unit: 'w_per_m2' },
    gain_fraction: 1.0,
    relationship_to_occupancy: 'independent',
    spill_minutes: 0,
    area_share: 1.0,
    schedule: {
      weekday:             new Array(24).fill(0),
      saturday:            new Array(24).fill(0),
      sunday:              new Array(24).fill(0),
      monthly_multipliers: new Array(12).fill(1.0),
      exceptions:          [],
    },
    _provenance: { source: 'seeded_default', confidence: 'low' },
  }
  let auxiliary
  const haveAuxiliary = Array.isArray(bc?.gains?.auxiliary?.profiles)
  if (haveAuxiliary) {
    auxiliary = {
      profiles: _ensureProfileFields(bc.gains.auxiliary.profiles, _auxDefaultProfile),
    }
  } else {
    auxiliary = { profiles: [] }
  }

  return { lighting, equipment, auxiliary }
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

// ── Brief 42 Part 2: v1 → v2 in-memory migration (2026-05-20) ──────────────
//
// Lifts building-level fields (setpoints, DHW demand + temps) from
// per-system entries on `systems_config_v40.{heating, cooling, dhw}` to
// service-level positions on `systems_config_v40` directly. Strips the
// per-system fields. Idempotent — running twice produces the same shape.
//
// Called from `_applyProject` when `bc.schema_version < 2`. The
// loader-side migration is the safety net for in-flight cases between
// Part 2 landing and Part 4's explicit migration script running on
// disk. After one autosave cycle post-Part-2, persisted bc has the v2
// shape and this helper becomes a no-op on subsequent loads.
//
// Strategy:
//   - For each service, pick the FIRST enabled per-system entry that
//     has the building-level field; lift its value to the service-
//     level position. (If no enabled entry has it, fall through to
//     the FIRST entry; if no entries at all, use DEFAULT_PARAMS.)
//   - Strip the building-level fields from every per-system entry.
//
// The "first-wins" rule mirrors the pre-Brief-42 engine behaviour
// (which read from `systems[0]` / `enabledSystems[0]`). Bridgewater's
// migration runs cleanly because every DHW entry carries the same
// values — the migration script in Part 4 will warn if it detects
// disagreement.
const SERVICE_LEVEL_FIELDS_PER_SERVICE = {
  heating: ['setpoint'],
  cooling: ['setpoint'],
  dhw:     ['setpoint', 'tap_outlet_temp_c', 'cold_supply_temp_c',
            'demand_basis', 'demand_litres_per_person_per_day',
            'demand_litres_per_m2_day'],
}

// Map a per-system v1 field name to the service-level v2 field name.
function _v2ServiceLevelKey(service, field) {
  if (service === 'heating' && field === 'setpoint') return 'heating_setpoint_c'
  if (service === 'cooling' && field === 'setpoint') return 'cooling_setpoint_c'
  if (service === 'dhw') {
    if (field === 'setpoint')                          return 'dhw_storage_setpoint_c'
    if (field === 'tap_outlet_temp_c')                 return 'dhw_tap_outlet_temp_c'
    if (field === 'cold_supply_temp_c')                return 'dhw_cold_supply_temp_c'
    if (field === 'demand_basis')                      return 'dhw_demand_basis'
    if (field === 'demand_litres_per_person_per_day')  return 'dhw_demand_litres_per_person_per_day'
    if (field === 'demand_litres_per_m2_day')          return 'dhw_demand_litres_per_m2_per_day'
  }
  return null
}

function migrateSystemsConfigV40_V1ToV2(rawV40) {
  if (!rawV40 || typeof rawV40 !== 'object') return rawV40
  // If service-level fields already exist, the migration has already
  // run (idempotent: subsequent loads see no per-system stale fields
  // and the heading-level keys are already populated; we still strip
  // any remaining per-system instances as a safety pass).
  const out = { ...rawV40 }

  for (const service of ['heating', 'cooling', 'dhw']) {
    const arr = Array.isArray(rawV40[service]) ? rawV40[service] : []
    if (arr.length === 0) continue
    const fields = SERVICE_LEVEL_FIELDS_PER_SERVICE[service]

    // Lift first-enabled value (fallback to first entry, then DEFAULT_PARAMS
    // for any field that wasn't on any entry).
    const enabledArr = arr.filter(s => s && s.enabled !== false)
    const leadEnabled = enabledArr[0] ?? arr[0]
    const defaultsV40 = DEFAULT_PARAMS.systems_config_v40

    for (const field of fields) {
      const v2Key = _v2ServiceLevelKey(service, field)
      if (!v2Key) continue
      // Skip if v2-level field already populated and not undefined
      // (don't clobber existing service-level values).
      if (out[v2Key] !== undefined && out[v2Key] !== null) continue
      // For heating/cooling setpoint we need both mode and c. Special-case:
      if ((service === 'heating' || service === 'cooling') && field === 'setpoint') {
        const v = leadEnabled?.[field]
        if (typeof v === 'number') {
          out[`${service}_setpoint_mode`] = 'custom'
          out[`${service}_setpoint_c`]    = v
        } else {
          // null/undefined per-system setpoint = "follow comfort"
          out[`${service}_setpoint_mode`] = defaultsV40[`${service}_setpoint_mode`]
          out[`${service}_setpoint_c`]    = null
        }
        continue
      }
      // DHW + simple value rewrites: lift the value verbatim, then fall
      // back to the DEFAULT_PARAMS default if absent.
      const liftedValue = leadEnabled?.[field]
      out[v2Key] = (liftedValue !== undefined && liftedValue !== null)
                     ? liftedValue
                     : defaultsV40[v2Key]
    }

    // Strip building-level fields from every per-system entry.
    out[service] = arr.map(sys => {
      if (!sys || typeof sys !== 'object') return sys
      const cleaned = { ...sys }
      for (const field of fields) delete cleaned[field]
      return cleaned
    })
  }

  return out
}

// Brief 42 Part 2 — wrapper that migrates the bc to v2 if necessary,
// also walks interventions through migrateInterventionPatches. Returns
// a sub-object with the migrated values for the loader to merge into
// the params set call.
//
// Brief 55 Part 2 (2026-05-26) — extended to v3. v2→v3 converts legacy
// whole-object `systems_config_v40` snapshots in saved interventions
// into field-level patches by diffing against the project's BASELINE
// v40 (bc.systems_config_v40 from disk, post-v1→v2 migration). This
// fixes Finding D's order-dependence — see docs/audit/55_granular_patch.md.
function _bcLoaderMigration(bc) {
  const fromVersion = Number.isInteger(bc?.schema_version) ? bc.schema_version : 1
  const toVersion = 3
  if (fromVersion >= toVersion) return null  // already migrated; no-op

  // Step 1: v1→v2 systems_config_v40 reshape (Brief 42).
  const v2_migratedV40 = (bc?.systems_config_v40 && fromVersion < 2)
                       ? migrateSystemsConfigV40_V1ToV2(bc.systems_config_v40)
                       : (bc?.systems_config_v40 ?? null)

  // Brief 55 v2→v3 needs the baseline v40 for diffing legacy snapshots.
  // Use the post-v1→v2 baseline so paths agree with the new shape.
  const baselineForDiff = { systems_config_v40: v2_migratedV40 }

  const migratedInterventions = Array.isArray(bc?.interventions)
    ? bc.interventions.map(intv => {
        const intvFrom = Number.isInteger(intv?.schema_version) ? intv.schema_version : fromVersion
        if (intvFrom >= toVersion) return intv
        return migrateInterventionPatches(intv, intvFrom, toVersion, baselineForDiff)
      })
    : undefined

  return {
    systems_config_v40: v2_migratedV40,
    interventions: migratedInterventions,
    schema_version: toVersion,
  }
}

// Back-compat alias — old name kept until call sites are renamed in a
// follow-up commit. _bcLoaderMigration is the canonical name now.
const _brief42LoaderMigration = _bcLoaderMigration

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
      // Brief 58 A2 (2026-05-26): include comfortBand so the popout's
      // calculateInstant call has it (engine now requires it).
      publishState({ building: params, constructions, systems, comfortBand, ...overrides })
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
    const bcRaw = project.building_config ?? {}
    // Brief 42 Part 2: run the v1→v2 in-memory migration BEFORE the
    // params setter sees the data. Lifts heating/cooling/dhw building-
    // level fields from per-system entries to service-level positions
    // on systems_config_v40, and migrates intervention patches via
    // migratePatch v1→v2. Idempotent: skipped when bc.schema_version
    // >= 2 already.
    const _v2Migration = _brief42LoaderMigration(bcRaw)
    let bc = _v2Migration
      ? { ...bcRaw,
          systems_config_v40: _v2Migration.systems_config_v40 ?? bcRaw.systems_config_v40,
          interventions:      _v2Migration.interventions      ?? bcRaw.interventions,
          schema_version:     _v2Migration.schema_version }
      : bcRaw
    // Brief 73 P3 (2026-05-29): strip `share_pct` from any persisted
    // ventilation entry on load. Vent fans don't split a shared demand
    // (each runs at its own flow_rate × flow_rate_basis), so the field
    // had no engine read site post Brief 60 Part A and no UI as of this
    // brief. The strip is unconditional (idempotent — no schema_version
    // bump needed; projects that never had it are no-op). The field
    // naturally drops out of the persisted bc on the next save because
    // it's gone from the in-memory params. Mirrors Brief 72 P3's
    // people_per_room retirement pattern: silent loader-side removal,
    // no UI alarm.
    if (Array.isArray(bc?.systems_config_v40?.ventilation)) {
      const ventBefore = bc.systems_config_v40.ventilation
      const hadShare = ventBefore.some(v => v != null && Object.prototype.hasOwnProperty.call(v, 'share_pct'))
      if (hadShare) {
        const ventStripped = ventBefore.map(v => {
          if (!v || typeof v !== 'object') return v
          const { share_pct: _drop, ...rest } = v
          return rest
        })
        bc = {
          ...bc,
          systems_config_v40: {
            ...bc.systems_config_v40,
            ventilation: ventStripped,
          },
        }
      }
    }
    // Brief 72 P3 (2026-05-29): schema migration warning for the retired
    // `people_per_room` phantom field. When a persisted project still
    // carries the field, log a one-shot console.warn explaining what
    // happens to the value (it's migrated into `occupancy.density.value`
    // via `_buildOccupancyFromLegacy` if the v2.3 occupancy block is
    // absent; otherwise it's silently ignored). The warning is
    // intentionally a console diagnostic, not a UI banner — it's a
    // developer signal during the deprecation window, not a user-facing
    // alarm. Will be removed in a later brief once all stored projects
    // have been opened and re-saved at least once (the field naturally
    // disappears from the persisted bc on the next save because it's
    // no longer in params).
    if (bcRaw?.people_per_room != null && typeof console !== 'undefined') {
      const ppr   = Number(bcRaw.people_per_room)
      const hasV23 = bcRaw?.occupancy?.density?.value != null
      console.warn(
        `[Brief 72 P3] Project "${project.name ?? project.id}" carries a ` +
        `legacy building.people_per_room=${ppr}. ` +
        (hasV23
          ? `v2.3 occupancy.density.value=${bcRaw.occupancy.density.value} is present and authoritative; the legacy value is ignored.`
          : `Migrated into occupancy.density.value=${ppr} (basis per_room). Re-save the project to drop the legacy field.`)
      )
    }
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
      // Brief 72 P3 (2026-05-29): people_per_room dropped from loader output —
      // the field is now phantom (no engine read site). If a legacy
      // building_config still has it, `_buildOccupancyFromLegacy` below
      // migrates the value into `occupancy.density.value` (basis per_room);
      // a console.warn surfaces the migration on the first load.
      // Brief 58 A4 (2026-05-26): reported_gia — the EUI denominator
      // (A3 engine surface). null when absent on load → engine falls
      // back to geometry-derived gia (length × width × num_floors).
      // Editable via BuildingMetadataSection.
      reported_gia:    bc.reported_gia    ?? null,
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
      // Brief 28-IM IM-M6: retrofit roadmap — ordered intervention list
      // consumed by roadmapEngine.computeRoadmap. Each entry carries
      // {id, year, sequence_in_year, type, name, overrides}.
      roadmap:            bc.roadmap            ?? { interventions: [] },
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
      // Brief 40 Part 2 (2026-05-19) — Brief 40 per-system array shape.
      // Named `systems_config_v40` (mirroring the existing
      // `systems_config_v25` convention) to avoid clashing with the legacy
      // `systems_config` fallback used by State 3 line 4018. Coexists with
      // systems_config_v25 during the migration window (Brief 40 Part 5
      // migration script populates this from the v25 shape on Bridgewater).
      // When this field is non-empty for any service, State 3's
      // systemsEngine.computeSystemsDelivered produces the per-system
      // breakdown and comfort-vs-setpoint diagnostic and attaches it under
      // `consumption.brief40`; when absent / empty, the engine falls back
      // to the v25 path and `consumption.brief40` is null.
      //
      // Brief 40 Part 4 (2026-05-19) — fall back to DEFAULT_PARAMS when bc
      // doesn't carry the field, so loading a pre-Brief-40 project still
      // gets the seeded lighting + small_power thin entries. Engine paths
      // gate the systemsEngine call on "any service array non-empty", so
      // a project with only lighting + small_power populated still triggers
      // the Brief 40 path for those services (and the heating / cooling /
      // dhw / ventilation v25 contracts continue to drive their Sankey
      // visuals unchanged).
      systems_config_v40: bc.systems_config_v40 ?? DEFAULT_PARAMS.systems_config_v40,
      // Brief 64 §B (2026-05-27) — control_strategy demand-model selector.
      // Default 'active_setpoint' (clamp) for both new projects AND legacy
      // projects without the field. Cooling demand will rise on gains-
      // dominated buildings under the new default — that's correct per
      // Chris's ratified post-Brief-62 decision. Persisted choice
      // round-trips via mutate('building.control_strategy', ...) and the
      // standard PUT /api/projects/{id}/building → bc.control_strategy
      // path.
      control_strategy: (bc.control_strategy === 'free_running' || bc.control_strategy === 'active_setpoint')
                          ? bc.control_strategy
                          : DEFAULT_PARAMS.control_strategy,
      // Brief 40 Part 3 (2026-05-19) — per-project systems library.
      // Same load semantics as systems_config_v40.
      library_systems: Array.isArray(bc.library_systems) ? bc.library_systems : (DEFAULT_PARAMS.library_systems ?? []),
      // Brief 41 Part 1 (2026-05-20) — Interventions stack. Falls back to
      // empty array for pre-Brief-41 projects (no patches stamped against
      // older schemas, so no migration to run on load). schema_version
      // tracks the building_config schema version this project's
      // interventions were authored against; absent → default to current.
      interventions:  Array.isArray(bc.interventions) ? bc.interventions : DEFAULT_PARAMS.interventions,
      schema_version: Number.isInteger(bc.schema_version) ? bc.schema_version : DEFAULT_PARAMS.schema_version,
      // Brief 41 Part 5 (2026-05-20) — per-project intervention library.
      // Same load semantics as systems_config_v40 / library_systems.
      library_interventions: Array.isArray(bc.library_interventions) ? bc.library_interventions : DEFAULT_PARAMS.library_interventions,
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
        // per-face nested objects ({north, south, east, west}). Brief 42
        // (2026-05-19): each per-face object now carries cd + flow_mode in
        // addition to louvre_area_m2 + openable_fraction; the per-face
        // spread inside the loop handles them automatically.
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
      // Brief 58 A2 (2026-05-26): include comfortBand for the popout's engine call.
      publishState({ building: params, constructions, systems, comfortBand })
    })
  }, [params, constructions, systems, comfortBand]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Brief 53 sidecar (2026-05-26): Clone a project — POSTs to the new
  // /api/projects/{id}/clone backend endpoint, then refreshes the project
  // list. Does NOT auto-load the clone (the user clicked Clone, not Load —
  // they may want to keep working on the original). Returns the new project
  // row so the caller can navigate or load explicitly if it wants.
  async function cloneProject(id) {
    const cloned = await _apiFetch(`/api/projects/${id}/clone`, { method: 'POST' })
    const list = await _apiFetch('/api/projects')
    setProjects(list)
    return cloned
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
      cloneProject,
    }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  return useContext(ProjectContext)
}
