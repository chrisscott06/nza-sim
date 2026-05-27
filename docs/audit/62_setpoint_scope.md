# Brief 62 Part 1 — wrong-source scope audit (read-only)

**Status:** read-only. Maps every input the State 2 demand integrand reads, and confirms the wrong-source fault scope. **HARD STOP** for Chris's confirmation before Part 2 fix.
**DB backup:** `data/nza_sim_cc.db.brief62_pre_fix.20260527_110801.bak`.

---

## §1 The State 2 demand integrand — every input it reads, and the source

`instantCalc.js _calculateState2` (function L2357-3700ish) consumes the following inputs that influence the heating/cooling demand integrand:

| input | what it controls | source today | wrong-source? |
|---|---|---|---|
| `effectiveLowerC` (heating setpoint) | T_heat in per-hour demand at L2981; floor const at L2447 | `opts.setpointOverride.heating ?? comfortBand.lower_c` at L2371-2373 | **YES** — main `_calculateState3` call at L4368 passes NO override → demand uses comfortBand only |
| `effectiveUpperC` (cooling setpoint) | T_cool in per-hour demand at L2982; floor const at L2448 | `opts.setpointOverride.cooling ?? comfortBand.upper_c` at L2374-2376 | **YES** — same call-site omission |
| `building.systems_config_v25.ventilation[*].flow_l_s` | mech-vent UA at L2712 | v25 with v40-wins override at L2640-2693 (Brief 59 P1 fix) | NO — Brief 59 P1 closed this |
| `building.systems_config_v25.ventilation[*].hre` | HRE in mech-vent UA `(1−HRE)` factor | v25 with v40-wins override (Brief 50 P6) | NO — Brief 50 P6 closed this |
| `building.systems_config_v25.ventilation[*].sfp_w_per_l_s` | does NOT affect demand (fan electricity only) | v25 with v40-wins override (Brief 60 A reconcile fix) | NO (and not demand-side anyway) |
| `building.systems_config_v25.ventilation[*].enabled` | gates the mech-vent loss accumulation | v25 AND v40 (both must agree, Brief 50 P6) | NO |
| `building.systems_config_v25.ventilation[*].summer_bypass` | per-hour bypass trigger inside the mech-vent loop | v40 wins, v25 fallback (Brief 53 P2) | NO (open question on bypass direction is Brief 63, not source) |
| `building.gains.lighting.profiles[*]` | lighting gain → State 2 hourly internal gain | direct read of building.gains | NO |
| `building.gains.equipment.profiles[*]` | equipment gain → State 2 hourly internal gain | direct read of building.gains | NO |
| `building.systems_config_v40.lighting[*].{enabled,share_pct,control_factor}` | modulates lighting gain via `effectiveSystemScalar` (Brief 58 C) | v40 direct | NO — Brief 58 C wired this correctly |
| `building.systems_config_v40.small_power[*].{enabled,share_pct,control_factor}` | modulates equipment gain (Brief 58 C) | v40 direct | NO |
| `building.occupancy.{density, schedule, ...}` | people gain + presence_hourly | direct read of building.occupancy | NO |
| `building.fabric`, `building.openings`, `building.thermal_bridges`, `constructions` | envelope U-values + opening areas + ψ-values → conduction loss + infiltration + permanent vent loss | direct read of building / passed-through libraryData | NO |
| `weatherData` | T_out hourly drives ΔT in all UA × ΔT integrands | EPW reader output | NO (correct source) |

**Conclusion: exactly 2 inputs are wrong-source — `heating_setpoint_c` and `cooling_setpoint_c` (when `*_setpoint_mode === 'custom'`).** Every other input that influences the demand integrand reads from the correct source. Brief 59 / Brief 50 / Brief 58 closed the previously-broken cases.

---

## §2 Bug pinpoint

### §2.1 Primary bug location

**`instantCalc.js:4368`** — `_calculateState3` calls `_calculateState2(building, constructions, libraryData, weatherData, hourlySolar, comfortBand)` with NO `opts.setpointOverride`. Therefore `effectiveLowerC = comfortBand.lower_c` and `effectiveUpperC = comfortBand.upper_c` at L2371-2376, regardless of what `building.systems_config_v40.{heating,cooling}_setpoint_c` is set to.

### §2.2 Why this produces the on-screen contradiction

`_computeHeatingOrCooling` at `systemsEngine.js:250-273` correctly resolves the v40 setpoint and calls the `state2Recompute` closure (`instantCalc.js:4378`) to get a NEW State 2 result at the v40 setpoint. The recomputed `heating_demand_mwh` is used for the per-system `demand_at_this_setpoint_mwh` and as the input to `delivered_mwh` (= demand-at-setpoint × share).

But the recomputed result NEVER flows back to `consumption.space_heating.demand_mwh` — which is assembled at `instantCalc.js:4747` from `heating_demand_state2_mwh` (the ORIGINAL State 2 result, comfortBand-anchored).

So: `consumption.space_heating.demand_mwh` = comfortBand demand (frozen at 245.6 on Bridgewater across the heating-setpoint sweep). `consumption.space_heating.delivered_mwh` = v40-setpoint demand (rises 245.6 → 493.5 across 21°C → 28°C). Two different State 2 results read by two different fields, no reconciliation.

### §2.3 Secondary cosmetic side-effect at L1900

`_calculateEnvelopeOnly` (State 1) returns `setpoints_used: { heating_c: comfortBand.lower_c, cooling_c: comfortBand.upper_c }` at L1900 — echoes the comfortBand even when the function was called WITH a setpointOverride (e.g. forwarded from State 2). Today this never lies because no caller passes setpointOverride to envelope-only mode; if Part 2's fix routes the override into State 2, the State-1-inside-State-2 path will also see the override, and this echo will become a mild misstatement (reports "21 °C" while State 1 actually ran at 24 °C internally).

**Disposition:** fix in the same commit as the primary fix. One-line change: `setpoints_used: { heating_c: effectiveLowerC, cooling_c: effectiveUpperC }`. Display-only, no other consumer reads this field for physics.

---

## §3 What the fix has to do (Part 2 plan — for Chris sign-off)

### §3.1 The resolution function

Mirror `systemsEngine.js _resolveSetpoint` (L105-113) at the engine entry. Resolution rule:

```js
// Per-service resolution (heating + cooling).
// mode === 'custom' AND _c is a number → use _c (override)
// otherwise → use comfortBand[lower_c | upper_c] (inherit)
function resolveSetpointForState2(building, service, comfortBand) {
  const v40 = building?.systems_config_v40
  const mode  = v40?.[`${service}_setpoint_mode`]
  const value = v40?.[`${service}_setpoint_c`]
  if (mode === 'custom' && typeof value === 'number') return value
  return service === 'heating' ? comfortBand?.lower_c : comfortBand?.upper_c
}
```

### §3.2 The wiring change

In `_calculateState3` at L4368, BEFORE the State 2 call, resolve both setpoints and pass them as `setpointOverride`:

```js
function _calculateState3(building, constructions, libraryData, weatherData, hourlySolar, comfortBand) {
  // Brief 62 Part 2 (2026-05-27): resolve v40 service setpoints (custom →
  // override, follow_comfort → inherit). Pass the resolved values as
  // setpointOverride so State 2's demand integrand reads from the SAME
  // resolved setpoint that _computeHeatingOrCooling's delivered path
  // already reads from. Fixes Brief 61 Root Cause A — demand_mwh was
  // frozen at comfortBand while delivered moved with the v40 setpoint.
  const resolvedHeating = resolveSetpointForState2(building, 'heating', comfortBand)
  const resolvedCooling = resolveSetpointForState2(building, 'cooling', comfortBand)
  const state2Result = _calculateState2(building, constructions, libraryData,
    weatherData, hourlySolar, comfortBand,
    { setpointOverride: { heating: resolvedHeating, cooling: resolvedCooling } })
  if (state2Result.state !== 2) return state2Result
  ...
}
```

### §3.3 Inherit/override preservation (the MUST-be-preserved clause from §13)

- Mode `'follow_comfort'` (default) → resolved = comfortBand.lower_c / upper_c → demand uses comfortBand, identical to today. **No-op.**
- Mode `'custom'` + numeric value → resolved = the custom value → demand uses the override. **Fixes the bug.**
- Anything else (missing mode, non-number value, etc.) → defensive fallback to comfortBand. **Safe.**

### §3.4 Why State 1 (Envelope page) stays unaffected

The dispatcher at `instantCalc.js:5858-5876`:
- `mode === 'envelope-only'` → calls `_calculateEnvelopeOnly(comfortBand)` DIRECTLY → no opts → no setpointOverride → effective = comfortBand. **Building page result independent of Systems-page setpoint.** ✓
- `mode === 'envelope-gains'` → calls `_calculateState2(comfortBand)` DIRECTLY → no opts. Same as today.
- `mode === 'full'` → `_calculateState3` — the only place the Part 2 fix lands.

The State 1 result INSIDE the State 3 path (the internal State 1 produced by `_calculateState2`'s call to `_calculateEnvelopeOnly` at L2386) DOES get the override forwarded (Rule 14 parity). This is consumed only by `state1_delta` (State 2's diagnostic vs State 1), which is fine — that delta is at the matched setpoint. It is NOT exposed back to the Building page.

### §3.5 What the fix does NOT touch

- Per-hour comfort-hour accumulation at L1491-1492 (uses `comfortBand` — correct, comfort question not setpoint).
- T_init / T_op_prev seed temperatures (uses `comfortBand.lower_c` — initial iterative guess only, doesn't affect steady-state).
- `comfort_band_used` echoes at L1699 / L1713 — those are labelled "comfort band", correct on comfortBand.
- `_calculateEnvelopeOnly` direct-from-Building-page path — independent run, no override, comfortBand only.

### §3.6 Side-effect cleanup (same commit)

`setpoints_used` echo at L1900 changes from `comfortBand.lower_c / .upper_c` to `effectiveLowerC / effectiveUpperC` so the State 1 result truthfully reports the setpoint it actually ran at.

---

## §4 Predicted Bridgewater impact (hand-calc, FIRST)

Bridgewater's current state: `heating_setpoint_mode = 'follow_comfort'` (default). With the fix landed:

- **Baseline (follow_comfort, no override):** resolved = comfortBand.lower_c = 21 °C (project's default). Demand identical to today, identical to comfortBand path. **Anchor 110.30 EUI holds by construction** — no override, no behaviour change.
- **Heating setpoint raised to 28 °C (custom):** resolved = 28 → State 2 demand integrand uses 28 → demand rises. Predicted from Brief 61 sweep numbers (where the DELIVERED path already ran at the override): demand should equal the previously-seen delivered, ≈ 493.5 MWh at heating_setpoint = 28. Fuel + EUI continue to move (they always did); the new behaviour is that **demand_mwh now moves with delivered, no contradiction**.

So gate-direction predictions:
- `consumption.space_heating.demand_mwh` rises 245.6 → ~493.5 MWh when heating_setpoint 21→28 (was frozen at 245.6).
- `consumption.space_cooling.demand_mwh` rises 69.10 → ~77.90 MWh when cooling_setpoint 24→18 (was frozen at 69.10).
- `consumption.{service}.delivered_mwh` continues to track demand (now sourced from the same resolved setpoint).
- `consumption.total.electricity_mwh`, EUI, carbon — unchanged behaviour (already moved correctly via fuel side).
- `heat_balance.annual.{losses, gains}` — NOW moves with setpoint (was frozen). This is the secondary improvement.

**No-op invariance predictions (gate items):**
- DHW demand: unchanged across setpoint sweep (correct — independent service).
- Lighting / small power: unchanged (independent).
- Anchor at follow_comfort default: 110.30 EUI exactly held.

---

## §5 Scope confirmation — Chris's sign-off needed

**The wrong-source fault affects exactly:**
- `building.systems_config_v40.heating_setpoint_c` (when `heating_setpoint_mode === 'custom'`)
- `building.systems_config_v40.cooling_setpoint_c` (when `cooling_setpoint_mode === 'custom'`)

**No other input** the State 2 demand integrand reads is from a stale source. The Brief 61 PASS list (vent flow, SFP, HRE, efficiencies, lighting/SP coupling, DHW basis, dhw_load_shape) is consistent with this: those inputs propagate correctly because their reads were closed by earlier briefs (Brief 50 P6, Brief 53 P2, Brief 59 P1, Brief 60 A, Brief 58 C).

**Plus one cosmetic side-effect** to fix in the same commit: `setpoints_used` echo at L1900 should use `effectiveLowerC / effectiveUpperC` (display-only, no consumer reads it for physics).

---

## §6 HARD STOP — questions for Chris before Part 2

1. **Scope confirmation:** is the 2-input scope (heating + cooling setpoint, custom mode) correct? Or is there something else you'd want me to verify reads-from-the-right-source before fixing?
2. **L1900 cleanup:** OK to bundle into the same commit? (Tiny diff, same root cause family — "stale comfortBand echo when override is active".)
3. **Approach option:** the brief offered two options for the fix shape. The plan above implements **option (a)** — State 2 takes a `setpointOverride` argument (already does; I just pass it from `_calculateState3`). Option (b) — promote the v40-recomputed result to be canonical — would touch more sites. Recommendation: **(a)**, smaller diff, mirrors how Brief 50 P6 / Brief 59 P1 closed similar issues. Confirm or pick (b)?
