/**
 * frontend/src/utils/scheduleLibrary.js — Brief 28e Gate E2
 *
 * Engine-side schedule resolver. Maps a schedule_ref name (e.g.
 * 'business_hours_09_18_weekdays') to a per-hour fraction value (0-1).
 *
 * Mirrors the Python-side library at `nza_engine/library/schedules.py` —
 * the schedule names + values must agree across both sides so the
 * assembler's EP `Schedule:Compact` output (Brief 28e Gate E4) and the
 * Static engine's resolver here produce the same hourly behaviour.
 *
 * Schedule shape (V1, simple):
 *   {
 *     day_types: {
 *       weekday:  number[24]   // hour-of-day fraction, 0..23
 *       saturday: number[24]
 *       sunday:   number[24]
 *     },
 *     monthly_multipliers?: number[12]   // optional, default 1.0
 *   }
 *
 * Resolver: resolveScheduleAtHour(name, hourIndex, weatherData) returns the
 * fraction value at that hour, accounting for weekday/weekend + monthly
 * multipliers. Standalone-testable — depends only on weatherData.month/day.
 *
 * Day-of-week assumption: Jan 1 = Monday (matches the engine's existing
 * decomposeHour() in instantCalc.js). Adequate for TMY synthetic weather;
 * real-year EPWs carry a starting day-of-week header but it isn't parsed.
 */

// ── Schedule definitions ──────────────────────────────────────────────────────

// always_on — 24/7 full rate (1.0). Used by operable_openings entries in
// 'permanent' control mode, and as a sane default for legacy mappings.
const _ALWAYS_ON_DAY = Array(24).fill(1.0)

// business_hours_09_18_weekdays — 1.0 from 09:00-18:00 Mon-Fri, 0.0 otherwise.
// Bridgewater's gf_entrance_door uses this.
const _BUSINESS_HOURS_WEEKDAY = (() => {
  const a = new Array(24).fill(0.0)
  for (let h = 9; h < 18; h++) a[h] = 1.0
  return a
})()
const _ZERO_DAY = Array(24).fill(0.0)

// hotel_ventilation_occupied — mirrors Python hotel_ventilation_occupied:
// 06-23 full, overnight (00-06 and 23-24) at 0.3.
const _HOTEL_VENT_OCCUPIED_DAY = (() => {
  const a = new Array(24).fill(1.0)
  for (let h = 0; h < 6; h++) a[h] = 0.3
  a[23] = 0.3
  return a
})()

// summer_day_daytime — 08:00-20:00 May-September, 0.0 otherwise. For
// "windows open on warm summer days" type controls.
const _SUMMER_DAYTIME_DAY = (() => {
  const a = new Array(24).fill(0.0)
  for (let h = 8; h < 20; h++) a[h] = 1.0
  return a
})()
const _SUMMER_MONTHS = [0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0]   // May (idx 4) through Sept (idx 8)

export const SCHEDULES = {
  always_on: {
    day_types: { weekday: _ALWAYS_ON_DAY, saturday: _ALWAYS_ON_DAY, sunday: _ALWAYS_ON_DAY },
  },
  business_hours_09_18_weekdays: {
    day_types: { weekday: _BUSINESS_HOURS_WEEKDAY, saturday: _ZERO_DAY, sunday: _ZERO_DAY },
  },
  hotel_ventilation_occupied: {
    day_types: { weekday: _HOTEL_VENT_OCCUPIED_DAY, saturday: _HOTEL_VENT_OCCUPIED_DAY, sunday: _HOTEL_VENT_OCCUPIED_DAY },
  },
  summer_day_daytime: {
    day_types: { weekday: _SUMMER_DAYTIME_DAY, saturday: _SUMMER_DAYTIME_DAY, sunday: _SUMMER_DAYTIME_DAY },
    monthly_multipliers: _SUMMER_MONTHS,
  },
}

// ── Day-of-week derivation ────────────────────────────────────────────────────
// Cumulative days at start of each month (non-leap year)
const _CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/**
 * For a 0..8759 hour index, return { dayType, hourOfDay, monthIdx0 }.
 * Uses weatherData.month/day/hour when available; falls back to derivation
 * from `h` assuming non-leap year and Jan 1 = Monday.
 */
function _decomposeHourForSchedule(h, weatherData) {
  let month, day, hourOfDay
  if (weatherData?.month && weatherData.month[h] != null) {
    month = weatherData.month[h]                     // 1-12
    hourOfDay = (weatherData.hour?.[h] ?? 1) - 1     // EPW 1-24 → 0-23
    day = weatherData.day?.[h]
    if (day == null) {
      // Derive day-of-month from h - cumulative days at start of month
      const dayOfYear = Math.floor(h / 24)
      day = dayOfYear - _CUM_DAYS[month - 1] + 1
    }
  } else {
    // Pure derivation from h
    const dayOfYear = Math.floor(h / 24)          // 0..364
    hourOfDay = h % 24                              // 0..23
    let m = 0
    while (m < 11 && _CUM_DAYS[m + 1] <= dayOfYear) m++
    month = m + 1                                   // 1..12
    day = dayOfYear - _CUM_DAYS[m] + 1              // 1..31
  }
  const dayOfYear = _CUM_DAYS[month - 1] + (day - 1)   // 0..364
  const dow = dayOfYear % 7                            // 0 = Monday, ..., 6 = Sunday
  let dayType
  if (dow === 5)      dayType = 'saturday'
  else if (dow === 6) dayType = 'sunday'
  else                dayType = 'weekday'
  return { dayType, hourOfDay, monthIdx0: month - 1 }
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Brief 28-IM IM-M4 Addition 1: project-scoped shared schedules.
 *
 * Each project may carry `building.schedules[]` — a first-class array of
 * editable schedule entries with the same shape as the hardcoded SCHEDULES
 * dict above:
 *
 *   {
 *     id:          'office_extended_hours',
 *     name:        'Office extended hours (07-20 weekdays)',
 *     day_types:   { weekday: number[24], saturday?: number[24], sunday?: number[24] },
 *     monthly_multipliers?: number[12],
 *   }
 *
 * The resolver prefers project schedules when the same name exists in both
 * places. This lets users override `business_hours_09_18_weekdays` for their
 * own project without changing the hardcoded library (which other projects
 * may still depend on).
 *
 * Schedules created via the Operation / Systems "✏️ Edit schedule" flow
 * land here. The Internal Gains module currently keeps its own per-section
 * profiles in `building.gains.{occupancy,lighting,equipment}.profiles[]` —
 * those are NOT unified with project.schedules yet (queued for a follow-up
 * refactor; out of IM-M4 scope to keep this gate's blast radius contained).
 */
function _projectScheduleByName(name, building) {
  const list = building?.schedules
  if (!Array.isArray(list)) return null
  return list.find(s => s?.name === name || s?.id === name) ?? null
}

/**
 * Resolve a schedule name to its fraction value (0-1) at hour `h`.
 * weatherData provides month/day/hour arrays (length 8760) for accurate
 * day-of-year mapping; if absent, derivation falls back to non-leap-year.
 *
 * Lookup order (Brief 28-IM IM-M4 Addition 1):
 *   1. `building.schedules[]` — project-scoped, user-editable
 *   2. hardcoded `SCHEDULES` dict — engine baseline (always_on, business_hours_*, etc.)
 *
 * Returns 0 if the name resolves nowhere (safer than throwing — silent
 * failure surfaces at the Gate verification step, not as a crash).
 *
 * `building` is optional; callers pre-IM-M4 omitted it and the resolver
 * still works (falls straight through to the hardcoded library). The two
 * call sites that thread building through are the State 2 natvent loop and
 * the temperature-mode opening-control evaluator.
 */
export function resolveScheduleAtHour(name, h, weatherData, building = null) {
  let sched = _projectScheduleByName(name, building)
  if (!sched) sched = SCHEDULES[name]
  if (!sched) return 0
  const { dayType, hourOfDay, monthIdx0 } = _decomposeHourForSchedule(h, weatherData)
  const daily = sched.day_types?.[dayType] ?? sched.day_types?.weekday
  if (!daily) return 0
  const fraction = daily[hourOfDay] ?? 0
  const monthly = sched.monthly_multipliers?.[monthIdx0] ?? 1.0
  return fraction * monthly
}

/**
 * Return true if the named schedule exists in EITHER the project's shared
 * schedules or the hardcoded library.
 */
export function hasSchedule(name, building = null) {
  if (_projectScheduleByName(name, building)) return true
  return SCHEDULES.hasOwnProperty(name)
}

/**
 * Get the union of project-scoped + hardcoded schedule names — used by the
 * Operation / Systems schedule dropdowns to surface both lists.
 */
export function allScheduleNames(building = null) {
  const names = new Set(Object.keys(SCHEDULES))
  const list = building?.schedules
  if (Array.isArray(list)) {
    for (const s of list) {
      if (s?.name) names.add(s.name)
      else if (s?.id) names.add(s.id)
    }
  }
  return Array.from(names).sort()
}
