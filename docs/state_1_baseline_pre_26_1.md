# State 1 baseline — pre-Brief 26.1

Diagnostic capture before any Brief 26.1 fixes land. This is the "before"
that subsequent parts compare against. Captured on Bridgewater (HIX
Bridgewater, project_id `14b4a5b1-8c73-4acb-8b65-1d22f05ec969`).

---

## Critical pre-Part-0 finding: latent assembler regression

Before Brief 26.1 could even take a Sim-side baseline, the State 1 EP
simulation was failing fatally on Bridgewater. Root cause:
`nza_engine/generators/epjson_assembler.py` line 914 used a raw
assignment

```python
hvac_objects["Schedule:Constant"] = dict(openings_const_schedules)
```

which overwrote the `state1_heating_setpoint` / `state1_cooling_setpoint`
`Schedule:Constant` entries added by the State 1 block just above. The
IdealLoads thermostats then referenced names that didn't exist in the
emitted epJSON → 17 severe errors → fatal exit before any output.

**Latent bug**: this overwrite has been in the codebase since the
openings brief (commit `0991990`, well before Brief 26). It only
manifests when a project carries non-zero louvre area on any facade
(which populates `openings_const_schedules`). Brief 26's test runs all
used the default-louvre Bridgewater (zero everywhere), so the overwrite
was a no-op. The user set louvres for the first time in the immediately
preceding session, surfacing the bug.

**Fix (single line)**: changed line 914 to
`hvac_objects.setdefault("Schedule:Constant", {}).update(openings_const_schedules)`
matching the pattern on line 882 in the detailed-mode branch.

This is the **first** of the two root causes behind Brief 26.1 Issues 1
and 2 (Sim view doesn't show contract output / glazing reads 0). The
second root cause is in Part 0b below.

---

## Part 0a — numerical baseline post-hotfix

`scripts/state1_engine_agreement.mjs` on HIX Bridgewater
(comfort band 21/25 — user-set narrower than contract's 20/26).

| Output | live | sim | Δ | flag |
|---|---:|---:|---:|---|
| `heating_demand_mwh` | 214.4 | 214.5 | **+0.0%** | **silent ✓** |
| `cooling_demand_mwh` | 56.8 | 45.4 | -20.1% | warn |
| `underheating_hours` | 5851 | 5256 | -10.2% | warn |
| `overheating_hours`  | 1321 | 1788 | +35.4% | HARD |
| `comfort_hours`      | 1588 | 1716 | +8.1% | soft |
| `annual_mean_c`      | 17.4 | 18.4 | +5.7% | soft |
| `winter_min_c`       | 1.9 | 7.3 | +284% | HARD |
| `summer_max_c`       | **43.0** | **34.2** | -20.5% | warn |
| `external_wall` (kWh) | 11194 | 12894 | +15.2% | warn |
| `roof` (kWh)         | 7531 | 8675 | +15.2% | warn |
| `ground_floor` (kWh) | 10354 | **11928** | +15.2% | warn |
| `glazing total` (kWh) | 56371 | **64936** | +15.2% | warn |
| `fabric_leakage` (kWh) | 39761 | 45801 | +15.2% | warn |
| `permanent_vents` (kWh) | 78345 | 96832 | +23.6% | warn |
| `solar total` (kWh)  | 200037 | 135296 | -32.4% | HARD |

**Key takeaways:**

1. **Brief 26.1 Issue 2 — glazing/floor read 0 in Sim — is resolved by
   the assembler hotfix.** Sim now reports 65 MWh glazing and 12 MWh
   ground floor. Brief 26 Part 6's parser fix was correct; it just
   wasn't getting valid SQL to read because EP wasn't producing output.

2. **Heating demand agrees to <1%** between engines — the contract
   headline number is intact and within contract bounds (150–250 MWh).

3. **Conduction line items now structurally OVER-predicted by the sim**
   (+15% across the board). This is the inverse of the Brief 26 finding
   (where sim was -11.7%). With the live engine summer max overpredicting
   (more on this below), the live calc spends more time well above outdoor
   temp than EP does, so its conduction-loss integral is lower. Both
   directions of structural error trace back to the temperature trace
   divergence; the magnitude depends on which model is closer to truth
   in any given regime.

4. **Sim `summer_max_c = 34.2°C` is physically plausible** for a UK
   hotel without cooling under TMYx Yeovilton. Within the contract
   bound (≤36°C). EP's transient mass model is doing its job.

5. **Live `summer_max_c = 43.0°C` is the contract-violating overshoot
   identified in Brief 26.1 Issue 3.** It's a live-engine bug, not a
   simulation bug. See Part 0c below for root cause analysis.

6. **Solar total disagrees by 32% (HARD)** — divergence #1 (isotropic
   vs Perez) is the documented cause. Still in the known-limitation
   category for now.

---

## Part 0b — UI data path trace

`frontend/src/hooks/useSimulationBalance.js:20`:

```js
fetch(`/api/projects/${projectId}/simulations/${runId}/balance`)
```

**Missing query param `?mode=envelope-only`.** The hook unconditionally
fetches the full-mode (State 3) balance regardless of the Building
module's State 1 context. The backend's `get_simulation_balance` endpoint
defaults to `mode='full'` if the param is absent, so:

- Building module → uses live State 1 path ✓
- Building module → uses sim **State 3 path** ✗ (should be State 1)

This is the **second** of the two root causes behind Brief 26.1 Issues 1
and 2. Even after the assembler hotfix lets EP produce SQL, the UI is
still asking the backend for the wrong shape.

`useSimulationBalance` is called from three places:

| Caller | Module | Wanted mode |
|---|---|---|
| `BuildingDefinition.jsx:787` | Building (State 1) | `envelope-only` |
| `BalanceTestPage.jsx:39` | Test page | configurable |
| `HeatBalanceTab.jsx:38` | Results (State 3) | `full` (default) |

Hook needs to accept `mode` as a parameter. Part 2 fix.

---

## Part 0c — peak summer hour energy balance

`scripts/state1_peak_summer_diagnostic.mjs` was added to replay the live
engine's hourly step and dump intermediates for the indoor-temp peak.
For Bridgewater under Yeovilton TMYx, the live engine indoor peak is
**43.04°C at month 7, day 20, hour 14** (mid-summer, mid-afternoon).

### Conditions at peak hour

| Quantity | Value |
|---|---:|
| T_out | 29.70°C |
| Wind  | 2.10 m/s |
| Indoor (live engine) | 43.04°C |
| Indoor previous hour | 42.69°C |
| Δ this step | +0.35 K |

### UA terms (Wh/K per hour)

| Term | Value |
|---|---:|
| UA_wall (opaque) | 205.6 |
| UA_roof | 138.3 |
| UA_floor | 190.2 |
| UA_glaz | 1035.3 |
| **UA_fabric total** | **1569.3** |
| UA_leakage (q50 → ach) | 730.2 |
| UA_permanent (2 m² louvres, wind 2.1 m/s) | 946.7 |
| **UA_total** | **3246.2** |

### Hour energy balance (Wh in this hour)

| Flow | Value |
|---|---:|
| Solar through south glazing | 40,203 |
| Solar through roof (5% absorbance) | 13,940 |
| Solar through north | 10,050 |
| Solar through west | 4,127 |
| Solar through east | 457 |
| **Q_solar TOTAL (gain)** | **68,776** |
| Q_cond_walls (loss, dT=13.34 K) | 2,742 |
| Q_cond_roof | 1,844 |
| Q_cond_floor | 2,536 |
| Q_cond_glazing | 13,806 |
| Q_vent_leakage | 9,738 |
| Q_vent_permanent | 12,625 |
| **Q_loss TOTAL** | **43,290** |
| **Net into zone this hour** | **+25,486** |

### C_zone (thermal mass, light category)

C_zone = 80,000 J/(K·m²) × 3,600 m² GIA / 3600 s/hr = **76,832 Wh/K**

Predicted ΔT this hour = Net / C_zone = 25,486 / 76,832 = **+0.332 K**
Measured ΔT = +0.346 K ✓

**Model is internally consistent.** Math is right; physics is too
simplified.

### Hypothesis verdict

| H | Hypothesis | Verdict |
|---|---|---|
| H1 | Opaque sol-air absorption added without release | **Ruled out** — live engine has no opaque sol-air term at all; walls contribute 0 W. Roof has 5% absorptance × incident (13.9 kWh this hour) which is small. |
| H2 | Thermal mass not coupling to air | **Confirmed (root cause)** — see H4 |
| H3 | Ventilation under-applied | **Ruled out** — q50 leakage + 2 m² louvres are both active. UA_vent / UA_total = 52% at this hour. Ventilation IS providing 22.4 kWh of cooling this hour — it's just outweighed by 68.8 kWh solar gain. |
| H4 | Solar bypasses mass, hits air directly | **Confirmed (root cause)** — `T_zone += (Q_solar - Q_loss) / C_zone` puts all 68.8 kWh of solar gain into indoor air this hour, with no surface absorption delay. |

H2 and H4 are the same root cause expressed two ways: the live engine
is a **single-capacitance lumped** model. Solar hits "the zone" as a
homogeneous blob; there's no per-surface mass with thermal lag. EP's
transient finite-difference solver naturally has per-surface mass with
conduction transfer functions through every construction layer — solar
on the south floor at noon stays in the slab for hours, releasing
slowly through the night when outdoor temps drop.

This is **catalogued divergence #2** (`docs/state_1_divergences.md`)
manifesting at a magnitude that violates the contract bound. The
divergences doc said "accept for State 1 live calc"; Brief 26.1 Part 3
asks for a quick-fix that brings the magnitude back inside the contract
without going to a full multi-node RC model.

---

## Implications for Brief 26.1 parts

| Brief item | Status given Part 0 findings |
|---|---|
| Issue 1 — Sim view shape | Two root causes (hotfix above + Part 0b). Hotfix lands here; Part 2 fixes hook. |
| Issue 2 — Glazing/floor=0 | Same as Issue 1. Resolved by hotfix + Part 2; no Part 4 parser work needed. |
| Issue 3 — Summer max 43°C | Real bug, live engine only. Part 3 addresses with quick-fix to mass coupling (likely "internal mass surcharge" — bump effective C_zone or split solar 30/70 fast/slow). |
| Issue 4 — Thermal mass derivation | Part 5 work, unchanged. |
| Engine agreement on heating | Already +0.0% silent — no work needed. |

Part 4 (parser fix) is effectively a no-op after the hotfix — already
producing correct numbers in isolation. Part 2 (UI mode threading) is
what makes those numbers reach the user.

---

## Files added in Part 0

- `docs/state_1_baseline_pre_26_1.md` (this document)
- `scripts/state1_peak_summer_diagnostic.mjs` — reusable hour-by-hour
  diagnostic for any project, prints UA, energy balance, and hypothesis
  probes for the peak-indoor hour. Will become useful again any time
  the lumped-capacitance model is revisited.
