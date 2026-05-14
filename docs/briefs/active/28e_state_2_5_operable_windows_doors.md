# Brief 28e — State 2.5: operable windows + doors

**Status:** Scope captured 2026-05-14 (after Brief 28b Part 3 v1 ship). **Not yet active.** Queue order: Brief 28b (State 1 physics) → Brief 28c (State 2 contract gap on losses recompute) → **Brief 28e (this)** → State 3 (systems).

**Context:** State 2.5 covers passive operation of the envelope after Brief 28b lands State 1 physics and Brief 28c closes the State 2 contract gap. Operable windows and doors with stack/wind-driven ventilation are the State 2.5 inputs per the state contract; previously stubbed but never implemented end-to-end.

---

## Part 1 — Operable windows (per-facade, schedule-driven)

**Files:** `frontend/src/utils/wallModel.js` (or a sibling), `frontend/src/utils/instantCalc.js` State 2.5 path, `frontend/src/components/modules/operation/` (UI), `nza_engine/assemblers/openings.py` (EP side).

### Schema

Per-facade operation, not per-individual-window. Each facade `F1..F4` gets:

| Field | Type | Meaning |
|---|---|---|
| `openable_fraction` | 0..1 | Fraction of glazing area that can open. `0` = fixed glazing only (stair cores, plant rooms). |
| `schedule` | string | Profile ID — reuses existing schedule infrastructure (same shape as lighting/occupancy operation profiles). |
| `temperature_trigger` | °C | T_air threshold above which windows can open (assuming schedule says "yes"). |
| `max_open_ratio` | 0..1 | Multiplier on `openable_fraction` for max actual opening (handles "we open windows 50% of openable" etc.). |

UI: existing facade panel in Operation module gets four input groups (F1-F4), each with the four fields above plus a "linked schedule" selector.

### Physics

Per hour, per facade:
- Profile active (schedule says yes) AND `T_air > temperature_trigger` → window opens with `effective_open_area = glazing_area × openable_fraction × max_open_ratio × profile_fraction`
- Else closed.
- Stack + wind buoyancy flow per CIBSE AM10 single-sided:
  - `Q_m3s = Cd × A_eff × sqrt(2 × g × H × ΔT / T_air_K + Cw × v_wind²)`
  - `Cd = 0.61` (typical for sliding sash); `H` ≈ effective opening height ~ 1.0 m.

Adds a `UA_window_open = AIR_HEAT_CAPACITY × Q_m3s × 3600` term to the zone energy balance for the active hour, only on facades where the window is open.

### Bridgewater test config

- **F1 (bedroom main facade NE):** `openable_fraction = 0.30, schedule = "bedroom_purge_summer_24h", temperature_trigger = 24, max_open_ratio = 0.50`
- **F3 (other bedroom facade SW):** same settings as F1
- **F2, F4:** `openable_fraction = 0` (no operation)

### Expected sensitivity (validation goal)

Bridgewater's State 2 free-running T sits under 25 °C in current model → no overheat hours above 24 °C trigger → **windows enabled but never trigger** → **zero impact on demand**. This validates wiring (no crashes, no phantom flow).

The point isn't operational realism on Bridgewater — Bridgewater's actual operation has windows fixed. The point is to demonstrate the physics is wired correctly.

If Brief 28b Part 3 v2 raises the summer T trace into trigger territory, this test will start showing non-zero impact. That's fine — the binary pass is "windows fire when conditions are met; don't when they aren't".

---

## Part 2 — Doors (manual add, one-at-a-time)

**Files:** same as Part 1.

### Schema

Manually added one at a time. Duplicate-able. **No drawing input required** — user enters location + dimensions:

| Field | Type | Meaning |
|---|---|---|
| `facade` | `north | south | east | west` | Which facade |
| `width_m` | float | Door width |
| `height_m` | float | Door height |
| `operation_profile` | string | Profile ID — separate from window schedule. Reused infrastructure. |
| `open_fraction` | 0..1 | Multiplier applied on top of the active profile fraction (Option A structure from earlier scoping — open_fraction × profile). |
| `air_curtain` | object | See below |

`air_curtain`:
| Field | Type | Meaning |
|---|---|---|
| `enabled` | bool | On/off |
| `effectiveness` | 0..1 | Fraction of door air exchange the curtain blocks |
| `power_kW` | float | Continuous draw while curtain is on |

### Physics

Stack-dominated single-sided flow (door height is significant, dominates):
- `Q_m3s_door = Cd × A_door × sqrt(2 × g × H_door × ΔT / T_air_K)` (with small wind term added)
- `A_door_effective = width × height × open_fraction × profile_active_fraction`
- `Q_through_door = Q_m3s × (1 − air_curtain_effectiveness)` if curtain on, else `Q_m3s × 1`
- Adds to zone energy balance the same way as window flow but typically larger Q.

Air curtain electricity: `kWh_curtain_annual = power_kW × Σ_hours_door_in_operation`. Reported as a separate line item under operation electricity (not heating/cooling).

### Bridgewater test config

Main entrance door, F3 (south/SW), 2.0 m × 2.4 m:

| Scenario | open_fraction | air_curtain.enabled | Notes |
|---|---:|---|---|
| Baseline | 0.05 | false | "Door cracked open 5% of operating hours" |
| Sensitivity A | 0.10 | false | "Door open 10%" — should be roughly 2× baseline impact |
| Sensitivity B | 0.10 | true (60% eff) | "Open 10% with air curtain" — should be ~40% of Sensitivity A impact |
| Profile sensitivity | 0.05 | false | Operation profile change: overnight closure (00:00–08:00 zero) vs 24/7. Should reduce annual flow by night fraction. |

### Expected sensitivity (validation goal)

- **5% open baseline:** small but non-zero increase in `fabric_leakage` line during operating hours. Validates physics.
- **10% open:** roughly double the 5% impact. Validates linearity.
- **Air curtain 60%:** roughly 40% of door-only impact. Validates air curtain math.
- **Profile change (overnight closure vs 24/7):** annual flow reduced by night-fraction. Validates profile integration.
- **Air curtain electricity:** `kWh = power_kW × active_hours`. Reported as separate line item (NOT lumped into space-heating or cooling).

Each scenario hand-calced against the validation spreadsheet. Sensitivity tests pass binary.

---

## Implementation gates

Brief 28e gates on:
- Brief 28b State 1 physics validated (mass model + solar redistribution)
- Brief 28c State 2 contract gap closed (losses recompute on State 2 T_op trace)

Without these, the test sensitivity for State 2.5 won't be informative (the underlying T trace + loss math is still in flux).

## Validation discipline

Every Brief 28e fix follows the same protocol as Brief 28b:

1. Hand-calc validation against the spreadsheet for each scenario
2. After each part, re-run Static vs Dynamic comparison
3. Document each part's impact on the comparison table — which rows now pass, which still fail
4. Live UI walkthrough check that nothing else regressed
5. Sensitivity tests (A1 double length, A2 rotate 90°, plus new windows + doors tests) re-run after each part — break-the-building behaviour must still hold

---

## What's deliberately out of scope

- Per-individual-window operation (only per-facade)
- Drawn door positioning (no graphical input — just facade + dimensions)
- Door auto-close logic (open_fraction × profile is the entire model)
- Dynamic air curtain modulation (just on/off at fixed effectiveness)
- Mechanical extract during door operation (that's State 3)

---

## File pointers (for action time)

- `frontend/src/utils/wallModel.js` (or sibling) — extend with `windowOpenFlow()` and `doorFlow()` helpers
- `frontend/src/utils/instantCalc.js::_calculateEnvelopeGainsOperation` — new function for State 2.5 path; current code routes 'envelope-gains-operation' through `_calculateState2` fallback per Brief 28a Part 8 detectProjectState
- `frontend/src/utils/stateMode.js::FORBIDDEN_ENVELOPE_GAINS_INPUTS` — drop `openings.schedule` and `openings.{face}.openable_fraction` from the forbidden list when State 2.5 path lands (currently they're forbidden for State 2)
- `frontend/src/components/modules/operation/` — UI for the per-facade window operation + door list
- `nza_engine/assemblers/openings.py` — EP side: `ZoneVentilation:WindAndStackOpenArea` objects for windows; same for doors with their own profile
- `docs/state_contracts.md` § State 2.5 — fill in the contract spec for inputs_used + outputs

## Commit message template

"Brief 28e Part 1: per-facade operable windows" / "Brief 28e Part 2: doors with air curtain" / "Brief 28e Part 3: State 2.5 validation"
