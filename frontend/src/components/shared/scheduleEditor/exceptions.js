/**
 * exceptions.js — utility module for v2.4 exception authoring.
 *
 * Brief 27 Revised Part 8. Pulls the exception-related helpers out of
 * the component layer so they can be reused by the heatmap (which needs
 * the same `decomposeHourForHeatmap` + `findActiveException` logic) and
 * by the ExceptionsPanel (which manages create / duplicate / preset
 * application).
 *
 * v2.4 exception schema (per the contract):
 *   {
 *     id:         string,        // stable identifier for edit-mode routing
 *     name:       string,        // user-visible label
 *     icon:       string,        // optional emoji
 *     start_date: 'MM-DD',
 *     end_date:   'MM-DD',       // year-wrap supported (end < start)
 *     weekday:    number[24],    // FULL editable curves (not inherited)
 *     saturday:   number[24],
 *     sunday:     number[24],
 *     ignore_monthly_multipliers: boolean,
 *   }
 *
 * The live engine (`computeHourlyGains` in instantCalc.js) already reads
 * exc[dayType][hourOfDay] directly — no engine changes needed; Part 8 is
 * purely the UI for authoring these curves.
 */

// ── Calendar / date helpers (TMY non-leap year, Jan 1 = Monday) ─────────────
//
// Matches the live engine's `decomposeHour` (instantCalc.js Brief 27 Part 2).
// Heatmap doesn't get weatherData so it must derive from h.

const _CUM_DAYS_NON_LEAP = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const DAYS_IN_YEAR = 365

export function decomposeHourForHeatmap(h) {
  const dayOfYear = Math.floor(h / 24) // 0..364
  const hourOfDay = h % 24
  let m = 0
  while (m < 11 && _CUM_DAYS_NON_LEAP[m + 1] <= dayOfYear) m++
  const month = m + 1
  const day = dayOfYear - _CUM_DAYS_NON_LEAP[m] + 1
  // Jan 1 = Monday → dow 0=Mon..4=Fri, 5=Sat, 6=Sun
  const dow = dayOfYear % 7
  const dayType = dow === 5 ? 'saturday' : (dow === 6 ? 'sunday' : 'weekday')
  const dateMMDD = String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
  return { monthIdx: m, month, day, hourOfDay, dayType, dateMMDD, dayOfYear }
}

/** Lexicographic MM-DD comparison with year-wrap. Mirrors live engine. */
export function isDateInRange(dateMMDD, startMMDD, endMMDD) {
  if (!startMMDD || !endMMDD) return false
  if (startMMDD <= endMMDD) return dateMMDD >= startMMDD && dateMMDD <= endMMDD
  return dateMMDD >= startMMDD || dateMMDD <= endMMDD
}

/** First exception whose date range covers dateMMDD (engine processes in array order). */
export function findActiveException(exceptions, dateMMDD) {
  if (!exceptions || exceptions.length === 0) return null
  for (const exc of exceptions) {
    if (isDateInRange(dateMMDD, exc.start_date, exc.end_date)) return exc
  }
  return null
}

/**
 * Compute the assembled hourly fraction at hour h (0..8759) for the given
 * v2.4 schedule. Returns { frac, exception: exc | null }.
 * Mirrors the engine's branching exactly.
 */
export function fractionForHour(schedule, h) {
  if (!schedule) return { frac: 0, exception: null }
  const { monthIdx, hourOfDay, dayType, dateMMDD } = decomposeHourForHeatmap(h)
  const exc = findActiveException(schedule.exceptions, dateMMDD)
  let frac
  if (exc) {
    frac = Number(exc[dayType]?.[hourOfDay] ?? 0)
    if (!exc.ignore_monthly_multipliers) {
      frac *= Number(schedule.monthly_multipliers?.[monthIdx] ?? 1)
    }
  } else {
    frac = Number(schedule[dayType]?.[hourOfDay] ?? 0)
         * Number(schedule.monthly_multipliers?.[monthIdx] ?? 1)
  }
  return { frac, exception: exc }
}

/** Convert MM-DD → day-of-year index (0..364). null if invalid. */
export function mmddToDayOfYear(mmdd) {
  if (!mmdd || mmdd.length !== 5) return null
  const m = parseInt(mmdd.slice(0, 2), 10)
  const d = parseInt(mmdd.slice(3, 5), 10)
  if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null
  return _CUM_DAYS_NON_LEAP[m - 1] + (d - 1)
}

/** Day-of-year → 'MM-DD'. */
export function dayOfYearToMMDD(doy) {
  const clamped = ((doy % DAYS_IN_YEAR) + DAYS_IN_YEAR) % DAYS_IN_YEAR
  let m = 0
  while (m < 11 && _CUM_DAYS_NON_LEAP[m + 1] <= clamped) m++
  const day = clamped - _CUM_DAYS_NON_LEAP[m] + 1
  return String(m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0')
}

/**
 * Day-of-year ranges that this exception covers, handling year-wrap by
 * splitting into two ranges. Returns [{from, to}, ...] with from/to
 * inclusive in [0, 364].
 */
export function exceptionDayRanges(exc) {
  if (!exc) return []
  const s = mmddToDayOfYear(exc.start_date)
  const e = mmddToDayOfYear(exc.end_date)
  if (s == null || e == null) return []
  if (s <= e) return [{ from: s, to: e }]
  return [{ from: s, to: DAYS_IN_YEAR - 1 }, { from: 0, to: e }]
}

// ── New-exception factory + presets ──────────────────────────────────────────

let _exceptionIdCounter = 0
function nextId() {
  _exceptionIdCounter += 1
  return `exc_${Date.now().toString(36)}_${_exceptionIdCounter}`
}

/** Deep-copy weekday/saturday/sunday arrays from a parent schedule. */
function copyCurvesFromParent(parent) {
  return {
    weekday:  Array.isArray(parent?.weekday)  ? parent.weekday.slice()  : new Array(24).fill(0),
    saturday: Array.isArray(parent?.saturday) ? parent.saturday.slice() : new Array(24).fill(0),
    sunday:   Array.isArray(parent?.sunday)   ? parent.sunday.slice()   : new Array(24).fill(0),
  }
}

/** 24-hour curve filled with `v`. */
function flatCurve(v) {
  return new Array(24).fill(v)
}

/**
 * Make a new exception. `curveSource` is either:
 *   - 'parent'         → copy weekday/saturday/sunday from `parentSchedule`
 *   - 'zero'           → all zeros (full shutdown)
 *   - { weekday, ... } → use these curves verbatim (preset case)
 *   - number           → flat curve at that fraction
 */
export function makeException({
  name = 'New exception',
  icon = '',
  start_date = '01-01',
  end_date = '01-07',
  curveSource = 'parent',
  parentSchedule = null,
  ignore_monthly_multipliers = false,
} = {}) {
  let curves
  if (typeof curveSource === 'number') {
    curves = { weekday: flatCurve(curveSource), saturday: flatCurve(curveSource), sunday: flatCurve(curveSource) }
  } else if (curveSource === 'zero') {
    curves = { weekday: flatCurve(0), saturday: flatCurve(0), sunday: flatCurve(0) }
  } else if (curveSource && typeof curveSource === 'object' && curveSource.weekday) {
    curves = {
      weekday:  curveSource.weekday.slice(),
      saturday: (curveSource.saturday ?? curveSource.weekday).slice(),
      sunday:   (curveSource.sunday   ?? curveSource.weekday).slice(),
    }
  } else {
    // 'parent' or fallback
    curves = copyCurvesFromParent(parentSchedule)
  }
  return {
    id: nextId(),
    name,
    icon,
    start_date,
    end_date,
    ...curves,
    ignore_monthly_multipliers,
  }
}

/**
 * Exception presets. Each preset returns an ARRAY of exceptions (because
 * bank holidays is naturally 8 separate single-day exceptions). Caller
 * spreads onto the current exceptions list.
 *
 * `Custom` is the blank-canvas case: parent curves, sensible 7-day range.
 */
export const EXCEPTION_PRESETS = {
  christmas_shutdown: {
    label: 'Christmas shutdown',
    description: 'Dec 22 – Jan 5, 10% baseload only (security lights / minimum heating)',
    apply: (parentSchedule) => [
      makeException({
        name: 'Christmas shutdown',
        icon: '🎄',
        start_date: '12-22',
        end_date:   '01-05',
        curveSource: 0.1,
        ignore_monthly_multipliers: true,
      }),
    ],
  },
  summer_holidays: {
    label: 'Summer holidays',
    description: 'Jul 15 – Aug 31, curves copied from parent (edit to taste)',
    apply: (parentSchedule) => [
      makeException({
        name: 'Summer holidays',
        icon: '☀️',
        start_date: '07-15',
        end_date:   '08-31',
        curveSource: 'parent',
        parentSchedule,
        ignore_monthly_multipliers: false,
      }),
    ],
  },
  uk_bank_holidays: {
    label: 'UK bank holidays',
    description: '8 single-day shutdowns through the year (20% baseload each)',
    apply: (parentSchedule) => [
      // UK bank holidays for a typical year — dates approximate; user edits
      // individual exceptions to their actual project year.
      { name: "New Year's Day",  icon: '🏛️', start_date: '01-01', end_date: '01-01' },
      { name: 'Good Friday',     icon: '🏛️', start_date: '04-18', end_date: '04-18' },
      { name: 'Easter Monday',   icon: '🏛️', start_date: '04-21', end_date: '04-21' },
      { name: 'Early May',       icon: '🏛️', start_date: '05-05', end_date: '05-05' },
      { name: 'Spring',          icon: '🏛️', start_date: '05-26', end_date: '05-26' },
      { name: 'Summer',          icon: '🏛️', start_date: '08-25', end_date: '08-25' },
      { name: 'Christmas Day',   icon: '🏛️', start_date: '12-25', end_date: '12-25' },
      { name: 'Boxing Day',      icon: '🏛️', start_date: '12-26', end_date: '12-26' },
    ].map(spec => makeException({
      ...spec,
      curveSource: 0.2,
      ignore_monthly_multipliers: true,
    })),
  },
  custom: {
    label: 'Custom exception',
    description: 'Parent curves, 7-day range — edit everything',
    apply: (parentSchedule) => [
      makeException({
        name: 'Custom exception',
        icon: '📅',
        start_date: '01-01',
        end_date:   '01-07',
        curveSource: 'parent',
        parentSchedule,
        ignore_monthly_multipliers: false,
      }),
    ],
  },
}

/**
 * v2.3 → v2.4 exception migration. Idempotent.
 *
 * v2.3 stored exceptions as `{ name, start_date, end_date }` only. The
 * weekday/saturday/sunday curves were INHERITED from the parent schedule
 * at engine evaluation time. v2.4 lifts each exception to a full
 * editable schedule with its own curves.
 *
 * This migration runs in `ProjectContext` on load. For each legacy
 * exception:
 *   - Assigns a DETERMINISTIC id (position + name slug + start date) so
 *     repeated loads produce the same id — critical for edit-mode state
 *     not to be invalidated on every refresh.
 *   - Copies parent's weekday/saturday/sunday curves into the exception
 *     IF the exception lacks them. Preserves the v2.3 "inherits parent
 *     pattern" semantic for any project that hasn't yet authored
 *     exception curves; user edits diverge from there.
 *
 * Returns the same array reference if no migration was needed.
 */
function _slug(s) {
  return (s ?? 'exc').toString().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 16) || 'exc'
}

export function migrateExceptionsV24(exceptions, parentSchedule) {
  if (!Array.isArray(exceptions) || exceptions.length === 0) return exceptions ?? []
  let changed = false
  const next = exceptions.map((exc, idx) => {
    if (!exc) return exc
    let result = exc
    if (!result.id) {
      result = {
        ...result,
        id: `legacy_${idx}_${_slug(result.name)}_${result.start_date ?? '0000'}`,
      }
      changed = true
    }
    if (!Array.isArray(result.weekday)) {
      result = {
        ...result,
        weekday: (parentSchedule?.weekday ?? new Array(24).fill(0)).slice(),
      }
      changed = true
    }
    if (!Array.isArray(result.saturday)) {
      result = {
        ...result,
        saturday: (parentSchedule?.saturday ?? result.weekday ?? new Array(24).fill(0)).slice(),
      }
      changed = true
    }
    if (!Array.isArray(result.sunday)) {
      result = {
        ...result,
        sunday: (parentSchedule?.sunday ?? result.weekday ?? new Array(24).fill(0)).slice(),
      }
      changed = true
    }
    return result
  })
  return changed ? next : exceptions
}
