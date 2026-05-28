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
| `frontend/src/components/modules/interventions/visualiser/VisualiserHost.jsx` | localStorage view-memory ~L64-71 | _TBD_ | |
| `frontend/src/components/modules/interventions/ComparisonView.jsx` | `PairedBar` ~L111 | _TBD_ | |
| `frontend/src/components/modules/interventions/InterventionRow.jsx` | `theme` badge ~L227-232 | _TBD_ | |
| `frontend/src/context/ProjectContext.jsx` | `fresh` object + `theme` field ~L221-229 | _TBD_ | |

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

- **#1 — Isolated first-intervention delta == its stack marginal.** Confirmed when isolated `cumulativeDelta` equals `stackResult.interventions[0].marginal_delta` for the first enabled intervention in the stack order. Result: _TBD_.
- **#2 — Combined surface unchanged.** Bridgewater baseline EUI + After-stack EUI byte-identical before and after Brief 71 lands. Result: _TBD_.

## §5 Notes for future cleanup

- _TBD as the brief progresses._
