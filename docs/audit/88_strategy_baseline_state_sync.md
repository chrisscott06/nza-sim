# Audit — Brief 88: Strategy baseline state-sync (diagnostic + targeted fix)

Branch: `chris/interventions-rework-ux` (same branch as Brief 87; both close before single PR to `main`).
Design note (canonical): [`docs/design-notes/88_strategy_baseline_state_sync.md`](../design-notes/88_strategy_baseline_state_sync.md).
Brief: [`docs/briefs/active/88_strategy_baseline_state_sync.md`](../briefs/active/88_strategy_baseline_state_sync.md).

**Principle (locked):** live baseline everywhere — the Strategy waterfall's baseline EUI must equal the
Systems page's EUI at all times, for the same project state. No frozen snapshots. The fix (if any) is in
the caller's option-passthrough, never in the engine numbers or `interventionsEngine.js`.

## §A — Part 2: source-read diagnostic (read-only)

**A0 — Does the bug currently reproduce?** (verify-first, per the design note's banked architect lesson)
_(to fill — read Systems EUI vs Strategy baseline in the browser before assuming the hypothesis)_

**A1 — SystemsModule `calculateInstant` call** — signature, options, which field is read for the 139.5 EUI.
_(to fill — file:line)_

**A2 — InterventionsModule `calculateInstant` call** — signature, options, the chain
`stackResult.baseline` → `cumulative_delta.eui_kwh_per_m2.from` → Strategy waterfall.
_(to fill — file:line)_

**A3 — `_runInterventionStack` call site inside `instantCalc.js`** — the `baselineConfig` shape + the
inner `runEngine` closure: does it preserve `engine:'v2.5'` (v40 routing) + `comfortBand`?
_(to fill — file:line)_

**A4 — Where the divergence opens** — ranked hypotheses with evidence (H1 inner closure drops v2.5 →
inline-legacy; H2 baselineConfig stripped of systems_config_v40; H3 different EUI field/boundary; H4
stale state from save failures).
_(to fill)_

**A5 — Recommended fix shape** — smallest possible change.
_(to fill)_

## §B — Part 3/4: fix + falsifiable visual verification
_(to fill)_

## §C — Part 5: "Save failed" audit + fix-if-small
_(to fill)_
