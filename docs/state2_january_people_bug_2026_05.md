# State 2 — January-People bug investigation + fix (2026-05-14)

**Found during:** Brief 28a Part 5 walkthrough on Bridgewater. Chris noticed the People band looked nearly invisible across the year on the Conditions tab's Gain profile lens. Tooltip at 11 Jan showed People: 0.00 kW while Lighting + Equipment were non-zero.

**Severity:** Engine-level bug affecting all of State 2. Affects internal-gain computation across the whole year on every project. State 1 unaffected (no gains, no schedule lookup).

**Diagnosis duration:** ~30 min from finding to fix.

---

## Root cause

`frontend/src/utils/instantCalc.js` `decomposeHour` (line 717):

```js
day = weatherData.day?.[h] ?? 1                  // 1-31
```

`weatherData.day` was **never populated** by any upstream loader. The fallback `?? 1` silently defaulted `day` to **1 for every hour of the year**.

Upstream chain:

- Frontend `WeatherContext` fetches `/api/weather/{file}/hourly` (`api/routers/weather.py:473`) and forwards the response shape verbatim to `decomposeHour`.
- Backend `parse_epw` (`weather.py:136`) iterates rows of the EPW file and parses columns 1 (month), 3 (hour), 6 (temp), 14 (DNI), 15 (DHI), 21 (wind). **Skips column 2 (day-of-month) entirely.** Returns `{ temperature, direct_normal, diffuse_horizontal, wind_speed, month, hour, location }` — no `day` field.
- Test scripts (`state1_engine_agreement.mjs`, `state2_smoketest_live.mjs`, the new `diagnose_january_people.mjs`) construct `weatherData` inline by parsing EPW directly. They also skipped column 2.

So every consumer of `decomposeHour` saw `day=1` for every hour.

---

## Consequences

With `day` always 1, both downstream computations broke:

### 1. Date-range exception matching

`dateMMDD = String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0')` → `"<month>-01"` for every hour.

For January (month=1), every hour got `dateMMDD = "01-01"`. Bridgewater has a Xmas exception with range `24-12` to `01-07` (Dec 24 to Jan 7). `"01-01"` falls inside that range → exception fired for **every** hour of January. Exception schedule is all-zeros → People = 0 across the whole month.

### 2. Day-of-week derivation

`dayOfYear = _CUM_DAYS_NON_LEAP[month-1] + (day-1) = _CUM_DAYS_NON_LEAP[month-1]` (since `day=1`).
`dayOfWeek = dayOfYear % 7`. With day=1, every hour in a given month gets the same dayOfWeek — the dow of the **1st of that month**.

In a TMY year starting Mon Jan 1:

| Month | dayOfYear (with day=1) | dow | dayType   | Result on Bridgewater |
|-------|------------------------|-----|-----------|------------------------|
| Jan   |   0                    |  0  | weekday   | Xmas exception fires regardless → 0 |
| Feb   |  31                    |  3  | weekday   | normal weekday schedule applies     |
| Mar   |  59                    |  3  | weekday   | normal                              |
| **Apr** |  90                  |  6  | **sunday** | Bridgewater's sunday = all-zeros → **0** |
| May   | 120                    |  1  | weekday   | normal                              |
| Jun   | 151                    |  4  | weekday   | normal                              |
| **Jul** | 181                  |  6  | **sunday** | **0**                              |
| Aug   | 212                    |  2  | weekday   | normal                              |
| **Sep** | 243                  |  5  | **saturday** | Saturday = all-zeros → **0**     |
| Oct   | 273                    |  0  | weekday   | normal                              |
| Nov   | 304                    |  3  | weekday   | normal                              |
| **Dec** | 334                  |  5  | **saturday** | **0**                            |

**5 of 12 months had People = 0 entirely.** The other 7 months had People reading the weekday schedule (correctly modulated by monthly multipliers).

The bug affected Lighting + Equipment identically (same `decomposeHour` lookup; their schedules vary so their visual appearance differs). People stood out as most-invisible because Bridgewater's saturday/sunday schedules are both all-zeros, while Lighting/Equipment have non-zero weekend values.

---

## Fix

Two layers — backend hygiene + frontend defensive fallback:

### Backend: `api/routers/weather.py` `parse_epw`

Added `day_arr` parsing from column 2 + returned `"day": day_arr` in the API response. Future API consumers automatically get correct `day` arrays.

### Frontend: `frontend/src/utils/instantCalc.js` `decomposeHour`

Defensive fallback. If `weatherData.day?.[h]` is null, derive `day` from `h` (hour-of-year) directly using the same cumulative-days math the existing else-branch used:

```js
if (weatherData.day?.[h] != null) {
  day = weatherData.day[h]
} else {
  const dayOfYear = Math.floor(h / 24)
  day = dayOfYear - _CUM_DAYS_NON_LEAP[month - 1] + 1
}
```

This means **any future loader / script that forgets to populate `day` still produces correct results**. The frontend fix is the load-bearing one because it makes `decomposeHour` self-correcting; the backend fix is data-flow hygiene.

---

## Verification

`scripts/diagnose_january_people.mjs` re-run post-fix:

**Pre-fix peak People per month (kW):**

```
Jan  0.00   Feb 19.09   Mar 19.09   Apr  0.00
May 19.09   Jun 19.09   Jul  0.00   Aug 17.95
Sep  0.00   Oct 15.85   Nov 16.61   Dec  0.00
```

**Post-fix peak People per month (kW):**

```
Jan 19.09   Feb 19.09   Mar 19.09   Apr 19.09
May 19.09   Jun 19.09   Jul 19.09   Aug 17.95
Sep 16.99   Oct 15.85   Nov 16.61   Dec 17.38
```

All 12 months now show plausible peaks. Pattern matches monthly_multipliers `[1,1,1,1,1,1,1,0.94,0.89,0.83,0.87,0.91]`:
- Aug 0.94 × 19.09 ≈ 17.95 ✓
- Sep 0.89 × 19.09 ≈ 16.99 ✓
- Oct 0.83 × 19.09 ≈ 15.85 ✓
- Nov 0.87 × 19.09 ≈ 16.61 ✓
- Dec 0.91 × 19.09 ≈ 17.38 ✓

Hand calc cross-check: 134 rooms × 2.0 ppl/room (per `occupancy.density`) × 1.0 `occupancy_rate` × 75 W sensible = 20,100 W = **20.1 kW peak**. Engine peaks at 19.09 kW which is 95% of hand calc — the small gap is the schedule-peak value (max weekday fraction × monthly_multiplier_jan=1), not the full theoretical maximum.

State 1 + State 2 Live isolation regressions still **byte-identical** (the fix changes absolute values but invariance to forbidden inputs is preserved — the regressions test invariance, not correctness).

---

## Downstream impact — audit trail

State 2 numbers reported in earlier docs were computed with the buggy engine. They need re-baselining:

| Doc | Status |
|---|---|
| `docs/state_2_expected_ranges.md` | **Stale.** Expected ranges (People kWh 67k-87k, Lighting 67k-93k, Equipment 147k-200k, Heating 125-165 MWh, Cooling 107-140 MWh) were calibrated against the buggy engine. Post-fix Bridgewater values: People 40k, Lighting 41k, Equipment 56k, Heating 40 MWh, Cooling 229 MWh — substantially outside. **Re-baseline needed.** |
| `docs/state_1_engine_divergence_investigation.md` | **State 1 numbers unaffected** (gains aren't computed in State 1). State 2 numbers if any are wrong — but the doc focuses on State 1 + free-running T. |
| `docs/physics_audit_2026_05.md` | Audits 1 (envelope conduction) and 4 (free-running T) are State-1-bounded → unaffected. Audit 6 (State 2 internal gains additivity) IS affected — the additivity result was computed against zeroed-by-bug months. Re-check needed. |
| Brief 27 cleanup Part 3 corrected close numbers | State 2 numbers in the corrected disclosure are **post-fix-correct only for the months not zeroed by the bug**. The annual aggregates (e.g. "Internal gains 307,594 kWh" cited in the 15/15 shape verification) were the buggy values. Verify post-fix. |
| Brief 28 prereq corrected comparison | State 2 demands (Static 103.4 MWh heating, 108.6 MWh cooling) used buggy engine. Re-baseline expected. |

**Recommended sequence:**
1. Backend uvicorn restart (so `parse_epw` returns `day` in API responses for the live app).
2. Open the Conditions tab on Bridgewater. Confirm People band is now visible across the year.
3. Re-run `scripts/state2_smoketest_live.mjs` to capture the new annual baselines.
4. Update `docs/state_2_expected_ranges.md` with the post-fix numbers as the new baseline.
5. Spot-check Brief 27 cleanup corrected close numbers + Brief 28 prereq corrected comparison numbers in their docs.

This work is bigger than Brief 28a Part 5 walkthrough Finding 3 itself — it's a re-baselining exercise that wasn't anticipated. Surfaced for Chris's decision on sequencing (do now, defer to Part 7 close-out, or queue as a Brief 28a follow-up?).

---

## Lessons

1. **Defensive defaults that hide bugs.** `?? 1` looks innocent. It silently masks a missing field for years (since the day-of-week + dateMMDD machinery was introduced). A noisier default — `?? null` or throw — would have surfaced the missing data immediately. Filed as a UI-principle candidate: default values should be conspicuous, not silent.

2. **Schema validation between layers.** The frontend trusted the backend `/api/weather/{file}/hourly` response shape. The backend's `parse_epw` returns whatever its implementation happens to produce. No contract between the two sides. A typed schema (Pydantic on the backend, matching shape on the frontend) would have caught the missing field at every consumer. Filed as a candidate for the constants-cleanup Brief 29 Part 3 or a separate brief.

3. **Byte-identity regressions are necessary but not sufficient.** All four isolation regressions passed before AND after the fix. Byte-identity tests invariance — it doesn't catch absolute-value bugs. The HeatBalance rendering smoketest already on the Brief 28a Part 7 acceptance-gate list addresses one class of similar miss; a `scripts/state2_january_people_smoketest.mjs` checking that People > 0 across all months on Bridgewater would catch this specific bug class. Filed as a Brief 28a Part 7 acceptance-gate addition.
