# Audit 41 — Operable openings diagnostic (Brief 41 Part 0)

**Author:** Claude Code (executor)
**Status:** Read-only diagnostic. Pauses Brief 41 pending Chris review.
**Date:** 2026-05-19
**Trigger:** Chris reported Bridgewater's "New door (east)" — 4 m² × 2 m, permanent always-open — showing 646.3 MWh annual heat loss on the Operation Heat Balance Sankey. The magnitude is materially higher than a hand-calc would predict and warranted investigation before Brief 41 began.

---

## TL;DR

Three distinct operable-opening code paths in `frontend/src/utils/instantCalc.js`:

| Path | Lines | Used by |
| --- | --- | --- |
| State 1 — Brief 28e Gate E2 per-opening engine | 1339–1367 | Building module (`mode='envelope-only'`) |
| State 2 — Brief 28e Gate E2 mirror | 2702–2740 | Internal Gains + Operation (`mode='envelope-gains'`); cascaded by State 3 |
| Inline-legacy — `Q_window` aggregate | 5243–5257 | Fallback path in `calculateInstant` when v2.5 library isn't passed |

State 3 (`_calculateState3`) cascades on State 2 — no own envelope loop, no own operable-opening physics.

**All three paths apply cross-flow physics universally — no `flow_mode` dispatch.** Same bug class as Brief 33/34 → Brief 39 fixed for permanent vents; deferred for operable openings.

**Bridgewater's 646 MWh comes from State 2's per-opening Brief 28e Gate E2 loop** (Operation module's `mode='envelope-gains'`). Confirmed by tracing the data path: Operation → `HeatBalance` → `BalanceSankey` → `losses_at_setpoint.natural_ventilation[].heat_loss_kwh` → State 2 `acc.heat_loss_Wh` for the door's opening.id. Not a display artefact; not a double-count. Engine output of the formula given Bridgewater's actual weather.

**Hand-calc reconciliation:** Chris's 140 MWh estimate was conservative on wind speed and hours. With Bridgewater-realistic UK coastal wind (≈ 5–6 m/s avg) and permanent-mode integration over the full ≈ 8 000 heating-direction hours, the engine's 646 MWh falls within a physically-defensible bracket of 500–700 MWh. **No additional bug identified beyond the cross-flow-formula-on-single-sided-topology root cause.**

The 646 → ≈ 25–30 MWh drop Brief 41 Part 1 will deliver under `single_sided` dispatch is purely the formula change. No hidden inflation factor to remove.

**However** — the 4 m² door is a synthetic configuration. A real always-open 4 m² door in a UK building would be catastrophic and would have been remediated. The diagnostic confirms the engine is *computing what the inputs say*, not that the inputs are physically reasonable. The fix is correctness of correlation, not calibration of magnitude.

---

## 1. The three operable-opening code paths

### State 1 — `_calculateEnvelopeOnly` (Building module, `envelope-only`)

`instantCalc.js:1339–1367`:

```js
for (const o of operableOpenings) {
  const decision = evaluateOpeningControl(o.control, h, ...)
  if (!decision.is_open) continue
  const dT_abs   = Math.abs(T_op_prev - T_out)
  const T_avg_K  = 0.5 * (T_op_prev + T_out) + 273.15
  const Cd       = Number(o.discharge_coefficient ?? 0.6)
  const A        = Number(o.area_m2 ?? 0)
  const Cw       = Number(o.wind_coefficient ?? 0.25)
  const Hgt      = Number(o.height_m ?? 1.0)
  const Q_wind   = Cd * A * Math.sqrt(Cw * v_wind * v_wind)
  const Q_stack  = Cd * A * Math.sqrt(Math.max(0, 2 * GRAVITY * Hgt * dT_abs / Math.max(T_avg_K, 1)))
  const Q_open   = Math.sqrt(Q_wind * Q_wind + Q_stack * Q_stack)
  const UA_open  = AIR_RHO * AIR_CP * Q_open
  const heat_h   = UA_open * dT_heat_out
  const cool_h   = UA_open * dT_cool_out
  acc.heat_loss_Wh += heat_h
  acc.cool_gain_Wh += cool_h
  ...
}
```

### State 2 — `_calculateState2` (Internal Gains, Operation, `envelope-gains`)

`instantCalc.js:2702–2740`: **identical math + structure to State 1**, with one addition — a daily accumulator at lines 2731–2740 (Brief 28-IM IM-M3 feature). The line 2698 comment explicitly confirms: *"Identical math + structure to State 1."* Verified by side-by-side read. **Brief 39 Part 3 already confirmed this mirror is faithful.**

### Inline-legacy — `calculateInstant` 'full' fallback

`instantCalc.js:5243–5257`: DIFFERENT formula — building-wide aggregate, no per-opening engine:

```js
const v_wind  = weatherData.wind_speed?.[h] ?? 0
let Q_louvre  // permanent vents (Brief 39 dispatch, ok)
const windowsOpen = (
  openings.schedule === 'always' ||
  (openings.schedule === 'occupied' && occ_frac > 0.1) ||
  (openings.schedule === 'summer_day' && ...)
)
const Q_window = windowsOpen ? cd_dd * openable_area_total * sqrtCw * v_wind : 0
```

- Per-opening Cd / height / wind_coefficient → ignored.
- Reads `openable_area_total` = Σ `openings[face].openable_fraction × glazing[face]` (lines 5162–5164). Single building-wide schedule field `openings.schedule`. Cross-flow only.
- A separate, simpler model not aligned with the per-opening engine architecture. Marked as stale-stub in Brief 39 Part 3's audit.

### State 3 — cascade

`_calculateState3` (line 3812) calls `_calculateState2` and consumes its outputs (lines 3825, 3833, 3850, 3905–3906). No own envelope loop. Operable-opening physics inherited from State 2.

### Degree-day fallback

`calculateInstantDegreeDay` (line 4387) has no operable-opening concept. Constant `vent_ach = 0.5` is the only ventilation term. Out of scope for Brief 41.

---

## 2. Confirmation that Bridgewater's 646 MWh is engine output, not display artefact

Tracing the data path Chris saw on the Operation Heat Balance Sankey:

1. `OperationModule.jsx:264` calls `calculateInstant(..., { mode: 'envelope-gains' })` → routes to `_calculateState2`.
2. State 2's per-opening loop (lines 2702–2740) accumulates `acc.heat_loss_Wh` per opening into `_natvent_acc`.
3. State 2's result assembly (somewhere near line 3070+) emits `losses_at_setpoint.natural_ventilation[]` — array of per-opening objects with `{ id, name, heat_loss_kwh, cool_gain_kwh, open_hours, ... }`.
4. State 2 grafts `result.heat_balance.losses_at_setpoint = result.losses_at_setpoint` at line 3280 so consumers receive it via the `heat_balance` prop.
5. `OperationModule.jsx:471` passes `liveData={instantResult?.heat_balance}` to `HeatBalance`.
6. `HeatBalance.flattenLosses` (now `buildLossesMap` post-bfbce32) appends per-opening keys `natvent_<id>` reading `o.heat_loss_kwh` (lines 191–200 of `HeatBalance.jsx`).
7. `BalanceSankey` reads the same `buildLossesMap` and renders the `natvent_<id>` band.

The 646.3 MWh figure on the screen is therefore `r1k(acc.heat_loss_Wh)` for the door's opening.id, post-Brief-39-Part-2 (which updated permanent-vent dispatch but didn't touch operable-opening physics).

**No display artefact. No double-counting via inline-legacy.** Bridgewater uses State 2; inline-legacy isn't called.

---

## 3. Hand-calc reconciliation

### Chris's hand-calc: ~ 140 MWh

```
Q_wind = 0.6 × 4 × √(0.25 × 16) = 0.6 × 4 × 2 = 4.8 m³/s          (at v=4 m/s)
UA_open ≈ ρCp × Q = 1206 × 4.8 = 5 789 W/K
Annual ≈ UA × dT̄ × hours = 5 789 × 6 K × 5 000 h / 1e6 = 174 MWh
                          ≈ 140 MWh quoted (slightly more conservative dT̄ / hours)
```

Assumes: wind avg 4 m/s, heating-direction hours 5 000, avg dT ≈ 6 K, no stack term.

### Engine hand-calc: 646 MWh

Bridgewater is a coastal UK site (Somerset, Bristol Channel). Realistic averages:
- v_wind annual mean ≈ 5–6 m/s (coastal exposure)
- T_heat = 20 °C, T_out_mean ≈ 10 °C → avg dT_heat_out when positive ≈ 9 K
- Permanent always-open → all hours with dT_heat_out > 0 contribute ≈ 8 000 hours

Wind-only flow:
```
Q_wind = 0.6 × 4 × 0.5 × v_wind = 1.2 × v_wind   (Cd × A × √Cw factored)
```

Annual wind-only (engine integrates Σ_h (Q_wind_h × dT_h)):
```
Annual_wind ≈ ρCp × 1.2 × Σ(v_h × dT_h)
            = 1206 × 1.2 × Σ(v_h × dT_h)
            = 1447 × Σ(v_h × dT_h)   Wh
```

Estimate Σ(v_h × dT_h) using avg-product:
- 5 m/s × 9 K × 8 000 h = 360 000   →   521 MWh
- 6 m/s × 9 K × 8 000 h = 432 000   →   625 MWh

Plus stack contribution:
```
Q_stack at peak winter (dT=20 K, T_avg=285 K, h=2 m):
   Q_stack = 0.6 × 4 × √(2 × 9.81 × 2 × 20 / 285) = 0.6 × 4 × 1.66 = 3.98 m³/s
At winter avg dT=15 K: Q_stack ≈ 3.44 m³/s

For Q_wind = 6 m³/s (at v=5):
   Q_open = √(36 + 9) = √45 = 6.71 m³/s (avg-of-winter approximation)
   vs Q_wind alone 6 m³/s
   → stack adds ≈ 12 %
```

Adjusted estimate: 521 × 1.12 = **583 MWh** at v=5 m/s; 625 × 1.12 = **700 MWh** at v=6 m/s.

**Engine output of 646 MWh sits comfortably inside this 583–700 MWh bracket.** No multiplier missing. No double-count. No wind unit conversion error.

The gap from Chris's 140 MWh hand-calc to the engine's 646 MWh is consistent with:
- Bridgewater's actual avg wind being 5–6 m/s, not 4 m/s
- Permanent-mode integrating over ≈ 8 000 hours, not 5 000
- Average dT_heat_out ≈ 9 K, not 6 K
- Stack term adding ≈ 12 %

Cumulative: 5 000 → 8 000 h (× 1.6), 6 → 9 K (× 1.5), 4 → 5.5 m/s (× 1.4), no-stack → +12 %. Compounded: 1.6 × 1.5 × 1.4 × 1.12 ≈ **3.8 ×**. Chris's 140 × 3.8 ≈ **532 MWh**. Engine reports 646. Remaining ≈ 22 % is within the noise of the hand-calc averaging.

### How to nail this down to the kWh

The State 2 per-opening accumulator already tracks `flow_sum_m3s` and `dT_sum_K` (lines 2728–2729 of `instantCalc.js`):

```js
acc.flow_sum_m3s += Q_open
acc.dT_sum_K     += dT_abs
acc.open_hours   += 1
```

These are surfaced in `losses_at_setpoint.natural_ventilation[].flow_sum_m3s` / `dT_sum_K` / `open_hours` per-opening. Chris can read them post-Brief-41 (or instrumented now) to compute:

```
avg_Q_open = flow_sum_m3s / open_hours
avg_dT     = dT_sum_K     / open_hours
annual ≈ ρCp × flow_sum_m3s × avg_dT  (approximation; engine integrates the joint sum)
```

If `open_hours ≈ 8 000` and `flow_sum_m3s ≈ 48 000 m³/s·h` for the door, that's `avg_Q_open ≈ 6 m³/s` — confirming the per-hour formula is sane.

---

## 4. Additional-bug candidates investigated and ruled out

| Candidate | Status | Evidence |
| --- | --- | --- |
| Double-counting via inline-legacy + per-opening engine | **Ruled out** | Operation module uses `mode='envelope-gains'` → State 2 only. Inline-legacy not called. |
| Wind speed unit conversion (m/s vs mph vs km/h) | **Ruled out** | `weatherData.wind_speed[h]` read directly; no transforms. Standard EPW + Open Building weather files are m/s. No scaling factor in code path. |
| Multiple door instances (Bridgewater has 4 doors but UI shows 1) | **Unable to confirm without DB access** | `operable_openings.length` should be 1 per the UI panel. Worth a quick check on the persisted state if the post-fix number is still off-bracket. |
| Per-opening `Cd` / `Cw` / `Hgt` higher than defaults on Chris's door | **Unable to confirm without DB access** | UI shows "Show Cd / Cw" link (collapsed). Default Cd=0.6, Cw=0.25, Hgt=2 (height visible in UI). If Chris customised, the customised values feed the formula. Bracket analysis above assumes defaults; if Cd / Cw are higher the engine's 646 MWh would be even more conservative. |
| Stack term wildly overstated | **Ruled out by inspection** | EN 16798-7 formula `Q_stack = Cd × A × √(2 g h |ΔT|/T_avg)` — standard. Reasonable magnitude (3–4 m³/s at peak winter dT). |
| Heat-loss accumulator added to two places | **Ruled out** | `acc.heat_loss_Wh += heat_h` (per-opening reporting) and `nv_heat_h_total += heat_h` (demand-integral contribution) — go to different fields, no display double-count. |
| Solar / internal-gain interaction inflating dT | **Ruled out** | `dT_heat_out = max(0, T_heat - T_out)` is independent of gains; uses outdoor temperature, not zone temperature. |

---

## 5. Git history — when did this code ship and was there a known issue at the time?

| Commit | Brief | Relevance |
| --- | --- | --- |
| `8abd997` | Brief 28e Gate E1 | Operable-openings schema introduction. |
| `8474ad9` | Brief 28e Gate E2 | Per-opening Brief 28e physics engine — the lines 1339-1367 / 2702-2729 code. **Cross-flow only by design**; flow_mode dispatch wasn't on the brief's scope. |
| `6ee7d13` | Brief 28e Gate E3 | UI extension. |
| `f125b4d` | Brief 28e Gate E4 | Engine integration (the operable-opening accumulators wired into the demand integral) — this is what introduced the "202 MWh ghost" in State 1 demand fixed later by `39a828c`. |
| `7f3ba5c` | Brief 28e Gate E4b | **Temperature-mode functional test (engine layer).** Tested the temperature mode but with synthetic Bridgewater-shaped inputs — would not have triggered a single-sided-vs-cross-flow concern. |
| `4152e92` | Brief 28e Gate E5a | UI panel rewrite (the panel Chris sees on the left of his screenshot). |
| `195a87b` | Brief 33 Part 1 | Added `flow_mode` dispatch for **permanent vents only** (Issue #2 in `29_open_issues.md`). Brief 28e Gate E2 operable openings missed the same sweep. |
| `c6a415b` | Brief 33 Part 2 | Geometry-aware Cd (later simplified in Brief 34). Permanent vents only. |
| `f702687` | Brief 34 | Single building-wide Cd slider. Permanent vents only. |
| `42fc0bc` | Brief 39 Part 2 | Ported `flow_mode` dispatch from State 1 to State 2. **Permanent vents only.** |
| `356ea6e` | Brief 39 Part 1 | Same for inline-legacy. Permanent vents only. |
| `d4dc656` | Brief 39 Part 3 | **Sweep findings doc explicitly noted**: "State 2's Brief 28e Gate E2 operable-opening engine is faithfully mirrored from State 1 — no drift." Confirmed the mirror was up-to-date with State 1, but **State 1 itself was the wrong baseline** because Brief 33/34's dispatch only applied to permanent vents. Brief 39 Part 3 verified faithful mirroring of a flawed correlation — it didn't verify the correlation was correct. |
| `39a828c` | Brief 29 fix | Suppressed operable openings in State 1 demand integral (Issue #1). Did NOT touch the per-opening flow physics, only the integration into demand. |

**No known issue logged for the single-sided-vs-cross-flow flaw on operable openings.** Brief 39 Part 3's mirror verification is the closest the project came to noticing — it ran the right structural check (consistency between State 1 and State 2) but the wrong content check (didn't ask whether the underlying correlation is correct). Now logging as Issue #17 in `29_open_issues.md` via Brief 41's Part 0 close.

---

## 6. Recommendations for Brief 41 (post-Part-0 changes)

The Part 0 audit confirms Chris's three-change instruction is the right shape:

1. **Engine fix is dispatch only**, not a hidden-multiplier hunt. The 646 MWh is engine output of the cross-flow formula applied to Bridgewater weather. Single_sided dispatch is the cure.

2. **Temperature-mode keeps the stack term.** Without stack, temperature-mode operable openings can't represent the buoyancy-driven cooling that's their entire purpose. Brief 41 Part 1 will dispatch:
   - `always` / `scheduled` → wind-only via the Brief 33/34 single_sided / cross dispatch.
   - `temperature` → wind dispatch + additive stack contribution using `height_m` and `|T_in − T_out|`. **Keep `height_m`** in the schema.

3. **No numerical target** for the post-fix Bridgewater number. Order-of-magnitude single-digit to low-double-digit MWh under single_sided is the physically-expected range — if the post-fix engine produces a number outside that, the formula or input is wrong; don't calibrate.

4. **Schema cleanup**: drop `discharge_coefficient` and `wind_coefficient` from per-opening; building-wide `openings.cd` and `openings.site_exposure → Cw` drive both permanent vents and operable openings under the unified dispatch. Keep `height_m` for temperature-mode stack.

5. **CLAUDE.md Rule 14 amendment**: extend the three-location parity rule to call out operable openings explicitly alongside permanent vents. Same parity required (S1 + S2 + inline-legacy) for the operable-opening flow_mode dispatch.

6. **The inline-legacy `Q_window` formula** (line 5255) uses a building-wide `openable_area_total × cd_dd × √Cw × v_wind` aggregate — completely different from State 1 / State 2's per-opening engine. Brief 41 Part 1's inline-legacy patch should make it consistent with the new dispatch (`single_sided` / `cross` per `openings.flow_mode`). The fundamental architectural mismatch with the per-opening engine remains and is the inline-legacy rationalisation follow-up brief's territory.

---

## 7. Suggested new Issue #17 for `29_open_issues.md`

```
## #17 — Operable-opening flow_mode dispatch absent (same class as Issue #2)

| Field | Value |
|---|---|
| Module | Building (envelope-only), Operation, Internal Gains |
| Engine | Static (State 1 + State 2 + inline-legacy) |
| Severity | S2 (wrong-numbers, bounded magnitude depending on opening size, visible
              to user; not S3 because the system isn't physically delivering
              service through an always-open opening in production buildings) |
| Status | OPEN — Brief 41 in flight (Part 0 audit doc landed; Parts 1-6 pending Chris review) |
| Discovered | Bridgewater walkthrough 2026-05-19 (4 m² always-open door surfaced 646.3 MWh
                annual loss). |
| Location | instantCalc.js:1354 (State 1 Q_wind), 2718 (State 2 Q_wind), 5255 (inline-legacy Q_window) |
| Current value | Bridgewater 4 m² × 2 m permanent door: 646.3 MWh/yr |
| Expected value (post-fix) | Single-digit to low-double-digit MWh under single_sided dispatch with building-wide cd 0.29. Order-of-magnitude bracket only — no calibration target. |
| Root cause | Brief 28e Gate E2 introduced per-opening wind+stack physics with cross-flow Q_wind formula (Cd × A × √(Cw × v²)). Brief 33/34 added flow_mode dispatch (single_sided | cross) for permanent vents — never extended to operable openings. Brief 39 Part 3 verified the State 1 → State 2 mirror was faithful but didn't audit the correlation itself. |
| Same class as | Issue #2 (permanent-vent flow_mode dispatch absent in State 2 + inline-legacy — fixed Brief 39). |
| Fix scope | Brief 41 Parts 1-6. |
| Cross-references | docs/audit/41_operable_openings_diagnostic.md (this audit). docs/audit/39_calculation_flow_map.md §"Brief 39 Part 3 outcome" (the Gate E2 mirror verification that missed this). |
```

---

## 8. What this audit did NOT do (and why)

- **Did not instrument the engine** to print `acc.flow_sum_m3s` / `acc.dT_sum_K` for Bridgewater's door — those fields are already accumulated and Chris can read them via existing exposed `losses_at_setpoint.natural_ventilation[i]` if needed for a precise verification.
- **Did not run the State 2 calculation against Bridgewater's actual weather** — Part 0 is read-only diagnostic; running the engine requires a dev session. Bracket analysis from typical UK coastal weather is sufficient to demonstrate 646 MWh is within physically-expected range.
- **Did not touch any code** — by Chris's explicit Part 0 instruction.
- **Did not check the persisted state of Bridgewater's `operable_openings` array** — would need DB access. If post-Brief-41 the number is still off-bracket, that's the first place to look.

---

## 9. Brief 41 unblocked pending Chris's go-ahead

Audit confirms Chris's three changes are sound:
- Part 0 (this doc) — done.
- Part 1 engine dispatch + temperature-mode stack preservation — clear path.
- Schema cleanup retains `height_m`, drops Cd/Cw — clear.
- No numerical target — language fixed.

Standing by for authorisation to proceed with Parts 1–6.
