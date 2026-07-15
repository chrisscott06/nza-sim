# Interventions — re-authored results, isolated vs Model 2 (report 4.8)

**Brief:** `docs/briefs/active/interventions-fix.md` (Part B4). **Date:** 2026-07-15.
**Baseline:** "Bridgewater Hotel — calibrated (Model 2)", EUI 185.1, GIA 4,215 m².
**Method:** each measure applied ALONE to Model 2 via the production
`runInterventionStack` + `computeDelta` path (`scripts/_model2_stack_rerun.mjs`);
end-use decomposition + residual proof via `scripts/_model2_interventions_run.mjs`.
Carbon/£ machinery unchanged (Briefs 100/101) — this doc covers the energy re-run.

Model-2 baseline end-uses (MWh): DHW 250.8 (elec 43.1 + gas 207.7) · fans 40.4 ·
lighting 77.8 · small power 330.0 (of which attributed Small Power ≈ 73.9, laundry
34.5, **residual 147.75**) · heating-elec 30.9 · cooling-elec 50.2.

## 4.8 per-measure table (isolated vs Model 2)

| Measure | ΔEUI | Δelec MWh | Δgas MWh | ΔTotal MWh | Verdict vs stale |
|---|---:|---:|---:|---:|---|
| 1_1 Low-flow fittings | −11.6 | −8.20 | −40.50 | **−48.70** | now reads converged L |
| 1_2 WWHR | −10.7 | −7.57 | −37.39 | **−44.95** | " |
| 1_3 Exhaust-air ASHP | −1.3 | −5.25 | 0 | **−5.25** | **was +8 → SAVING** |
| 1_4 Larger ASHP (DHW off gas) | −34.3 | +63.05 | −207.70 | **−144.65** | approximation, see §3 |
| 2_2 Fan duty | −3.6 | −14.92 | 0 | **−14.92** | **was +0.3 → SAVING** |
| 2_4 Trickle-vent EA ×0.5 (NEW) | −0.1 | −0.50 | 0 | **−0.50** | illustrative, CONFIRM-505 |
| 3_1 VRF commissioning | −2.2 | −9.37 | 0 | **−9.37** | **was +6.6 → SAVING** |
| 3_2 VRF replacement | −3.7 | −15.58 | 0 | **−15.58** | **was +1.8 → SAVING** |
| 3_3 Setpoints ±1K | −3.9 | −16.28 | 0 | **−16.28** | widen 22/23→21/24 |
| 3_4 Glazing solar film | −1.6 | −6.72 | 0 | −6.72 | Class-S, unchanged |
| 3_5 Brise soleil | −0.2 | −0.84 | 0 | −0.84 | Class-S, unchanged |
| 4_2 Keycard shut-off | −4.5 | −18.86 | 0 | **−18.86** | **was +70 → SAVING** |
| 5_2 Communal lighting | −2.8 | −11.72 | 0 | **−11.72** | scale ×0.85 |
| 2_1a MVHR @2208 l/s | **+8.3** | +35.00 | 0 | **+35.00** | net penalty (no bypass) — §2 |
| 2_1b MVHR @1656 l/s | **+7.1** | +30.14 | 0 | **+30.14** | net penalty (no bypass) — §2 |

## Sign-change list (penalty → saving vs Model 2)

The re-authoring flipped five measures that the diagnostic caught computing as penalties
against the stale absolutes:

| Measure | Stale (vs pre-D1 absolute) | Re-authored (relative vs Model 2) |
|---|---:|---:|
| 1_3 exhaust-air ASHP | **+8.0** (mis-authored VRF de-rate) | **−5.25** |
| 2_2 fan duty | +0.3 | **−14.92** |
| 3_1 VRF commissioning | +6.6 | **−9.37** |
| 3_2 VRF replacement | +1.8 | **−15.58** |
| 4_2 keycard | **+70.3** (absolute > live) | **−18.86** |

## Conservation check (no measure saves more than the end-use it touches)

| Measure | Saving | End-use touched (baseline) | OK |
|---|---:|---|:--:|
| 1_1 / 1_2 / 1_3 | 48.7 / 45.0 / 5.25 | DHW 250.8 | ✓ |
| 1_4 | 144.65 (net) | DHW 250.8 | ✓ |
| 2_2 | 14.92 | fans 40.4 + heating 30.9 | ✓ |
| 3_1 / 3_2 / 3_3 | 9.4 / 15.6 / 16.3 | heating+cooling 81.1 | ✓ |
| 4_2 | 18.86 | attributed Small Power 73.9 (NOT residual 147.75) | ✓ |
| 5_2 | 11.72 | lighting 77.8 | ✓ |
| 2_4 | 0.5 | envelope/infiltration | ✓ |

All pass. `_model2_interventions_run.mjs` asserts the residual is byte-identical after
every measure (B3, exit 1 otherwise) — PASS for all 13 patched measures.

## §1 — Verification-2 evidence: 1_1/1_2 read the converged L live

`1_1` scales `dhw_demand_litres_per_person_per_day` ×0.805 off **live** state. Against
Model 2 the live value is the gas-anchored converged **57.57 L/p/day** (Part 3), so the
measure lands at 57.57 × 0.805 = 46.34 L/p/day — it tracks the anchor rather than fighting
it. Proof: the isolated run produces Δgas −40.50 MWh, exactly the demand-reduction share of
the 207.7 MWh gas anchor; a frozen absolute (old 44.3) would have been baseline-dependent
and, post-anchor, wrong. `scale`/`delta` throw on a missing path, so an un-resolvable
DHW-demand path would fail loudly rather than silently no-op.

## §2 — MVHR (2_1a / 2_1b): net penalty as-modelled, components for the with-bypass bound

Both variants convert the bedroom extract to MVHR (SFP 1.8, 80% sensible recovery, **no
summer bypass**) and seal the trickle-vent path. **Net penalty as-modelled (no bypass)** —
the year-round recovery adds cooling demand that swamps the heating and fan sides. Components
are reported so the **with-bypass bound can be constructed** (this is a bound, not a claim —
bypass is imperfect and is ungated engine work):

| | Total | fans | heating | cooling | sealed-vents (of total) |
|---|---:|---:|---:|---:|---:|
| 2_1a @2208 | +35.00 | +18.75 | −30.29 | +46.53 | +3.89 (MVHR-only +31.11) |
| 2_1b @1656 | +30.14 | +10.05 | −30.54 | +50.63 | +4.03 (MVHR-only +26.12) |

**The sign has changed vs the Model-1 analysis:** the heating benefit is now **−30 MWh**
(at SCOP 2.8 the recovered heat is worth more electricity than under Model-1's SCOP 5.0),
against fans +18.8 / +10.1. An **ideal** bypass (removes the cooling penalty entirely) would
bound **2_1a near −11.5** and **2_1b near −20.5 MWh saving**. This materially changes the 505
conversation — MVHR is unattractive as-modelled but plausibly the largest single fabric-side
saving once summer bypass is modelled (the gated thermal-engine brief). The sealed-vents
component is itself a small penalty (+3.9/+4.0 MWh — sealing loses free cooling in this
gains-dominated building), reported separately per D7.

## §3 — 1_4 (larger ASHP): approximation flagged

Isolated-run convention: 1_4 is measured alone vs Model 2; composed **after** 1_1/1_2 the DHW
demand it serves would shrink accordingly (smaller saving). The energy model treats DHW as
**100% ASHP annually** (gas share → 0): Δgas −207.70 (the full anchor) + Δelec +63.05 (ASHP at
COP 2.8). **Approximation:** the gas calorifiers are physically retained as peak/backup plant
but carry no annual load in this representation — flagged, not hidden.

## §4 — 2_4 (trickle-vent) and D5 (bypass) status

- **2_4** EA ×0.5 is **illustrative** — 505 specify no reduction quantum. Practical floor set
  by make-up air / face velocity (~×0.6–0.7 likely limit); superseded inside the MVHR variants
  (EA→0). Marked **CONFIRM-with-505** in the export basis string.
- **2_3** HR-bypass stays off-model (0 patches, no claimed effect); simulatable only after the
  gated thermal-engine session adds a bypass model.

## Divergences (Lessons)
- **3_3 setpoints** realised via `set` custom 21/24, not `delta` — Model-2 `follow_comfort`
  exposes no numeric setpoint to delta from; the ±1K widening is derived from the live band.
  Setpoints are absolute temperatures (not the forbidden L/p/day `set`).
- **1_4** ASHP COP de-rate dropped (no side-effect); COP owned by 1_3.
- **MVHR sealed-vents** is a penalty, not a saving, in this gains-dominated building.
