# Brief 61 — Engine source-consistency matrix + findings + fix-brief breakdown (READ-ONLY)

**Status:** read-only diagnostic. No engine touches. Sweeps + code-reads only.
**Probe:** `scripts/_brief61_consistency_sweep.mjs` (15 sweeps × Bridgewater). Trace at `docs/audit/61_consistency_sweep.json`.
**DB backup:** `data/nza_sim_cc.db.brief61_pre_audit.20260527_105237.bak`.

**Anchor declarations not used here.** Per the brief: this audit gates on **consistency** (direction / magnitude / propagation / source / reconciliation / parity), not on any remembered baseline EUI number. "Drift" is never the word.

---

## §1 The consistency matrix

For each Systems-module input swept across 2-3 values on Bridgewater. Each cell records whether the named output BAND moves with the input (in the correct direction and reasonable magnitude). "FROZEN" = the band reads a number that doesn't budge across the sweep, when it should. "FROZEN OK" = it shouldn't move, and doesn't. "MOVES" = it moves correctly.

| Input swept | Values | Demand (`consumption.*.demand_mwh`) | Heat balance (`heat_balance.annual.{losses,gains}`) | Energy flows (`consumption.{service}.electricity_mwh / gas_mwh`) | Totals + EUI (`consumption.total.*`, `eui`, `carbon`) | Parity (baseline vs intervention) |
|---|---|---|---|---|---|---|
| heating_setpoint_c (custom) | 21 → 24 → 28 | **✗ FROZEN** at 245.6 MWh across all 3 values | **✗ FROZEN** (all losses + gains, by construction — State 2 reads comfortBand only) | ✓ MOVES heating_elec 95.6 → 192.1 MWh (recompute-at-setpoint path fires) | ✓ MOVES EUI 110.3 → 132.6 | ⚠ probe inconclusive (see §3.4) |
| cooling_setpoint_c (custom) | 18 → 21 → 24 | **✗ FROZEN** at 69.10 MWh — Chris's reported symptom | **✗ FROZEN** | ✓ MOVES cool_elec 19.7 → 22.3 MWh | ✓ MOVES EUI 110.3 → 110.9 | ⚠ probe inconclusive |
| heating.efficiency (SCOP) | 0.85 → 2.5 → 4.0 | ✓ FROZEN OK (240.6) | ✓ FROZEN OK | ✓ MOVES heat_elec 70.6 → 286.8 MWh (inverse with SCOP) | ✓ MOVES EUI 104.5 → 154.5 | ⚠ probe inconclusive |
| cooling.efficiency (SEER) | 2.5 → 3.5 → 5.0 | ✓ FROZEN OK | ✓ FROZEN OK | ✓ MOVES cool_elec 13.8 → 27.6 MWh | ✓ MOVES EUI 108.9 → 112.1 | not tested |
| dhw[0].efficiency | 0.7 → 0.9 → 1.0 | ✓ FROZEN OK | ✓ FROZEN OK | ✓ MOVES dhw_gas 132.9 → 189.8 MWh | ✓ MOVES EUI 106.9 → 120.1 | not tested |
| dhw_demand_basis `per_m2` L/m² | 0.5 → 1.1 → 2.0 | ✓ MOVES demand_dhw 27.5 → 109.9 MWh | ✓ FROZEN OK (heat balance) | ✓ MOVES dhw_elec + dhw_gas | ✓ MOVES EUI 75.0 → 91.5 | not tested |
| dhw_demand `per_person` L/p/day | 40 → 80 → 150 | ✓ MOVES demand_dhw 102.2 → 383.3 MWh | ✓ FROZEN OK | ✓ MOVES dhw fuel | ✓ MOVES EUI 89.9 → 146.0 | not tested |
| dhw_load_shape (B58 B4) | flat / follow_occ | ✓ FROZEN OK (annual invariant by design) | ✓ FROZEN OK | ✓ FROZEN OK (timing-only) | ✓ FROZEN OK | not tested |
| v40.vent[bedroom].flow_rate (B59 P1) | 1000 → 2208 → 3000 | ✓ MOVES demand_heating 141.4 → 318.3 MWh; demand_cooling 61.0 → 88.3 | ⚠ MIXED — `losses_at_setpoint.ventilation[].heat_loss_kwh` MOVES; `heat_balance.annual.losses.*` does NOT include mech-vent loss so it shows frozen fabric (display completeness gap, not bug) | ✓ MOVES fan_elec + heat_elec + total_elec | ✓ MOVES EUI 100.2 → 117.6 | ⚠ probe inconclusive |
| v40.vent[mvhr].sfp_w_per_lps | 1.0 → 1.8 → 2.5 | ✓ FROZEN OK | ✓ FROZEN OK | ✓ MOVES fan_elec 29.4 → 48.2 MWh | ✓ MOVES EUI 108.0 → 112.3 | not tested |
| v40.vent[mvhr].recovery_sensible_pct (HRE) | 60 → 75 → 90 | ✓ MOVES demand_heating 226.5 → 265.0 MWh (sign inverse — lower HRE = more demand) | ⚠ as above — `losses_at_setpoint.ventilation[0].heat_loss_kwh` moves 14.6 → 58.5 MWh; `heat_balance.annual.losses.*` does not surface this term | ✓ MOVES heat_elec + total_elec | ✓ MOVES EUI 108.8 → 111.9 | ⚠ probe inconclusive |
| v40.vent[mvhr].summer_bypass | false → true | **✗ DIRECTION SUSPICIOUS** — demand_cooling RISES 60.5 → 69.1 with bypass ON | ⚠ vent loss rises 36.5 → 47.7 with bypass ON | ✓ MOVES total_elec 327.5 → 329.1 | EUI 109.9 → 110.3 — **bypass-on costs MORE EUI** | not tested |
| v40.lighting[0].control_factor | 0.5 → 0.86 → 1.0 | ✓ MOVES demand_heating 238.3 → 265.1 MWh (gain ↑ → heating demand ↓) | ✓ MOVES gain_lighting 38.3 → 76.5; loss_external_wall 35.9 → 41.5 (T_air drift) | ✓ MOVES light_elec 38.3 → 76.5 MWh (Brief 58 C 1:1 coupling) | ✓ MOVES EUI 105.2 → 112.4 | ⚠ probe inconclusive |
| v40.lighting[0].enabled | false / true | ✓ MOVES demand_heating 245.6 → 293.2 MWh (disable → no gain → more heating); demand_cooling 50.9 → 69.1 | ✓ MOVES gain_lighting 0 → 65.8 MWh; loss_external_wall 30.3 → 39.9 | ✓ MOVES light_elec 0 → 65.8 MWh | ✓ MOVES EUI 98.2 → 110.3 | not tested |
| v40.small_power[0].control_factor | 0.5 → 1.0 → 1.5 | ✓ MOVES demand_heating 219.0 → 273.7 MWh | ✓ MOVES gain_equipment 39.4 → 118.3; all loss_* move proportionally | ✓ MOVES sp_elec 39.4 → 118.3 MWh | ✓ MOVES EUI 103.0 → 117.9 | not tested |

**FAIL count: 3 confirmed (×heating_setpoint + ×cooling_setpoint demand FROZEN; summer_bypass direction).** Plus the parity-probe issue (instrumentation).

---

## §2 Grouped findings by root cause

### §2.1 ROOT CAUSE A — calc-vs-display source mismatch (the BIG one)

**Symptom family:** `consumption.{space_heating,space_cooling}.demand_mwh` is frozen on the panel when the user changes the heating/cooling setpoint on the Systems page. Delivered_mwh + fuel + EUI move correctly; demand stays anchored to a different setpoint.

**Affects:** heating_setpoint sweep + cooling_setpoint sweep. Chris's exact reported symptom on the live model.

**Mechanism:**

1. Systems page setpoint slider writes `building.systems_config_v40.heating_setpoint_c` (or `cooling_setpoint_c`) plus mode `'custom'`.
2. State 2 is computed via `_calculateState2(building, ..., comfortBand)` at `instantCalc.js:2357`. **It reads `comfortBand.lower_c` / `upper_c` only** (lines 2371-2376). It does NOT consult `systems_config_v40.heating_setpoint_c` at all.
3. `consumption.space_heating.demand_mwh` is assembled at `instantCalc.js:4747` from `heating_demand_state2_mwh` — which is the State 2 main output (above), still at the comfortBand setpoint.
4. `_computeHeatingOrCooling` at `systemsEngine.js:185` reads the v40 setpoint via `_resolveSetpoint` and calls `state2Recompute({setpointOverride: {heating: setpoint_resolved}})` (L273) to get a RECOMPUTED State 2 demand at the v40 setpoint. This is used for `demand_at_this_setpoint_mwh` and the per-system delivered, but the recomputed value is NOT propagated back to `consumption.space_heating.demand_mwh`.
5. Heat balance display reads `heat_balance.annual.{losses,gains}` — also from State 2 main, also comfortBand-anchored. So heat balance shows the same numbers across the setpoint sweep.

**Why it matters:** the user can change the setpoint, see the EUI move, but read a "Heat needed" number that contradicts the system's actual heating load. The displayed demand and the displayed delivered no longer reconcile.

**Engine architecturally has TWO State 2 results** — the main one (comfortBand) and the recomputed one (v40 setpoint) — and the panel reads inconsistently from both. This is the core source-mismatch disease.

### §2.2 ROOT CAUSE B — Heat-balance display completeness gap (NOT a source mismatch — a missing line)

**Symptom:** vent flow / HRE changes move `losses_at_setpoint.ventilation[].heat_loss_kwh` correctly, but `heat_balance.annual.losses.*` does not move. The user reading a "Heat balance" graph that shows the `losses` block only sees fabric losses, not mech-vent loss.

**Mechanism:** `heat_balance.annual.losses` contains `external_wall`, `roof`, `ground_floor`, `glazing`, `thermal_bridging`, `fabric_leakage`, `permanent_vents`. The mech-vent loss has its own block, `losses_at_setpoint.ventilation[]`. Engine does this on purpose (mech vent is per-system not building-wide); the issue is whether the heat-balance display reads BOTH blocks or only the first.

**Affects:** vent_flow_bedroom, vent_hre_mvhr, summer_bypass — all sweeps that move mech vent.

**Note:** this is NOT calc-vs-display source mismatch in the sense of §2.1. The engine produces the right numbers; the display might or might not surface them. **Need to code-read the actual Heat balance display in the UI to know if this is a bug or just a probe-side framing issue.** (Surfaced for the fix brief to verify; treat as a findings flag, not yet a confirmed bug.)

### §2.3 ROOT CAUSE C — Summer bypass behaviour: bypass-on costs MORE EUI

**Symptom:** Toggling `summer_bypass: false → true` raises both heating AND cooling demand, and increases EUI by 0.4 kWh/m²·yr on Bridgewater.

  - bypass=false: demand_heating 245.60 / demand_cooling 60.50 / EUI 109.90
  - bypass=true:  demand_heating 247.70 / demand_cooling 69.10 / EUI 110.30

**Why suspicious:** summer bypass is a free-cooling damper. Conceptually, enabling it should LOWER cooling demand (free cool air bypasses heat exchanger, cools the zone) at the cost of LOSING heat recovery in hours where the bypass fires. The cooling-demand RISE is paradoxical.

**Hypothesis (parked from Brief 53):** the bypass trigger is lagged (`prev_cooling_demand > 0 AND T_out < prev_T_air`). If the trigger fires in hours when the building wanted heating recovery (heating-direction hours), bypass throws away wanted recovery → MORE heating demand AND somehow more cooling demand (because the gain bucket shifts). The right diagnostic is the **bypass-hour decomposition** Brief 61 calls out: of hours bypass fires, classify each as (a) genuine cooling-demand hour or (b) heating-direction hour. Brief 61 §2 explicitly scopes this; not done in this sweep (the sweep just records the symptom).

**Disposition:** REAL FINDING. Whether it's a bug or correct physics depends on the bypass-hour decomposition. The fix-brief should run that classification before any code change.

### §2.4 ROOT CAUSE D — Parity probe instrumentation issue (parking the question)

**Probe result:** for 3 representative inputs (heating_scop, vent_hre, lighting_control), the intervention-applied result returned with `total_elec_mwh = 0`, `delivered_heating_mwh = 0` across the board — uniformly zero, regardless of the patch. The baseline-edit results were sensible (304-323 MWh elec).

**Diagnosis:** the probe wasn't extracting `stackResult.interventions[0].result` correctly, OR the intervention patch wasn't applying. The uniform-zero pattern across three different patches strongly suggests an instrumentation bug rather than a real divergence between baseline-edit and intervention paths.

**Disposition:** the parity question stays open. A real Part 4 closure requires a corrected parity probe. **NOT GROUPED with the real root causes A-C** — flagged separately as "probe needs fixing before parity finding can be trusted". Likely fix is in the probe's `runInterventionStack` call setup, not in any engine field.

### §2.5 ROOT CAUSE E (provisional) — `dhw_load_shape` toggle untestable in the sweep

`dhw_load_shape` 'flat' vs 'follow_occupancy' produced 0 moved fields across all tracked outputs. Per Brief 58 B4, this is **CORRECT by design** — the toggle is timing-only and annual totals are invariant. The sweep can't see hourly profiles. **Not a bug.** A future panel test (or trace_calc.mjs's hourly_kwh inspection) would observe the shape difference.

---

## §3 Source map — setpoints (the §2.1 disease, mapped end-to-end)

| field | where written | where the demand integrand reads | where each display reads |
|---|---|---|---|
| `heating_setpoint_c` (custom mode) | Systems-page setpoint UI → `building.systems_config_v40.heating_setpoint_c` + `heating_setpoint_mode='custom'`. Patched through `useProjectMutation`. | **NOT READ** by State 2's main demand integrand. State 2 reads `comfortBand.lower_c` only at `instantCalc.js:2371`. | Calc Trail / Breakdown panel's "Heat needed" row: reads `consumption.space_heating.demand_mwh` = State 2 main output = comfortBand-anchored. **FROZEN.** |
| (same) | (same write) | (same — main demand frozen) | Calc Trail "Heating delivered": reads `consumption.space_heating.delivered_mwh` which comes from the v40 path's `_computeHeatingOrCooling` → `state2Recompute({heating: v40_setpoint})`. **MOVES.** Internal split: `_computeHeatingOrCooling` (`systemsEngine.js:250-307`) reads the v40 setpoint via `_resolveSetpoint`, recomputes State 2 at that setpoint, delivers against it. |
| (same) | (same write) | (same — main demand frozen) | Heat-balance graph (panel): reads `heat_balance.annual.losses` + `gains` = State 2 main output = comfortBand-anchored. **FROZEN.** |
| (same) | (same write) | (same — main demand frozen) | EUI / Carbon (headline): reads `consumption.total.electricity_mwh` + `gas_mwh` which include the recomputed-fuel. **MOVES.** |
| `cooling_setpoint_c` (custom mode) | mirror of heating | mirror — State 2 reads `comfortBand.upper_c` only | mirror — `consumption.space_cooling.demand_mwh` FROZEN; delivered + fuel + EUI MOVE |

**The contradiction visible on screen:** with heating_setpoint raised 21 → 28 °C, the panel shows the "Heat needed" row unchanged at 245.6 MWh, the "Heating delivered" row at 493.5 MWh, and a SCOP of ~2.57. The user reads: "the system delivers 493 MWh against a 245 MWh need — at 200% over-delivery?" That's the symptom.

**The fix is architectural:** EITHER the main State 2 integrand should read the resolved v40 setpoint (so the comfortBand setting becomes only a UI default, not a hard-coded engine constant), OR every display that reads State 2 main demand must also read the recompute. Either way it needs to be ONE source.

---

## §4 Reconciliation sweep (Brief 61 Part 3, focused subset)

The Brief 60 walkthrough fix already installed an in-component consistency check on the new Calc Trail panel (Σ per-service = Total + cross-references). That panel reconciles per `docs/audit/60_a_panel_consistency.json` (passed).

The OTHER panels (BreakdownPanel chain-context view, BeforeAfterBars, Heat-balance graph, Sankey) have NOT been instrumented with the same check. **Suspect that any panel showing `consumption.space_heating.demand_mwh` next to `consumption.space_heating.delivered_mwh` exhibits the §2.1 contradiction on a heating-setpoint sweep.** Verification of those panels was out of scope for this audit — flagging for the fix brief.

---

## §5 Recommended fix-brief breakdown

Three fix-briefs scope cleanly from the grouped findings, plus the parity probe to fix in passing. Ordered by criticality:

### §5.1 Brief 62 (CRITICAL) — Single-source setpoint resolution (§2.1)

Fix the State 2 demand integrand to read the resolved v40 setpoint (not just comfortBand). This collapses the two State-2 results into one, and the panel's demand_mwh moves with the slider.

**Approach options (architect to choose):**

- **(a)** State 2 takes a `resolvedSetpoint` arg (computed from v40_setpoint_mode/value before State 2 runs); comfortBand becomes a UI-default for the slider only, not an engine input.
- **(b)** Keep State 2 as-is on comfortBand; promote the v40-recomputed State 2 result to BE the primary `consumption.space_heating.demand_mwh` source. The recompute path becomes the canonical demand surface.

Either path produces a single source for demand. Option (a) is the cleaner "one State 2 result" architecture; (b) is the smaller diff but keeps the dual computation.

**Gate:** heating_setpoint sweep 21 → 24 → 28 shows demand_heating_mwh MOVING in proportion to delivered_heating_mwh — Δ demand = Δ delivered (by definition, since fuel = delivered ÷ η). Same for cooling. Heat balance display reflects the new setpoint. Anchor (Bridgewater clean baseline EUI 110.30 at the current heating_setpoint_mode = 'follow_comfort' default) holds when no setpoint custom override is set.

### §5.2 Brief 63 — Summer-bypass hour decomposition (§2.3)

Diagnostic FIRST, fix after if needed. Decompose bypass-firing hours on the MVHR-bedrooms 2×SFP intervention into (a) cooling-direction vs (b) heating-direction. If (b) > 0, the lagged trigger is misfiring and the fix is the trigger formula. If (b) = 0, bypass-on raising EUI is real physics and the visualisation needs to explain the cost trade-off rather than the calc needing change.

**Gate:** the trigger decomposition produces specific hour counts per category. Recommend re-running on the refbox HOT case in parallel to compare against a project that has clearer cooling-dominated hours.

### §5.3 Brief 64 — Heat-balance display completeness (§2.2)

Audit the actual Heat balance graph component (NOT done in this read-only audit — out of probe scope). Determine whether it reads `losses_at_setpoint.ventilation[]` in addition to `heat_balance.annual.losses`. If yes → fine, no change. If no → add mech-vent rows so heat balance properly accounts for vent loss.

**Gate:** vent_flow sweep shows the heat balance graph's "ventilation" row moving when vent flow changes.

### §5.4 Sidecar — fix the Brief 61 parity probe (§2.4)

`scripts/_brief61_consistency_sweep.mjs` PARITY_TESTS section returns zero intervention results. Quick fix to the runInterventionStack invocation, then re-run to close Part 4. NOT a brief — a single-commit probe correction.

### §5.5 NOT a new fix brief

The Brief 60 share_pct retirement (proposed at `docs/audit/60_share_pct_audit.md`) STAYS as its own scoped brief — Brief 61 didn't surface anything that changes its scope.

---

## §6 What was NOT done (read-only scope limits)

- **Browser walkthroughs at 1440×900.** All findings come from engine-probe sweeps, not in-screen verification. The actual rendered panels may surface the §2.1 contradiction differently than the engine traces predict. The fix brief should verify in browser.
- **The OTHER visualisations (Sankey, Heat balance graph, BeforeAfterBars, Breakdown chain-context).** Audit was scoped to the engine-output level. Display-side verification deferred.
- **The Brief 53 bypass-hour decomposition.** Brief 61 §2 listed this as part of Part 2 sweep; the sweep observed the bypass-on-costs-more symptom but did NOT run the per-hour classification. Brief 63 should.
- **Parity Part 4.** Probe instrumentation issue blocked Part 4 closure. See §5.4.

---

## §7 Sweep methodology + replication

`scripts/_brief61_consistency_sweep.mjs` on Bridgewater + verification DB (`:8003`). For each sweep:
1. Deep-clone `building_config`.
2. Apply the input mutation.
3. Run `calculateInstant(..., { mode: 'full', _skipInterventions: true })`.
4. Read 33 tracked output fields into a snapshot.
5. Compare snapshots across the sweep values.
6. Classify each field as MOVED (range > max(0.005, 0.1% of mean)) or FROZEN.

Re-run: `node scripts/_brief61_consistency_sweep.mjs` — writes `docs/audit/61_consistency_sweep.json` (full per-sweep / per-field trace).

---

## §8 Suggested ordering for Chris

Brief 60 Part B (auxiliary energy) and Part C (parity guard) remain queued. The Brief 61 matrix suggests they wait for:

1. **Brief 62 setpoint single-source fix** (CRITICAL) — without it, every panel showing demand vs delivered shows a contradiction on setpoint changes. The auxiliary energy work (Brief 60 B) lands rows in the same panel; better to land Brief 62 first so the new rows aren't built into a contradictory frame.

2. **Sidecar parity probe fix + closure of Part 4** (~30 min). Confirms whether the baseline-vs-intervention parity holds across the engine — answers the question Brief 60 Part C wants to permanently guard.

3. **Brief 60 Part C (parity guard)** — relies on §5.4 close to know what real divergence (if any) the guard must catch.

4. **Brief 60 Part B (auxiliary energy)** — additive, can land any time after Brief 62.

5. **Brief 63 bypass diagnostic** — independent; can run in parallel.

6. **Brief 64 heat-balance display completeness** — defer until browser walkthrough confirms the actual display gap.

---

## §9 Update to the Notion diagnostics note

Per brief §88, post the grouped findings:
- §2.1 calc-vs-display source mismatch (setpoint demand frozen) — confirmed empirically; specced as Brief 62.
- §2.2 heat-balance display completeness gap — flagged; specced as Brief 64 (verify in browser first).
- §2.3 summer-bypass direction question — confirmed symptom; needs hour decomposition (Brief 63).
- §2.4 parity probe instrumentation — Part 4 closure blocked; sidecar fix queued.
- §2.5 `dhw_load_shape` correct by design (no finding).

Reconciliation note for the Notion: this audit ABSOLUTELY HONOURED the read-only constraint. No engine touches, no UI fixes. The deliverable IS this document.
