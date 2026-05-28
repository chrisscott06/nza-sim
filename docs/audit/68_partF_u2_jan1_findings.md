# Brief 68 Part F — U2: Jan 1 = Monday assumption — findings

**Status:** investigation-only (no fix this brief, per Brief 68 §Part F).
**Date:** 2026-05-28
**Reviewer:** Chris (decides whether this gets its own follow-up brief).

---

## TL;DR

- **Blast radius:** PRODUCTION-AFFECTING. Two production-path day-of-week derivations exist (`instantCalc.js:2058-2094` `decomposeHour` and `scheduleLibrary.js:89-115` `_decomposeHourForSchedule`), both assume Jan 1 = Monday. State 2 schedule resolution (occupancy, lighting, equipment, ventilation, DHW load-shape follow-occupancy) routes through one or both.
- **Magnitude:** **Annual totals: zero** (52 weekends either way; the count is preserved, only the calendar position shifts). **Hourly/daily/monthly profiles: ±3 days of phase shift** from the real calendar. Affects any visualisation or comparison that uses real dates (e.g. comparing modelled vs measured half-hourly data — Brief 18b consumption module is a candidate).
- **Recommendation:** **Document for TMY, fix for AMY.** TMYx files like Bristol's are synthetic-year — Jan 1 = Monday is a defensible convention. If AMY (actual measured year) data is ingested for calibration in a future brief, the assumption breaks and needs a per-project Jan 1 day-of-week field. Cleanest is to parse the EPW DATA PERIODS line for a year, compute the real Jan 1 day-of-week, and feed it through. **Do NOT fix this brief.**

---

## Where the assumption lives

### Site 1 — `frontend/src/utils/instantCalc.js:2058-2094` `decomposeHour`

```js
const dayOfYear = _CUM_DAYS_NON_LEAP[month - 1] + (day - 1)
// Jan 1 = Monday → dayOfWeek 0=Mon..4=Fri, 5=Sat, 6=Sun
const dow = dayOfYear % 7
const dayType = dow === 5 ? 'saturday' : (dow === 6 ? 'sunday' : 'weekday')
```

**Used by:** State 2 schedule resolution for every gain category that has a schedule (occupancy via `gains.occupancy.schedule_ref`, lighting/equipment via `gains.lighting[].profile/schedule_ref` etc., ventilation via `systems_config_v25.ventilation[].schedule_ref`, DHW follow-occupancy load shape per Brief 58 B4).

**Reaches:** Every hourly call inside the State 2 integrand. Production path on every engine run with non-trivial schedules (i.e. any project that doesn't use 24/7 always-on schedules).

### Site 2 — `frontend/src/utils/scheduleLibrary.js:89-115` `_decomposeHourForSchedule`

```js
const dayOfYear = _CUM_DAYS[month - 1] + (day - 1)   // 0..364
const dow = dayOfYear % 7                            // 0 = Monday, ..., 6 = Sunday
let dayType
if (dow === 5)      dayType = 'saturday'
else if (dow === 6) dayType = 'sunday'
else                dayType = 'weekday'
```

**Used by:** `resolveScheduleValue(schedule, hour, weatherData)` which is the library-side schedule lookup. Library callers include schedule-preview UI components (the chart agent has been wrapping some of these for chart export).

**Status:** Same assumption as Site 1, same comment ("Jan 1 = Monday"). Duplicate logic — single-source candidate, but that's a separate `S2/SOSOT` register item, not part of U2.

### Inline-legacy

`calculateInstantDegreeDay` (the inline-legacy degree-day path at `instantCalc.js:5613+` / `6469+`) does NOT compute hourly schedules — it integrates daily HDD against monthly schedules. So U2 does not affect inline-legacy. Inline-legacy still uses Brief-pre-67 demand math (separate harmonisation brief logged).

---

## The Bristol EPW

File in use: `data/weather/current/GBR_ENG_Bristol-Filton.Aerodrome.038270_TMYx.2009-2023.epw` (or similar — confirmed by inspection in the validation harness setup at `validate_engine.mjs:78-79`).

- **Source:** climate.onebuilding.org **TMYx** format — typical meteorological year, extended period (built from monthly bests across multiple years).
- **Year field:** TMYx files use a placeholder year (commonly 2009 or the start of the dataset span) but the day/month combos are synthesised so day-of-week is not meaningful in the EPW source data.
- **Real calendar Jan 1:**
  - 2024 Jan 1 = Monday  ✓ (engine's assumption is correct for 2024)
  - 2025 Jan 1 = Wednesday  ✗ (engine off by 2 days)
  - 2026 Jan 1 = Thursday  ✗ (engine off by 3 days)
  - 2009 Jan 1 = Thursday  ✗ (engine off by 3 days)
- **TMY synthesis erases this anyway:** TMYx hours are knit from different real years per month — there is no single "real" Jan 1 day-of-week for a TMYx file. The engine's "Jan 1 = Monday" is as defensible as any other choice **for a TMY file**.

### Conclusion for Bristol TMYx

The Jan 1 = Monday assumption is **internally consistent** for TMY files: schedules fire on a fixed calendar pattern across runs (necessary for reproducibility) and weekend hours are correctly counted (annual totals are right). The choice is arbitrary but defensible.

---

## Magnitude of the misalignment

### Annual totals
**Zero net impact.** The engine maps 5/7 of days to "weekday" and 2/7 to weekend regardless of where Jan 1 falls. For any schedule whose annual integral is `weekday × 5/7 × hours_per_day + weekend × 2/7 × hours_per_day`, the total is unchanged by phase. Verified by inspection of the formulas and by the validation harness's annual-conservation assertions (Brief 63 §C still PASS).

### Hourly / daily / monthly profiles
**Up to ±3 days of phase shift** from a real calendar. Practical consequences:

| Use case | Affected? |
|---|---|
| Annual EUI, demand, fuel, carbon | No (annual integral preserved) |
| Monthly demand breakdown | No (each month's 4–5 weekends shift around inside the month but stay inside) |
| Hourly load profile (annual) | Yes (visualisation is offset 0–3 days from real-calendar Mon-Fri pattern) |
| Half-hourly comparison vs measured | Yes — **the headline calibration concern** if AMY data is ingested |
| EnergyPlus daily-pattern parity | Yes (EnergyPlus reads the EPW's `RunPeriod` start day-of-week; mismatch with the engine creates apparent disagreement on daily plots even when annual totals match) |

### Worst-case daily impact

For an office with weekday=1 (09-18) and weekend=0 schedule, a single day could be classified differently:
- True Monday (load=1 hours 09-18) classified as "Saturday" (load=0): -9 hours of load × peak rate
- ≈ 9 hours/day of misclassified load × 4 days/year of misclassification ≈ 36 hours

Over 8760 hours of total simulation, 36 hours of single-day misclassification per affected schedule. Trivial for annual EUI but visible on daily plots.

---

## Recommended fix approach (NOT this brief)

Three options, in order of effort:

### Option A — Document the assumption (no code change)
Add a note to the Information module / weather selector explaining that day-of-week is fixed at Jan 1 = Monday for all weather files. Acceptable for TMY-only usage. Cost: one paragraph of UI copy.

### Option B — Parse EPW year and compute real day-of-week
Read the `DATA PERIODS` line from the EPW header at engine entry; if the year is sensible (e.g. ≥ 2000), compute `new Date(year, 0, 1).getDay()` and translate into the engine's 0=Monday convention. Use Monday if the EPW year is bogus (TMY synthetic 1900 etc.). Replace the hard-coded assumption with this computed offset.

  **Cost:** ~15 lines in EPW loader + 1 parameter added to `decomposeHour` and `_decomposeHourForSchedule` + harness assertion that the offset is honoured. **Risk:** schedules would shift on existing projects — that's a visible change in profiles, no change in annual totals. Anchor (Bridgewater 110.30 EUI) preserved.

### Option C — Per-project Jan 1 day-of-week input
Add a field to building config so the user can calibrate the model's day-of-week against their measured data (or against a specific real year). Default to the EPW-derived value from Option B. Most flexible; needed for serious AMY calibration work.

  **Cost:** schema field + UI input + loader + ALLOWLIST DRIFT entry in withMode. **Risk:** another field to migrate on persisted projects; touches the v25/v40 patch system.

**Recommendation:** **Option A now (zero risk, gets us past this register item), Option B when AMY data ingestion lands**, Option C if calibration tuning becomes a workflow.

---

## What I did NOT do (per brief)

- Did **not** fix the assumption.
- Did **not** add a building-config field.
- Did **not** touch `decomposeHour` or `_decomposeHourForSchedule`.
- Did **not** parse the EPW for a real year.

This is a read-only investigation. If Chris wants this addressed, it gets its own brief.

---

## Open question for Chris

Annual totals are unaffected; only the *position* of weekends shifts. Two cases where this matters:
1. **Daily plots vs measured AMY data** — comparison tool would visibly disagree on a Tue-vs-Sat misclassification.
2. **EnergyPlus parity** — when Brief 30 (Dynamic engine rebuild) resumes, EnergyPlus will read the EPW's RunPeriod start day. Mismatch will surface as daily-profile disagreement on otherwise-matched runs.

Both can be deferred until either path lands. Confirming this register item stays low-priority unless either of those workstreams resumes.
