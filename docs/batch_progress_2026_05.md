# Batch Progress — Brief 27 Cleanup + Brief 28 + Brief 29

**Current state:** `paused_for_walkthrough` (Brief 28a Part 4 done — components ported in isolation + test harness at `/chart-test`; awaiting component-level walkthrough before Part 5 wires them into the live Conditions tab. 3e/3f deferred until after Part 5 per Chris's reorder.)
**Last update:** 2026-05-14
**Walkthrough findings — both resolved:**

- **Finding 1 (Heat balance bug) FIXED.** Brief 27 cleanup Part 1's prop rename was correct but incomplete. Added Part 3 (corrected close) — unwrapped `state2.heat_balance` in the wrapper + moved internal gains under `gains.internal.*` in `_calculateState2`. New diagnostic script `scripts/verify_state2_heat_balance_shape.mjs` confirms 15/15 shape checks. State 1 + State 2 Live regressions byte-identical post-fix. Brief 27 cleanup overall confidence revised: 10/10 → **9/10**.
- **Finding 2 (slow State 1 → State 2 transition) FIXED.** Profiled the Static engine via new `scripts/profile_static_engine.mjs`: state1 cold 7.8 ms, state2 cold 23.5 ms, warm 1-17 ms. The "~1 minute" delay was auto-simulate firing a full Dynamic EP run on `saveStatus='saved'` events from any source. Chris chose fix-path (b): gate on `saveSource === 'user'`. Shipped `2026-05-14` in commit `62325f4`. Browser-verified.

Brief 28a Part 3 (canvas tab restructure) unblocked. Slicing plan: 3a (Summary tab placeholder + default routing), 3b (fold Delta into Summary), 3c (merge time-series tabs into Load shape), **halt for walkthrough**, 3d (remove 3D Model from Internal Gains), 3e (apply pattern to Building), 3f (update ui_principles.md).
**Brief 27 cleanup closed at 10/10 (commits `2a9dd90`, `d281a16`, `8dc1909`, `a26b0b9`, pushed to origin/main).** Brief 28 prereq Part 1 verification + Chris's Q1-Q3 follow-up confirmed: the physics audit's "Dynamic was HVAC-clamped" attribution was correct after all. My initial Part 1 conclusion was based on inspecting the assembled epJSON (which IS practically free-running), but `state1_engine_agreement.mjs` doesn't run that epJSON — it re-parses full-sim SQL through the State 1 parser view. All 200 persisted sims in `data/simulations/` are full-mode (HVAC-clamped). The `simulation_runs` table has no mode column. **Option C+ confirmed:** zero the People placeholder in envelope-only, persist a real envelope-only EP run, repoint the engine_agreement script, re-run with corrected comparison. ~1 day. Awaiting Chris's "go" to unhalt. See `docs/batch_halt_report.md` Halt 2 Update for the full reconciliation.

---

## Pre-flight check results (run 2026-05-14)

| Check | Result | Notes |
|---|---|---|
| State 1 Live isolation | ✅ 40/40 byte-identical | Bridgewater baseline 224,587 bytes |
| State 1 EP isolation | ✅ 41/41 byte-identical (40 assembler + 1 end-to-end) | Required `$env:ENERGYPLUS_DIR = "C:\EnergyPlusV26-1-0"` — `nza_engine/config.py:17` defaults to a macOS path and is not Windows-aware |
| State 2 Live isolation | ✅ 21/21 byte-identical | Bridgewater baseline 165,637 bytes |
| State 2 EP isolation | ✅ 21/21 byte-identical (assembler only — script does not include end-to-end check parallel to Brief 27's State-1 addition) | Same env-var requirement |
| Frontend build | ✅ Clean (12.79s, 3166 modules, 2 chunk-size warnings only) | No errors. Pre-existing warning about chunk size > 500 kB. |
| Git working tree clean | ⚠ Not clean | Orchestration setup + audit deliverables uncommitted. See halt report for the file list. |
| `current.md` points at `27_cleanup.md` | ✅ Yes | Updated this session |

All four state-isolation regressions pass. Build is clean. The working-tree-clean check is the only pre-flight that didn't pass — and it's not pass-failing because of uncertainty about *whether* to commit the orchestration setup yet (see halt report).

---

## Brief 27 Cleanup

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 1. Heat Balance prop bug fix | **complete** | 2026-05-14 | 2026-05-14 | `d281a16` | One-line rename `balance=` → `liveData=` on `HeatBalanceView.jsx:45`. Shape contract holds (`instantCalc.js` returns `annual.totals` + `metadata.gia_m2` matching what `HeatBalance.jsx` reads at lines 535-543). No transform needed per Chris's "rename is the complete fix if shape matches" guidance. All 4 isolation regressions still byte-identical (40/40 + 41/41 EP + 21/21 + 21/21). Build clean (10.99s). |
| 2. Divergence doc correction | **complete** | 2026-05-14 | 2026-05-14 | `8dc1909` | Four inline `[CORRECTED 2026-05-14]` annotation blocks added to `docs/state_1_engine_divergence_investigation.md`: top-of-doc summary, solar 38%/50 GWh correction with per-facade table, 23.5% conduction artefact explanation, Resolution-section update with the new May 2026 batch structure. Original content preserved per brief's "annotation over strikethrough" guidance. |
| 3. **Corrected close-out — re-opened post-walkthrough** | **complete** | 2026-05-14 | 2026-05-14 | (this commit) | Brief 27 cleanup Part 1's prop rename was correct but missed the shape transform the brief had asked for. State 2 nests `annual` under `heat_balance`; consumer expects it at top level. Plus internal gains needed to live under `gains.internal.*` not `gains.*`. Two fixes: (1) HeatBalanceView.jsx:45 unwraps `state2?.heat_balance`; (2) `_calculateState2` moves people/lighting/equipment to `gains.internal.*` + recomputes `totals.gains_kwh`. Verified via new `scripts/verify_state2_heat_balance_shape.mjs` (15/15). Regressions byte-identical. Confidence: 9/10 (1/10 gap is the missed shape verification originally). |
| **Brief 27 cleanup close-out (corrected)** | **complete** | 2026-05-14 | 2026-05-14 | (this commit) | Overall Brief 27 cleanup confidence 9/10 (revised down from 10/10). The gap captured as a Brief 28a Part 7 acceptance-gate candidate: a rendering smoketest for canvas views with Bridgewater state2 data that asserts `data.annual` resolves AND `gains.internal.*` renders. |
| **Brief 27 cleanup close-out** | **complete** | 2026-05-14 | 2026-05-14 | (next commit) | Full regression suite green post-cleanup: State 1 Live 40/40, State 1 EP 41/41, State 2 Live 21/21, State 2 EP 21/21. Build 11.01s clean. STATUS.md updated. `current.md` updated to point at `active/28_prereq_free_running_ep.md`. Brief file archived to `docs/briefs/archive/27_cleanup_COMPLETED.md`. Confidence: 10/10 (two narrowly-scoped fixes, no design decisions). |

## Brief 28 Prereq Free-running EP (executed as Option C+)

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 1. Verify assembler envelope-only mode | **complete** | 2026-05-14 | 2026-05-14 | `d1df19a` | Verified via `scripts/state1_envelope_only_verify.py`: wide-band setpoints (−60/+100 °C) ✓, no operable windows ✓, no real systems ✓. Initial conclusion ("premise wrong") was corrected by Halt 2 Update — verification was inspecting the wrong artifact. The premise was right; the prereq was needed. See `docs/state_1_free_running_verification.md`. |
| C+ Step 1. Zero People density in envelope-only mode | **complete** | 2026-05-14 | 2026-05-14 | `4659443` | `epjson_assembler.py:192` `_build_people_objects` had `density = max(density, 1e-4)` unconditionally, silently overriding State 1's explicit zero-out (line 1152 sets `_density_override = 0.0`). Fix: only clamp when `density > 0`. EP accepts `people_per_floor_area: 0.0`; end-to-end regression passed. |
| C+ Step 2. Add `simulation_mode` column + persist envelope-only run | **complete** | 2026-05-14 | 2026-05-14 | (this commit) | Migration `scripts/migrate_add_simulation_mode.py` (idempotent, 181 legacy rows → NULL). `api/db/schema.sql` updated. Both `/simulate` INSERTs in `api/routers/projects.py` now write `simulation_mode = mode`. `/simulations` GET endpoint now returns `simulation_mode`. New script `scripts/run_envelope_only_sim_bridgewater.py` ran Bridgewater envelope-only: **run_id `8d7fc517`** (35.4 s, 20 warnings, 0 fatal). Row in DB has `simulation_mode='envelope-only'`, SQL at `data/simulations/8d7fc517/eplusout.sql`. |
| C+ Step 3. Repoint `state1_engine_agreement.mjs` | **complete** | 2026-05-14 | 2026-05-14 | (this commit) | Lines 128-138 changed from `sims[0]?.id` to `sims.filter(s => s.simulation_mode === 'envelope-only')[0].id`. Explicit `RUN_ID` argv override still works. Clean error message + reproduction command if no envelope-only run exists. |
| C+ Step 4. Re-run + update divergence doc | **complete** | 2026-05-14 | 2026-05-14 | (this commit) | New dated section appended to `docs/state_1_engine_divergence_investigation.md`. Headline numbers from `node scripts/state1_engine_agreement.mjs 14b4a5b1-... 8d7fc517`: conduction divergence 23.5% → **6.8%** (most was HVAC-clamping artefact ✓), summer max gap 15 K → **8.8 K** (mass model story holds, smaller magnitude), winter min Static 4.0 / Dynamic 8.3 → Static may be UNDER-predicting (opposite-season mass model story), cooling demand −95% → −43% (real but less catastrophic). One open question: solar aggregate still shows −27.3% Live vs Sim, conflicts with audit's +1% — likely a pre-vs-post-shading accumulator mismatch in the engine_agreement script, filed for Brief 28b Part 2 reconciliation. |
| **Brief 28 prereq close-out** | **complete** | 2026-05-14 | 2026-05-14 | (this commit) | All 4 isolation regressions byte-identical post-changes (40/40 + 41/41 EP + 21/21 + 21/21). Build clean (18.26 s). Active brief file archived. `current.md` pointer flipped to `28a_visible_polish.md`. Confidence: 9/10 — work shipped exactly as Option C+ scoped, with one open question (solar aggregate) routed to Brief 28b. The 1/10 gap is that open question. |

## Brief 28a Visible Polish

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 1. Static / Dynamic rename | **complete** | 2026-05-14 | 2026-05-14 | `2c37383` | 19 files touched. Engine labels: EngineBadge ("Static" / "Dynamic"), EngineToggle in HeatBalance (Live → Static, Simulation → Dynamic, both tooltips updated). Top-bar button: Run/Re-run/Retry/Simulating → Dynamic equivalents. Results-page empty states + status banners across 8 tabs. Scenarios + Information module summary card + data-completeness CheckItem + ProjectDashboard scenario-run button + DrillDown sub-label + ComparisonView empty states. Cross-cutting disclosure correction folded in per Chris's direction: HeatBalance/DeltaView/FreeRunningView disclosure text updated from "isotropic sky model — peak summer 5-10°C high" to "lumped two-node mass model — ~8.8°C above Dynamic on Bridgewater" matching the corrected prereq findings. Intentionally NOT renamed: "Simulation mode" labels in SystemsZones/HVACTab (refer to assembler mode, not engine), HomePage tool descriptors ("Building energy simulation"), "Ready to simulate?" section verb, all internal code-name "live engine" comments. Build clean (15.79s). State 1 Live + State 2 Live regressions byte-identical. EP regressions skipped — UI text changes can't affect Python engine byte-identity by construction; will be confirmed at Brief 28a close-out per Part 7. |
| 2. kWh/m²·yr live readouts | **complete (sub-steps 1-2; sub-step 3 fused with Part 3)** | 2026-05-14 | 2026-05-14 | (this commit) | Sub-step 1 (per-profile inline readout in MultiProfileList) + Sub-step 2 (Per-m² row added to Occupancy/Lighting/Equipment section readouts) shipped. GIA wired via the existing `annual.gia_m2` path (Occupancy/Lighting/Equipment) + new `giaM2` prop on MultiProfileList. Sub-step 3 (new "Summary" tab with stacked bar chart of gains vs demand) is the natural content of the Summary tab created by Part 3 — fused there to avoid duplicate work. Build clean (12.58s). State 2 Live byte-identical. |
| 3. Canvas tab restructure (sliced 3a-3f) | **3a-3d done; halted for walkthrough; 3e-3f pending** | 2026-05-14 | — | `7782556` (3a), `8b33206` (3b), `496cda3` (3c), `359861c` (3d) | **3a** Summary tab as new default. **3b** folded Delta into Summary + gains-vs-demand stacked bar with unit toggle + removed standalone Delta tab. **3c** consolidated Free-running + Hourly + Annual breakdown into one tab with sub-view toggle. **3d** three refinements from Chris's 3a-3c walkthrough: (i) 3D Model tab removed from Internal Gains, (ii) `autoSimulate` default flipped `true → false` (saveSource gating retained as safety net), (iii) tab label renamed `Load shape → Conditions` per Chris (industry jargon → plain English). Also: Brief 28a Part 8 ("State-aware Dynamic runs") scoped in the brief. Tab strip post-3d: Schedule \| Summary \| Heat balance \| Conditions (4 tabs, down from 7 originally). Walkthrough targets in STATUS.md. **3e-3f queued:** apply 5-tab pattern to Building (keeps 3D Model since facades have visual meaning), update ui_principles.md. |
| 8. State-aware Dynamic runs | **newly scoped** | — | — | — | Added to brief at Chris's direction post-3c walkthrough. Run Dynamic should pick mode by detection (envelope-only / envelope-gains / 2.5 / full) rather than always full. Foundation: Brief 28 prereq envelope-only pipeline + simulation_mode column. New helper `detectProjectState(building, systems)`; SimulationContext threads detected mode into POST URL. Confidence target 9/10. Implementation deferred — Chris said "scope properly, don't improvise into existing slices." |
| 4. Pablo component port | **done — halted for component walkthrough** | 2026-05-14 | 2026-05-14 | `c54ee6f` (port) + follow-up commit for test harness | Read actual Pablo sources from `pablo-2/`. Refined scope: NZA-Sim already had clean equivalents of ChartContainer (no html2canvas/jspdf -- effectively the "stripped" version) and DataCard (already using free-form CSS borderLeft). So real new ports were ZoomNav + MonthJumpButtons + tokens (CHART_SERIES_COLORS, SEASON_COLORS, MONTH_SEASON, MONTH_LABELS) in chartTokens.js. Moved ChartContainer + DataCard from `ui/` to `chart/` for canonical-location alignment with brief; 9 downstream imports updated. Test harness page at `/chart-test` exercises all 4 components in isolation with sample state/data. MODELLER_COLORS not ported (Pablo-specific). BUILDING_SERVICE_COLORS not ported -- reconciling with `balanceColours.js` deferred to 3f / ui_principles update. Build clean (10.46s). |
| 5. Load shape + engine toggle | queued | — | — | — | |
| 6. Pablo pattern roll-out | queued | — | — | — | |
| 7. Close-out | queued | — | — | — | |

## Brief 28b Physics Overhaul

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 0. Premise re-validation | queued | — | — | — | |
| 1. Contract update | queued | — | — | — | |
| 2. Solar model upgrade | queued | — | — | — | |
| 3. Multi-layer CTF mass model | queued | — | — | — | |
| 4. Multi-construction validation | queued | — | — | — | |
| 5. Engine agreement re-baseline | queued | — | — | — | |
| 6. Close-out | queued | — | — | — | |

## Brief 29 Building Completion

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 1. State 1 diagnostic views | queued | — | — | — | |
| 2. UI principles conformance | queued | — | — | — | |
| 3. Hardcoded constants cleanup | queued | — | — | — | |
| 4. BREDEM phasing factors | queued | — | — | — | |
| 5. Close-out + batch close | queued | — | — | — | |

---

## Decisions log

| Part / decision | Rationale |
|---|---|
| Use `$env:ENERGYPLUS_DIR = "C:\EnergyPlusV26-1-0"` inline for EP scripts | `nza_engine/config.py:17` falls back to `/Applications/EnergyPlus-25-2-0` (macOS-only) when env var unset. Not in scope to change config; setting inline works. Filed under "things worth fixing as part of constants cleanup in Brief 29 Part 3." |
| Part 1 — keep `mode="envelope-gains"` as-is in `HeatBalanceView.jsx:45`, don't expand scope to also fix the mode prop | The consumer `HeatBalance.jsx:494` declares `mode = DEFAULT_MODE   // 'envelope-only' \| 'full'`. The wrapper passes `'envelope-gains'` which is outside the documented enum — a pre-existing condition not flagged by the audit. Chris's instruction was specifically the prop name rename. Logged as a follow-up candidate: either extend the consumer's `mode` enum to include `'envelope-gains'` (with appropriate handling in `flattenGains` / `flattenLosses`), or change the wrapper to pass `'full'` semantically. Defer to Brief 28a (canvas restructure) or document as accepted-pre-existing. |
| Rename `docs/briefs/batch_orchestration.md` → `docs/briefs/batch_orchestration_2026_05.md` | Per Chris's direction, matching the dated convention used for `batch_progress_2026_05.md` and `batch_halt_report.md`. Updated all five inline references in `current.md`, `STATUS.md`, halt report, divergence investigation, and the supersession notes (which had referenced the dated path all along; they now resolve correctly). |
| Brief 28 prereq Part 1 inspection target | Q1-Q3 verification clarified that the engine comparison pipeline operates on persisted SQL, not assembled epJSON. Future verifications of "is engine X really doing Y" should inspect what the comparison script *actually pulls*, not what the assembler *can emit*. Filed as a methodology note for any future engine-agreement work. |
| `simulation_runs` table has no `mode` column | Surfaced during Q2 investigation. Engine comparisons cannot filter persisted sims by mode at the database level. Candidate fix: add `simulation_mode` TEXT column with values `{'envelope-only', 'envelope-gains', 'full'}`. Alternative: bake mode into `scenario_name` per the prereq's original Part 2 spec (`'state_1_envelope_only_free_running'`). Defer to Brief 28a Part 5 (SQL parser surface) or Brief 29 Part 3 (constants cleanup). |

## Halts

| # | Date | Brief | Part | Classification | Resolution |
|---|------|-------|------|----------------|------------|
| 1 | 2026-05-14 | 27 cleanup | 1 (Heat Balance prop fix) | HH4 (premise concern) | **Resolved 2026-05-14.** Chris verified the empty state in browser. Bug is real, distinct from `4f4f3a5` race fix. Part 1 proceeds. See `docs/batch_halt_report.md` resolution section. |
| 2 | 2026-05-14 | 28 prereq | 1 (Verify envelope-only mode) | HH4 (premise wrong → premise correct after deeper inspection) | **Resolved 2026-05-14.** Chris ordered Option C+. All 4 sub-steps shipped: People zeroed, `simulation_mode` column added, envelope-only run `8d7fc517` persisted, agreement script repointed, divergence doc updated with corrected numbers (conduction 23.5%→6.8%, summer max gap 15K→8.8K). The audit's attribution holds — most of the 23.5% WAS HVAC-clamping. Mass model story stands but at smaller magnitude. One open question on solar aggregate routed to Brief 28b Part 2. |
| 3 | 2026-05-14 | 28a (paused) | (walkthrough Finding 2) | SH3-adjacent (slow Static engine perceived) | **CLOSED 2026-05-14.** Fix-path (b) shipped in `62325f4`: `saveSource: 'user' \| 'system'` added to ProjectContext, default `'system'`, 5 user-edit sites tag `'user'`; SimulationContext gates auto-simulate on `saveSource === 'user'`. Browser-verified by Chris — no surprise EP runs on project load; Static numbers immediate; user edit still triggers Dynamic after 2 s debounce. Batch state flipped `paused_for_walkthrough → running`. |

Note: the Brief 27 cleanup walkthrough Finding 1 (Heat balance bug incomplete fix) was resolved in the same session via Part 3 (corrected close) — see Brief 27 cleanup table above for the audit trail. It was a continuation of the walkthrough findings batch alongside Halt 3, not a separate halt event with its own classification.
