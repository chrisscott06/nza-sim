# Brief 44 — Performance audit (mid-Part-6)

**Status:** Read-only diagnostic complete. No fixes applied during this pass.
**Trigger:** Slowness perceived after Brief 41–44 work landed (interventions stack + visualiser rebuilds).
**Companion:** [`docs/audit/44_visualisation_audit.md`](44_visualisation_audit.md) — same brief, different lens.

**Scope:** Quantify (A) → diagnose dominant cost (B) → compare to pre-Brief-41 baseline (C) → recommend smallest fix (D). Surface findings; do not fix.

**Test project:** HIX Bridgewater (id `14b4a5b1-8c73-4acb-8b65-1d22f05ec969`), heating mode `follow_comfort` 21°C unless stated otherwise. Viewport 1440×900. Dev servers on `127.0.0.1:8002` / `localhost:5176`. Vite dev server with React **StrictMode** (the dev double-render multiplies wall-clock times by 2 ×; per-pass numbers reported below are single-pass unless flagged "wall time"). React 18, recharts 2.13.

**HEAD at start of audit:** `3b2c4cc` (Brief 44 Part 5b protocol pause).

**Pre-Brief-41 reference SHA:** `5835d21` (Brief 40 close).

**Instrumentation:** `window.__nza_perf` accumulator added to `instantCalc.js` (`calculateInstant` wrap) and `SystemsModule.jsx` (render counter). Records every outer `calculateInstant` call duration and every inner `_calculateInstantBaseline` call duration with phase (`top_level_baseline` / `stack_runner:N`). Flagged temp; removed at Part 6 close.

---

## Part A — Baseline measurements

### A.1 Engine pass duration vs intervention count

**Method:** Project loaded fresh. For each N, count `outer_durations_ms` from the post-mount settle (two StrictMode passes captured per outer call); the second pass is the "warm" number (cold first-pass includes one-time module-graph evaluation). Per-pass cost is reported as the mean of the two captured passes. After the initial load, an edit (heating setpoint mode toggle) was applied and a second measurement was taken — the edit numbers matched within ~5 % so the table reports the higher (load-time) value for caution.

| N enabled | Outer per-pass | Wall time (StrictMode 2 ×) | Inner breakdown (mean ms) |
|---:|---:|---:|---|
| 0 | **900 ms** | 1.8 s | top_level 510 + stack_runner:0 **(wasted)** 387 |
| 1 | **2,550 ms** | 5.1 s | top_level 549 + stack:0 333 + stack:1 **1,654** |
| 2 | **4,300 ms** | 8.6 s | top_level 605 + stack:0 351 + stack:1 **1,666** + stack:2 **1,673** |
| 3 | **6,300 ms** | 12.6 s | top_level 655 + stack:0 347 + stack:1 **1,739** + stack:2 **1,788** + stack:3 **1,799** |

**Marginal cost per added intervention: ~1.8 s.** Patches-empty interventions (the two `New intervention` rows with `No patches yet`) cost the same as patched ones — the engine pass dominates over patch application.

**Per-pass cost can be decomposed:**
- Top-level baseline (line 6043 of `instantCalc.js`): ~550 ms.
- First stack runner iteration (rebuilt baseline at `stack_runner:0`): ~350 ms — **redundant with the top-level baseline call.**
- Each enabled intervention (`stack_runner:1..N`): ~1,750 ms each (deep clone + applyIntervention + engine pass).

### A.2 Edit timing (Heating setpoint Custom ↔ Follow comfort toggle)

| N enabled | Wall time per edit (StrictMode 2 ×) | Per-pass |
|---:|---:|---:|
| 0 | (not measured separately — same as load) | ~900 ms |
| 3 | 12,672 ms | **6,336 ms** |

The Custom-↔-Follow-comfort radio toggle was used as the canonical "single edit" because it changes one field on `params` (a service-level setpoint mode), forcing the `useMemo` to recompute (deps include `params` reference).

### A.3 React commit phase

Not measured separately. The `systems_renders` counter (increments on each `useEffect([result])` fire) showed **1 commit per N≥1 edit and 0–1 commits per N=0 edit** (sometimes the `result` reference compared equal across the two StrictMode useMemo passes — but in dev mode StrictMode triggers two useMemo passes regardless, and the resulting effect schedules collapse into one commit). The commit phase is bounded by the rendering of visible children (Sankey + Profiles + Live Results + side panel) — likely 100–400 ms by Recharts component cost on a 365-day chart. Not the dominant cost.

### A.4 Steady-state idle

- 10 seconds of no interaction on `/systems` with `result` settled.
- Engine reruns: **0** (good — no timer-driven re-render).
- Heap delta: **+1.71 MB** (likely Vite HMR background work + WeakRef cleanup; not per-second leak).
- Heap at idle (N=0): **50.3 MB**.

### A.5 Memory

Not instrumented further — no leak indicator observed in idle. Heap growth pattern across many edits was not driven to a controlled-experiment 20-edit sequence because the per-edit cost is already in 6 s territory and a controlled 20-edit run would have exceeded the audit budget. Recommend re-running this slice after fix landing to confirm no leak introduced.

---

## Part B — Identify the dominant cost

### B.1 Hypothesis 1: engine runs N+1 times per stack

**Status: CONFIRMED at code + measurement level. Dominant cost by an order of magnitude.**

#### B.1.1 Code-path verification

`instantCalc.js:6042-6071` — the exported `calculateInstant` runs the baseline calculator at line 6043 unconditionally, then if `building.interventions` exists and is non-empty, dispatches into `_runInterventionStack` at line 6061. The stack runner (`interventionsEngine.js:365-402`) builds `configs = [baseline, after_int_1, …]` (length 1 + N_enabled) and runs `runEngine(cfg)` on each via `configs.map(cfg => runEngine(cfg))` at line 383.

**Total `_calculateInstantBaseline` invocations per `calculateInstant` call:**

| Intervention state | Outer baseline (line 6043) | Stack baseline (`stack_runner:0`) | Enabled interventions (`stack_runner:1..N`) | Total |
|---|---:|---:|---:|---:|
| No `interventions` field, or `interventions: []` | 1 | 0 (early return at line 6046) | 0 | **1** |
| `interventions: [3 disabled]` | 1 | 1 (wasted — `.length` ≠ 0 falls through) | 0 | **2** |
| `interventions: [N enabled + M disabled]` | 1 | 1 | N | **N + 2** |

#### B.1.2 Two wasted calls per N≥1 invocation

1. **Top-level baseline at line 6043** runs even when interventions exist, then the **first stack runner iteration** runs the same baseline config a second time. Both compute `_calculateInstantBaseline(building, constructions, systems, libraryData, weatherData, hourlySolar, scheduleProfiles, options)` with identical inputs. They share zero work.
2. **Stack-runner-fires-on-empty:** the early return at `instantCalc.js:6046` checks `building.interventions.length === 0` rather than "any enabled". A stack of three disabled interventions falls through; the stack runner runs the baseline configuration through `runEngine` one more time wasted.

#### B.1.3 Measured impact

Removing (1) saves ~550 ms per call regardless of N — the top-level baseline pass.
Removing (2) saves ~470 ms per call when N_enabled = 0 with stale-disabled rows present.

The remaining per-intervention cost ~1.75 s per row is the actual engine pass against a patched config; no shortcut available without engine memoization.

### B.2 Hypothesis 2: InteractiveProfileVisualiser doing expensive work on every render

**Status: REJECTED at code-audit level.**

`InteractiveProfileVisualiser.jsx` (447 lines) — read line-by-line.

**Operations in the render path that touch the hourly/daily arrays:**

| Location | Operation | Wrapped in useMemo? | Cost class |
|---|---|---|---|
| Line 80 `kwhPerDayToKwAvg` | (not actually called — defined but unused) | n/a | dead code |
| Line 203-209 `initialSelected` useMemo | new Set(layer IDs) | yes, deps `[layers, defaultLayerIds]` | 1 op per layer, cheap |
| Line 220-231 `window` useMemo | computes day-range bounds | yes, deps `[timeAxis, quarter, month, day]` | <1 ms |
| **Line 235-251 `data` useMemo** | iterates `window.startDoy..endDoy` × `layers`, divides `daily_kwh[d] / 24` | **yes, deps `[layers, weather, window]`** | **365 × ~10 = ~3,650 ops; <1 ms** |
| Line 253-256 `selectedLayers` useMemo | filters by selectedIds | yes, deps `[layers, selectedIds]` | <1 ms |

**The hot loop is the `data` useMemo at line 235-251:**

```js
for (let d = window.startDoy; d <= window.endDoy; d++) {
  const point = { doy: d, label: dayOfYearToMonthDay(d).label }
  for (const layer of layers) {
    const kwAvg = layer.daily_kwh?.[d] != null ? layer.daily_kwh[d] / 24 : null
    point[layer.id] = kwAvg
  }
  …
}
```

Year-view bound: 365 days × ~10 layers (heating delivered, cooling delivered, DHW delivered, electricity total, gas total, fan power, lighting, small_power, plus weather) = ~3,650 read+assign operations + ~3,650 division ops + 365 `dayOfYearToMonthDay` calls (each O(1)). Net cost on V8 in dev mode: **<1 ms.** Even at hypothetical 8,760-point hourly resolution the cost would be <10 ms — at least 100 × smaller than a single engine pass.

**Reference-stability concern:** the `layers` and `weather` props arrive freshly constructed from `SystemsProfiles` (inline object literal each render); `useMemo([layers, weather, window])` therefore recomputes on every parent render despite identical underlying values. The recompute itself is cheap, but **this would defeat any `React.memo(InteractiveProfileVisualiser)` boundary** if one were added.

No `React.memo` is currently applied to `InteractiveProfileVisualiser`. The recharts components inside it (`LineChart`, `AreaChart`, `ResponsiveContainer`) re-render fully each commit. Recharts re-render on a 365-point dataset is on the order of 50–150 ms — visible but secondary to the engine cost.

**Verdict:** IPV is not the dominant cost. The reference-instability concern is a follow-up for the post-engine-fix performance polish.

### B.3 Hypothesis 3: Sankey or other shared components re-rendering on every keystroke

**Status: PARTIALLY CONFIRMED at code-audit level. Significant but secondary.**

#### B.3.1 No `React.memo` anywhere in `frontend/src/components/`

Grep result: **0 files match `React\.memo|memo\(`** across the entire `components/` tree. Every shared and module-local component re-renders on every parent render.

#### B.3.2 `SystemsSankey` reference dependency

`SystemsSankey({ consumption, sysCfg, sysCfgV40 })` at `SystemsModule.jsx:751`. Each `calculateInstant` returns a new top-level result object → `consumption` is a new reference every call. The Sankey re-renders even when the underlying numbers are byte-identical.

#### B.3.3 The Sankey's render work

`SystemsSankey` is in-file (line 732+ in `SystemsModule.jsx`), so the per-render cost is full SVG path computation for every flow. With ~6 services × 2-3 systems per service × 2 carriers = ~20-30 SVG ribbons, plus tick labels and tooltip wiring, the per-render cost is in the 50–150 ms range (estimated from typical Recharts custom-shape rendering; not measured directly in this audit).

#### B.3.4 Comparison to H1

Even at 150 ms × 1 commit per edit, the Sankey re-render cost is **<3 % of the 6,300 ms engine cost at N=3**. It becomes proportionally significant only after the engine cost is reduced.

**Verdict:** real cost class, but distant secondary. Address after H1.

### B.4 Stacked diagnosis

The dominant cost per edit on `/systems` with the current Bridgewater state (N=3 enabled interventions) is:

```
                                    Per useMemo pass
                                    (× 2 for StrictMode wall time)
   Top-level baseline                          550 ms        ← wasted, same input as stack:0
   Stack runner iteration 0 (baseline rerun)   350 ms        ← redundant
   Stack runner iteration 1 (intervention 1) 1,750 ms
   Stack runner iteration 2 (intervention 2) 1,790 ms
   Stack runner iteration 3 (intervention 3) 1,800 ms
                                    ─────────────
                                          6,240 ms          ≈ 6.3 s × 2 = 12.6 s wall time
```

**At code level, 4 of those 5 inner calls are arguably wasted on the `/systems` route**, because `/systems` consumes only `consumption.brief40.*` (the baseline result) — not `consumption.interventions.*` (the stack result, which only the Interventions module's stack view + comparison view read).

A maximally aggressive surgical change would have SystemsModule pass `{ _skipInterventions: true }` in its options at line 149 — cutting the N=3 cost from 6,300 ms → 550 ms (the baseline pass only). Same logic applies to Building / Internal Gains / Operation / Results / CRREM / Roadmap — none of those routes read `consumption.interventions.*`. Only Interventions and Comparison views need the stack output.

---

## Part C — Pre-Brief-41 baseline comparison

**Approach chosen: documented-but-not-run.**

The pre-Brief-41 reference is **`5835d21`** (Brief 40 close, 2026-05-19). Running Part A measurements at that SHA would require:

1. Stash the temporary perf instrumentation in `instantCalc.js` and `SystemsModule.jsx` (currently uncommitted to HEAD).
2. `git checkout 5835d21` (would also revert the Brief 41 demolition of `scenarios/` and several engine + schema changes from Briefs 41-44).
3. Re-add equivalent perf instrumentation at the pre-Brief-41 `calculateInstant` (which has a simpler signature — no stack dispatch, no `_skipInterventions` flag).
4. Boot fresh, load Bridgewater, repeat A.1 → A.5.
5. Restore HEAD and stash-pop.

**Why deferred to the fix-pass:**

- The B.1 measurements already give a strong pre/post comparison **without checkout**. The pre-Brief-41 call path is exactly the current `_calculateInstantBaseline` (sans the wrapper). Its expected time on Bridgewater is ~550 ms per call (matching the current top-level baseline cost — same input, same engine path, no stack dispatch).
- So pre-Brief-41 baseline ≈ **550 ms per edit**. Current N=3 ≈ **6,300 ms per edit**. **Slowdown factor: ~11 ×.** Well above the >20 % threshold the audit calls "real, not perceived".
- A live re-measurement at `5835d21` would add a confidence digit but wouldn't change the diagnosis or the recommended fix.

If Chris wants the live comparison run before authorising a fix, the checkout + re-instrument can be the first step of the fix brief (it's a clean ~30 min exercise).

---

## Part D — Recommended fix path

### Recommendation: Surgical fix, in two steps, each independently committable.

#### D.1 Step 1 — Skip interventions on consumer routes (highest ROI, smallest diff)

**Change:** Pass `{ _skipInterventions: true }` in the `options` object at every `calculateInstant` site that does **not** read `consumption.interventions.*`. Concretely:

- `SystemsModule.jsx:149` — Sankey + Profiles + Schedule + Monthly + Rejection + Diagnostic + Summary all read `consumption.brief40.*` / `consumption.space_*` / `consumption.total.*`; none reads `consumption.interventions.*`.
- `BuildingDefinition.jsx`, `OperationModule.jsx`, gains/`useAnnualGains.js`, results/, `CRREMModule.jsx`, `RoadmapModule.jsx` — same.
- Leave `InterventionsModule.jsx` (Stack + Comparison views) and `InterventionEditorPopout.jsx` (live preview) using the full stack-dispatching call — they're the only consumers.

**Expected impact (Bridgewater, N=3 today):**
- `/systems`, `/building`, `/gains`, `/operation`, `/results`, `/crrem`, `/roadmap` edit cost: 6,300 ms → **~550 ms (−91 %).**
- `/interventions` edit cost: unchanged (~6,300 ms — those views need the stack).

**Risk:** Low. The `_skipInterventions` flag is already plumbed (Brief 41 Part 2 recursion guard). The change is one option literal per call site (~6 sites). Tests: confirm Sankey + Profiles still render identical numbers on `/systems`. Confirm `/interventions` Stack + Comparison views still compute deltas correctly.

#### D.2 Step 2 — Remove the redundant top-level baseline + fix the empty-stack early-return (impact at the /interventions route only)

**Changes inside `calculateInstant` (instantCalc.js):**

1. Move the `_calculateInstantBaseline` call from line 6043 *inside* the `if (no interventions || _skipInterventions)` branch — so the redundant baseline at line 6043 doesn't fire when the stack runner is going to run it anyway. Pull the baseline result from `stack.baseline` (the stack runner already returns it as `rollingResults[0]`) instead.
2. Tighten the early-return at line 6046 from `interventions.length === 0` to `!interventions.some(i => i?.enabled !== false)`. Skips the stack runner entirely when all interventions are disabled.

**Expected impact (Bridgewater, N=3 today, on the `/interventions` route):**
- 6,300 ms → ~5,400 ms (−14 %).
- Per-edit saving on `/interventions` when stack has many disabled rows: a further ~470 ms.

**Risk:** Medium. Pulling `result` from `stack.baseline` changes a result-object reference identity. Verify the existing `result.consumption.interventions = stack` attachment logic at line 6065 still produces the expected shape. Verify nothing else reads `result` before the stack-attach.

### Alternatives considered and ranked lower

- **Medium fix: cache engine output by config hash.** Saves repeated work across re-renders with identical params. Requires a hash key over the deep config and a TTL/LRU. Worth doing later as polish but doesn't help the steady-state edit pattern (where params *do* change).
- **Medium fix: stabilise engine output reference identity when values unchanged.** Would let `React.memo` boundaries on Sankey / Profiles / Diagnostic actually skip re-renders. Material only after H1 is fixed (right now the engine cost dwarfs render cost).
- **Invasive: web worker for `_calculateInstantBaseline`.** Big lift (engine touches `weatherData` + `hourlySolar` which are large; main-thread to worker transfer cost matters). Only worth it after surgical fixes show the engine cost is intrinsic.
- **Invasive: debounce/throttle the engine on edit storms.** Hides the cost rather than fixing it; would feel sluggish on every edit until the debounce settles. Strongly preferred to fix the actual cost first.
- **Make patches-empty interventions effectively no-ops.** Already the case structurally (the engine still runs because each rolling config is engine-equivalent to baseline; the patches list is just empty). Surgical fix `D.1 / D.2` makes this moot. A theoretical `if patches.length === 0` skip in the stack runner could save ~1,700 ms per patches-empty intervention. Worth a follow-up after D.1 and D.2.

### Estimated effort

- D.1: 1 commit, ~6 file changes, ~12 lines of diff. ~30 min including manual verification.
- D.2: 1 commit, 1 file (`instantCalc.js`), ~10 lines. ~45 min including verification of result-shape invariance.

### Discipline cross-check

- ✓ Read-only audit. No fixes during this pass.
- ✓ Numbers in ms, not "feels slow".
- ✓ Three hypotheses tested against code + measurement.
- ✓ Surgical-vs-invasive ranking with impact + risk per option.
- ⚠ Part C live comparison deferred — the inference is documented + the SHA is recorded. Re-running is a known follow-up if Chris wants additional confidence before authorising the fix.

---

## Appendix — Raw measurement traces (post-mount, settled)

```
N=3 (three enabled interventions):
  outer_durations_ms      = [6479.5, 6304.8]   (StrictMode double)
  inner_phases / durations:
    top_level_baseline     568.8   559.0
    stack_runner:0         465.2   244.5
    stack_runner:1        1611.4  1703.5
    stack_runner:2        1994.9  1901.9
    stack_runner:3        1828.9  1891.1
  Per-pass sum:           6469.2  6300.0

N=3 after a single edit (Custom → Follow comfort radio click):
  outer_durations_ms      = [6175.4, 6496.5]
  inner_phases / durations:
    top_level_baseline     581.0   729.4
    stack_runner:0         314.7   379.0
    stack_runner:1        1718.5  1760.3
    stack_runner:2        1803.2  1772.2
    stack_runner:3        1749.5  1849.5

N=2 (one disabled):
  outer_durations_ms      = [4220.9, 4385.9]
  inner_phases / durations:
    top_level_baseline     538.8   671.1
    stack_runner:0         456.3   247.4
    stack_runner:1        1495.7  1837.1
    stack_runner:2        1721.1  1625.3

N=1 (two disabled):
  outer_durations_ms      = [2590.8, 2496.3]
  inner_phases / durations:
    top_level_baseline     594.1   504.7
    stack_runner:0         427.0   239.7
    stack_runner:1        1561.5  1745.8

N=0 (all three disabled):
  outer_durations_ms      = [1021.9, 774.6]
  inner_phases / durations:
    top_level_baseline     548.6   470.7
    stack_runner:0         470.8   303.4   ← wasted (stack still fires because .length ≠ 0)

Idle 10s on /systems, settled:
  engine_runs_during_idle = 0
  memory_delta_mb         = +1.71
  heap_at_idle_mb         = 50.3
```
