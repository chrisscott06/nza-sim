# Brief 48 §5 — Per-intervention breakdown data audit (read-only)

**Brief:** `docs/briefs/active/48_intervention_breakdown_viewer.md`
**Date:** 2026-05-25
**Author:** Claude Code
**Status:** READ-ONLY — no code changes. Establishes whether the engine already computes the quantities Brief 48's audit-trail panel needs, so the brief's premise ("surface, don't recompute") can be evaluated.

---

## Method

Walked the engine's intervention pass end-to-end:
1. `frontend/src/utils/interventionsEngine.js` — `runInterventionStack`, `computeDelta`, `_serviceDelta`, `_envelopeDelta`.
2. `frontend/src/utils/instantCalc.js` — `_calculateState2`, `_calculateState3` and specifically the consumption-block emission at line ~4338 onwards.

For each quantity Brief 48's UX section calls out, classified as:
- **AR — Already Retained**: directly on every intervention's `result` object and / or in `marginal_delta` / `cumulative_delta`.
- **CR — Computed and Retained derivably**: not a single named field, but trivially derivable (e.g. `raw − offset = post-MVHR`) from fields that ARE retained.
- **CD — Computed and Discarded**: live in a local variable inside the engine pass but not attached to the result.
- **NC — Not Computed at all**.

The escalation rule per the brief: NC for post-MVHR-per-intervention OR for the "vs state above me" framing → STOP and escalate.

---

## §1 — Framings (the two views the panel must offer)

Brief 48 wants every metric in two framings: vs the unedited project baseline AND vs the cumulative state above this intervention in the stack.

| Framing | Where it lives | Status |
|---|---|---|
| **Vs project baseline** (cumulative) | `stackResult.interventions[i].cumulative_delta` — `computeDelta(rollingResults[0], rollingResults[myIdx])` in `runInterventionStack` (interventionsEngine.js:395) | **AR** |
| **Vs state above me** (marginal) | `stackResult.interventions[i].marginal_delta` — `computeDelta(rollingResults[prevIdx], rollingResults[myIdx])` (interventionsEngine.js:394) | **AR** |

Both framings are first-class, computed by `runInterventionStack` for every intervention on every engine pass. **Escalation gate (framing): DOES NOT FIRE.**

Disabled-intervention semantics (audit §8.2 carry-over): `rowConfigIndex[i]` doesn't advance for disabled rows, so `marginal_delta` reads as zero against the previous enabled state. That's correct — the panel's "vs state above" view will read zero for disabled rows, which is right.

---

## §2 — Metrics catalogue

### §2.1 Headline (Brief 48 Level 1)

| Quantity | Where retained | Status |
|---|---|---|
| EUI (kWh/m²·yr) | `result.consumption.total.kwh_per_m2_yr` + delta records in `marginal_delta.eui_kwh_per_m2` / `cumulative_delta.eui_kwh_per_m2` | **AR** |
| Carbon (kgCO₂/m²·yr) | `result.carbon_kg_co2_per_m2` + `marginal_delta.carbon_kgco2_per_m2` | **AR** |
| Total delivered MWh | `result.consumption.total.electricity_mwh + .gas_mwh` (sum) + `marginal_delta.total_delivered_mwh` | **AR** |

### §2.2 Demand-side (the boundary discipline)

This is the heart of Brief 48 — the boundaries Brief 44 made discipline must be visible to the user. Each row of the panel's audit trail.

| Quantity | Plain-language label | Where retained | Status |
|---|---|---|---|
| **Raw heating demand** (pre-MVHR, State 2 zone demand) | "Heat the building needs" | `result.consumption.space_heating.demand_mwh` (instantCalc.js:4341 — emits `heating_demand_state2_mwh`, which IS the raw State 2 value pre-recovery) | **AR** |
| **MVHR recovery credit** | "Heat recovered by MVHR" | `result.consumption.space_heating.recovery_offset_mwh` (instantCalc.js:4350) | **AR** |
| **Post-MVHR heating demand** | "After heat recovery" | NOT a single named field on `result`, but trivially derivable: `space_heating.demand_mwh − space_heating.recovery_offset_mwh`. Engine internally calls this `heating_demand_mwh` (line 4131) and uses it for system sizing — see §3. | **CR** |
| **Delivered heating** | "Delivered by systems" | `result.consumption.space_heating.delivered_mwh` (instantCalc.js:4342) | **AR** |
| **Raw cooling demand** | "Cooling the building needs" | `result.consumption.space_cooling.demand_mwh` (instantCalc.js:4370 — `cooling_demand_mwh`, no recovery applied to cooling) | **AR** |
| **Post-recovery cooling demand** | n/a — same as raw (no cooling-side recovery in current engine) | Same field as raw | **AR** |
| **Delivered cooling** | "Delivered by systems" | `result.consumption.space_cooling.delivered_mwh` (instantCalc.js:4371) | **AR** |
| **DHW demand** (tap-mix corrected) | "Hot-water demand" | `result.consumption.dhw.demand_mwh` (instantCalc.js:4397) | **AR** |
| **Delivered DHW** | "Delivered by systems" | `result.consumption.dhw.delivered_mwh` (instantCalc.js:4398) | **AR** |
| **MVHR per-vent recovery** | "Per-system recovery" | `result.consumption.ventilation[i].hre_recovery_mwh` (instantCalc.js:4411) | **AR** |
| **Per-vent fan electricity** | "Fan electricity" | `result.consumption.ventilation[i].fan_electricity_mwh` (instantCalc.js:4410) | **AR** |
| **Exhaust loss per vent** | "Heat lost via exhaust" | `result.consumption.ventilation[i].exhaust_loss_mwh` (instantCalc.js:4416) | **AR** |

**Escalation gate (post-MVHR-per-intervention): DOES NOT FIRE.** The post-MVHR value is one subtraction away from two AR fields. Part 1's surfacing work will compute it once per intervention (in both framings) and attach it as a named field on `marginal_delta` / `cumulative_delta`, so the panel reads it directly instead of doing arithmetic in JSX.

### §2.3 Fuel-side

| Quantity | Where retained | Status |
|---|---|---|
| Total electricity (MWh) | `result.consumption.total.electricity_mwh` + `marginal_delta.per_fuel.electricity_mwh` | **AR** |
| Total gas (MWh) | `result.consumption.total.gas_mwh` + `marginal_delta.per_fuel.gas_mwh` | **AR** |
| Total district heat (MWh) | `result.consumption.total.district_heat_mwh` + `marginal_delta.per_fuel.district_heat_mwh` | **AR** |
| Per-service electricity (heating / cooling / DHW / vent / lighting / SP) | `result.consumption.{service}.electricity_mwh` | **AR** |
| Per-service gas (heating / cooling / DHW) | `result.consumption.{service}.gas_mwh` | **AR** |
| Heating SCOP / efficiency | `result.consumption.space_heating.scop_effective` (instantCalc.js:4347) | **AR** |
| Cooling SEER | `result.consumption.space_cooling.seer_effective` (instantCalc.js:4374) | **AR** |
| DHW efficiency | NOT a single named field. Derivable as `dhw.delivered_mwh / (dhw.electricity_mwh + dhw.gas_mwh)` from AR fields. | **CR** |
| Per-system primary / secondary split (heating / cooling) | `result.consumption.{service}.primary` + `.secondary` (instantCalc.js:4355-4366, 4378-4389) | **AR** |

### §2.4 Per-envelope (already on `cumulative_delta.per_envelope` via `_envelopeDelta`)

| Quantity | Status |
|---|---|
| Wall / roof / ground / glazing conduction losses | **AR** in `marginal_delta.per_envelope.{wall,roof,ground,glazing}_loss_mwh` |
| Infiltration loss | **AR** in `per_envelope.infiltration_loss_mwh` |
| Permanent vent loss | **AR** in `per_envelope.permanent_vent_loss_mwh` |
| Thermal bridging loss | **AR** in `per_envelope.thermal_bridge_loss_mwh` |
| Solar gain | **AR** in `per_envelope.solar_gain_mwh` |

These are pulled from the State 2 `losses_at_setpoint` block via `_envelopeDelta` (interventionsEngine.js:544). Useful for the "intervention reduced infiltration by X MWh" sub-row in the audit trail, but secondary to the main heating/delivered/fuel boundary rows.

### §2.5 What's COMPUTED-and-DISCARDED (CD) — none material to the panel

I walked `_calculateState2` and `_calculateState3` looking for boundary quantities computed in local variables but not attached to `result`. The Brief 44 era went through significant boundary-discipline work — the engine generally surfaces what it computes. Specifically:

- `heating_demand_state2_mwh` (raw) — surfaced as `demand_mwh`.
- `effective_recovery_mwh` — surfaced as `recovery_offset_mwh`.
- `heating_demand_mwh` (post-MVHR) — used for system sizing but NOT directly surfaced; CR (derivable).
- `ventResult.theoreticalRecoveryMwh` — uncapped per-system theoretical recovery. Surfaced per-system as `ventilation[i].theoretical_recovery_mwh` (instantCalc.js:4317). **AR** — useful as an "if uncapped" diagnostic for Finding C (infiltration) investigation.

No quantities Brief 48's UX section asks for are **CD** in a way that requires a retention change. The engine is in good shape.

### §2.6 What's NOT computed at all (NC)

None of Brief 48's listed quantities. The brief's UX section asks for:
- Raw demand → AR
- Post-MVHR demand → CR (one subtraction)
- Delivered per service → AR
- Electricity / gas → AR (totals + per-service)
- EUI / CO₂ → AR
- Both framings (cumulative + marginal) → AR

**Escalation gate: DOES NOT FIRE on any axis.**

---

## §3 — A note on `consumption.space_heating.demand_mwh` (raw vs post-MVHR)

There's a subtle point worth flagging because it affects the panel's clarity. The engine surfaces `consumption.space_heating.demand_mwh` as the **RAW (pre-MVHR) State 2 zone demand**, not the post-MVHR system-facing demand. Confirmation:

```js
// instantCalc.js:4131
const heating_demand_mwh = Math.max(0, heating_demand_state2_mwh - effective_recovery_mwh)
// instantCalc.js:4135 — systems sized to POST-MVHR demand
const heating_v25 = computeServiceEnergy(sys.heating, 'heating', heating_demand_mwh, resolved)
// instantCalc.js:4341 — but consumption block emits RAW
demand_mwh: r_mwh(heating_demand_state2_mwh),
```

The relationship is:
```
demand_mwh (raw)  =  delivered_mwh (post-MVHR, system-sized)  +  recovery_offset_mwh
```

For Bridgewater this means a typical reading might be:
- `demand_mwh` = 90.3 MWh (RAW — what the building needs at the zone level)
- `recovery_offset_mwh` = 26.1 MWh (MVHR recovers this)
- Post-MVHR demand = 64.2 MWh (what systems must deliver)
- `delivered_mwh` ≈ 64.2 MWh (sized to post-MVHR demand)

The panel needs to surface ALL THREE numbers (raw / recovery / post-MVHR) as distinct rows so the user sees the boundary, per Brief 44 discipline + Brief 48 §UX rule "Boundaries labelled in plain language, not engine jargon."

This also means the existing `marginal_delta.heating_demand_mwh` in `computeDelta` (interventionsEngine.js:473) reads the RAW value. Part 1's surfacing work will:
- Keep the existing field (it's the raw demand, useful as-is).
- Add a named `marginal_delta.heating_post_mvhr_demand_mwh` derived from `space_heating.demand_mwh − space_heating.recovery_offset_mwh` on each rolling result, so the panel doesn't need to do the subtraction inline.
- Add a named `marginal_delta.heating_recovery_offset_mwh` so the credit is also queryable in delta form.

This is **boundary-naming discipline** per Brief 48 Step 1.3 — no ambiguous `heat_kwh`, explicit raw / recovery / post-MVHR / delivered tier.

---

## §4 — Implication for Part 1's scope

The brief's premise — "surface, don't recompute" — is **confirmed**. The engine has the data. Part 1's actual work is:

1. **Extend `computeDelta` in `interventionsEngine.js`** to add the explicitly-named-derived fields:
   - `marginal_delta.heating_post_mvhr_demand_mwh` + `cumulative_delta.heating_post_mvhr_demand_mwh` (`raw − recovery_offset` per-state, then deltaRecord)
   - `marginal_delta.heating_recovery_offset_mwh` + `cumulative_delta.heating_recovery_offset_mwh` (direct deltaRecord on `space_heating.recovery_offset_mwh`)
   - `marginal_delta.heating_raw_demand_mwh` + alias for `heating_demand_mwh` with the explicit name (don't break the existing field; add the boundary-named version alongside)
   - Per-service `electricity_mwh` + `gas_mwh` deltas alongside the existing `delivered_mwh` + `demand_mwh` in `_serviceDelta` (currently these are only computed at the per-fuel total level, not per-service)
   - Per-service efficiency-equivalent deltas (`scop_effective` for heating, `seer_effective` for cooling) — useful for the panel's "delivered ÷ SCOP = electricity" identity reading

2. **No State 2 / State 3 changes.** Every input to the new deltaRecords is already on `result`.

3. **No physics changes.** Pure delta-extraction extensions.

Estimated diff size for Part 1: ~50 lines of additions to `computeDelta` + `_serviceDelta` in `interventionsEngine.js`. Possibly a small helper for the raw/recovery/post-MVHR triple. No other files touched in Part 1.

---

## §5 — Reconciliation checks Part 1 should add

Per the brief's Step 1.4 ("Unit-test or console-verify on Bridgewater that the surfaced numbers reconcile"). On Bridgewater clean state:

1. **MVHR identity**: `space_heating.demand_mwh − space_heating.recovery_offset_mwh ≈ space_heating.delivered_mwh` (within rounding). If not, the engine is doing something the panel isn't representing — investigate.
2. **Fuel identity per service**: `delivered_mwh / scop_effective ≈ electricity_mwh + gas_mwh` (for heating; for cooling use `seer_effective`; for DHW use derived efficiency). If a service violates this by >1%, it's a real boundary find — log to the diagnostics note and surface to Chris.
3. **Cumulative = sum of marginals**: for any metric M and any prefix of enabled interventions, `cumulative_delta.M[last] === sum(marginal_delta.M[i] for i in prefix)`. If not, that's Finding D directly — exactly what the panel is built to investigate. Part 5 will use the new panel to read this. Part 1 just needs to not BREAK the identity by introducing a derived field that doesn't sum.

These reconciliations are confirmations of engine correctness, not new physics. They're the kind of check the panel itself surfaces visually (the audit trail rows must be internally consistent).

---

## §6 — Verdict

- All data Brief 48's UX section requires is **already on the engine result** or **trivially derivable from it**.
- Both framings (cumulative vs marginal) are first-class.
- **No escalation gate fires.**
- Part 1 is a ~50-line additive change to `computeDelta` + `_serviceDelta`. No engine path, no physics, no State 2/3 changes.

The brief's premise holds. Proceeding to Part 1 on authorisation.

**Bridgewater clean anchor:** ~121.7 kWh/m²·yr at HEAD `5a135f9`. Held by construction throughout this audit (read-only). Part 1 will hold it by construction too (delta math, no physics).
