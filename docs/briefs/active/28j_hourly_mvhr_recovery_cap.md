# Brief 28j — Hour-by-hour MVHR recovery cap

**Status:** SHIPPED 2026-05-15. Engine refactor + tests + canonical Bridgewater re-baseline captured below.

**Predecessor:** Brief 28f Part 4 (annual-aggregate cap) — superseded by this.
**Triggered by:** Chris's testing observation 2026-05-15 — MVHR "covering full heating demand" annually was hiding that real peak-winter heating still occurs. The annual model let summer-distributed theoretical recovery cancel winter-clustered demand arithmetically.

---

## The physics gap (pre-28j)

State 3's V1 MVHR recovery model (Brief 28f Part 4):

```
theoretical_recovery_mwh = flow_m3s × air_HC × HRE × ΔT_integral × schedule_factor
effective_recovery_mwh   = min(theoretical_recovery_mwh, state2_heating_demand_mwh)
heating_demand_for_systems = max(0, state2_heating_demand - effective_recovery)
```

Both terms in the `min(…)` were **annual aggregates**:

- `theoretical` integrated `(T_setpoint − T_out)` over all 8760 hours where outdoor air was cooler than the setpoint.
- `state2_heating_demand` was the annual integral of `max(0, Q_loss_at_lower − Q_gain)` over hours when `T_op < T_setpoint`.

The annual cap let recovery "earned" in spring/autumn (when there was little heating demand) offset demand in deep winter (when MVHR couldn't actually deliver more recovery than the building needed at that hour). For an over-sized MVHR on a gain-dominated building (Bridgewater post-Xmas-fix, with ~109 MWh state-2 heating demand and ~121 MWh theoretical recovery), the annual cap absorbed almost all heating demand → heating fuel = 0 MWh → "MVHR covers all heating" → wrong.

Reality: real peak-winter heating still fires. The annual aggregate hid this.

---

## The 28j fix — per-hour cap

```
for h in 0..8760:
  if vent_on(h) AND T_out(h) < T_setpoint:
    theoretical_h_Wh = flow_m3s × air_HC × HRE × max(0, T_setpoint − T_out(h)) × schedule_factor
    demand_h_Wh      = heating_demand_hourly_kwh[h] × 1000   # from State 2
    effective_h_Wh   = min(theoretical_h_Wh, demand_h_Wh)
    effective_total += effective_h_Wh
```

At each hour the recovery contributes at most the heating demand for that hour. Summer hours with no demand contribute zero (was previously double-counted in the annual cap). Winter peak hours where theoretical exceeds demand are capped per-hour (was previously available to cancel summer "credit").

The result is necessarily **≤** the old annual cap — per-hour is a strictly stricter constraint than annual aggregate. Equality only when the cap never binds at any individual hour.

---

## Engine changes

### Sub-piece 1: State 2 emits hourly demand series

`frontend/src/utils/instantCalc.js::_calculateState2`:

```js
const heating_demand_hourly_kwh = new Float32Array(n)   // 8760
const cooling_demand_hourly_kwh = new Float32Array(n)

// In the main hourly loop:
const heating_Wh = Math.max(0, Q_loss_at_lower - Q_gain_to_zone)
acc_heating_demand_Wh += heating_Wh
heating_demand_hourly_kwh[h] = heating_Wh / 1000    // NEW
```

Surfaced via `result.demand.heating_demand_hourly_kwh` / `cooling_demand_hourly_kwh`. Engine-internal data exposed to State 3 only; not for normal UI consumers. Memory: ~70 kB per simulation.

### Sub-piece 2: `computeVentilationEnergy` applies per-hour cap

New 5th parameter `heatingDemandHourlyKwh`. When supplied, the function iterates 8760 hours, applying `min(theoretical_h, demand_h)` per hour. When absent (legacy callers), falls back to theoretical-only (no cap).

Returns both `theoreticalRecoveryMwh` (uncapped annual) and `effectiveRecoveryMwh` (per-hour-capped). Per-system results carry both as `theoretical_recovery_mwh` + `recovery_mwh`.

### Sub-piece 3: `_calculateState3` removes annual cap

```js
// Before (annual cap):
const effective_recovery_mwh = Math.min(ventResult.theoreticalRecoveryMwh, heating_demand_state2_mwh)

// After (per-hour cap inside computeVentilationEnergy):
const heatingDemandHourlyKwh = state2Result.demand?.heating_demand_hourly_kwh ?? null
const ventResult = computeVentilationEnergy(..., heatingDemandHourlyKwh)
const effective_recovery_mwh = ventResult.effectiveRecoveryMwh
```

### Output shape

`system_performance.ventilation.systems[*]` now has BOTH:
- `recovery_mwh` — effective (per-hour-capped), the heating-offset value
- `theoretical_recovery_mwh` — uncapped annual integral, informational

`system_performance.ventilation.total` keeps the same shape: `recovery_mwh` (effective) + `recovery_theoretical_mwh` (uncapped).

---

## Bridgewater canonical re-baseline

Before vs after on Bridgewater (length 58.8, num_floors 5, 1450 L/s MVHR, post-Xmas-exception-fix, all v2.5 systems):

| Metric | Pre-28j (annual cap) | Post-28j (hourly cap) |
|---|---:|---:|
| State 2 heating demand | 108.8 MWh | 108.8 MWh (unchanged) |
| State 2 cooling demand | 178.0 MWh | 178.0 MWh (unchanged) |
| Theoretical MVHR recovery | 120.77 MWh | 120.77 MWh (unchanged) |
| **Effective MVHR recovery** | **108.8 MWh** (capped at state2 demand) | **60.25 MWh** (per-hour-capped) |
| **Heating fuel** | **0 MWh** | **11.44 MWh** |
| **Heating delivered** | **0 MWh** | **48.55 MWh** |
| Cooling fuel | ~varies | 49.76 MWh |
| DHW fuel | 182.90 MWh | 182.90 MWh (unchanged) |
| EUI | ~88 kWh/m² | **90.7 kWh/m²** |
| Carbon | ~16.5 kg/m² | **18.09 kg CO2e/m²** |

### Reading

- **Effective recovery -48.5 MWh**: ~half what the annual cap claimed. Summer-distributed theoretical recovery (the original integral counted ΔT_h over all hours with T_out < setpoint, including transitional months) was previously available to offset winter demand; the per-hour cap correctly zeros those contributions when there was no heating demand.
- **Heating fuel +11.44 MWh**: peak-winter heating no longer artificially cancelled. The 11.44 MWh is the residue after MVHR recovers 60.25 MWh of the 108.8 MWh annual demand — roughly half.
- **EUI +2.7, carbon +1.6**: small absolute moves but a meaningful narrative shift — the building IS using heating fuel, just less of it because MVHR offsets a real fraction.

This puts the modelled vs measured gap at:
- Modelled electricity 252 MWh, gas 124 MWh (measured 2024-25: 560 elec, 205 gas)
- Closer to reality than pre-28j but still substantial gap (calibration target for future briefs).

---

## V1 limitations (still documented)

1. **Schedule factor approximation**: per-hour cap uses `schedule_factor = hours_active / 8760` as a uniform multiplier. Strictly per-hour vs-on check requires the schedule profile to expose `is_on(h)`. For always-on systems (Bridgewater) this is exact. For profile-driven schedules it's an annual-average approximation. Tightenable when calibration shows it matters.

2. **Cooling-side recovery**: not implemented. MVHR can also do "free cooling" during summer (exhaust cool morning air to pre-cool the building before peak). Not in scope for V1 — the heating-side cap is the dominant correction.

3. **Variable HRE**: real units have part-load efficiency curves. V1 scalar HRE. Curve support is a future contract bump.

---

## Test invariants (post-28j)

Three brittle assertions in Parts 4 + 5 tests assumed the annual cap (`effective === min(theoretical, state2_demand)`). Per-hour cap makes this `<=` not `===`. Updated:

- **Part 4 invariant 3:** `effective recovery <= min(theoretical, state2 heat demand)` (was `===`)
- **Part 4 small-MVHR case:** `effective recovery <= theoretical recovery (per-hour cap is stricter)` (was `effective === theoretical`)
- **Part 5 schedule scaling:** `theoretical recovery ratio === schedule_factor` (testing the pre-cap linearity); separate `effective recovery scales monotonically with schedule_factor (<= 1)` (allows for cap binding non-linearly)

**Regression result:** 40 + 56 + 46 + 21 = **163/163 PASS**.

---

## File pointers

- Engine: `frontend/src/utils/instantCalc.js::_calculateState2` (hourly demand emission), `computeVentilationEnergy` (per-hour cap), `_calculateState3` (caller wiring)
- Tests: `scripts/state3_part2_skeleton_test.mjs` (40), `scripts/state3_part3_heating_cooling_test.mjs` (56), `scripts/state3_part4_dhw_vent_lighting_carbon_test.mjs` (46), `scripts/state3_part5_engine_inputs_test.mjs` (21)
- Seed: `scripts/seed_bridgewater_v25_systems.mjs` (canonical state; captures the post-28j outputs)
- Predecessor: `docs/briefs/active/28f_state_3_systems.md` (Part 4 annual-cap design)

---

## Next per Chris's queue

1. ✅ Brief 28j (this brief) — SHIPPED.
2. **Brief 28f Part 5.4** — Systems UI forms (replace SystemsZones.jsx legacy left-column accordions with v2.5 inputs).
3. **Brief 28e** — operable windows per-facade + ground floor doors with air curtains.

All other work (28g/28h/28i, calibration workflow) remains paused until the input-output loop is complete.
