# Audit — Brief 88: Strategy baseline state-sync (diagnostic + targeted fix)

Branch: `chris/interventions-rework-ux` (same branch as Brief 87; both close before single PR to `main`).
Design note (canonical): [`docs/design-notes/88_strategy_baseline_state_sync.md`](../design-notes/88_strategy_baseline_state_sync.md).
Brief: [`docs/briefs/active/88_strategy_baseline_state_sync.md`](../briefs/active/88_strategy_baseline_state_sync.md).

**Principle (locked):** live baseline everywhere — the Strategy waterfall's baseline EUI must equal the
Systems page's EUI at all times, for the same project state. No frozen snapshots. The fix (if any) is in
the caller's option-passthrough, never in the engine numbers or `interventionsEngine.js`.

## §A — Part 2: source-read diagnostic (read-only)

### A0 — Does the bug currently reproduce? **NO.** (verified first, per the banked lesson)
Browser, current Bridgewater state (2026-06-26):
- **Systems page EUI = 139.5 kWh/m²**
- **Strategy headline baseline = 139.5**
- **Left "Baseline" card = 588.1 MWh** — which is *the same number*: 588.1 MWh × 1000 ÷ 4,216 m² = 139.5 kWh/m² (it reads MWh because the global toggle was on "Total"). The "245.6" of the design note does **not** reproduce. All three baselines agree.

The systems config was regenerated to main's defaults mid-Brief-87 (EUI ~139.5); the 245.6 was the state at the time of Chris's walkthrough, not the current state.

### A1 — SystemsModule call
`SystemsModule.jsx:180` (and `systems/SystemsLiveResults.jsx:294`):
`calculateInstant(params, constructions ?? {}, systems ?? {}, libraryData, weatherData, hourlySolar, null, { _skipInterventions: true, comfortBand })` — **no `mode`, no `engine:'v2.5'`**. EUI displayed from **`result.eui_kWh_m2`** (`SystemsLiveResults.jsx:400`).

### A2 — InterventionsModule call
`InterventionsModule.jsx:186–189`:
`calculateInstant(paramsForEngine, constructions, systems, libraryData, weatherData, hourlySolar, null, { mode: 'full', comfortBand, engine: 'v2.5' })`. `stackResult = engineResult.consumption.interventions`; baseline = `stack.baseline` (rollingResults[0]); Strategy reads `cumulative_delta.eui_kwh_per_m2.from` = **`consumption.total.kwh_per_m2_yr`** of that baseline result (`StrategyView.jsx`, `InterventionsModule` baselineSummary).

### A3 — `_runInterventionStack` call site + inner closure (`instantCalc.js:7311–7339`)
- `baselineConfig = { building, constructions, systems, libraryData }` (L7322) — **includes `systems`**.
- The inner runEngine closure (L7323–7332):
  ```js
  const runEngine = (cfg) => _calculateInstantBaseline(
    cfg.building ?? building, …,
    { ...options, _skipInterventions: true },   // ← spreads options
  )
  ```
  **It spreads `{ ...options }`** — so `engine:'v2.5'` and `comfortBand` from the outer call ARE preserved. The baseline pass runs the same dispatch as the fast path (`_calculateInstantBaseline`, L7317).

### A4 — Ranked hypotheses (after source-read)
- **H1 (inner closure drops `v2.5` → inline-legacy): REFUTED.** The closure spreads `{...options}` (instantCalc.js:7331); `v2.5` is preserved. If H1 were true the bug would reproduce structurally — it doesn't.
- **H2 (baselineConfig stripped of systems): REFUTED.** `baselineConfig` includes `systems` (instantCalc.js:7322).
- **H3 (different EUI field / boundary): PLAUSIBLE LATENT RISK — the only real inconsistency found.** Systems reads `result.eui_kWh_m2` (`= total_kWh / gia`, instantCalc.js:6144/7011); Strategy reads `consumption.total.kwh_per_m2_yr` (instantCalc.js:5584/5775). These are **independently computed** in different regions of the engine. Currently identical (both 139.5) but they *could* diverge if the two `total` sums ever differ. The design note's own boundary principle says both should read `consumption.total.kwh_per_m2_yr`.
- **H4 (stale state from save failures): LEADING explanation for the original 245.6.** Structural paths are correct + bug doesn't reproduce + saves currently work → the 245.6 was almost certainly transient stale/desynced state at walkthrough time (possibly the H3 fields diverging in that state, or a stale `systems`/`paramsForEngine`).

### A5 — Recommended fix shape
**No option-passthrough fix is warranted** (H1/H2 refuted; the closure is correct). The brief's leading hypothesis is wrong — flagging per the premise-check authority (same as Briefs 76/83/84). The only principled, *available* change is **H3 harmonisation**: make the Systems page read `consumption.total.kwh_per_m2_yr` (the same boundary the Strategy + the design note specify) instead of `eui_kWh_m2`, so the two can never diverge even if those engine fields differ in some state. That's a ~1-line read change in `SystemsLiveResults.jsx`, defensive and boundary-aligned. **But it is not proven to be the 245.6 cause** (they're equal now), so it's a guard, not a confirmed fix. **STOP + escalate to Chris** before Part 3 (brief rule: hypothesis refuted → ask before continuing).

## §B — Part 3/4: fix + falsifiable visual verification
_Pending Chris's decision (Part 2 refuted the brief's hypothesis; bug not reproducing)._

## §C — Part 5: "Save failed" — does NOT reproduce
Triggered a real save (building length 58.8 → 59.8 via the Building page); it **persisted to the DB
with no failure** (`length: 59.8` confirmed in `building_config`), the indicator read "SAVED", and the
network `failed` filter showed **no failed requests** across the session. Restored to 58.8. So Thread C
also doesn't reproduce in the current state — consistent with H4 (the walkthrough-session save failures
were transient/state-specific, and likely the same root as the baseline divergence).
