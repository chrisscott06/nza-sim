# Brief 88 design note — Strategy baseline state-sync

## Where this came from

Walkthrough of Brief 87 (Library/Strategy UX rework) on the `chris/interventions-rework-ux` branch surfaced a baseline disagreement between modules:

- **Systems page** displays EUI **139.5 kWh/m²·yr** for Bridgewater Hotel
- **Interventions → Strategy page** displays "Baseline EUI **245.6 kWh/m²·yr**" in the waterfall header and starting bar

Same project, same `ProjectContext`, same session, same browser tab. The numbers are ~100 kWh/m² apart. That's not a tweak between page loads — that's a real bug.

A persistent **"Save failed"** indicator appears across every screenshot. Independent issue, surfaced during the same testing session.

## The product principle being broken

NZA-Sim's product proposition is the interactive, real-time engine. The whole point of the tool is that users can tweak any building input and see the response immediately — that's what makes the interventions framework meaningful. Strategy baseline is not a frozen snapshot; it is *whatever the building currently is*, before interventions are applied. Any divergence between Systems page EUI and Strategy baseline EUI is a state-sync bug, not a design choice.

This principle is locked. **Live baseline everywhere.** Frozen baselines only become relevant if/when the EnergyPlus-as-canonical-results layer (roadmap thread 1 in the NZA-Sim guidebook) lands — and only on the EnergyPlus side. For NZA-Sim, the engine is fast enough that re-running on every render is the natural pattern.

## What the source-read confirmed

`interventionsEngine.js` is clean. `runInterventionStack(baselineConfig, …)` runs the engine on `baselineConfig` itself to produce `rollingResults[0]` — which becomes both `stackResult.baseline` and the `cumulative_delta.from` value the Strategy waterfall displays. The engine never invents a baseline number — it computes it from whatever `baselineConfig` is passed in.

`InterventionsModule.jsx` calls `calculateInstant(paramsForEngine, …, { mode: 'full', comfortBand, engine: 'v2.5' })`. Same shape as the Systems module. Both pages feed `ProjectContext` state into the same engine entry point with what appears to be the same options.

`StrategyView.jsx` reads `cumulative_delta.eui_kwh_per_m2.from` for the "Baseline 245.6" display. That `from` value IS the EUI of `rollingResults[0]` — the engine's own pass on the baseline config the stack runner was given.

**The unanswered question is what happens inside `calculateInstant` (in `instantCalc.js`).** The file is ~7000 lines; I could only fetch the first half. The relevant region is around the State 3 dispatch (memory cites L4914 + L6669) where `runInterventionStack` is called. The question is: **does the inner `runEngine` closure that the stack runner uses preserve the same v40-routing options as the outer `calculateInstant` call?**

If it doesn't — if the inner closure falls through to the inline-legacy path (UK_HDD = 2200 hardcoded constants, no v40 systems efficiency, no per-system mech vent) — then `rollingResults[0]` is computed via inline-legacy while `consumption.total.kwh_per_m2_yr` is computed via State 3. Same project, two different EUIs. That's exactly the Brief 76 bug-family on a different consumer call site that didn't get the fix.

## Why this is the leading hypothesis

Four reasons:

1. **Magnitude.** The 245.6 vs 139.5 gap is roughly the magnitude of the State 3 / inline-legacy gap on Bridgewater. State 3 reflects v40 systems efficiencies (VRF SCOP, DHW heat pump, mech vent fan SFP). Inline-legacy assumes generic system losses with degree-day correlations.

2. **Persistence.** The gap doesn't change as you click around the UI. That rules out transient state issues. It's consistent with a structural code-path divergence.

3. **Symptom shape matches Brief 76.** Brief 76 fixed the v40-routing for the live engine pass on the Systems page. If the InterventionsModule's stack runner inherited the same bug for its baseline computation, you'd see exactly this pattern: Systems correct, Interventions baseline ~100 higher.

4. **The architecture invites it.** The stack runner calls `runEngine(cfg)` where `runEngine` is a closure built inside `calculateInstant`. The closure has to re-thread options carefully. If it was constructed before Brief 76's fix landed, or if the fix was applied to one closure but not the other, this is exactly the kind of bug that survives undetected because it only fires when interventions are present (and Brief 76's verification was on the Systems page with no interventions).

There are other possible causes (stale state from save failures; comfortBand threading inconsistency; the baseline config being differently shaped from what the engine expects), but none match the magnitude or symptom shape as cleanly.

## What Brief 88 does

Three threads, in order of dependency:

**Thread A — Source-read diagnostic (Tier-2 audit, read-only).**

Code reads the `instantCalc.js` State 3 dispatch and the call site of `runInterventionStack`. Documents in audit §A with file + line references:

- Where `runInterventionStack` is called from
- How the `runEngine` closure passed to it is constructed
- What options that closure passes through to `calculateInstant` when invoked on the baseline config
- Whether those options include `engine: 'v2.5'` (or whatever flag triggers v40 routing)
- Comparison: what options does the Systems module's main `calculateInstant` call use? Same? Different?

Output: ranked hypotheses with evidence. Confirm or refute the inline-legacy fallback theory.

**Thread B — Targeted fix.**

Whatever the diagnostic finds, fix the smallest possible thing that makes the Strategy waterfall's leftmost bar exactly equal the Systems page's EUI for the same project state.

Falsifiability gate: load Bridgewater. Note Systems EUI. Switch to Interventions → Strategy. Confirm leftmost waterfall bar matches. Walk one input change in Systems (e.g. nudge a SCOP). Switch back to Strategy. Confirm baseline has updated to match Systems' new EUI. Both numbers track together at all times.

**Thread C — "Save failed" audit.**

Read-only diagnostic of the save endpoint failures. Browser dev tools network tab is sufficient — capture the failing request, HTTP code, response body. Identify whether this is client-side validation, server-side rejection, or transport. Fix in the same brief if the cause is small (likely a payload-shape issue or a missing field in the post-Brief-87 schema change). Escalate to a separate brief if it's architectural.

## What Brief 88 does NOT do

- **No Calc Trail restructure.** The before/after value display, the four-tier presentation, the propagation-trace from input to demand to fuel to carbon — all separate UX work. Trying to improve the Calc Trail while the headline numbers are wrong is sand-on-sand.
- **No DHW-occupancy audit.** The Occupancy 2 intervention's blank DHW demand delta + 63 MWh gas saving is a real engine question, but separate from this brief's scope. Captured for a follow-on brief.
- **No engine architectural changes.** Brief 41's declarative-patches model stays untouched. The interventions engine doesn't change. The fix lives in whatever wiring is currently misreading state.
- **No frozen-baseline workflow.** Live read is the principle. Brief explicitly does not add any "capture baseline" or "freeze project state" feature.
- **No Brief 87 close changes.** Brief 87 remains in Part 6 cleanup / Part 7 walkthrough state. Brief 88 lands on the same branch, must close before the PR to `main`.

## Branch

Continues on `chris/interventions-rework-ux`. Both Brief 87 close and Brief 88 close on the same branch; single PR to `main` once both are clean.

## Decision log

**26 June 2026:** Chris confirms live baseline is correct architecture for NZA-Sim. The Strategy waterfall must reflect current project state, not a captured snapshot. Frozen baselines are only relevant for the EnergyPlus canonical-results layer (separate future work). "Save failed" indicator added as Thread C — independent issue surfaced during the same testing session, fix in the same brief if small.

**Architect track record (banked):** This brief's framing was reached after an architect mistake earlier in the same session. The first pass reasoned from "the engine architecture should produce consistent results, therefore it does." Chris pushed back with the Systems-page screenshot showing 139.5 — the engine demonstrably wasn't producing consistent results. The correction: source-read is mandatory before declaring something correct, not just before declaring it broken. Confirmed: the architect's job is to verify, always.
