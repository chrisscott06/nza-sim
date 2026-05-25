# Brief 49 — MVHR recovery boundary diagnosis

**Brief:** [`docs/briefs/active/49_mvhr_recovery_boundary_diagnostic.md`](../briefs/active/49_mvhr_recovery_boundary_diagnostic.md)
**Status:** Diagnosis complete. HARD STOP. No fixes applied.
**Date:** 2026-05-25
**Bridgewater anchor:** ~121.9 kWh/m²·yr (unchanged — investigation is read-only on code)

This document delivers what the brief asks for: (1) the end-to-end trace of `recovery_offset_mwh` and the heating-fuel path with boundaries named, (2) the reconciliation arithmetic, (3) a verdict on which of Hypotheses 1/2/3 explains Finding E.2, (4) a plausibility check on the 61 MWh recovery magnitude, (5) recommended fix direction (not implemented), (6) falsifiability target for the future fix brief.

---

## §1 — The observation under investigation (Finding E.2)

| | MVHR ON | MVHR OFF | Δ |
|---|---|---|---|
| `consumption.space_heating.demand_mwh`    | 90.3 MWh | 90.3 MWh | 0 |
| `consumption.space_heating.delivered_mwh` | 28.9 MWh | 90.3 MWh | +61.4 |
| Implied recovery (display side)            | ≈ 61.4 MWh | 0 | -61.4 |
| Total electricity                         | ~284 MWh | 283.9 MWh | ~0 |
| EUI                                       | 121.9 kWh/m²·yr | 121.9 kWh/m²·yr | ~0 |

**Expected Δ in heating electricity** at SCOP ~2.8: `Δdelivered / SCOP` = 61.4 / 2.8 ≈ **22 MWh**. Observed total electricity Δ ≈ **0 MWh**. The brief's framing: the two accounting paths look decoupled.

---

## §2 — Boundary glossary (Brief 44 discipline)

Names used throughout this document, each tied to its computation site.

| Boundary | Symbol used here | Engine variable | Where computed | Numerical example (MVHR ON) |
|----------|-----------------|-----------------|----------------|-----------------------------|
| State 2 RAW zone demand at comfort, **pre-MVHR** | `D_raw` | `heating_demand_state2_mwh` | `instantCalc.js` line 4041, sourced from `state2Result.demand.heating_demand_mwh` | 90.3 MWh |
| MVHR effective recovery (per-hour-capped, annual sum) | `R_eff` | `ventResult.effectiveRecoveryMwh` → `effective_recovery_mwh` | `computeVentilationEnergy` line 3960-3963 (per-hour cap inside `computeVentilationEnergy`), summed line 3976; surfaced at `instantCalc.js` line 4130 | 61.4 MWh |
| Post-recovery zone demand (= raw − recovery, floored at 0) | `D_post` | `heating_demand_mwh` | `instantCalc.js` line 4131: `Math.max(0, heating_demand_state2_mwh - effective_recovery_mwh)` | 28.9 MWh |
| Per-system delivered (= D_post × share) | `delivered_sys` | line 307 of `systemsEngine.js` (v40 path) or line 3661 of `instantCalc.js` (v25 path) | `delivered_mwh = demand_at_service_setpoint_mwh × share` (v40) or `delivered = demand_mwh × pct/100` (v25) | 28.9 MWh × 1.0 = 28.9 MWh |
| Per-system fuel (= delivered_sys / efficiency) | `fuel_sys` | line 308 of `systemsEngine.js` (v40) or line 3662 of `instantCalc.js` (v25) | `source_energy_mwh = delivered_mwh / eff` (v40) or `fuel = delivered / rec.efficiency` (v25) | 28.9 / 2.8 ≈ 10.3 MWh |
| MVHR fan electricity | `E_fan_mvhr` | `vs.fan_kwh` per system | `computeVentilationEnergy` line 3930: `fan_kwh = (flow_l_s × sfp × hours_active) / 1000`. **Zeroed when `vs.enabled === false`** at line 3920-3927. | (unknown, see §5) |

---

## §3 — The end-to-end trace of `recovery_offset_mwh`

### §3.1 Where it is computed

`computeVentilationEnergy` in `instantCalc.js` lines 3873–3985.

**For each enabled ventilation system** (line 3939 onwards):
```js
if (vs.hre > 0) {
  const flow_m3s        = vs.flow_l_s / 1000
  const schedule_factor = hours_active / 8760
  // Per-hour cap: each heating-degree hour, recovery ≤ heating demand that hour
  for (let h = 0; h < n; h++) {
    const dT = T_setpoint_c - weatherData.temperature[h]
    if (dT > 0) {
      const theoretical_h_Wh = flow_m3s × AIR_HC × vs.hre × dT × schedule_factor
      const demand_h_Wh      = heatingDemandHourlyKwh[h] × 1000
      effective_Wh += Math.min(theoretical_h_Wh, demand_h_Wh)
    }
  }
}
```

The recovery is therefore scoped against the **ventilation airstream's** physical heat content (`flow × HC × HRE × ΔT`), and capped per-hour at the heating demand that hour. **It is not scoped against total heating demand directly** — though the per-hour cap means it can't exceed total demand cumulatively.

Summed across systems → `totalEffectiveRecoveryMwh` (line 3976) → `ventResult.effectiveRecoveryMwh` (line 3983) → `effective_recovery_mwh` (line 4130).

### §3.2 Where it feeds heating demand

`instantCalc.js` line 4131:
```js
const heating_demand_mwh = Math.max(0, heating_demand_state2_mwh - effective_recovery_mwh)
```

So `D_post = max(0, D_raw − R_eff)`. The variable `heating_demand_mwh` is the **post-MVHR** zone demand that the systems-energy calculation uses as its input.

### §3.3 Where it feeds the display denominator

`instantCalc.js` line 4341:
```js
consumption: {
  space_heating: {
    demand_mwh:    r_mwh(heating_demand_state2_mwh),   // RAW (pre-MVHR)
    delivered_mwh: r_mwh(heating.total_perf.delivered_mwh),  // post-MVHR × share
```

`consumption.space_heating.demand_mwh` is set to the **RAW pre-MVHR** value. `consumption.space_heating.delivered_mwh` is what the systems delivered (computed from post-MVHR demand). The Breakdown panel reads both, which is why MVHR ON shows "28.9 / 90.3" and MVHR OFF shows "90.3 / 90.3".

**This is the intended boundary discipline.** `demand_mwh` is what the building needs without MVHR help; `delivered_mwh` is what the systems actually have to produce (after MVHR has done its job). The 61 MWh gap IS the MVHR recovery.

---

## §4 — The fuel path: three places to check

There are three places in the codebase where heating electricity / gas could be computed. The brief's Hypothesis 2 (fuel uses raw demand) would surface as a `D_raw / SCOP` somewhere instead of `D_post / SCOP` (= `delivered / SCOP`).

### §4.1 v25 path — `computeServiceEnergy` (`instantCalc.js` lines 3643–3674)

```js
function computeServiceEnergy(serviceCfg, service, demand_mwh, resolved) {
  // ...
  const attribute = (rec, pct, role) => {
    if (!rec) return
    const delivered = demand_mwh × pct / 100
    const fuel      = rec.efficiency > 0 ? delivered / rec.efficiency : 0
    // ...
  }
}
```

Called at line 4135: `computeServiceEnergy(sys.heating, 'heating', heating_demand_mwh, resolved)` where `heating_demand_mwh = D_post`.

**Verdict:** `fuel = (D_post × share) / efficiency`. Tracks post-MVHR delivered. Δfuel with MVHR toggle ≈ Δ(D_post) / SCOP ≈ R_eff / SCOP ≈ **22 MWh expected**. No `D_raw / SCOP` anywhere. **Hypothesis 2 NOT present in v25 path.**

### §4.2 v40 path — `_computeHeatingOrCooling` (`systemsEngine.js` lines 246–356)

```js
const heatingDemandMwh = (typeof heatingDemandOverrideMwh === 'number')
                          ? heatingDemandOverrideMwh        // post-MVHR, from caller
                          : (state2Result?.demand?.heating_demand_mwh ?? 0)  // RAW fallback ⚠
// ...
const out_systems = enabledSystems.map(sys => {
  const share = Number(sys?.share_pct ?? 0) / 100
  const eff   = Number(sys?.efficiency_metric ?? 0)
  const delivered_mwh     = demand_at_service_setpoint_mwh × share
  const source_energy_mwh = eff > 0 ? delivered_mwh / eff : 0
  // ...
})
```

Called at `instantCalc.js` line 4150 with `heatingDemandOverrideMwh: heating_demand_mwh` (= `D_post`).

**Verdict:** Same shape as v25 — `source_energy_mwh = (D_post × share) / efficiency`. **Hypothesis 2 NOT present in v40 path** when called from `_calculateState3` (the State 3 path that feeds `consumption.space_heating` and therefore the Breakdown panel).

**⚠ Note on a defensive risk** (NOT the bug being investigated, but worth flagging for the future fix brief): line 736–738 falls back to `state2Result.demand.heating_demand_mwh` (the **RAW** value) when `heatingDemandOverrideMwh` is undefined. If any future caller forgets to pass the override, that caller silently gets the pre-MVHR boundary. The State 3 path always passes the override, so this fallback doesn't fire today; just a latent footgun.

### §4.3 Inline-legacy 'full' path — `calculateInstant` (`instantCalc.js` lines 4795–4900)

This is the Pattern-C third parallel implementation (per CLAUDE.md Rule 14). Used for the inline-legacy 'full' code path; not the State 3 path that feeds the Breakdown panel, but checking for completeness.

```js
const heat_recovery = hre_fraction
const vent_kWh      = AIR_HEAT_CAPACITY × vent_ach × volume × UK_HDD × 24 / 1000 × (1 - heat_recovery)
// ...
const heat_losses = total_fabric + infiltration_kWh + vent_kWh
const heating_thermal = Math.max(0, heat_losses - heat_gains × util_factor)
// ...
heating_electricity += heating_thermal × sh_prim_share / sh_eff
```

Here the MVHR recovery is folded INTO `vent_kWh` via `(1 − heat_recovery)` before `heating_thermal` is computed, so `heating_thermal` is already post-MVHR. Then `heating_electricity = heating_thermal × share / eff` — post-MVHR.

**Verdict:** Same shape — fuel tracks post-MVHR demand. **Hypothesis 2 NOT present in inline-legacy 'full' path.** (Note: this path uses a different MVHR-recovery model — `(1 − HRE)` applied to the bulk-ventilation-loss formula, not the per-hour-capped `effective_recovery_mwh` of `computeVentilationEnergy`. The two paths can drift on magnitude, but neither uses raw demand for fuel.)

### §4.4 Top-level fuel sums

`instantCalc.js` line 4234:
```js
const electricity_total_kwh =
    elec_heat_total + elec_cool_total + elec_dhw_total +
    total_fan_kwh + lighting_kwh + equipment_kwh
```

`electricity_total_kwh` includes BOTH `elec_heat_total` (heating fuel, post-MVHR) AND `total_fan_kwh` (MVHR fan electricity). These two move in **opposite directions** when MVHR is toggled (see §5).

---

## §5 — The MVHR enable/disable kill-switch

`computeVentilationEnergy` line 3919-3928:
```js
if (vs.enabled === false) {
  perSystem.push({
    id, fan_kwh: 0,
    recovery_mwh: 0,
    theoretical_recovery_mwh: 0,
    hours_active: 0,
    schedule_source: 'disabled',
  })
  continue
}
```

When a ventilation system is toggled `enabled: false` in the UI, **both** `fan_kwh` AND `recovery_mwh` are zeroed in the same code path. The two changes propagate together:

- `R_eff` → 0  (so `D_post` → `D_raw`, heating delivered ↑, heating fuel ↑)
- `total_fan_kwh` → drops by the disabled system's `fan_kwh`  (so total electricity ↓)

These are **opposite-sign contributions to total electricity**. The net change is:

```
Δ(electricity_total) = +ΔE_heat − ΔE_fan
                     = +(R_eff / SCOP) − fan_kwh_of_disabled_MVHR
```

For Bridgewater's observed `Δ(electricity_total) ≈ 0`, this implies:

```
fan_kwh_of_disabled_MVHR ≈ R_eff / SCOP ≈ 61.4 / 2.8 ≈ 22 MWh
```

**Whether the MVHR fan actually IS ~22 MWh on Bridgewater is the smoking gun.** A typical MVHR system at SFP = 1.2 W/(L/s) running 8760 hours: 22 MWh = 22,000 kWh = `flow_l_s × 1.2 × 8760 / 1000` → `flow_l_s ≈ 2,094 L/s`. That's a plausible MVHR flow rate for a building producing 90 MWh annual heating demand — not unusual.

---

## §6 — Reconciliation arithmetic

| Quantity | MVHR ON | MVHR OFF | Δ (computed) | Δ (observed) | Match? |
|----------|---------|----------|--------------|--------------|--------|
| `D_raw` (demand_mwh) | 90.3 | 90.3 | 0 | 0 | ✓ |
| `R_eff` (recovery)   | 61.4 | 0 | -61.4 | -61.4 | ✓ |
| `D_post` (=raw−R)    | 28.9 | 90.3 | +61.4 | (= delivered display) | ✓ |
| `delivered_mwh`      | 28.9 | 90.3 | +61.4 | +61.4 | ✓ |
| `heating_fuel = delivered/SCOP` | 10.3 | 32.3 | +22.0 | **needs Chris's read on `per_service.heating.electricity_mwh`** | **THE OPEN QUESTION** |
| `total_fan_kwh` | unknown | 0 | -fan_kwh | **needs Chris's read on `system_performance.ventilation.total.fan_kwh`** | **THE OPEN QUESTION** |
| `electricity_total` | ~284 | 283.9 | ~0 | ~0 | (consistent with Δheating ≈ Δfan ≈ ±22) |

**The two cells marked "OPEN QUESTION" are decisive.** If Chris reads them off the Brief 48 Breakdown panel:

| Reading | Implication |
|---------|-------------|
| `per_service.heating.electricity_mwh` Δ ≈ **22 MWh** AND `system_performance.ventilation.total.fan_kwh` ≈ **22 MWh** | **HYPOTHESIS 1.** Code is correct; total-elec stability is coincident cancellation of fan power against heating savings. The display side IS correct (the 61 MWh recovery is real). The user is misled by reading total electricity alone — but the per-service breakdown reconciles. Fix is UX/communication, not engine. |
| `per_service.heating.electricity_mwh` Δ ≈ **0 MWh** (i.e. flat, not 22) | **HYPOTHESIS 2.** Code paths I've traced do not produce this, so there's a fourth fuel path I haven't found OR a stale-state issue OR a different toggle behaviour than `enabled: false`. Need to keep digging. Escalation. |
| `per_service.heating.electricity_mwh` Δ ≈ **22 MWh** AND `system_performance.ventilation.total.fan_kwh` ≈ **0 or much smaller than 22** | **MIXED.** Heating side correct (Hypothesis 1 confirmed for heating), but the fan-cancellation explanation for the flat total fails. Δ(electricity_total) would NOT actually be ~0 — Chris should re-read total elec, EUI Δ may have been hidden by display rounding. |

---

## §7 — Verdict

### §7.1 What the code trace proves

**Hypothesis 2 (fuel path uses raw demand) is NOT supported by the code in any of the three heating-fuel paths** (`computeServiceEnergy` v25, `_computeHeatingOrCooling` v40, inline-legacy `calculateInstant`). All three compute `fuel = delivered / efficiency` where `delivered` derives from `D_post` (the post-MVHR demand). The v25 and v40 paths are the ones feeding `consumption.space_heating.electricity_mwh` and `consumption.space_heating.delivered_mwh` — the values Chris reads in the Breakdown panel.

### §7.2 What the code trace strongly suggests (but doesn't fully prove without live data)

**Hypothesis 1 (display correct, fuel correct, total-electricity stability is coincident cancellation)** is the most likely explanation, because:
- The fuel path provably computes from post-MVHR demand.
- `computeVentilationEnergy` zeroes BOTH `fan_kwh` AND `recovery_mwh` together when MVHR is `enabled: false` (line 3919-3928).
- The arithmetic `+ΔE_heat = +22 MWh, -ΔE_fan = -fan_kwh_mvhr` gives net ~0 when `fan_kwh_mvhr ≈ 22 MWh`, which is plausible for a typical MVHR at SFP 1.2 W/(L/s) and ~2,100 L/s flow.

### §7.3 What the code trace doesn't tell us

The cancellation arithmetic ONLY holds if `fan_kwh_mvhr ≈ R_eff / SCOP`. There's no architectural reason for these to be equal — it's a coincidence of system sizing, not a bug or a design intent. **On a different building (different SCOP, different ventilation flow, different recovery effectiveness), Δ(electricity_total) would not be flat.** Chris should re-run the toggle on a second project to confirm.

### §7.4 Hypothesis 3 plausibility check

`R_eff = 61.4 MWh` on Bridgewater with `D_raw = 90.3 MWh` means MVHR is recovering **68 %** of total heating demand. For that to be physical, the ventilation heat loss component of the State 2 envelope balance must be at least `R_eff / HRE = 61.4 / 0.85 ≈ 72 MWh` — i.e. **80 % of total heating demand must come from the ventilation airstream alone**. That's unusually high; typical UK well-insulated buildings have ventilation loss at 30–50 % of total. For Bridgewater specifically (hotel, MVHR-equipped) it's defensible if the building is very well insulated and ventilation is the dominant remaining loss — but it's worth verifying.

**Recommended check (Chris, in the panel):** read the State 2 heat-balance ventilation loss component. If it's much lower than 72 MWh, the recovery is overstated against a too-large base → Hypothesis 3 (the per-hour cap allows recovery to claim back more than the airstream physically carries because the cap is set at hourly heating-demand, not at hourly ventilation-loss). That'd be a separate engine fix.

### §7.5 Why we can't fully decide here

Three numbers from the live Breakdown panel on Bridgewater would close the diagnosis:
1. `per_service.heating.electricity_mwh` Δ between MVHR ON and OFF.
2. `system_performance.ventilation.total.fan_kwh` in MVHR ON state.
3. State 2 ventilation heat loss component (for §7.4 plausibility).

The Brief 48 panel surfaces (1) directly (as "Heating electricity" row in the Fuel section); (2) needs reading off the Systems Sankey or Live Results since the Breakdown panel doesn't carry fan electricity yet; (3) is in the heat-balance view in the Building module.

**AI cannot drive the browser.** This brief stops at the code trace + the framing of the decisive numbers, per the diagnosis-before-fix discipline.

---

## §8 — Recommended fix direction (NOT implemented — Brief 49 is diagnosis-only)

### §8.1 If Hypothesis 1 confirmed

**No engine fix needed.** The display and fuel are both correct. The UX issue is that total-electricity stability misleads the user into thinking MVHR has no impact. Fix is in presentation:

- **Breakdown panel:** add a single row to the chain narrative that decomposes the net total-electricity change into the two opposing components. E.g. an info-tooltip on the "Heat recovered by MVHR" row saying *"This saves ~22 MWh of heating fuel, but the MVHR fans also consume ~22 MWh of electricity to deliver this. Net total-electricity change ≈ 0 — but the underlying heat flows are very different."*
- **Systems Sankey / Live Results:** ensure fan electricity is broken out from total electricity at the headline level so the user sees it separately.

Files most likely touched: `frontend/src/components/modules/interventions/visualiser/BreakdownPanel.jsx`, `frontend/src/components/modules/systems/SystemsSankey.jsx`. **No engine code changes.**

### §8.2 If Hypothesis 2 surfaces (heating electricity Δ ≈ 0, not 22)

There's a fuel-path I haven't found. Re-investigate with live engine instrumentation — pin `result` to `window.__lastEngineResult` and walk through it. Look especially at:
- The `system_performance.heating.total.fuel_mwh` value vs `(consumption.space_heating.electricity_mwh + gas_mwh)` — these must reconcile.
- Whether the Interventions module's `interventionsEngine.js` re-derives fuel anywhere that bypasses the State 3 path.

Files most likely touched (if a bug surfaces): `frontend/src/utils/instantCalc.js` (lines 3643-3674 + 4131-4154), `frontend/src/utils/systemsEngine.js` (lines 246-356). Engine code change with the boundary-alignment discipline of Brief 44 Part 2.

### §8.3 If Hypothesis 3 surfaces (recovery overstated vs ventilation loss budget)

The per-hour cap in `computeVentilationEnergy` (line 3960: `Math.min(theoretical_h_Wh, demand_h_Wh)`) caps recovery against heating demand, NOT against ventilation airstream heat content. If `theoretical_h_Wh > ventilation_loss_h_Wh` (e.g. high HRE and high ΔT but low ventilation flow capped by physics), the cap doesn't catch this overstate.

Fix direction: add a second cap on the per-hour recovery — `min(theoretical_h_Wh, demand_h_Wh, ventilation_airstream_loss_h_Wh)`. Files: `frontend/src/utils/instantCalc.js` lines 3950-3963.

---

## §9 — Falsifiability target for the future fix brief

After the fix lands (whichever hypothesis turned out to be the broken side), the following must hold on Bridgewater clean:

1. **Toggling MVHR `enabled: false` raises `per_service.heating.electricity_mwh` by approximately `R_eff / SCOP_heating`** (currently ≈ 22 MWh expected).
2. **The Breakdown panel's "Total electricity" row Δ equals the algebraic sum of the per-service `electricity_mwh` Δs** (no silent terms).
3. **If Hypothesis 1 is the answer, no engine change should perturb numbers; only UX copy/decomposition changes** — Bridgewater anchor still ~121.9.
4. **If Hypothesis 2 or 3, after the fix:** `recovery_offset_mwh × SCOP` should equal the heating-fuel saving exactly, AND `R_eff ≤ ventilation_airstream_loss × HRE` per hour.

The Brief 48 BreakdownPanel is the verification instrument — toggle MVHR, read the per-row Δs, all three quantities reconcile.

---

## §10 — What is NOT being changed in this brief

Per Brief 49 "What MUST NOT happen":
- No engine code touched (read-only investigation).
- No defensive patches (the v40 fallback to raw demand at line 736-738 of `systemsEngine.js` is flagged in §4.2 but left as-is — it's a latent risk, not the bug under investigation).
- No "while I'm here" UX changes to the Breakdown panel.
- No hypothesis pre-committed despite Brief 44 precedent — the trace independently shows Hypothesis 2 is NOT present in any current fuel path.
- No Bridgewater anchor movement — no engine surface touched.

---

## §11 — Live engine numbers (Node harness — added after the initial static trace)

Chris's follow-up: "Don't wait on me for browser readings — get them yourself by running the engine directly." Built `scripts/_brief49_mvhr_boundary_diagnostic.mjs` to call `calculateInstant` from Node, load Bridgewater via the running FastAPI backend, and run the engine three times: MVHR fully on, MVHR fully removed (system + fan + recovery), HRE=0 only (system + fan kept, recovery off). The Node harness writes its raw output to `docs/audit/_brief49_diagnostic_run.json`. All numbers below are from that run, not from a browser session.

### §11.1 Hand-calc reference (Chris's real MVHR system values)

- SFP = 1.40 W/(L/s), flow = 1425 L/s, HRE = 0.75 declared on the v40 entry (the v25 entry has HRE = 0.80 — a stale mismatch flagged in §11.5)
- Continuous fan = 1.40 × 1425 × 8760 / 1e6 = **17.48 MWh / yr**
- Degree-day recovery ceiling ≈ 67 MWh (Chris's hand-calc)

### §11.2 Three engine runs on clean Bridgewater

| Quantity | State A — MVHR ON (baseline) | State B — MVHR fully removed | State C — HRE=0 only (system + fan kept) |
|---|---:|---:|---:|
| `consumption.space_heating.demand_mwh` (RAW) | 90.30 | 71.70 | **175.90** |
| `consumption.space_heating.delivered_mwh` | 28.88 | 71.70 | 175.90 |
| `consumption.space_heating.recovery_offset_mwh` | 61.42 | 0 | 0 |
| `consumption.space_heating.electricity_mwh` (heating fuel) | **12.17** | **30.22** | 74.13 |
| `system_performance.ventilation.total.fan_kwh / 1000` | 25.95 | 8.47 | 25.95 |
| `system_performance.ventilation.total.recovery_mwh` | 61.42 | 0 | 0 |
| `energy_use.totals.electricity_kwh / 1000` | 284.00 | 287.57 | 337.13 |
| `energy_use.totals.eui_kwh_per_m2` | **121.90** ✓ anchor held | 122.70 | 134.20 |

State A's EUI 121.90 = Bridgewater clean anchor. ✓ Read-only investigation did not move the engine.

### §11.3 Δ analysis (State B − State A — true MVHR toggle)

- Δ heating delivered    = **+42.82 MWh**     (expect ≈ +recovery if H1 in isolation; observed less because raw demand also dropped 18.60)
- Δ heating electricity  = **+18.05 MWh**     (matches recovery_offset / SCOP_ASHP ≈ 61.42 / 3.4 ≈ 18.06 to <0.1 MWh — perfect)
- Δ fan electricity      = **−17.48 MWh**     (matches hand-calc 17.48 to 0.00 MWh — perfect)
- Δ total electricity    = **+3.57 MWh**       (= +18.05 − 17.48 + small residual from secondary effects)
- Δ EUI                  = **+0.80 kWh/m²·yr** (not flat — engine output is visible when toggle is true)

**H1's mechanism (heating fuel rises ~recovery/SCOP, fan electricity falls by the MVHR fan's annual draw) is precisely confirmed. The fan-vs-heat cancellation is real.**

The +3.57 MWh residual in total electricity, +0.80 EUI shift, is small enough that the live UI's 1-dp rounded EUI display would show as `122` vs `122` — i.e. visually flat — explaining Chris's observation of EUI 121.9 in both states.

### §11.4 H2 falsification (re-confirmed under live engine)

The static trace ruled H2 out by reading the three fuel paths. The live engine numbers re-confirm it:
- Heating electricity changed by **+18.05 MWh ≠ 0**, so the fuel path IS crediting the recovery; if H2 were live (fuel computed from raw demand), Δ would be ≈ 0.
- The change matches the recovery / SCOP arithmetic to within rounding.

H2 is dead. Move on.

### §11.5 The deeper finding — H3 confirmed, but as DOUBLE-COUNTING, not raw-magnitude overstatement

State C is the diagnostic instrument. By holding the MVHR airflow + fan constant (system enabled, HRE=0), it isolates **what the engine thinks the building would need without recovery**.

| Hand-calc against the engine | Value |
|---|---:|
| Total MVHR airstream heat content (full vent loss, no recovery) — from State C raw vs State B raw | 175.90 − 71.70 = **104.20 MWh** |
| Physical recovery ceiling at HRE=0.8 (Brief 49 §7.4 formula) | 104.20 × 0.8 = **83.36 MWh** |
| Engine's `effective_recovery_mwh` (State A) | 61.42 MWh ← under physical ceiling, OK on its own |
| State 2 vent-loss reduction from `(1 − HRE)` factor: State C raw − State A raw | 175.90 − 90.30 = **85.60 MWh** ← State 2 already claims most of the recoverable heat |
| **Total apparent MVHR savings to the user** (vs State C) | 85.60 + 61.42 = **147.02 MWh** |
| **Physical airstream maximum** (≤ full airstream heat content) | **104.20 MWh** |
| **Engine over-counts MVHR savings by** | 147.02 − 104.20 = **42.82 MWh / yr** |

The recovery is **counted in two places that don't compose correctly**:

1. **State 2's vent UA formula** (`instantCalc.js` line 2551):
   ```js
   AIR_HEAT_CAPACITY × Q_m3_h × (1 - v.hre) × sched_factor   // W/K
   ```
   This already reduces vent loss by the recovery fraction. With HRE=0.8, only 20 % of the ventilation airstream's heat appears as a State 2 load. That's the 85.60 MWh saved at the State-2 boundary.

2. **State 3's recovery subtraction** (`instantCalc.js` line 4131):
   ```js
   const heating_demand_mwh = Math.max(0, heating_demand_state2_mwh - effective_recovery_mwh)
   ```
   This subtracts the full HRE-weighted recovery integral (61.42 MWh, per-hour-capped at hourly heating demand) AGAIN.

Pre-Brief-49 the brief framed H3 as "recovery magnitude overstated against the ventilation budget". The actual situation is sharper: **the recovery is correctly capped per-hour at the airstream heat content, but it's being subtracted at two different layers in series.** State 2 should not apply `(1 − HRE)`, OR State 3 should not subtract `effective_recovery_mwh` — picking one and only one is the fix.

### §11.6 What this means for every MVHR building

If the engine subtracts recovery twice, then **every MVHR building's heating demand is systematically under-counted by approximately the per-hour-capped recovery integral.** On Bridgewater that's 61.42 MWh / yr (= 1.52 kWh/m²·yr of heating fuel @ ASHP SCOP 3.4 = ~14.6 kWh/m²·yr of heating delivered if computed correctly). Hypothesis 2's framing — "every MVHR building's EUI is wrong" — turns out to be true, but for a different reason than originally suspected (double-counting at the boundary, not raw-demand-instead-of-delivered in the fuel path).

Severity: **HIGH**. This is the systematic accuracy gap Brief 49's "physics-based credibility" framing called out. Heat-pump-vs-boiler comparisons on MVHR buildings are not on solid ground until this fix lands.

### §11.7 A separate finding — v25 ↔ v40 share-pct silent fallback

Discovered while debugging the harness's first run. The v40 ventilation block validates `share_pct` sums to 100 % across enabled systems (`systemsEngine.js` line 572). If you disable one MVHR via `enabled: false` without rebalancing the remaining shares, validation fails and **`computeSystemsDelivered` silently returns null for the ventilation block** (`systemsEngine.js` line 950: `if (brief40VentBlock.error) return null  // fall through to v25 to keep ventilation alive`). Engine then reads v25 ventilation instead.

Effect: a user who disables MVHR in the v40 UI thinks they've turned it off; engine actually keeps it on via v25 fallback. Recovery still applied, fan still running, demand unchanged. This is almost certainly what produced Chris's original Finding E.2 observation of "90.3 / 90.3 in both states" (raw demand unchanged because State 2 is still reading v25's enabled-MVHR via fallback).

This is a SEPARATE bug from the double-counting. Recommended fix:
- Either auto-rebalance shares when a system is disabled in the v40 UI (the simpler UX fix)
- Or make the silent fallback loud — surface an error to the user that the toggle was rejected because shares no longer sum to 100 %

Also flagged: **v25 MVHR entry has HRE = 0.80, v40 entry has 0.75.** Stale duplicate config, surfaces as a `~3 MWh / yr` drift in recovery between v25-fallback and v40-active paths (caught by the first harness run, before share rebalancing was added). Either field should be the single source of truth; the other should be deleted or auto-synced.

### §11.8 Updated verdict

**Verdict: H1 + H3 both present.**

- **H1 (display + fuel internally consistent at the engine boundary they share):** confirmed. Δ heating electricity = +18.05 ≈ recovery / SCOP. Total-electricity flatness is real fan/heat cancellation, not a fuel-path bug.
- **H2 (fuel path uses raw demand):** ruled out by both static trace AND live engine.
- **H3 (recovery double-counted across State 2 + State 3):** confirmed. State 2's `(1 − HRE)` vent UA factor + State 3's explicit `−effective_recovery_mwh` subtraction together overstate MVHR savings by ~recovery_offset_mwh per year. On Bridgewater that's 61 MWh / yr of heating demand the engine credits the building with, beyond what the airstream physically carries.

The internal consistency (H1) is why Chris's observation looked like "the panel works correctly" at the Brief 48 checkpoint — every quantity in the panel reconciles with every other quantity. It just reconciles to a wrong total.

### §11.9 Recommended fix direction (still NOT implementing)

The fix brief must pick one boundary to own the MVHR recovery, and remove it from the other:

**Option A — State 2 owns it; State 3 stops subtracting again.**
- Keep `(1 − HRE)` in `instantCalc.js` line 2551 (State 2 vent UA formula).
- Delete the subtraction at `instantCalc.js` line 4131: replace with `const heating_demand_mwh = heating_demand_state2_mwh`.
- Surface `effective_recovery_mwh` as DIAGNOSTIC ONLY (for the Breakdown panel's "Heat recovered by MVHR" row), not as a deduction from demand.
- Effect on Bridgewater: heating demand reads 90.30 MWh as both demand AND delivered (single boundary). Heating fuel rises from 12.17 to ~26.6 MWh. EUI rises ~4 kWh/m²·yr.

**Option B — State 3 owns it; State 2 uses full vent loss.**
- Remove `(1 − HRE)` from `instantCalc.js` line 2551 — vent UA becomes `AIR_HC × Q × sched_factor`.
- Keep State 3's subtraction at line 4131 as the only recovery point.
- Effect on Bridgewater: State 2 raw demand rises to ~175.90 MWh; State 3 subtracts 61.42; delivered = 114.48; heating fuel = 33.7 MWh. EUI rises ~7 kWh/m²·yr.

**Option A is the more conservative correction** (smaller numerical move from current) and matches the Brief 44 boundary discipline: State 2 represents "demand at the comfort setpoint, given the heat balance INCLUDING passive systems like MVHR"; State 3 represents "active systems consuming fuel to meet that demand". State 3 should not double-net what State 2 already netted.

Both options also need:
- Update the Breakdown panel's `recovery_offset_mwh` row label / tooltip — it's still shown as a deduction from raw demand, which after the fix is no longer how the math works.
- Decide on v25/v40 stale-HRE: delete one path or auto-sync.
- Decide on the share-pct silent fallback (rebalance or raise).

### §11.10 Falsifiability target (updated)

After the fix lands, on Bridgewater clean:

1. Toggling MVHR (any mechanism — true `enabled: false`, or HRE→0) must change `consumption.space_heating.delivered_mwh` by ≤ the airstream's physical heat content `flow × cp × ρ × HRE × dT_integral` (≈ 83 MWh ceiling for Bridgewater).
2. `consumption.space_heating.delivered_mwh − raw_demand_with_zero_HRE × (1 - HRE)` must round to zero (single boundary owns the recovery).
3. The Brief 48 BreakdownPanel "Heat recovered by MVHR" row must reconcile: `raw_demand − delivered = recovery_actually_credited`.
4. Bridgewater EUI shifts by 4–7 kWh/m²·yr (depending on Option A or B) and stabilises at the new anchor.
5. The harness `scripts/_brief49_mvhr_boundary_diagnostic.mjs` re-run must show MVHR savings ≤ 104 MWh (the airstream's heat content), not 147 MWh.

---

## §12 — HARD STOP

Diagnosis is closed. **Verdict: H1 + H3 — internal accounting consistent but recovery double-counted, ~14 kWh/m²·yr heating-fuel under-count per MVHR building.** H2 is dead. The v25/v40 silent-fallback footgun (§11.7) is recorded as a related bug for the same fix brief.

Two read-only artifacts in this brief:
- `scripts/_brief49_mvhr_boundary_diagnostic.mjs` — Node harness (re-runnable; written to be kept for the fix brief's falsifiability target #5).
- `docs/audit/_brief49_diagnostic_run.json` — the raw harness output (numbers above derived from it).

**The fix is a separate brief**, authorised once Chris reviews the verdict and picks between Option A and Option B (§11.9).
