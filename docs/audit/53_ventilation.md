# Brief 53 audit — Ventilation: bypass design + heat-balance residual hypothesis

**Brief:** [`docs/briefs/active/53_ventilation_bypass_and_heatbalance.md`](../briefs/active/53_ventilation_bypass_and_heatbalance.md)
**Status:** Part 1 deliverable. Read-only. No engine code touched.
**Anchor:** Bridgewater clean EUI 128.20 (Brief 50 close, `c64657c`).
**Purpose:** Lock the bypass trigger choice + reconciliation strategy + Bridgewater first-principles prediction BEFORE any engine code lands. Plus a hypothesis on the +10 heat-balance residual to scope Part 4.

---

## §1 — Where the per-hour recovery cap lives (confirmed, Brief 50 Probe 4 + cooling-hours probe c64657c)

`instantCalc.js` `computeVentilationEnergy`, hourly loop at **L3984–3995**:

```js
if (heatingDemandHourlyKwh && heatingDemandHourlyKwh.length === n) {
  let effective_Wh = 0
  for (let h = 0; h < n; h++) {
    const dT = T_setpoint_c - weatherData.temperature[h]
    if (dT > 0) {                                          // ← outer gate: T_out < heating setpoint
      const theoretical_h_Wh = flow_m3s * AIR_HC_J_PER_M3_K * vs.hre * dT * schedule_factor
      const demand_h_Wh      = (heatingDemandHourlyKwh[h] ?? 0) * 1000
      effective_Wh += Math.min(theoretical_h_Wh, demand_h_Wh)  // ← inner cap: per-hour heating demand
    }
  }
  effective_mwh = effective_Wh / 1_000_000
}
```

Two gates already in place, both probe-confirmed correct:

| Gate | Condition | Captures |
|---|---|---|
| Outer | `dT > 0` ⟺ `T_out < T_setpoint_heating` | Hours where the airstream physically has heat to recover from |
| Inner | `min(theoretical_h, demand_h)` | Hours where the building actually wants heat per-hour, gains-aware |

Brief 53's bypass is a THIRD gate, layered ON TOP of these (suppression, not replacement).

## §2 — Where the State 2 `(1 − HRE)` factor lives (Brief 50 Part 6)

`instantCalc.js` `_calculateState2`, vent UA projection at **L2553–2579**, used in the heat-balance hourly loop. After Brief 50 Part 6, `hre` is sourced from v40 when present:

```js
const ventSystems = (building?.systems_config_v25?.ventilation ?? []).map(v => {
  const v40Match = v40VentMap.get(v?.id)
  const hreFromV40 = v40Match
    ? Number(v40Match?.efficiency_metric?.recovery_sensible_pct ?? 0) / 100
    : null
  const hre = (hreFromV40 != null) ? hreFromV40 : Number(v.hre ?? 0)
  …
})
```

Then at ~L2582:

```js
const ventUA = ventSystems.map(v => {
  const Q_m3_h = v.flow_l_s * 3.6
  const sched_factor = v.hours / 8760
  return AIR_HEAT_CAPACITY * Q_m3_h * (1 - v.hre) * sched_factor   // ← (1−HRE) recovery credit
})
```

This `ventUA` array is consumed inside State 2's 8760-hour balance step as the per-hour ventilation loss UA. Recovery is folded into demand via the `(1 − HRE)` factor exactly once — Brief 50's single-owner architecture.

## §3 — Bypass design

### §3.1 Trigger choice — recommendation

**Use `cooling_demand_hourly_kwh[h−1] > 0` in BOTH `_calculateState2` AND `computeVentilationEnergy`. Same array slot. Same lag.**

Why this trigger:

| Candidate | Pros | Cons |
|---|---|---|
| `T_out > some_threshold` (e.g. > 16 °C) | Synchronous (no lag); cheap | Crude — ignores zone state. Bypasses on warm winter days when zone is still being heated. Wrong for real bypass-controlled units. |
| `T_zone > cooling_setpoint` (zone-temp trigger) | Captures "zone in cooling mode" | Zone temp known only AFTER the heat balance solves at hour h → chicken-and-egg with State 2's loop. Requires `T_air[h−1]` proxy (different signal from computeVentilationEnergy's cooling-demand array → reconciliation drift). |
| **`cooling_demand_hourly_kwh[h−1] > 0`** | **Mirrors the heating-side per-hour cap. Already computed in State 2 (L2628 alloc, L3067 populate, L3430 surface). Same array readable by both `_calculateState2` AND `computeVentilationEnergy`.** | **One-hour lag.** Affects only the handful of transition hours per year. |
| `cooling_demand_hourly_kwh[h] > 0` (true synchronous demand) | Most physically correct | Requires 2-pass State 2 (dry-run to compute cooling array, then real run with bypass applied). ~2× engine cost — unacceptable for the live-update loop Brief 47 / 53 rely on. |

The `[h−1]` choice is the only option that meets the **reconciliation principle** (Principle 2: same hours, same magnitude on demand side and fuel side) **without doubling engine cost.** Both `_calculateState2`'s per-hour UA computation AND `computeVentilationEnergy`'s per-hour cap read identically from `cooling_demand_hourly_kwh[h−1]`. Same signal, same lag, identical bypass hours → reconciliation tight.

**Awkwardness flagged (per Chris's design-around-it request):**

- The implementation is not a single one-liner inside `computeVentilationEnergy`. It's a two-site change with a shared signal. The "single one-liner" path would be cooling-demand only in `computeVentilationEnergy` and zone-temp proxy in State 2 — which breaks reconciliation. The shared-signal-with-lag is the cleanest reconciliation-safe path.
- For hour 0 (first hour of the simulation), `cooling_demand_hourly_kwh[−1]` is undefined. Initialise as `false` (bypass off) for hour 0; physically a non-issue (single hour out of 8760, almost certainly in winter, no cooling demand anyway).

**`computeVentilationEnergy` needs `cooling_demand_hourly_kwh` passed in.** Currently it only takes `heatingDemandHourlyKwh`. Part 2 adds `coolingDemandHourlyKwh` as a sibling parameter. Caller (`_calculateState3` at ~L4118) already has it on `state2Result.demand.cooling_demand_hourly_kwh` (L3430).

### §3.2 Reconciliation diagram

```
                                bypass_h
                                   │
              ┌────────────────────┼────────────────────┐
              │                                          │
              ▼                                          ▼
     State 2 hourly loop                  computeVentilationEnergy hourly loop
     (instantCalc.js ~L2580+)              (instantCalc.js L3984-3995)
              │                                          │
     vent_UA_h = AIR_HC × Q ×                Math.min(theoretical_h, demand_h)
     (bypass_h ? 1 : (1 − HRE)) ×            (skip when bypass_h)
     sched_factor
              │                                          │
              ▼                                          ▼
     larger vent loss in                     no recovery credit in
     bypass hours                            bypass hours
     → less heating demand                   → reported recovery is
       (or more cooling                        less than theoretical
       potential)                              (consistent with
                                               State 2 picture)

  Both sides honour SAME hours (cooling_demand_hourly_kwh[h−1] > 0)
  → Demand-side recovery and fuel-side recovery match within rounding.
```

**Anti-pattern to avoid (Brief 50 redux):**
> Touching only `computeVentilationEnergy`'s cap (suppressing reported recovery) without also flipping `(1 − HRE)` → 1 in the State 2 UA in the same hours reintroduces the exact decoupling Brief 50 fixed. State 2 would report demand assuming MVHR is still recovering; system fuel would assume it isn't.

Part 2's grep-confirmation: every bypass-true hour h shall have BOTH `(a) ventUA[h] = full ventUA without (1−HRE)` AND `(b) effective recovery accruing 0 in that hour`. Same hour. Same magnitude.

### §3.3 Default — bypass OFF

Default OFF preserves the 128.20 anchor. Bypass is an opt-in modelling choice; a real building may or may not have a working bypass damper. Bypass-on becomes a deliberate user decision, surfaced in the system editor, with engine confirming the EUI shift from first principles (§4).

## §4 — First-principles prediction: bypass-on effect on Bridgewater

### §4.1 Bridgewater clean baseline (no MVHR-bedrooms intervention)

Post-Brief-50 anchor:
- Cooling demand: small (<5 MWh on Bridgewater clean per the original Sankey screenshot, ~4.8 MWh on refbox COLD)
- MVHR recovery: ~63 MWh (effective_recovery_mwh)
- Most cooling-demand hours occur in summer when `T_out > T_heating_setpoint` → outer `dT > 0` gate ALREADY zeros recovery in those hours

**Prediction:** bypass-on EUI shift on Bridgewater clean is **near-zero (probably < 0.3 kWh/m²·yr)** because the outer gate already suppresses recovery in most cooling-demand hours. The interesting hours are SHOULDER-SEASON ones where `T_out < setpoint` (outer gate passes, some recovery accrues) AND zone has cooling demand (gains pushed it above cooling setpoint). Few such hours on Bridgewater clean.

### §4.2 Bridgewater + bedrooms-MVHR intervention (the walkthrough scenario)

Chris's walkthrough showed reorder behaviour: "MVHR Bedrooms: heat recovered drops 63.2 → 24.4 while cooling rises +83.9". The bedrooms zone has high gains; adding MVHR there:
- Slightly raises heating demand (the per-hour cap is firing in many hours where gains absorb heat → less recovery credit)
- Raises cooling demand significantly (MVHR adds heat to a zone that wants cooling in shoulder/summer hours where `T_out < setpoint`)
- Net effect: under reorder, MVHR can show as an EUI INCREASE rather than a saving

**Prediction:** bypass-on for the bedrooms-MVHR intervention shifts the cooling penalty substantially. The 83.9 MWh cooling increase in Chris's walkthrough is the target. Of that, the portion attributable to shoulder-hour recovery is what bypass-on suppresses:
- Order-of-magnitude estimate: **half to two-thirds of the cooling-demand increase recovers** if bypass is well-targeted (cooling-demand hours where MVHR was still accruing recovery).
- Predicted EUI shift on the bedrooms-MVHR scenario: bypass-on **reduces EUI by ~5–15 kWh/m²·yr** (depends on the bedrooms gain magnitude — could be larger).
- The qualitative test: with bypass on, the MVHR bedrooms intervention SHOULD read as a net EUI saving rather than an increase under reorder.

### §4.3 Refbox HOT scenario (probe-baselined)

From cooling-hours probe (`c64657c`):

| | COLD baseline | HOT (1 person/m² gain) | Expected bypass-on HOT |
|---|---:|---:|---:|
| heating demand | 147.80 | 71.30 | similar (~72) |
| cooling demand | 4.80 | 15.40 | **lower** (~12–13) |
| effective recovery | 35.26 | 30.55 | **lower** (~25–28) |
| heating electricity | 49.27 | 23.77 | similar (~24) |

Bypass-on suppresses ~2–5 MWh of recovery (estimate; depends on hour-by-hour overlap of `T_out < setpoint` AND `cooling_demand > 0`). Cooling demand drops by approximately the same magnitude (the recovered heat that was driving the cooling load is no longer added). Heating demand barely changes (those hours weren't heating-mode hours).

**Part 2 will run the refbox with bypass on/off and report.** The above ranges are the first-principles prediction; if the engine returns something materially outside these ranges, escalate.

## §5 — Hypothesis on the +10 heat-balance residual

### §5.1 What the residual mechanism is

Heat-balance Sankey (`HeatBalance.jsx` L755–774) computes `netResidual = totalGains − totalLosses` per the displayed Sankey ribbons; flags "large residual; check inputs" when |residual| > 5 kWh/m² (or 10 % of losses).

The PHPP convention is enforced via two **synthetic** terms (L215–223 for cooling, L324–353 for heating):

- **Cooling** synthesised as a *loss*: `data.demand.cooling_demand_mwh`, added when `orderWithNew.includes('cooling')`.
- **Heating** synthesised as a *gain*: `data.demand.heating_demand_mwh`, added when `allowed.has('heating')`.

Together they make the balance close: the building's heating-demand-as-a-gain plus envelope-gains equals envelope-losses plus cooling-demand-as-a-loss.

### §5.2 Hypothesis on the +10

The +10 residual is small enough that it's NOT a full missing-term issue (a full missing heating demand on Bridgewater would show as a large NEGATIVE residual — heating fights envelope losses, putting it on the gain side adds ~30+ kWh/m²·yr of gain).

`+10 kWh/m²·yr` × `Bridgewater GIA 4322 m²` = `43.2 MWh / yr`. This magnitude is in the same family as:
- Solar gains (a few tens of MWh on a hotel)
- Internal-gain util-factor residue (heating util_factor < 1 means some gains don't fully offset, leaving them on the gain side without a matching loss)
- MVHR fan electricity becoming heat in the space (continuous ~25 MWh on Bridgewater) — possibly a separate gain term that's surfaced but not labelled

**Most-likely candidates (Part 4 investigates in order):**

1. **MVHR fan electricity → space-heat gain.** Bridgewater MVHR fan ~17.5 MWh + extracts ~8 MWh ≈ 25 MWh. Some fraction (the SUPPLY fan share) ends up as heat IN the space. If 25 MWh × supply-fan-share (~50–80 %) ≈ 12–20 MWh ≈ 3–5 kWh/m²·yr of "fan motor heat". If the engine surfaces fan heat as a gain (or doesn't) inconsistently with the rest of the balance, partial residual.
2. **Solar absorbed on opaque walls** (`TUNE_OPAQUE_GAIN_FRACTION × OPAQUE_WALL_SOLAR`, around L4830-4842 inline-legacy). This is treated as a gain in State 2 but may not be on the Sankey's gain side at the same scale.
3. **Util-factor non-linearity.** State 2 applies `util_factor = 0.60` to internal gains for heating offset. The Sankey may show full internal gain on the gain side but the heating-demand synthesis already accounts for `(1 − util_factor)` of those gains being "unused" — surfaces as a positive residual ≈ `0.40 × (people + lighting + equipment) / GIA`.
   - Bridgewater internal gains: rough estimate from a hotel — ~150,000 kWh occupancy + ~250,000 kWh lighting + ~250,000 kWh equipment ≈ 650 MWh. 40 % × 650 / 4322 = ~60 kWh/m². Too big. So util-factor residue alone isn't it.
4. **MVHR recovery directionality.** Brief 50 closed the double-count; the recovery is now baked into a smaller `permanent_vents` / mechanical vent loss term. If the Sankey separately shows the airstream recovery integral as a "gain" (informational, ~63 MWh), it'd produce a much larger residual (~15 kWh/m²) — not +10. So this is unlikely the primary cause.

**Lead hypothesis for Part 4 investigation:** **MVHR fan electricity → space-heat gain** (item 1 above), interacting with the heating-demand-as-gain synthesis. Magnitude 3–5 kWh/m² of fan heat plus a few kWh/m² of misaligned solar-on-opaque-walls accounting could account for the +10.

**Investigation method for Part 4:**
- Log `totalGains`, `totalLosses`, the per-line breakdown of each, on Bridgewater clean.
- Compare each line value to the engine's `losses_at_setpoint.*.heating_loss_kwh` / `heat_balance.annual.gains.internal.*.kwh` / etc.
- The first line where the Sankey value diverges from the engine value (or where a term is missing from the Sankey but present on the engine result) is the residual source.
- If it's a real missing term — add it. If it's a legitimate "this is unused/storage/etc." — relabel the footer from "check inputs" to e.g. "Net (gains − losses): +10.1 kWh/m²·yr (unused gains, util factor 0.60)".

## §6 — What Part 2 will look like (forward sketch — for sign-off context, NOT to be implemented yet)

### §6.1 Engine changes (`instantCalc.js`)

```js
// New: at State 2 ventilation projection (L2553+), thread through summer_bypass flag
const ventSystems = (... as before ...).map(v => {
  …
  const v40Match = v40VentMap.get(v?.id)
  const summer_bypass = v40Match?.summer_bypass === true   // new v40 field, default false
                     || v?.summer_bypass === true          // v25 fallback
  …
  return { …, summer_bypass }
})

// Inside State 2 hourly loop (~L2700-2900 region — UA is currently precomputed
// outside the loop; now it must be conditioned per hour by bypass status):
for (let h = 0; h < n; h++) {
  …
  // bypass active when previous hour had cooling demand
  const cooling_prev = (h > 0) ? cooling_demand_hourly_kwh[h - 1] : 0
  // Per-system vent UA: bypass replaces (1−HRE) with 1.0 for systems with summer_bypass
  let ventUA_eff = 0
  for (let vi = 0; vi < ventSystems.length; vi++) {
    const vs = ventSystems[vi]
    if (!vs.enabled) continue
    const bypass_h = vs.summer_bypass && cooling_prev > 0
    const hre_factor = bypass_h ? 1 : (1 - vs.hre)
    ventUA_eff += AIR_HEAT_CAPACITY * vs.flow_l_s * 3.6 * hre_factor * (vs.hours / 8760)
  }
  // Use ventUA_eff in this hour's heat balance step
  …
}
```

### §6.2 `computeVentilationEnergy` change

```js
// New 6th positional arg: coolingDemandHourlyKwh
function computeVentilationEnergy(ventSystems, weatherData, T_setpoint_c, building,
                                  heatingDemandHourlyKwh = null,
                                  coolingDemandHourlyKwh = null) {
  …
  for (let h = 0; h < n; h++) {
    const dT = T_setpoint_c - weatherData.temperature[h]
    if (dT > 0) {
      const cooling_prev = (coolingDemandHourlyKwh && h > 0) ? coolingDemandHourlyKwh[h - 1] : 0
      const bypass_h = vs.summer_bypass && cooling_prev > 0
      if (!bypass_h) {
        const theoretical_h_Wh = flow_m3s * AIR_HC_J_PER_M3_K * vs.hre * dT * schedule_factor
        const demand_h_Wh = (heatingDemandHourlyKwh[h] ?? 0) * 1000
        effective_Wh += Math.min(theoretical_h_Wh, demand_h_Wh)
      }
      // else: bypass active this hour, contribute 0
    }
  }
  …
}
```

And `_calculateState3` at L4118+ already has `cooling_demand_hourly_kwh` available on `state2Result.demand.cooling_demand_hourly_kwh` — pass it through.

### §6.3 Schema field

Add `summer_bypass: boolean` to:
- `systems_config_v40.ventilation[].summer_bypass` — canonical
- (Optional) `systems_config_v25.ventilation[].summer_bypass` — v25 mirror with the same fallback logic Brief 50 Part 6 used for HRE / enabled

Default: `false`. The engine reads `v40 ?? v25 ?? false`.

### §6.4 UI control

Checkbox in `SystemEditorCard.jsx` / equivalent for v40 ventilation systems. Label: "Summer bypass (suppress recovery in cooling-demand hours)". Default unchecked.

### §6.5 Falsifiability for Part 2

1. **Bypass-off Bridgewater clean = 128.20** (no movement) — non-trivially, because Part 2 changes the call signature of `computeVentilationEnergy` and the State 2 UA computation pattern. Any byte-shift between bypass-off and pre-brief = bug.
2. **Bypass-off refbox HOT** matches probe (recovery 30.55, cooling 15.40).
3. **Bypass-on refbox HOT** drops recovery in cooling-mode hours: predict recovery 25–28 MWh, cooling demand 12–13 MWh.
4. **Reconciliation log:** in Part 2's commit, dump `Σ (1 − HRE)-mode-hours` vs `Σ bypass-mode-hours` for both State 2 and `computeVentilationEnergy` on Bridgewater. Both lists must match exactly.

## §7 — Part 1 deliverable summary

| Question | Answer |
|---|---|
| Where does the per-hour recovery cap live? | `instantCalc.js` `computeVentilationEnergy` L3984–3995 |
| Where does the State 2 (1−HRE) factor live? | `instantCalc.js` `_calculateState2` L2553–2582 |
| Recommended bypass trigger | `cooling_demand_hourly_kwh[h−1] > 0` — symmetric in both sites, identical signal, identical lag |
| Reconciliation strategy | Both sites read the same `cooling_demand_hourly_kwh[h−1]` array slot per hour. Same signal → same bypass hours → same magnitude (Principle 2). |
| Implementation awkwardness | One-hour lag is inherent (avoiding 2-pass State 2). Two-site change (not a one-liner). Hour 0 defaults to bypass-off. |
| Default | OFF (preserves 128.20 anchor; bypass is opt-in modelling choice). |
| Bridgewater clean bypass-on prediction | Near-zero shift (< 0.3 kWh/m²·yr). Outer gate already suppresses recovery in most cooling hours. |
| Bridgewater + bedrooms-MVHR bypass-on prediction | EUI drops 5–15 kWh/m²·yr on that scenario. Cooling penalty falls toward the no-recovery-into-cooling-zone level. Order under reorder flips from "increase" to "saving". |
| Refbox HOT bypass-on prediction | Recovery 30.55 → ~25–28 MWh. Cooling 15.40 → ~12–13 MWh. Heating largely unchanged. |
| +10 residual hypothesis | Lead: MVHR fan electricity → space-heat gain not surfaced consistently with the heating-demand-as-gain / cooling-demand-as-loss PHPP convention. Plus possible solar-on-opaque-walls misalignment. Investigation method documented for Part 4. |

## §8 — Hard stop

Part 1 checkpoint per the brief: **trigger + Bridgewater first-principles prediction signed off by Chris BEFORE Part 2 engine code.** Surfacing for sign-off. No engine code touched.

Open questions for Chris:

1. **Trigger `cooling_demand_hourly_kwh[h−1] > 0` accepted?** Or do you want the synchronous-with-2×-cost variant? (Recommend reject — the lag effect is one hour of recovery in a year of 8760 — negligible at engine scale, and 2× State 2 cost would break live-update reactivity in Brief 47 / 53's heat-balance Sankey.)

2. **Default OFF accepted?** (Recommend yes — preserves 128.20 anchor as the verified clean reference.)

3. **Predictions reasonable?** Particularly the bedrooms-MVHR 5–15 kWh/m²·yr range. If you have a tighter expectation from the walkthrough imagery, narrow it now so Part 2's checkpoint has the right band.

4. **Part 4 +10 residual hypothesis (MVHR fan heat) — agree this is the lead candidate to investigate first?** Or do you want Part 4 to start with a different candidate?

Awaiting sign-off before Part 2.
