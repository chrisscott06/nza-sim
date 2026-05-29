/**
 * loadTypeLibrary.js — building-type-aware default load splits for the
 * multi-profile Internal Gains module.
 *
 * Brief 27 Revised Part 10. Each entry is a profile TEMPLATE that the
 * "+ Add profile" affordance uses to seed a new profile. Users edit the
 * resulting profile in place — these are starting points, not first-
 * class library items.
 *
 * Schedule references use preset ids from `schedulePresets.js`. The UI
 * resolves them at the moment a profile is added.
 *
 * Per the v2.4 contract: profile.area_share is the fraction of GIA this
 * profile applies to; profile.magnitude carries the LPD/EPD on that share.
 * Effective building average = Σ (profile.LPD × profile.area_share).
 *
 * Building types covered: hotel / office / school / retail / Custom.
 * Custom is a blank profile (user defines everything).
 */

// ── Lighting templates by building type ──────────────────────────────────────

export const LIGHTING_LOAD_TYPES = {
  hotel: [
    {
      id: 'hotel_bedroom_lighting',
      label: 'Bedroom lighting',
      magnitude: { value: 5, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional_with_spill',
      spill_minutes: 15,
      daylight_factor: 0.6,
      area_share: 0.6,
      schedule_preset_id: 'hotel_bedroom_lighting',
    },
    {
      id: 'hotel_corridor_lighting',
      label: 'Corridor lighting',
      magnitude: { value: 2, unit: 'w_per_m2' },
      relationship_to_occupancy: 'always_on',
      area_share: 0.2,
      schedule_preset_id: 'corridor_24_7',
    },
    {
      id: 'hotel_exterior_lighting',
      label: 'Exterior lighting',
      magnitude: { value: 1, unit: 'w_per_m2' },
      relationship_to_occupancy: 'independent',
      area_share: 0.1,
      schedule_preset_id: 'office_lighting',  // proxy for night-time pattern; user edits
    },
    {
      id: 'hotel_back_of_house',
      label: 'Back of house',
      magnitude: { value: 3, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional',
      spill_minutes: 0,
      daylight_factor: 1.0,
      area_share: 0.1,
      schedule_preset_id: 'hotel_bedroom_lighting',
    },
  ],

  office: [
    {
      id: 'office_workstation_lighting',
      label: 'Workstation lighting',
      magnitude: { value: 8, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional_with_spill',
      spill_minutes: 15,
      daylight_factor: 0.6,
      area_share: 0.6,
      schedule_preset_id: 'office_lighting',
    },
    {
      id: 'office_general_lighting',
      label: 'General lighting',
      magnitude: { value: 3, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional_with_spill',
      spill_minutes: 30,
      daylight_factor: 0.7,
      area_share: 0.25,
      schedule_preset_id: 'office_lighting',
    },
    {
      id: 'office_corridor_lighting',
      label: 'Corridor lighting',
      magnitude: { value: 2, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional_with_spill',
      spill_minutes: 30,
      daylight_factor: 1.0,
      area_share: 0.1,
      schedule_preset_id: 'office_lighting',
    },
    {
      id: 'office_server_room',
      label: 'Server room',
      magnitude: { value: 5, unit: 'w_per_m2' },
      relationship_to_occupancy: 'always_on',
      area_share: 0.05,
      schedule_preset_id: 'corridor_24_7',
    },
  ],

  school: [
    {
      id: 'school_classroom_lighting',
      label: 'Classroom lighting',
      magnitude: { value: 10, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional_with_spill',
      spill_minutes: 15,
      daylight_factor: 0.6,
      area_share: 0.6,
      schedule_preset_id: 'office_lighting',
    },
    {
      id: 'school_corridor_lighting',
      label: 'Corridor lighting',
      magnitude: { value: 2, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional_with_spill',
      spill_minutes: 30,
      daylight_factor: 1.0,
      area_share: 0.15,
      schedule_preset_id: 'office_lighting',
    },
    {
      id: 'school_sports_hall',
      label: 'Sports hall / common',
      magnitude: { value: 6, unit: 'w_per_m2' },
      relationship_to_occupancy: 'independent',
      area_share: 0.15,
      schedule_preset_id: 'office_lighting',  // proxy for booked-session pattern
    },
    {
      id: 'school_catering',
      label: 'Catering / kitchen',
      magnitude: { value: 8, unit: 'w_per_m2' },
      relationship_to_occupancy: 'independent',
      area_share: 0.1,
      schedule_preset_id: 'office_lighting',
    },
  ],

  retail: [
    {
      id: 'retail_sales_floor',
      label: 'Sales floor',
      magnitude: { value: 15, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional_with_spill',
      spill_minutes: 30,
      daylight_factor: 0.7,
      area_share: 0.6,
      schedule_preset_id: 'office_lighting',
    },
    {
      id: 'retail_display_lighting',
      label: 'Display lighting',
      magnitude: { value: 10, unit: 'w_per_m2' },
      relationship_to_occupancy: 'independent',
      area_share: 0.15,
      schedule_preset_id: 'office_lighting',
    },
    {
      id: 'retail_back_of_house',
      label: 'Back of house',
      magnitude: { value: 5, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional',
      spill_minutes: 0,
      area_share: 0.15,
      schedule_preset_id: 'office_lighting',
    },
    {
      id: 'retail_exterior_lighting',
      label: 'Exterior lighting',
      magnitude: { value: 3, unit: 'w_per_m2' },
      relationship_to_occupancy: 'independent',
      area_share: 0.1,
      schedule_preset_id: 'office_lighting',  // proxy for night-time
    },
  ],
}

// ── Equipment templates by building type ─────────────────────────────────────
// Schedule preset ids reference equipment presets in schedulePresets.js:
//   hotel_bedroom_equipment | office_equipment | baseload_constant.

export const EQUIPMENT_LOAD_TYPES = {
  hotel: [
    {
      id: 'hotel_guest_equipment',
      label: 'Guest room equipment',
      baseload: { value: 1, unit: 'w_per_m2' },  // TVs standby, network, mini-bars
      active:   { value: 4, unit: 'w_per_m2' },  // TVs on, kettles, hairdryers
      relationship_to_occupancy: 'proportional',
      standby_factor: 0.10,
      area_share: 0.6,
      schedule_preset_id: 'hotel_bedroom_equipment',
    },
    {
      id: 'hotel_refrigeration',
      label: 'Refrigeration',
      baseload: { value: 5, unit: 'w_per_m2' },
      active:   { value: 0, unit: 'w_per_m2' },
      relationship_to_occupancy: 'independent',
      standby_factor: 1.0,
      area_share: 0.1,
      schedule_preset_id: 'baseload_constant',
    },
    {
      id: 'hotel_back_of_house',
      label: 'Back-of-house equipment',
      baseload: { value: 2, unit: 'w_per_m2' },
      active:   { value: 5, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional',
      standby_factor: 0.20,
      area_share: 0.2,
      schedule_preset_id: 'hotel_bedroom_equipment',
    },
    {
      id: 'hotel_lifts_pumps',
      label: 'Lifts / pumps',
      baseload: { value: 1, unit: 'w_per_m2' },
      active:   { value: 0, unit: 'w_per_m2' },
      relationship_to_occupancy: 'always_on',
      area_share: 0.1,
      schedule_preset_id: 'baseload_constant',
    },
  ],

  office: [
    {
      id: 'office_workstation_equipment',
      label: 'Workstation equipment',
      baseload: { value: 2, unit: 'w_per_m2' },
      active:   { value: 8, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional',
      standby_factor: 0.15,
      area_share: 0.6,
      schedule_preset_id: 'office_equipment',
    },
    {
      id: 'office_server_room',
      label: 'Server room',
      baseload: { value: 30, unit: 'w_per_m2' },
      active:   { value: 0,  unit: 'w_per_m2' },
      relationship_to_occupancy: 'always_on',
      area_share: 0.05,
      schedule_preset_id: 'baseload_constant',
    },
    {
      id: 'office_kitchen',
      label: 'Kitchen / catering',
      baseload: { value: 3, unit: 'w_per_m2' },
      active:   { value: 10, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional',
      standby_factor: 0.05,
      area_share: 0.10,
      schedule_preset_id: 'office_equipment',
    },
    {
      id: 'office_lifts_pumps',
      label: 'Lifts / pumps',
      baseload: { value: 1, unit: 'w_per_m2' },
      active:   { value: 0, unit: 'w_per_m2' },
      relationship_to_occupancy: 'always_on',
      area_share: 0.25,
      schedule_preset_id: 'baseload_constant',
    },
  ],

  school: [
    {
      id: 'school_classroom_equipment',
      label: 'Classroom equipment',
      baseload: { value: 1, unit: 'w_per_m2' },
      active:   { value: 5, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional',
      standby_factor: 0.10,
      area_share: 0.7,
      schedule_preset_id: 'office_equipment',
    },
    {
      id: 'school_kitchen',
      label: 'Catering kitchen',
      baseload: { value: 3, unit: 'w_per_m2' },
      active:   { value: 15, unit: 'w_per_m2' },
      relationship_to_occupancy: 'independent',
      standby_factor: 0.10,
      area_share: 0.15,
      schedule_preset_id: 'office_equipment',
    },
    {
      id: 'school_lifts_pumps',
      label: 'Lifts / pumps',
      baseload: { value: 1, unit: 'w_per_m2' },
      active:   { value: 0, unit: 'w_per_m2' },
      relationship_to_occupancy: 'always_on',
      area_share: 0.15,
      schedule_preset_id: 'baseload_constant',
    },
  ],

  retail: [
    {
      id: 'retail_sales_equipment',
      label: 'Sales equipment / tills',
      baseload: { value: 2, unit: 'w_per_m2' },
      active:   { value: 5, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional',
      standby_factor: 0.20,
      area_share: 0.6,
      schedule_preset_id: 'office_equipment',
    },
    {
      id: 'retail_refrigeration',
      label: 'Refrigeration (food retail)',
      baseload: { value: 15, unit: 'w_per_m2' },
      active:   { value: 0, unit: 'w_per_m2' },
      relationship_to_occupancy: 'always_on',
      area_share: 0.15,
      schedule_preset_id: 'baseload_constant',
    },
    {
      id: 'retail_back_of_house',
      label: 'Back of house',
      baseload: { value: 1, unit: 'w_per_m2' },
      active:   { value: 3, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional',
      standby_factor: 0.10,
      area_share: 0.15,
      schedule_preset_id: 'office_equipment',
    },
    {
      id: 'retail_lifts_pumps',
      label: 'Lifts / pumps',
      baseload: { value: 1, unit: 'w_per_m2' },
      active:   { value: 0, unit: 'w_per_m2' },
      relationship_to_occupancy: 'always_on',
      area_share: 0.1,
      schedule_preset_id: 'baseload_constant',
    },
  ],
}

// ── Custom profile factory ───────────────────────────────────────────────────

export const CUSTOM_LIGHTING_TEMPLATE = {
  id: 'custom_lighting',
  label: 'Custom lighting',
  magnitude: { value: 5, unit: 'w_per_m2' },
  relationship_to_occupancy: 'proportional',
  spill_minutes: 0,
  daylight_factor: 1.0,
  area_share: 0.1,
  schedule_preset_id: 'office_lighting',
}

export const CUSTOM_EQUIPMENT_TEMPLATE = {
  id: 'custom_equipment',
  label: 'Custom equipment',
  baseload: { value: 1, unit: 'w_per_m2' },
  active:   { value: 2, unit: 'w_per_m2' },
  relationship_to_occupancy: 'proportional',
  standby_factor: 0.10,
  area_share: 0.1,
  schedule_preset_id: 'office_equipment',
}

// ── Auxiliary loads (Brief 72 P7, 2026-05-29) ─────────────────────────────
//
// Six-item preset picker per the design note. Auxiliary differs from
// equipment in three ways:
//   1. Single `magnitude` (W/m²), not a baseload/active split.
//   2. `gain_fraction` is a first-class field (defaults vary per preset —
//      external lighting 0%, catering 50%, lifts 85%, the rest 100%).
//   3. No `standby_factor` (no duty cycle split).
//
// The presets are intentionally NOT keyed by building type — auxiliary
// loads tend to be similar across building types (a pump is a pump, a
// catering hood is a catering hood). One list for everyone.
//
// area_share defaults are sized for the load to be "noticeable but not
// dominant" on a building like Bridgewater (4125 m²); users tune from
// there.
export const AUXILIARY_LOAD_TYPES = [
  {
    id: 'aux_external_lighting',
    label: 'External lighting',
    magnitude: { value: 1.5, unit: 'w_per_m2' },
    // Anchored to dusk-till-dawn; doesn't radiate to the zone — almost all
    // heat goes outdoors. Pre-brief implicit was 100% gain (wrong for any
    // façade lighting); 0% is the canonical anchor for properly-routed
    // external loads.
    gain_fraction: 0.0,
    relationship_to_occupancy: 'independent',
    area_share: 1.0,
    schedule_preset_id: 'baseload_constant',  // overridden by a dusk-dawn pattern in P7's profile build
  },
  {
    id: 'aux_catering',
    label: 'Catering',
    magnitude: { value: 6, unit: 'w_per_m2' },
    // Extract hoods remove ~50% of the heat directly outdoors before it
    // joins the zone air. The other ~50% (radiant + convective spill from
    // the equipment housings) does become zone gain.
    gain_fraction: 0.5,
    relationship_to_occupancy: 'proportional',
    area_share: 0.1,
    schedule_preset_id: 'office_equipment',
  },
  {
    id: 'aux_pumps',
    label: 'Pumps',
    magnitude: { value: 1, unit: 'w_per_m2' },
    // Pump electrical work is dissipated as heat in the working fluid and
    // bearings; in a hot-water system that heat re-enters the building.
    // 100% is the conservative anchor.
    gain_fraction: 1.0,
    relationship_to_occupancy: 'always_on',
    area_share: 1.0,
    schedule_preset_id: 'baseload_constant',
  },
  {
    id: 'aux_small_power',
    label: 'Small power',
    magnitude: { value: 2, unit: 'w_per_m2' },
    // Generic small plug loads beyond what the Equipment category covers —
    // chargers, monitors, small appliances. All electrical → all heat.
    gain_fraction: 1.0,
    relationship_to_occupancy: 'proportional',
    area_share: 1.0,
    schedule_preset_id: 'office_equipment',
  },
  {
    id: 'aux_lifts',
    label: 'Lifts',
    magnitude: { value: 0.5, unit: 'w_per_m2' },
    // Lifts dissipate motor heat into the shaft + machine room; some
    // fraction radiates to occupied space, the rest stays in the shaft
    // and either escapes or recirculates with the building. 85% is the
    // CIBSE Guide F default for hydraulic / MRL lifts.
    gain_fraction: 0.85,
    relationship_to_occupancy: 'proportional',
    area_share: 1.0,
    schedule_preset_id: 'office_equipment',
  },
]

export const CUSTOM_AUXILIARY_TEMPLATE = {
  id: 'custom_auxiliary',
  label: 'Custom auxiliary',
  magnitude: { value: 1, unit: 'w_per_m2' },
  gain_fraction: 1.0,
  relationship_to_occupancy: 'independent',
  area_share: 1.0,
  schedule_preset_id: 'baseload_constant',
}

// ── Profile factory ──────────────────────────────────────────────────────────
//
// Convert a load-type template (which carries `schedule_preset_id`) into a
// full v2.4 profile (which carries an inline schedule object). Resolves the
// preset id against `schedulePresets.js` and clones the curves so subsequent
// edits don't mutate the preset.

let _profileIdCounter = 0
function newProfileId(prefix) {
  _profileIdCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${_profileIdCounter}`
}

/**
 * Build a v2.4 profile from a load-type template.
 *
 * @param {object} template — entry from LIGHTING_LOAD_TYPES / EQUIPMENT_LOAD_TYPES
 * @param {string} gainType — 'lighting' | 'equipment'
 * @param {object} schedulePresets — SCHEDULE_PRESETS object
 * @param {object} fallbackSchedule — used if preset can't be resolved
 * @returns v2.4 profile
 */
export function profileFromTemplate(template, gainType, schedulePresets, fallbackSchedule = null) {
  const presetList = schedulePresets?.[gainType] ?? []
  const preset = presetList.find(p => p.id === template.schedule_preset_id)
  const sched = preset?.schedule ?? fallbackSchedule ?? {
    weekday: new Array(24).fill(0.5),
    saturday: new Array(24).fill(0.5),
    sunday: new Array(24).fill(0.5),
    monthly_multipliers: new Array(12).fill(1.0),
    exceptions: [],
  }
  const profile = {
    id:    newProfileId(template.id),
    label: template.label,
    magnitude: template.magnitude ? { ...template.magnitude } : undefined,
    baseload:  template.baseload  ? { ...template.baseload  } : undefined,
    active:    template.active    ? { ...template.active    } : undefined,
    relationship_to_occupancy: template.relationship_to_occupancy,
    spill_minutes:    template.spill_minutes,
    daylight_factor:  template.daylight_factor,
    standby_factor:   template.standby_factor,
    // Brief 72 P7 (2026-05-29): gain_fraction threaded through from
    // template. Lighting / equipment templates that omit it inherit the
    // schema default of 1.0 (anchor preservation per P4). Auxiliary
    // templates carry it explicitly because the preset values vary
    // (external lighting 0.0, catering 0.5, lifts 0.85, etc.).
    gain_fraction:    template.gain_fraction,
    area_share: template.area_share ?? 0.1,
    schedule: {
      weekday:             [...(sched.weekday ?? new Array(24).fill(0))],
      saturday:            [...(sched.saturday ?? sched.weekday ?? new Array(24).fill(0))],
      sunday:              [...(sched.sunday ?? sched.weekday ?? new Array(24).fill(0))],
      monthly_multipliers: [...(sched.monthly_multipliers ?? new Array(12).fill(1))],
      exceptions:          [],
    },
    _provenance: {
      source:     'load_type_library',
      template_id: template.id,
      confidence: 'medium',
    },
  }
  // Strip undefined fields (cleaner JSON, easier to inspect).
  Object.keys(profile).forEach(k => profile[k] === undefined && delete profile[k])
  return profile
}

// ── Building types known to the library ──────────────────────────────────────

export const BUILDING_TYPES = [
  { id: 'hotel',  label: 'Hotel' },
  { id: 'office', label: 'Office' },
  { id: 'school', label: 'School' },
  { id: 'retail', label: 'Retail' },
]

/**
 * Determine the building type from `params`. Defaults to 'hotel' when
 * absent — Bridgewater is the reference scenario and most early users
 * will be modelling hotels. Eventually surfaced as a top-level project
 * input.
 */
export function buildingTypeOf(params) {
  return params?.building_type ?? 'hotel'
}

/**
 * Return the lighting profile templates relevant to a building type, plus
 * the Custom entry as a final fallback option.
 */
export function lightingTemplatesFor(buildingType) {
  const list = LIGHTING_LOAD_TYPES[buildingType] ?? LIGHTING_LOAD_TYPES.hotel
  return [...list, CUSTOM_LIGHTING_TEMPLATE]
}

export function equipmentTemplatesFor(buildingType) {
  const list = EQUIPMENT_LOAD_TYPES[buildingType] ?? EQUIPMENT_LOAD_TYPES.hotel
  return [...list, CUSTOM_EQUIPMENT_TEMPLATE]
}

/**
 * Return the auxiliary preset list — unkeyed by building type (a pump is
 * a pump, a catering hood is a catering hood). The Custom entry is the
 * last item so users can author from scratch when no preset fits.
 * Brief 72 P7 (2026-05-29).
 */
export function auxiliaryTemplatesFor(_buildingType) {
  return [...AUXILIARY_LOAD_TYPES, CUSTOM_AUXILIARY_TEMPLATE]
}
