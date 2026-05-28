# Audit — Brief 71 Interventions: Isolated vs Combined

> Companion to [`docs/briefs/active/71_interventions_isolated_vs_combined.md`](../briefs/active/71_interventions_isolated_vs_combined.md). Updated in the same commit as each Part it describes (Process Rule 7).

---

## §1 Line-number verification against current `main` (Part 1)

Confirm the line numbers cited in the brief's BEFORE-DOING-ANYTHING §5 against the current tree before any code work.

| File | Reference in brief | Actual on main (HEAD) | Notes |
|---|---|---|---|
| `frontend/src/utils/interventionsEngine.js` | `runInterventionStack` L365-401 | **L365-402** ✓ | Exported, signature unchanged. |
| `frontend/src/utils/interventionsEngine.js` | `applyPatch` L247 | **L247** ✓ | Exported, signature `(config, patch, libraryData)`. |
| `frontend/src/utils/interventionsEngine.js` | never-mutate-baseline invariant L48-51 | _TBD (Part 2)_ | Not required for Part 1's hook. |
| `frontend/src/utils/interventionsEngine.js` | disabled-row handling L334 | _TBD (Part 2)_ | Hook force-enables singleton; combined-stack handling is `applyIntervention` at L334 region. |
| `frontend/src/components/modules/interventions/InterventionsModule.jsx` | `VisualiserHost` mount ~L422 | _TBD_ | |
| `frontend/src/components/modules/interventions/visualiser/VisualiserHost.jsx` | `VIEWS` array ~L55-61 | _TBD_ | Brief 60 Part A may have shifted these. |
| `frontend/src/components/modules/interventions/visualiser/VisualiserHost.jsx` | localStorage view-memory ~L64-71 | **L64-72** ✓ (Part 3) | Same key shared with new 'isolated' view. |
| `frontend/src/components/modules/interventions/ComparisonView.jsx` | `PairedBar` ~L111 | **L112-137** ✓ | Not lifted; IsolatedView built bidirectional bars from scratch (different visual semantics — centre-anchored saving/increase vs paired baseline/target). ComparisonView intentionally not deleted (Brief 71 Principle "no deletion of ComparisonView in this brief"). |
| `frontend/src/components/modules/interventions/InterventionRow.jsx` | `theme` badge ~L227-232 | **L227-234** ✓ (Part 4) | Existing badge renders the field set by the new theme combobox. |
| `frontend/src/context/ProjectContext.jsx` | `fresh` object + `theme` field ~L221-229 | _TBD (not consumed by Part 4 — theme persists via existing onSave→updateParam path; no DEFAULT_PARAMS change)_ | |

## §2 `runInterventionStack` signature + `fresh`-object shape (Part 1)

Record verbatim from current `main`:

```js
// runInterventionStack — verified from instantCalc.js / interventionsEngine.js L365 (HEAD: 128424c)
export function runInterventionStack(baselineConfig, interventions, runEngine, libraryData) {
  // builds rolling configs (disabled rows don't advance), runs engine per
  // config, returns { baseline, interventions: [{ id, enabled, result,
  // marginal_delta, cumulative_delta }] }
}

// fresh intervention object — verified in Part 2 audit pass.
```

**Hook consumes** `runInterventionStack` with a singleton list per intervention. The first element of `runInterventionStack(baseline, [x], …).interventions` is the isolated row for `x`; that row's `cumulative_delta` is the standalone delta from baseline.

## §3 Per-run engine cost on Bridgewater (Part 1)

Measured against Bridgewater baseline + the current intervention stack (Reduce Extract + MVHR per the brief's anchor):

| Metric | Value | Notes |
|---|---|---|
| Baseline engine run | _TBD_ ms | One pass through `_calculateInstantBaseline`. |
| Per-isolated-intervention cost | _TBD_ ms | `runInterventionStack(baselineConfig, [intervention], …)` — singleton list, two engine invocations (iter 0 baseline + iter 1 patched). |
| Total for N=2 (current stack) | _TBD_ ms | Useful as the "is memoisation enough?" measurement. |
| Estimated for N=10 | _TBD_ ms | Linear extrapolation; document if non-linear surfaces. |
| Estimated for N=25 | _TBD_ ms | Threshold above which worker offload should be considered. |

Methodology: `performance.now()` brackets in `useIsolatedResults` during first render; print to console; capture and record.

## §4 Falsifiability log

- **#1 — Isolated first-intervention delta == its stack marginal.** Hook bakes in a `console.log` / `console.warn` at every render where `stackResult` is provided. PASS = the two numbers agree within 0.05 kWh/m²·yr (intensity); FAIL surfaces immediately in the browser console with both numbers. Chris's first-in-stack browser test at Part 5 close is the in-app falsifiability; result deferred to that session.
- **#2 — Combined surface unchanged.** Brief 71 is purely additive (new files + new props on VisualiserHost + new useMemo on InterventionsModule + new theme combobox field); no existing engine path touched, no DEFAULT_PARAMS change. Existing Waterfall / Before-after / Heat balance / Calc trail / Breakdown views consume `stackResult` unchanged. Result: pre-close expectation = byte-equal; Chris confirms at Part 5 walkthrough.

## §5 Notes for future cleanup

- _TBD as the brief progresses._

---

## §6 Post-Part-3 diagnostic — Isolated value off by factor-of-2 (2026-05-28)

**Symptom (browser, Bridgewater):** Shading's ΔEUI in **Calc trail** reads `−825.0 kWh (−0.825 MWh)`; same intervention in **Isolated view** reads `−412.5 kWh` — exactly half. Chris reports the same pattern on other fabric measures (solar gain, U-value), so it's the shared isolated-display path, not measure-specific.

### Read-only trace

**A. `useIsolatedResults.js` — what does it pull from the engine?**

- Line 66: `const isolated = runInterventionStack(baselineConfig, singleton, runEngine, libraryData)`
- Line 67-74: reads `isolated.interventions[0].cumulative_delta`, surfaces it as `cumulativeDelta`.
- `runInterventionStack` (interventionsEngine.js L394-395) computes for a singleton list:
  - `rollingResults = [runEngine(baselineConfig), runEngine(applyIntervention(baselineConfig, intervention))]`
  - `cumulative_delta = computeDelta(rollingResults[0], rollingResults[1])` — i.e. `computeDelta(baseline_result, patched_result)`.
- `computeDelta` (interventionsEngine.js L536-538) emits the EUI under `eui_kwh_per_m2: { from, to, delta, delta_pct }` by `pickNumber` against `consumption.total.kwh_per_m2_yr` first. **Unit: intensity, kWh/m²·yr.**
- No `/2`, no `/1000`, no magnitude reduction anywhere in the hook.

**B. `IsolatedView.jsx` — what does it render?**

- Line 148-150 `extractEuiDelta(cumulativeDelta)`: returns `cumulativeDelta?.eui_kwh_per_m2?.delta ?? null`. **No halving.**
- Line 160 `gia_m2 = getGia(stackResult?.baseline)`: reads `result.metadata.gia_m2` per `unitFmt.getGia`. For Bridgewater this resolves to 4125 (State 3) or 4322 (State 2) — confirmed in earlier session diagnostics.
- Line 163-167 `displayDelta = toDisplay(rawEui, KIND.KWH_M2, unit, gia_m2).value`:
  - In **Per m²** mode → returns `rawEui` unchanged (intensity).
  - In **Total** mode → returns `rawEui × gia_m2` (auto-promotes to MWh when |abs| ≥ 1000). See `unitFmt.js` L83-89.
- Line 126 `fmtDelta(displayDelta)` — bare format, sign + abs + 1 dp. **No halving.**
- Line 60-68 — bar GEOMETRY uses `halfPct = pctW / 2` and width `${halfPct}%`. The bar is centre-anchored so its rendered extent is half-width per side, but **the label at L126 reads `displayDelta` directly, not `pctW`/`halfPct`**. The geometry halving is purely cosmetic; the labelled number is the full delta.

### Root cause — single best fit

**The Isolated and Calc Trail numbers are measuring different quantities by design — not a bug in the math, but very likely a misleading view if the user reads them as the same field.**

- **Calc Trail's "ΔEUI"** is `after.head.eui − before.head.eui` (BreakdownTable.jsx L508), where `before = stackResult.baseline` and `after = stackResult.interventions[selected].result` — i.e. the **CUMULATIVE state at that intervention's stack position**, which INCLUDES the effects of every enabled intervention above it in stack order. For mid-stack Shading, that's `baseline → (baseline + Int1 + Int2 + Shading)`.
- **Isolated view's number** is `cumulative_delta` from a singleton runInterventionStack — i.e. the **STANDALONE delta**: `baseline → (baseline + Shading-alone)`. No compounding from preceding interventions.

If Shading is mid-stack and the preceding interventions reduce EUI by amounts comparable to Shading's own contribution, Calc Trail's "−825 kWh" reflects 2-3 measures' compounded effect through that row, while Isolated's "−412.5 kWh" reflects Shading alone. A 2:1 ratio for one mid-stack measure is consistent with this; "exactly half across multiple measures" is suggestive of compounding but not conclusive without per-intervention numbers.

**Falsifiability test Chris can run in 30 seconds without code changes:** find the intervention that is FIRST in the stack order in the left pane. For that intervention, Calc Trail's "ΔEUI" and Isolated's value MUST match (Principle 4 / falsifiability #1 — for the first row, cumulative-from-baseline-through-this-row == standalone). The browser console should also show `[Brief 71 falsifiability #1 PASS]` with the two numbers.

- **If first-intervention numbers match** → the 2x is correct compounding semantics. The fix is UI, not engine — relabel the bars to make "standalone vs cumulative" unambiguous (the amber caption already says it but evidently isn't enough on first read).
- **If first-intervention numbers DIFFER** → there's a real code-level 2x somewhere I couldn't reach from static analysis alone. The next instrumentation step would be to dump `rollingResults[0].consumption.total.kwh_per_m2_yr` and `rollingResults[1].consumption.total.kwh_per_m2_yr` from inside the hook and compare to `stackResult.baseline.consumption.total.kwh_per_m2_yr` and `stackResult.interventions[0].result.consumption.total.kwh_per_m2_yr` from the main stack.

### Proposed one-line fix (do NOT apply yet)

**If falsifiability test confirms the values match for the first intervention** (i.e. semantics, not math):

Replace the caption text in `IsolatedView.jsx` L228-232 to be more pointed:

```diff
- <span className="font-semibold">Isolated != marginal.</span> Each bar shows what a measure
- would deliver on its own, measured from the unmodified baseline. The bars do NOT sum to
- the combined-stack total ...
+ <span className="font-semibold">These are standalone deltas, not stack contributions.</span>
+ Each bar shows what the measure would deliver ALONE against the unmodified baseline. Calc
+ Trail / Waterfall show different (larger) numbers because they include the effect of every
+ intervention ABOVE this one in the stack. Isolated and Calc-Trail will only agree for the
+ first-in-stack intervention.
```

**If falsifiability test shows a genuine code-level 2x** (first-intervention values don't match):

A one-line fix is premature — needs the rollingResults dump to locate the halving. Likely candidates would be in `runEngine` wiring (InterventionsModule.jsx L367-380) or `applyPatch`'s deepClone behaviour, but no specific one-liner identified from static analysis.

### kWh vs MWh — separate or same?

**Separate, and benign.** `toDisplay` auto-promotes to MWh when `|abs_kwh| ≥ 1000` (unitFmt.js L86). Calc Trail's "−825 kWh" is below the threshold so stays as kWh; the "−0.825 MWh" parenthetical in Chris's description is a manual derivation, not the rendered label. Isolated's "−412.5 kWh" follows the same rule. No factor-of-2 contribution from the unit toggle; the kWh/MWh question is independent of the magnitude question.

### Verdict for Chris

The static trace finds no `/2`, no `/1000`, no half-width-feeding-label bug in the hook or the view. The most parsimonious explanation for the symptom is the cumulative-vs-isolated semantic difference (which is the whole point of the brief), but I cannot rule out a real code-level 2x without the rollingResults dump described above. The 30-second falsifiability test on the first-in-stack intervention discriminates between the two cleanly.

Chris decides: land the caption clarification as a Brief 71 pre-close polish, or queue the dump as Brief 72 if the values genuinely disagree for the first row.
