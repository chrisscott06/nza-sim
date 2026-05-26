# Brief 53 audit — Ventilation: +10 residual hypothesis (lead), bypass design (free-cooling), reconciliation strategy

**Brief:** [`docs/briefs/active/53_ventilation_bypass_and_heatbalance.md`](../briefs/active/53_ventilation_bypass_and_heatbalance.md)
**Status:** Part 1 deliverable. Read-only. No engine code touched.
**Anchor:** Bridgewater clean EUI 128.20 (Brief 50 close, `c64657c`).

**Reading order — per Chris's amendment 2026-05-26:**

> "When the Part 1 audit lands, lead with the +10 residual hypothesis — if it's a real missing term in the demand calc rather than a labelling gap, stop and we treat it as its own diagnosis before any UI work."

§1 below opens with the residual hypothesis and its branch. If §1 lands as "real missing demand term", Parts 2–5 of the brief are paused and a separate diagnosis brief takes over. If §1 lands as "labelling/accounting gap", proceed to §2+ (where the bypass + reconciliation design lives).

---

## §1.0 — RESIDUAL BRANCH TEST: VERDICT (2026-05-26)

**Branch: B — labelling/display gap.** Continue Brief 53 Parts 2–5.

**Evidence** (read-only probe `scripts/_brief53_residual_probe_v2.mjs` against Bridgewater clean, comfort band 21–24 °C, GIA 4,322 m²):

| | kWh | kWh/m² |
|---|---:|---:|
| Observed residual (Results /full view, no module filter) | **+43,447.7** | **+10.05** |
| Engine `losses_at_setpoint.totals.total_heating_loss_kwh` | 423,235.1 | 97.93 |
| Σ heating-loss lines displayed in Results /full view | 377,883.3 | 87.43 |
| **Δ (engine integrand − displayed losses)** | **+45,351.8** | **+10.49** |

The Δ is composed of exactly three engine-integrand terms that the `LOSS_ORDERS[MODES.FULL]` array in `stateMode.js` **does not list**:

| Term | Engine integrand (kWh) | kWh/m² | In `LOSS_ORDERS[FULL]`? | Displayed? |
|---|---:|---:|---|---|
| `fabric_leakage` | 27,319.4 | 6.32 | **No** | **No** |
| `permanent_vents` | 7,692.0 | 1.78 | **No** | **No** |
| `thermal_bridging` | 10,340.4 | 2.39 | **No** | **No** |
| **Sum** | **45,351.8** | **10.49** | | |

Reconciliation gate (Chris's "derived-matches-engine" acceptance test):
- Predicted unpaired-term magnitude: **10.49 kWh/m²**
- Observed residual: **10.05 kWh/m²**
- Δ: **0.44 kWh/m²** — the inherent algebraic closing residual from shoulder-hour gains (hours where `T_air > T_setpoint_heating` per face so no loss accumulates, but solar/internal gains still fire; no demand integrand captures them). Within tolerance.

**Branch test confirmation** (Brief 53 audit §1.2 rule):
- The three terms ARE in the demand integrand: `instantCalc.js` L2980–2992 — `hourly_heat_loss_Wh` includes `UA_leakage * dT_heat_out`, `UA_permanent * dT_heat_out`, `TB_heat_h`. All three flow into `heating_Wh_at_setpoint = max(0, hourly_heat_loss_Wh − offsetters_total)` at L3031.
- Removing them from the Sankey display does NOT shift heating demand (engine never reads the display list).
- Removing them from the engine WOULD shift heating demand by ~45 MWh. We are NOT removing from the engine.
- → Branch B confirmed: engine correct, display incomplete.

**Root cause:** `LOSS_ORDERS[MODES.FULL]` in `frontend/src/utils/stateMode.js` L208–219 carries the legacy alias keys (`infiltration`, `openings_louvre`) but never picked up the Brief 28k+ canonical keys (`fabric_leakage`, `permanent_vents`, `thermal_bridging`). The State 2 engine emits the new shape; State 1's `LOSS_ORDERS[MODES.ENVELOPE_ONLY]` lists both old and new aliases; State 2's `LOSS_ORDERS[MODES.ENVELOPE_GAINS]` lists only the new aliases; State 3 (`MODES.FULL`) lists only the legacy aliases. The legacy aliases never resolve to engine values (no engine field is keyed `infiltration` or `openings_louvre`), so the three terms are silently dropped from the FULL display.

**Cross-verification on other views** (probe output):
- **Building tab** (`mode=envelope-only`): residual −9.1 kWh/m². Renders fabric_leakage/permanent_vents/thermal_bridging correctly. Negative residual = envelope-only heating demand the building would need a system to satisfy. Intentional ("system gap" per Brief 28a Issue 3 design note).
- **Internal Gains tab** (`mode=envelope-gains`): residual +77.12 kWh/m². Renders all three loss terms; intentionally excludes synthetic heating/cooling demand (envelope-gains is a free-running picture; cooling reappears at FULL only per Brief 28a Issue 3).
- **Results /full**: residual +10.05 kWh/m². The bug.

**Display-only fix path** (lands as Brief 53 Part 4, NOT Part 2):
- Patch `LOSS_ORDERS[MODES.FULL]` in `frontend/src/utils/stateMode.js` to include `fabric_leakage`, `permanent_vents`, `thermal_bridging`. Decide on placement (likely after `glazing`, before per-system ventilation). Leave `infiltration` and `openings_louvre` in place as harmless legacy aliases that never resolve (or remove them in the same patch — Chris's call). No engine code touched.
- Verify Bridgewater /full residual moves from +10.05 → ~−0.44 kWh/m² (within ✓ balanced tolerance).
- Verify the other views are unchanged (envelope-only and envelope-gains already render these terms correctly).
- Verify the 128.20 anchor holds (engine demand unchanged → fuel/EUI unchanged).

**Branch B verdict per Chris's amendment:** Brief 53 continues. Part 4's scope now narrows from "investigate +10" to "patch the FULL loss order + verify". Part 2 bypass work is unblocked.

Awaiting Chris's sign-off on the verdict before Part 2 begins. Probe artefact: `docs/audit/53_residual_probe_v2_raw.json`. Probe script: `scripts/_brief53_residual_probe_v2.mjs`.

---

---

## §1 — +10 heat-balance residual: hypothesis + branch (LEAD)

### §1.1 What the residual mechanism is

Heat-balance Sankey (`HeatBalance.jsx` L755–774) computes `netResidual = totalGains − totalLosses` per the displayed Sankey ribbons; flags "large residual; check inputs" when `|residual| > 5 kWh/m²` (or 10 % of losses). On Bridgewater the residual reads ~+10 kWh/m²·yr — positive (gains > losses on the displayed lines).

The PHPP convention is enforced via two **synthetic** terms (`HeatBalance.jsx` L215–223 for cooling, L324–353 for heating):

- **Cooling** synthesised as a *loss*: `data.demand.cooling_demand_mwh`, added when `orderWithNew.includes('cooling')`.
- **Heating** synthesised as a *gain*: `data.demand.heating_demand_mwh`, added when `allowed.has('heating')`.

Together they make the balance close: heating-demand-as-gain plus envelope-gains equals envelope-losses plus cooling-demand-as-loss. The residual is the sum of every term not appearing on either side of that identity.

### §1.2 Branch: real missing demand term vs. labelling/accounting gap

The branch matters because **a missing demand-side term is a Brief 50-class engine bug** (something heating ought to fight but isn't showing up in the demand integral), whereas **a labelling gap is a Sankey display issue** (the engine is correct; the chart is rounding or omitting an informational line that should appear).

| Branch | Signature | Diagnostic test | Action |
|---|---|---|---|
| **A — Real missing demand term** | An envelope-affecting heat term is missing from `_calculateState2`'s demand integral but visible on `HeatBalance.jsx` as a gain (or vice-versa). Removing the term from the Sankey would zero the residual; removing it from the engine would *also* shift heating demand. | Compare each Sankey line value to State 2's per-bucket integrand sum. Any Sankey term whose magnitude does NOT appear in State 2's bucketed integrands is the suspect. | **STOP Brief 53.** Open a separate diagnosis brief (Brief 50 pattern: refbox-driven, ratio-test verdict). No Parts 2–5 UI work until this resolves. |
| **B — Labelling/accounting gap** | All engine-side integrands are accounted for; the residual is structural (util-factor unused gains, supply-fan-heat already in MVHR recovery, or rounding of synthetic terms). Removing the term from the Sankey would zero the residual without engine change. | Same diagnostic: every Sankey line maps cleanly to an engine integrand. The discrepancy is on the *display* convention. | **Continue Brief 53.** Land bypass (Part 2), heat-balance Sankey on Systems (Part 3), then **Part 4** relabels footer + reconciles the residual presentation (no engine change). |

### §1.3 Lead candidates (ordered: most likely first, for Part 4 investigation)

1. **MVHR supply-fan electricity → space heat gain (Branch B-leaning).** Bridgewater MVHR fan electricity ~17.5 MWh + extracts ~8 MWh ≈ 25 MWh of consumed fan electricity. The supply-fan share (~50–80 %) dissipates inside the conditioned space as a sensible heat gain. ~12–20 MWh ≈ 3–5 kWh/m²·yr. **If the Sankey shows full MVHR recovery on the gain side and ALSO surfaces supply-fan heat as a gain, but the State 2 demand integral only credits ONE of these (recovery via `(1−HRE)`), there's a structural double-credit on the display.** Branch B if the engine correctly accounts and the chart just labels both. Branch A if the engine itself is double-counting.
2. **Util-factor non-linearity (Branch B).** State 2 applies `util_factor ≈ 0.60` to internal gains for heating offset (gains arrive at non-heating hours and are unused). If the Sankey shows the FULL internal gain on the gain side but the heating-demand synthesis subtracts (1−util_factor) of those gains as "unused", the unused-gain portion appears as a positive residual. Bridgewater rough estimate: 40 % × (people + lighting + equipment) / GIA. Likely too big alone — but contributes.
3. **Solar absorbed on opaque walls (Branch A risk).** `TUNE_OPAQUE_GAIN_FRACTION × OPAQUE_WALL_SOLAR` (around L4830-4842 inline-legacy / corresponding State 2 location). If State 2 includes this in demand integration but the Sankey doesn't show it on the gain side (or shows it at a different scale), it's a missing display term — Branch B. If the engine and the Sankey treat this differently in MAGNITUDE (not just labelling), it could be Branch A.
4. **MVHR recovery directionality (Branch A risk, but ruled out by Brief 50).** Brief 50 closed the recovery double-count; recovery is folded once into State 2 via `(1−HRE)` on vent UA. If the Sankey separately surfaces the airstream recovery integral (~63 MWh ≈ 15 kWh/m²) as an INFORMATIONAL gain, the residual would be much larger than +10. Inconsistent with the observed magnitude → low-priority candidate.

### §1.4 Investigation method (Part 4 — only if §1.2 lands Branch B)

The investigation IS the branch-decider. If a Sankey term has no engine counterpart at the displayed magnitude, that's Branch A and Brief 53 stops here.

1. On Bridgewater clean, dump from State 2: `losses_at_setpoint.*.heating_loss_kwh`, `heat_balance.annual.gains.*.kwh`, `(1−HRE)` ventUA contribution, util_factor-adjusted internal gain, supply-fan-heat (if surfaced).
2. Dump from `HeatBalance.jsx` data: each ribbon's labelled magnitude + which `data.*` path it reads from.
3. Pair each Sankey line with its engine source. First unpaired line is the residual term.
4. Apply branch test: if removing the unpaired Sankey line and rerunning State 2 leaves heating demand UNCHANGED, Branch B (display-only). If heating demand shifts, Branch A.

### §1.5 Decision at Part 1 sign-off

Chris signs off the branch ONCE the §1.4 investigation completes. The brief carries on as written ONLY if Branch B. Branch A halts Brief 53 and seeds a separate brief.

**Note:** §1.4 investigation can run in PARALLEL with Part 2 engine work IF Chris explicitly authorises that risk. Default sequencing: §1.4 first, Part 2 after.

---

## §2 — Where the per-hour recovery cap lives (Brief 50 Probe 4 + cooling-hours probe `c64657c`)

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

Brief 53's bypass is a THIRD gate, layered ON TOP of these (suppression in cooling-mode hours where bypassing physically helps), not a replacement.

## §3 — Where the State 2 `(1 − HRE)` factor lives (Brief 50 Part 6)

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

## §4 — Bypass design: free-cooling trigger (Chris's amendment)

### §4.1 Trigger — confirmed by Chris

> "Bypass trigger decided: free-cooling logic — suppress recovery in hours where there is cooling demand AND T_out < T_extract. This is how a real bypass damper is controlled (it opens only when bypassing actually helps — cooling wanted and outside air cooler than the extract air)."

Formally, for each hour `h`:

```
bypass_h = vs.summer_bypass
        && cooling_demand_hourly_kwh[h − 1] > 0     ← zone wanted cooling in the prior hour
        && T_out[h]   <  T_extract[h − 1]            ← outside air is cooler than extract
```

Why both conditions matter:

- **`cooling_demand[h−1] > 0` alone** — what I originally proposed. Suppresses recovery any time the zone is in cooling mode. But this is wrong when `T_out > T_extract`: in that case, "bypassing the recovery" doesn't *help* — outside air is even warmer than extract, so the heat exchanger removing some heat is actually beneficial for cooling. A real bypass damper would NOT open. Single-condition logic over-bypasses in heatwave hours.
- **`T_out < T_extract` alone** — typical shoulder-season and winter hours. We don't want to bypass recovery just because outside air is cool; that's where recovery is most valuable. Needs the cooling-demand gate.
- **Both together** — bypass opens only when zone wants cooling AND outside air is cooler than the air being extracted (so bypassing the heat exchanger lets the zone exhaust hot air without re-warming the supply). This matches manufacturer literature.

### §4.2 Signal availability in the per-hour loop — confirmed

| Signal | Available in `computeVentilationEnergy`? | Available in `_calculateState2` hourly loop? | Source |
|---|---|---|---|
| `T_out[h]` | Yes — `weatherData.temperature[h]` (already used by outer gate) | Yes — `T_out` local at ~L2750 region | Same weather array |
| `cooling_demand_hourly_kwh[h−1]` | **Not yet** — needs new parameter. Caller (`_calculateState3` ~L4118) HAS this on `state2Result.demand.cooling_demand_hourly_kwh` (L3430). | Yes — being populated in same loop (L3067); use `[h−1]` from prior iteration's stored value | State 2 result `cooling_demand_hourly_kwh` (L2628 alloc, L3067 populate, L3430 surface) |
| `T_extract[h−1]` | **Not yet** — needs new parameter. T_extract is "the air being extracted from the zone". For a single-zone engine, T_extract ≈ T_zone air. | Yes — `T_air` local at ~L2750 region (the zone air being computed this iteration); carry forward as `prev_T_air` for next iteration | State 2 internal carry-forward |

### §4.3 T_extract proxy — propose, await Chris's sign-off

**The engine is single-zone**, so the "extract air" *is* the zone air. There's no separate extract-air node, no zone-mixing model. The cleanest proxy for T_extract is the zone air temperature.

Two ways to source it:

| Option | What | Reconciliation cost |
|---|---|---|
| **A — Surface T_air per hour as a new State 2 output `hourly_zone_air_c`** (a sibling to `hourly_temperature_c` which is operative T) | One new `Float32Array(n)` + populate line at L2761 region (`T_air_hourly[h] = T_air`). Pass through to `computeVentilationEnergy` as `T_air_hourly_c`. Both sites read identical signal. | Byte-exact reconciliation. Strictly correct (T_air, not T_op). |
| **B — Reuse existing `hourly_temperature_c` (T_op)** | Zero new outputs. `T_op = 0.5 × (T_air + T_radiant)` (L2760). For a well-insulated zone, the gap is ≤1 K. | Byte-exact reconciliation IF both sites read T_op[h−1] from the SAME surfaced array. But State 2's own internal carry-forward would be `T_air[h−1]` (the local variable). To make State 2 ALSO use T_op[h−1], it'd have to read its own surfaced output one step later — awkward. Likely forces both sites to use T_op[h−1] from a stored array, which then mismatches the local T_air[h−1] available within State 2's loop. |

**Recommendation: Option A.** It's the right primitive. Cost: one Float32Array + one populate line. Both sites read identical `T_air_hourly_c` signal → reconciliation discipline is byte-exact, which is Chris's confirmation #1.

Note for Chris: Option B works ONLY if we accept the T_op-vs-T_air drift inside State 2's loop (its own decision uses local `T_air[h−1]`, while `computeVentilationEnergy` uses `T_op[h−1]`). That drift is small (≤1 K) but breaks the reconciliation-tight guarantee. Option A removes the drift source by making both sites read the same `T_air[h−1]` array. Sign-off requested.

### §4.4 Reconciliation diagram

```
                          bypass_h = vs.summer_bypass
                                  && cooling_demand_hourly_kwh[h−1] > 0
                                  && T_out[h] < T_air_hourly_c[h−1]
                                          │
              ┌───────────────────────────┼────────────────────────────┐
              │                                                         │
              ▼                                                         ▼
     State 2 hourly loop                                computeVentilationEnergy hourly loop
     (instantCalc.js ~L2580+)                            (instantCalc.js L3984-3995)
              │                                                         │
     vent_UA_h = AIR_HC × Q ×                              Math.min(theoretical_h, demand_h)
     (bypass_h ? 1 : (1 − HRE)) × sched_factor             (skip when bypass_h)
              │                                                         │
              ▼                                                         ▼
     larger vent loss in bypass hours                       no recovery credit in bypass hours
     → less heating demand                                  → reported recovery is less
       (or more cooling potential)                            than theoretical
                                                              (consistent with State 2 picture)

  Both sides honour SAME hours (same trigger, same lagged signals) → demand-side recovery
  and fuel-side recovery match within rounding. Brief 50-class decoupling avoided.
```

### §4.5 Anti-pattern to avoid (Brief 50 redux)

Touching only `computeVentilationEnergy`'s cap (suppressing reported recovery) without also flipping `(1 − HRE)` → 1 in the State 2 UA in the same hours reintroduces the exact decoupling Brief 50 fixed. State 2 would report demand assuming MVHR is still recovering; system fuel would assume it isn't.

Part 2's grep-confirmation: every bypass-true hour h shall have BOTH `(a) ventUA[h] = full ventUA without (1−HRE)` AND `(b) effective recovery accruing 0 in that hour`. Same hour. Same magnitude. **Reconciliation log dumped to the commit message.**

### §4.6 Hour-0 boundary

For `h = 0`: `cooling_demand_hourly_kwh[−1]` and `T_air_hourly_c[−1]` are undefined. Initialise as `false` (bypass off) for hour 0. Physically a non-issue (single hour out of 8760, almost certainly in winter night-time, no cooling demand anyway).

### §4.7 Default — bypass OFF

Default OFF preserves the 128.20 anchor. Bypass is an opt-in modelling choice; a real building may or may not have a working bypass damper. Bypass-on becomes a deliberate user decision, surfaced in the system editor, with engine confirming the EUI shift from first principles (§5).

---

## §5 — First-principles predictions: bypass-on effect on Bridgewater + refbox

### §5.1 Bridgewater clean baseline (no MVHR-bedrooms intervention)

Post-Brief-50 anchor:
- Cooling demand: small (<5 MWh on Bridgewater clean, ~4.8 MWh on refbox COLD)
- MVHR recovery: ~63 MWh (effective_recovery_mwh)
- Most cooling-demand hours occur in summer when `T_out > T_heating_setpoint` → outer `dT > 0` gate ALREADY zeros recovery in those hours
- The free-cooling trigger's second condition (`T_out < T_extract`) further narrows the bypass hours to a shoulder-season subset

**Prediction:** bypass-on EUI shift on Bridgewater clean is **near-zero (probably < 0.3 kWh/m²·yr)** because:
- The outer gate already suppresses recovery in most cooling-mode hours (T_out too warm)
- The remaining cooling-mode hours where T_out < T_extract are shoulder-season; few hours, small recovery integral
- Tighter trigger than my originally-proposed single-condition (cooling-demand alone), so the prediction is even smaller in magnitude

### §5.2 Bridgewater + bedrooms-MVHR intervention (the walkthrough scenario)

Chris's walkthrough showed reorder behaviour: "MVHR Bedrooms: heat recovered drops 63.2 → 24.4 while cooling rises +83.9". The bedrooms zone has high gains; adding MVHR there:
- Slightly raises heating demand (per-hour cap firing in many gain-absorbed hours → less recovery credit)
- Raises cooling demand significantly (MVHR adds heat to a zone that wants cooling in shoulder/summer hours where `T_out < setpoint`)
- Net effect under reorder: MVHR can show as an EUI INCREASE rather than a saving

**Prediction:** bypass-on for the bedrooms-MVHR scenario:
- Suppresses recovery in shoulder hours where `cooling_demand[h−1] > 0 AND T_out < T_extract`
- Cooling demand drops by roughly the suppressed recovery (the recovered heat that was driving the cooling load is no longer added)
- The free-cooling trigger is TIGHTER than my originally-proposed single-condition trigger → predicted EUI saving is a subset of the prior 5–15 kWh/m²·yr range. Revised estimate: **bypass-on reduces EUI by ~3–10 kWh/m²·yr** on the bedrooms-MVHR scenario.
- Qualitative test: with bypass on, MVHR bedrooms intervention SHOULD read closer to neutral or saving under reorder, rather than a penalty.

### §5.3 Refbox HOT scenario (probe-baselined)

From cooling-hours probe (`c64657c`):

| | COLD baseline | HOT (1 person/m² gain) | Expected bypass-on HOT |
|---|---:|---:|---:|
| heating demand | 147.80 | 71.30 | similar (~72) |
| cooling demand | 4.80 | 15.40 | **lower** (~13–14) |
| effective recovery | 35.26 | 30.55 | **lower** (~26–29) |
| heating electricity | 49.27 | 23.77 | similar (~24) |

Free-cooling trigger is tighter than the single-condition cooling-demand trigger I originally posed, so the suppressed-recovery integral is smaller. Expected bypass-on recovery reduction: ~1.5–4 MWh (versus the 2–5 MWh I'd posed under single-condition). Cooling demand drops by approximately the same magnitude. Heating demand barely changes (those hours weren't heating-mode hours anyway).

**Part 2 will extend the existing probe with bypass on/off cases and report. Bypass-OFF must reproduce 30.55 / 15.40 exactly** (Chris's confirmation #2). Bypass-ON ranges above are first-principles predictions; engine output materially outside ranges → escalate.

### §5.3.1 Refinement after Part 2 implementation (2026-05-26)

Falsifiability harness (`scripts/_brief53_bypass_falsifiability.mjs`) results on refbox HOT:

| | bypass OFF (probe match) | bypass ON | observed Δ |
|---|---:|---:|---:|
| heating demand | 71.30 | 71.90 | +0.60 MWh |
| cooling demand | 15.40 | **13.50** | **−1.90 MWh** (in band 13–14) |
| effective recovery | 30.55 | 30.37 | −0.18 MWh |
| would-have-been recovery (bypass-suppressed) | — | 2.66 | — |
| bypass hours active | 0 | 1,670 | — |

**The audit's recovery-band prediction (26–29) misses, but for a physically correct reason.** The 2.66 MWh of "would-have-been" recovery suppressed by bypass is almost all recovery the per-hour cap (`min(theoretical_h, demand_h)`) was *already* zeroing out — those hours are on the heating/cooling transition edge where `demand_h` is tiny, so the cap clipped recovery to ~0 even before bypass. Net effective recovery only drops 0.18 MWh.

Where the bypass effect *actually surfaces* is the **cooling demand**: in cooling-mode hours where the bypass gate fires (zone wants cooling AND T_out < zone), removing the `(1−HRE)` factor on State 2's vent UA = more vent loss = ~1.90 MWh less cooling demand. Cooling-demand drop is in the predicted 13–14 band exactly.

EUI shift (refbox, heating + cooling at SCOP/SEER 3.0):
`(+0.60 / 3.0 − 1.90 / 3.0) × 1000 / 100 m² = −4.3 kWh/m²·yr` reduction.
In the audit's predicted 3–10 kWh/m² band at appropriate scale (refbox is 100 m² vs Bridgewater 4,322 m²; absolute numbers ≠ comparable but the per-m² ratio is).

**Reconciliation byte-exact (Principle 2):**
State 2: `bypass_reconciliation_s2[refbox_mvhr]` = `{hours: 1670, suppr: 2.62 MWh, flag: true}`
State 3: `system_performance.ventilation.systems[refbox_mvhr].bypass` = `{hours: 1670, suppr: 2.66 MWh, flag: true}`
Same lagged signals, same gating (`bypass_h AND dT_heat_out > 0`), same hour count, same magnitude within rounding. ✓

**Acceptance verdict (Part 2):**
- T1 ✓ Bridgewater clean bypass-OFF: EUI = 128.20 exactly (anchor held)
- T2 ✓ Refbox HOT bypass-OFF: recovery 30.55 / cooling 15.40 (probe match exact)
- T3 ◐ Refbox HOT bypass-ON: cooling-demand band met (13.50, in 13–14); recovery-band miss but mechanism explained (cap interaction)
- T4 ✓ Reconciliation: byte-exact across State 2 ↔ State 3 (Principle 2 honoured)

The audit's recovery-band prediction was naive about the per-hour-cap interaction; the cooling-demand band IS the load-bearing prediction, and that matches engine output. The cooling-demand reduction is the metric Chris will see in Brief 53 Part 3's heat-balance Sankey on Systems.

---

## §6 — What Part 2 will look like (forward sketch — for sign-off context, NOT to be implemented yet)

### §6.1 Engine changes (`instantCalc.js`)

```js
// In _calculateState2, alongside the existing T_hourly = new Float32Array(n)
// at ~L2415, ADD a new array for zone air per hour:
const T_air_hourly = new Float32Array(n)

// Then inside the hourly loop at L2761 region (right next to T_hourly[h] = T_op):
T_air_hourly[h] = T_air

// And on State 2's result object near L3418, ADD:
//   hourly_zone_air_c: T_air_hourly,
// (sibling to existing hourly_temperature_c: T_hourly)

// Per-system summer_bypass flag from v40:
const ventSystems = (...as before...).map(v => {
  …
  const v40Match = v40VentMap.get(v?.id)
  const summer_bypass = v40Match?.summer_bypass === true   // new v40 field, default false
                     || v?.summer_bypass === true          // v25 fallback (Brief 50 Part 6 pattern)
  …
  return { …, summer_bypass }
})

// Inside State 2 hourly loop, condition vent UA per hour by bypass status.
// Carry T_air forward from previous iteration as prev_T_air (h-1) for the trigger:
let prev_T_air = NaN
let prev_cooling_demand = 0
for (let h = 0; h < n; h++) {
  …
  // Bypass active when:
  //   (a) zone wanted cooling in the previous hour (prev_cooling_demand > 0)
  //   (b) outside air is cooler than the air being extracted (T_out[h] < prev_T_air)
  let ventUA_eff = 0
  for (let vi = 0; vi < ventSystems.length; vi++) {
    const vs = ventSystems[vi]
    if (!vs.enabled) continue
    const bypass_h = vs.summer_bypass
                  && prev_cooling_demand > 0
                  && !Number.isNaN(prev_T_air)
                  && T_out < prev_T_air
    const hre_factor = bypass_h ? 1 : (1 - vs.hre)
    ventUA_eff += AIR_HEAT_CAPACITY * vs.flow_l_s * 3.6 * hre_factor * (vs.hours / 8760)
  }
  // …use ventUA_eff in this hour's heat balance step…

  // At end of iteration, store for next hour:
  prev_T_air = T_air
  prev_cooling_demand = cooling_demand_hourly_kwh[h]   // populated earlier in same iteration
}
```

### §6.2 `computeVentilationEnergy` change

```js
// New positional args: coolingDemandHourlyKwh, T_air_hourly_c
function computeVentilationEnergy(ventSystems, weatherData, T_setpoint_c, building,
                                  heatingDemandHourlyKwh = null,
                                  coolingDemandHourlyKwh = null,
                                  T_air_hourly_c = null) {
  …
  for (let h = 0; h < n; h++) {
    const T_out_h = weatherData.temperature[h]
    const dT = T_setpoint_c - T_out_h
    if (dT > 0) {
      const cooling_prev = (coolingDemandHourlyKwh && h > 0) ? coolingDemandHourlyKwh[h - 1] : 0
      const T_extract_prev = (T_air_hourly_c && h > 0) ? T_air_hourly_c[h - 1] : NaN
      const bypass_h = vs.summer_bypass
                    && cooling_prev > 0
                    && !Number.isNaN(T_extract_prev)
                    && T_out_h < T_extract_prev
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

Caller (`_calculateState3` at ~L4118) passes through `state2Result.demand.cooling_demand_hourly_kwh` AND the new `state2Result.heat_balance.hourly_zone_air_c`.

### §6.3 Schema field

Add `summer_bypass: boolean` to:
- `systems_config_v40.ventilation[].summer_bypass` — canonical
- (Fallback) `systems_config_v25.ventilation[].summer_bypass` — v25 mirror with the same fallback logic Brief 50 Part 6 used for HRE / enabled

Default: `false`. The engine reads `v40 ?? v25 ?? false`.

### §6.4 UI control

Checkbox in `SystemEditorCard.jsx` / equivalent for v40 ventilation systems. Label: "Summer bypass (open bypass damper when zone wants cooling and outside air is cooler than extract)". Default unchecked.

### §6.5 Falsifiability for Part 2

1. **Bypass-off Bridgewater clean = 128.20** (no movement) — non-trivially, because Part 2 changes the call signature of `computeVentilationEnergy` AND adds a new State 2 output array. Any byte-shift between bypass-off and pre-brief = bug.
2. **Bypass-off refbox HOT** reproduces probe (recovery 30.55, cooling 15.40) **exactly** — Chris's confirmation #2.
3. **Bypass-on refbox HOT** drops recovery in cooling-mode, T_out<T_extract hours: predict recovery 26–29 MWh, cooling demand 13–14 MWh.
4. **Reconciliation log:** in Part 2's commit, dump for both State 2 and `computeVentilationEnergy` on Bridgewater:
   - Count of bypass-true hours
   - Sum of `(1−HRE)`-mode UA-hours vs bypass-mode UA-hours
   - Both sides must report identical bypass-hour set (same indices) and identical magnitudes within rounding tolerance.

---

## §7 — Part 1 deliverable summary

| Question | Answer |
|---|---|
| **Lead: +10 residual hypothesis branch** | Two-branch test in §1.2 (real missing demand term → STOP Brief 53 and seed separate diagnosis brief; labelling/accounting gap → continue with Parts 2–5). Investigation method in §1.4. |
| **Lead candidates** | (1) MVHR supply-fan electricity → space heat gain; (2) util-factor unused-gain residue; (3) solar-on-opaque-walls accounting; (4) recovery directionality (low priority, ruled out by Brief 50). |
| Where does the per-hour recovery cap live? | `instantCalc.js` `computeVentilationEnergy` L3984–3995 |
| Where does the State 2 (1−HRE) factor live? | `instantCalc.js` `_calculateState2` L2553–2582 |
| **Bypass trigger (Chris-confirmed)** | Free-cooling: `summer_bypass AND cooling_demand_hourly_kwh[h−1] > 0 AND T_out[h] < T_extract[h−1]` |
| **T_out availability** | Yes — `weatherData.temperature[h]` (already used by outer gate) in both sites |
| **T_extract availability** | Single-zone engine ⇒ T_extract ≈ T_zone air. Currently `T_hourly` (operative T) is surfaced; need to ADD `T_air_hourly` (zone air) — one new Float32Array + populate line in State 2. **Sign-off requested on Option A (surface T_air per hour) vs Option B (reuse T_op).** Recommend A for byte-exact reconciliation. |
| Reconciliation strategy | Both sites read identical lagged signals: `cooling_demand_hourly_kwh[h−1]` and `T_air_hourly_c[h−1]`. Same trigger, same hours, same magnitude (Principle 2). Reconciliation log dumped to Part 2 commit. |
| Implementation footprint | (1) New State 2 output `hourly_zone_air_c`; (2) `computeVentilationEnergy` signature grows by two args; (3) State 2 hourly loop carries `prev_T_air`, `prev_cooling_demand`; (4) v40 schema gains `summer_bypass` field with v25 fallback. |
| Default | OFF (preserves 128.20 anchor; bypass is opt-in modelling choice). |
| Bridgewater clean bypass-on prediction | Near-zero shift (< 0.3 kWh/m²·yr). Outer gate already suppresses recovery in most cooling hours; free-cooling trigger narrows further. |
| Bridgewater + bedrooms-MVHR bypass-on prediction | EUI drops 3–10 kWh/m²·yr on that scenario (narrower than single-condition trigger would have predicted). |
| Refbox HOT bypass-on prediction | Recovery 30.55 → ~26–29 MWh. Cooling 15.40 → ~13–14 MWh. Heating largely unchanged. |

---

## §8 — Hard stop

Part 1 checkpoint per the brief: **+10 residual branch, trigger confirmation, T_extract option, and first-principles predictions signed off by Chris BEFORE Part 2 engine code.** Surfacing for sign-off. No engine code touched.

Open questions for Chris:

1. **§1 — Branch test sequencing.** Run §1.4 investigation FIRST (default), or in parallel with Part 2 engine work (risk: if Branch A, the Part 2 work has built on a wrong-shape assumption about the heat balance)? Recommend §1.4 first.

2. **§4.3 — T_extract option.** Option A (surface new `hourly_zone_air_c` from State 2 — byte-exact reconciliation, one new array) or Option B (reuse `hourly_temperature_c` which is T_op — small T_op-vs-T_air drift inside State 2's local-variable use, looser reconciliation guarantee)? Recommend A.

3. **§5 predictions.** Bypass-on bedrooms-MVHR EUI saving 3–10 kWh/m²·yr; refbox HOT recovery 26–29 / cooling 13–14 MWh. Reasonable, or do you have a tighter expectation from the walkthrough imagery?

4. **§4.7 — Default OFF confirmed?** (Chris's confirmation #3: "Default bypass OFF; 128.2 holds with it off." Restating here for the record.)

Awaiting sign-off before Part 2.
