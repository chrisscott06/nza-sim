/**
 * frontend/src/data/schedulePresets.js
 *
 * Schedule preset library — Brief 27 Part 1, resolving contract Open Q #5.
 *
 * Presets are STARTING POINTS, not first-class library items. Applying
 * one populates the schedule fields in the target gain/occupancy; the
 * user then edits in place. The preset itself is unaffected by user
 * edits. Applying a preset PRESERVES any existing exceptions on the
 * target schedule (presets don't carry exceptions — those are
 * project-specific).
 *
 * Schema per `docs/state_contracts.md` v2.3 § Schedule preset library.
 * Source values sourced from the seeded library_items rows of
 * library_type='schedule' (hotel_bedroom_*, office_*, retail_*, etc.).
 *
 * The UI surfaces these as a dropdown per input (Occupancy section
 * shows occupancy presets; Lighting section shows lighting presets when
 * relationship_to_occupancy === 'independent'; etc.). A "Save current
 * as preset…" affordance may add project-level custom presets to the
 * same dropdown — those live alongside seeded presets in project
 * state (Brief 27 Part 5 / future).
 */

// Compact factory for a daily curve. Saves a lot of brackets-and-commas.
const h = (...vals) => {
  if (vals.length !== 24) throw new Error(`Schedule curve needs 24 values, got ${vals.length}`)
  return vals.slice()
}

// Default monthly_multipliers (flat, no seasonality) — for presets where
// the source doesn't specify a seasonal pattern.
const FLAT_MONTHS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]

// UK tourism seasonality — peak summer, dip winter shoulder
const UK_TOURISM = [0.7, 0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7]

// UK office — slight summer dip (annual leave), Dec dip (Christmas)
const UK_OFFICE = [0.9, 0.9, 1.0, 1.0, 1.0, 0.9, 0.8, 0.8, 1.0, 1.0, 1.0, 0.85]

// UK retail — Q4 ramp into Christmas
const UK_RETAIL = [0.8, 0.9, 1.0, 1.0, 1.0, 0.95, 0.9, 0.95, 0.95, 1.0, 1.1, 1.2]


export const SCHEDULE_PRESETS = {
  occupancy: [
    {
      id: 'hotel_bedroom_overnight',
      name: 'Hotel bedroom (overnight)',
      description: 'Guest present overnight + evening, away during the day',
      icon: '🏨',
      schedule: {
        weekday:  h(0.9,0.9,0.9,0.9,0.9,0.9,0.7,0.4,0.3,0.2,0.2,0.2,0.2,0.2,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.9,0.9),
        saturday: h(0.9,0.9,0.9,0.9,0.9,0.9,0.8,0.5,0.4,0.3,0.3,0.3,0.3,0.3,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.9,0.9,0.9),
        sunday:   h(0.9,0.9,0.9,0.9,0.9,0.9,0.8,0.6,0.5,0.4,0.4,0.4,0.4,0.4,0.4,0.5,0.5,0.6,0.7,0.8,0.9,0.9,0.9,0.9),
        monthly_multipliers: UK_TOURISM.slice(),
      },
    },
    {
      id: 'office_mon_fri',
      name: 'Office Mon-Fri',
      description: '9-5 weekday pattern with lunch dip, empty at weekends',
      icon: '💼',
      schedule: {
        weekday:  h(0,0,0,0,0,0,0,0.1,0.5,0.9,0.95,0.95,0.75,0.9,0.95,0.9,0.7,0.3,0.1,0.05,0,0,0,0),
        saturday: h(0,0,0,0,0,0,0,0,0,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0,0,0,0,0,0,0,0),
        sunday:   h(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0),
        monthly_multipliers: UK_OFFICE.slice(),
      },
    },
    {
      id: 'retail_open_hours',
      name: 'Retail open hours',
      description: '10-6 pattern, busier at weekends, Q4 ramp',
      icon: '🛍️',
      schedule: {
        weekday:  h(0,0,0,0,0,0,0,0,0,0.1,0.5,0.8,0.9,0.85,0.8,0.75,0.7,0.4,0,0,0,0,0,0),
        saturday: h(0,0,0,0,0,0,0,0,0,0.1,0.6,0.9,1.0,0.95,0.9,0.85,0.8,0.6,0.1,0,0,0,0,0),
        sunday:   h(0,0,0,0,0,0,0,0,0,0,0.2,0.6,0.8,0.85,0.8,0.7,0.5,0.2,0,0,0,0,0,0),
        monthly_multipliers: UK_RETAIL.slice(),
      },
    },
    {
      id: 'school_term',
      name: 'School term (Mon-Fri)',
      description: '8-4 weekday term-time pattern, dips for holidays in summer + winter',
      icon: '🎓',
      schedule: {
        weekday:  h(0,0,0,0,0,0,0,0.1,0.8,0.95,0.95,0.85,0.7,0.95,0.95,0.85,0.4,0.1,0.05,0,0,0,0,0),
        saturday: h(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0),
        sunday:   h(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0),
        // Aug school holiday, Dec winter break
        monthly_multipliers: [1.0, 1.0, 1.0, 0.9, 1.0, 0.9, 0.3, 0.1, 1.0, 1.0, 1.0, 0.5],
      },
    },
    {
      id: 'residential',
      name: 'Residential',
      description: 'Home most of the time, peak occupancy evening + overnight',
      icon: '🏠',
      schedule: {
        weekday:  h(1.0,1.0,1.0,1.0,1.0,1.0,0.95,0.7,0.4,0.3,0.3,0.3,0.4,0.4,0.4,0.5,0.7,0.85,0.95,1.0,1.0,1.0,1.0,1.0),
        saturday: h(1.0,1.0,1.0,1.0,1.0,1.0,0.95,0.8,0.7,0.65,0.6,0.6,0.65,0.7,0.7,0.7,0.8,0.9,0.95,1.0,1.0,1.0,1.0,1.0),
        sunday:   h(1.0,1.0,1.0,1.0,1.0,1.0,0.95,0.85,0.75,0.7,0.7,0.7,0.75,0.75,0.75,0.8,0.85,0.9,0.95,1.0,1.0,1.0,1.0,1.0),
        monthly_multipliers: FLAT_MONTHS.slice(),
      },
    },
    {
      id: 'always_on',
      name: 'Always present (24/7)',
      description: 'Constantly occupied — server room, control room, manufacturing',
      icon: '⏰',
      schedule: {
        weekday:  h(...new Array(24).fill(1)),
        saturday: h(...new Array(24).fill(1)),
        sunday:   h(...new Array(24).fill(1)),
        monthly_multipliers: FLAT_MONTHS.slice(),
      },
    },
    {
      id: 'flat_75pct',
      name: 'Flat 75% (placeholder)',
      description: '75% occupancy every hour — useful as a sketch baseline',
      icon: '▭',
      schedule: {
        weekday:  h(...new Array(24).fill(0.75)),
        saturday: h(...new Array(24).fill(0.75)),
        sunday:   h(...new Array(24).fill(0.75)),
        monthly_multipliers: FLAT_MONTHS.slice(),
      },
    },
  ],

  lighting: [
    {
      id: 'hotel_bedroom_lighting',
      name: 'Hotel bedroom',
      description: 'Minimal overnight, peaks at wakeup and bedtime',
      icon: '🏨',
      schedule: {
        weekday:  h(0.05,0.05,0.05,0.05,0.05,0.05,0.4,0.7,0.2,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.5,0.8,0.8,0.6,0.2,0.05),
        saturday: h(0.05,0.05,0.05,0.05,0.05,0.05,0.2,0.6,0.4,0.2,0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.3,0.5,0.8,0.8,0.6,0.2,0.05),
        sunday:   h(0.05,0.05,0.05,0.05,0.05,0.05,0.2,0.5,0.5,0.3,0.2,0.1,0.1,0.1,0.1,0.1,0.2,0.3,0.5,0.8,0.7,0.5,0.2,0.05),
        // More lights in winter (short days), less in summer
        monthly_multipliers: [1.0, 1.0, 0.9, 0.8, 0.7, 0.7, 0.7, 0.7, 0.8, 0.9, 1.0, 1.0],
      },
    },
    {
      id: 'office_lighting',
      name: 'Office (follows occupancy, daylight dimmed)',
      description: 'Follows occupancy with summer reduction from daylight',
      icon: '💼',
      schedule: {
        weekday:  h(0,0,0,0,0,0,0,0.1,0.5,0.8,0.9,0.9,0.7,0.85,0.9,0.85,0.65,0.25,0.05,0,0,0,0,0),
        saturday: h(0,0,0,0,0,0,0,0,0,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0,0,0,0,0,0,0,0),
        sunday:   h(...new Array(24).fill(0)),
        monthly_multipliers: [1.0, 1.0, 0.9, 0.8, 0.7, 0.6, 0.6, 0.65, 0.75, 0.85, 0.95, 1.0],
      },
    },
    {
      id: 'corridor_24_7',
      name: 'Corridor / always-on at low level',
      description: '24/7 baseline at ~25% — emergency lighting, corridors, signage',
      icon: '🪧',
      schedule: {
        weekday:  h(...new Array(24).fill(0.25)),
        saturday: h(...new Array(24).fill(0.25)),
        sunday:   h(...new Array(24).fill(0.25)),
        monthly_multipliers: FLAT_MONTHS.slice(),
      },
    },
  ],

  equipment: [
    {
      id: 'hotel_bedroom_equipment',
      name: 'Hotel bedroom (TV, chargers, HVAC)',
      description: 'Loosely follows occupancy with overnight baseline',
      icon: '🏨',
      schedule: {
        weekday:  h(0.1,0.1,0.1,0.1,0.1,0.1,0.3,0.6,0.1,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.1,0.3,0.6,0.7,0.6,0.4,0.2,0.1),
        saturday: h(0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.5,0.3,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.4,0.6,0.7,0.6,0.4,0.2,0.1),
        sunday:   h(0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.4,0.4,0.2,0.1,0.1,0.1,0.1,0.1,0.1,0.2,0.3,0.5,0.6,0.5,0.3,0.2,0.1),
        monthly_multipliers: FLAT_MONTHS.slice(),
      },
    },
    {
      id: 'office_equipment',
      name: 'Office workstation',
      description: 'Computers, monitors, printers — follows occupancy with sleep modes',
      icon: '💻',
      schedule: {
        weekday:  h(0.05,0.05,0.05,0.05,0.05,0.05,0.1,0.3,0.7,0.9,0.95,0.95,0.6,0.9,0.95,0.9,0.7,0.3,0.15,0.1,0.05,0.05,0.05,0.05),
        saturday: h(0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.1,0.15,0.15,0.15,0.1,0.1,0.1,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05),
        sunday:   h(...new Array(24).fill(0.05)),
        monthly_multipliers: UK_OFFICE.slice(),
      },
    },
    {
      id: 'baseload_constant',
      name: 'Constant baseload',
      description: '24/7 at full — fridges, network gear, security',
      icon: '🔌',
      schedule: {
        weekday:  h(...new Array(24).fill(1.0)),
        saturday: h(...new Array(24).fill(1.0)),
        sunday:   h(...new Array(24).fill(1.0)),
        monthly_multipliers: FLAT_MONTHS.slice(),
      },
    },
  ],
}

/**
 * Find a preset by id within a given gain type's preset list.
 * Returns null if not found.
 */
export function findPreset(gainType, presetId) {
  const list = SCHEDULE_PRESETS[gainType]
  if (!list) return null
  return list.find(p => p.id === presetId) ?? null
}

/**
 * Build a starting-point schedule by copying a preset's curves and
 * preserving any existing exceptions on the target schedule.
 *
 * Returns a new schedule object — caller is responsible for assigning
 * it to the target via setParams() etc.
 */
export function applyPreset(currentSchedule, gainType, presetId) {
  const preset = findPreset(gainType, presetId)
  if (!preset) return currentSchedule
  return {
    ...preset.schedule,
    // arrays are intentionally cloned to avoid aliasing the preset
    weekday:             [...preset.schedule.weekday],
    saturday:            [...preset.schedule.saturday],
    sunday:              [...preset.schedule.sunday],
    monthly_multipliers: [...preset.schedule.monthly_multipliers],
    // PRESERVE exceptions from the target — they're project-specific
    exceptions: (currentSchedule?.exceptions ?? []).slice(),
  }
}

/**
 * Empty schedule — all zeros. Used when bootstrapping a project that has
 * no schedule yet and no preset has been chosen.
 */
export function emptySchedule() {
  return {
    weekday:             new Array(24).fill(0),
    saturday:            new Array(24).fill(0),
    sunday:              new Array(24).fill(0),
    monthly_multipliers: new Array(12).fill(1),
    exceptions:          [],
  }
}
