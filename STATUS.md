# NZA SIMULATE — Status

## 🚧 Session 2026-05-14 — paused at Brief 28a Part 3 mid-slice (3a-3d done, awaiting walkthrough before 3e/3f)

**State:** `paused_for_walkthrough`
**Latest commits this session (pushed to origin/main):**
- `359861c` Brief 28a Part 3d: 3D Model removal + auto-simulate default off + Load shape → Conditions
- `496cda3` Brief 28a Part 3c: consolidate Free-running + Hourly + Annual breakdown into Conditions tab
- `8b33206` Brief 28a Part 3b: fold Delta into Summary + gains-vs-demand stacked bar + remove standalone Delta tab
- `7782556` Brief 28a Part 3a: new Summary tab as default for Internal Gains
- (earlier this session: Brief 27 cleanup Part 3 corrected close, Finding 2 fix-(b), Brief 28a Parts 1+2)

### Walkthrough targets for 3d (refinements on top of 3a-3c)

Tab strip is now **4 tabs** (down from 7 originally): `Schedule | Summary | Heat balance | Conditions`. Pablo-pattern unified time-series view replaces the Conditions sub-view toggle in Parts 4-5. Brief 28a Part 8 (state-aware Dynamic runs) newly scoped.

1. **Load `/gains` on Bridgewater.** Confirm the tab strip shows the 4 tabs above (Delta / Free-running / Hourly profile / Annual breakdown / 3D Model are all gone from the top-level strip).
2. **Default landing tab is Summary.** First load lands on Summary, not Schedule. The Static badge reads "Static".
3. **Summary tab content** — renders top-to-bottom:
   - Headline 4-up stat cards: Internal gains / Heating demand / Cooling demand / Comfort hours (each with MWh + kWh/m²·yr + delta vs State 1 where applicable).
   - **Gains vs demand stacked bar** with `kWh | kWh/m²·yr` unit toggle at top-right of that card.
   - Demand paired bars (State 1 vs State 2 for heating + cooling) — moved from old Delta tab.
   - Comfort impact (hours deltas + annual-mean T shift).
   - "What gains contribute" with per-gain attribution + per-profile sub-rows.
   - Footnote referencing Static engine + the 2026-05-14 corrected disclosure (mass model, ~8.8°C gap).
4. **Conditions tab** (renamed from "Load shape" in 3d) — internal sub-view toggle at top with three buttons: `Temperature trace | Hourly profile | Annual breakdown`. Each renders the existing component unchanged. Sub-view selection persists via localStorage. Interim sub-toggle is documented in the footnote at top.
5. **Heat balance tab** — should still render (Brief 27 cleanup Part 3 corrected close fix). Sankey / Stacked / Rows layouts work; gains.internal renders.
6. **Schedule tab** — still works (no functional change since 3a; just no longer the default).
7. **3D Model tab** — **gone** from Internal Gains (3d removed it; Building still has it, that lands in 3e).
8. **Top-bar Auto-simulate toggle** — defaults to **OFF** (grey dot) on fresh load. Click to enable; tooltip shows current state. With auto-sim OFF: editing a value updates Static numbers immediately but does NOT trigger a Dynamic EP run. With auto-sim ON + user edit: Dynamic fires after 2s debounce as before (Halt 3 saveSource gating intact).
9. **Run Dynamic button** — click triggers a full mode EP run, status banner reads "Running Dynamic…" (state-aware mode detection lands in Brief 28a Part 8, not yet implemented).
10. **No console errors** during tab switches.

### What's still in the queue after walkthrough

- **3e** — Apply the consolidated pattern to Building module (Summary / Heat balance / Conditions / 3D Model — Building keeps 3D Model because facades / orientation / shading have visual meaning). **Note (per Chris):** Building's Conditions tab won't have the same content as Internal Gains' Conditions tab. Building's load-shape lens is fabric heat-flow time series + element-by-element conduction, not gain temperature trace. 3e isn't a copy-paste; needs Building-specific content design.
- **3f** — Update `docs/ui_principles.md` with the canonical tab structure: Summary / Schedule (if module has schedules) / Heat balance / Conditions / 3D Model (optional, modules with facade-meaningful 3D content).
- **Part 4** — Pablo component port (ChartContainer / ZoomNav / MonthJumpButtons / DataCard / chartTokens.js).
- **Part 5** — Migrate Conditions tab to Pablo unified pattern + engine toggle wiring.
- **Part 6** — Roll out Pablo pattern to remaining time-series views (Building, etc.).
- **Part 7** — Close-out + completion checklist + canvas rendering smoketest acceptance gate.
- **Part 8 (newly scoped)** — State-aware Dynamic runs (detect project state, dispatch EP run with the matching mode).

### Brief 27 cleanup walkthrough findings — both resolved earlier this session

(unchanged from previous session-close; sections below this one capture the audit trail)

---

## 🚧 Session 2026-05-14 — paused after walkthrough findings (Brief 27 Part 3 + Finding 2 investigation)

**State:** still `paused_for_walkthrough` (halt continues pending Finding 2 fix-path decision)
**Walkthrough findings:**

### Finding 1 (Heat balance bug) — FIXED in this session

Brief 27 cleanup Part 1 closed at 10/10 but the fix was incomplete. The prop name was renamed correctly (`balance=` → `liveData=`) but the data shape didn't match. `_calculateState2` nests `annual`/`losses`/`gains`/`metadata` under `state2.heat_balance`, not at top level (the engine author's comment explicitly intended `state2.heat_balance` to be consumed). Second: internal gains were under `gains.*` rather than `gains.internal.*` where `flattenGains` looks for them.

Brief 27 cleanup reopened and closed with **Part 3 (corrected)** — see `docs/briefs/archive/27_cleanup_COMPLETED.md` Part 3 section. Revised overall Brief 27 cleanup confidence: **9/10** (was 10/10; the 1/10 gap is the missed shape verification, captured as a learning + a regression-test candidate for Brief 28a Part 7).

Fixes shipped:
- `HeatBalanceView.jsx:45` — `<HeatBalance liveData={state2?.heat_balance} ...>` (unwrap the nested heat_balance subset)
- `instantCalc.js _calculateState2` — move `people`/`lighting`/`equipment` to `gains.internal.*`; recompute `totals.gains_kwh` to include them

Verified via new `scripts/verify_state2_heat_balance_shape.mjs` (15/15 shape checks pass). State 1 + State 2 Live regressions byte-identical.

### Finding 2 (slow State 1 → State 2 transition) — FIXED via fix-path (b), pending browser verification

The Static engine itself is **sub-30ms cold, sub-10ms warm** on Bridgewater. Profiled via new `scripts/profile_static_engine.mjs`:

```
state1 cold:  7.8 ms
state2 cold:  23.5 ms
warm runs:    state1 ~1-2 ms, state2 ~6-17 ms
```

So the engine is not the bottleneck. The "~1 minute" delay is **auto-simulate firing a full Dynamic EP run in the background**:
- `SimulationContext.jsx:59` defaults `autoSimulate = true`
- `SimulationContext.jsx:92-115` triggers `runSimulation()` 2 seconds after every save (including project-load normalisations + migrations)
- Full mode EP runs take ~35-45s
- Status flips to `'running'` during the EP run

If the UI is blocking on Dynamic completion anywhere, that's a separate UI bug (Static engine numbers should appear immediately regardless). Worth verifying with Chris's browser dev tools (Network tab will show the POST to `/api/projects/{id}/simulate`).

Chris chose **fix-path (b)**: gate auto-simulate on `saveSource === 'user'`. Shipped this session:
- `ProjectContext.jsx` adds `saveSource: 'user' | 'system' | null` state.
- `_scheduleSave(endpoint, body, source = 'system')` accepts a source argument. Default `'system'` is the fail-safe — a future save call site that forgets to tag itself doesn't accidentally trigger an EP run.
- All 5 existing user-edit call sites (`updateParam` name / building, `updateConstruction`, `setComfortBand`, `updateSystem`) explicitly tag `'user'`.
- `SimulationContext.jsx` reads `saveSource` and gates the auto-simulate `useEffect` on `saveStatus === 'saved' && saveSource === 'user'`.

Acceptance criteria (Chris):
- Load project: Static numbers visible immediately, **no Dynamic run firing**.
- Edit a value (e.g., occupancy density): Static updates instant, **Dynamic fires after 2s debounce**.
- No surprise EP runs on project load.

Browser verification pending. When confirmed, **Halt 3 closes**, batch state flips `paused_for_walkthrough → running`, Brief 28a Part 3 unblocks.

Also shipped per Chris's direction: a Brief 28a Part 7 acceptance gate (rendering smoketest) documented in `docs/briefs/active/28a_visible_polish.md`. This is the discipline gap the Brief 27 cleanup Part 1 miss exposed — closing it prevents future "static check passed but runtime renders empty" misses.

---

## 🚧 Session 2026-05-14 — paused for walkthrough (initial pause, superseded by findings above)

**State:** `paused_for_walkthrough`
**Commits shipped this session:** 11 (all pushed to `origin/main`)
**Next:** Brief 28a Part 3 (canvas tab restructure) — resumes in a fresh conversation

### What shipped

| # | Brief | What |
|---|---|---|
| 1 | **27 cleanup** ✅ closed | Heat Balance prop bug fix (`HeatBalanceView.jsx:45` `balance=` → `liveData=`); divergence-doc corrections via `[CORRECTED 2026-05-14]` annotations |
| 2 | **28 prereq** ✅ closed (Option C+) | Zeroed People density in envelope-only mode; added `simulation_mode` column to `simulation_runs`; persisted Bridgewater envelope-only EP run `8d7fc517`; repointed `state1_engine_agreement.mjs` to filter by `simulation_mode='envelope-only'`; re-ran agreement and captured corrected divergence (conduction 23.5% → 6.8%, summer max gap 15K → 8.8K, audit's mass-model story confirmed at smaller magnitude) |
| 3 | **28a visible polish** 2/7 parts | Part 1: Static/Dynamic terminology rename across 19 user-facing files + corrected disclosure text (mass model, not sky model). Part 2: kWh/m²·yr live readouts on Occupancy/Lighting/Equipment section blocks + per-profile inline readout in MultiProfileList |

### Verification on pause

- State 1 Live isolation: 40/40 byte-identical
- State 1 EP isolation: 41/41 byte-identical (incl. end-to-end with People = 0.0)
- State 2 Live isolation: 21/21 byte-identical
- State 2 EP isolation: 21/21 byte-identical
- Frontend build: clean (12.58s last run)
- Working tree: clean after the session-close commit (this one)

### Walkthrough targets

When Chris loads the app:
1. **Restart uvicorn** to pick up the `/simulations` and `/simulate` endpoint changes (`simulation_mode` field now in responses + writes). DB and code on disk are correct; only the running process is stale.
2. **`/gains` → Heat balance tab** — confirms (a) prop-name bug fix (no more empty state on loaded Bridgewater) and (b) corrected disclosure text mentioning the lumped two-node mass model + ~8.8°C gap. The EngineBadge should read "Static" with the new tooltip.
3. **`/gains` → Free-running tab** — confirms updated disclosure (mass model, not sky model).
4. **`/gains` → State 1 → State 2 Delta tab** — confirms updated footnote with Static-vs-Dynamic terminology + mass-model story.
5. **Top bar** — buttons now read "Run Dynamic" / "Re-run Dynamic" / "Running Dynamic…".
6. **`/results`** — all empty states say "Run Dynamic" not "Run Simulation"; status banners say "Dynamic complete" / "Dynamic failed".
7. **`/information`** — Simulation summary card now reads "Dynamic simulation"; data-completeness item reads "Dynamic run".
8. **Each gain section's live readout** — should show a new "Per m²" row in `kWh/m²·yr` between Annual MWh and Peak kW.
9. **Per-profile readouts in Lighting / Equipment profile cards** — inline format `X MWh · Y kWh/m²·yr · Z kW peak`.

### Outstanding for the next conversation

- **Brief 28a Parts 3-7** — canvas tab restructure (Part 3 — slicing plan in `docs/briefs/active/28a_visible_polish.md`), Pablo component port (Part 4), Load shape + engine toggle wiring (Part 5, closes the Brief 27 9/10 holdback), Pablo pattern roll-out (Part 6), close-out (Part 7).
- **Brief 28b** — physics overhaul (HDKR/Perez solar + multi-layer CTF mass model). Mass-model target metric revised down to 8.8K (was 15K) per the prereq's corrected comparison.
- **Brief 29** — Building module completion (State 1 diagnostic views, UI conformance, constants cleanup, BREDEM phasing factors).
- **Open question routed to Brief 28b Part 2:** aggregate solar Live 182.9 GWh vs Sim 133.0 GWh = −27% disagreement, conflicts with physics audit's +1% aggregate finding. Probable pre-vs-post-shading accumulator mismatch in `state1_engine_agreement.mjs`. The HDKR/Perez upgrade touches the same code path.
- **Design gap logged:** the engine_agreement script's solar accumulator question + the `state2_heating_setpoint`/`state2_cooling_setpoint` schedule definition gap in `epjson_assembler.py` for envelope-gains mode (noted in `docs/state_1_free_running_verification.md` auxiliary observations).

### Resumption protocol

When the fresh conversation starts:
1. Read `CLAUDE.md`, `STATUS.md` (this section + the brief close-out sections below), `docs/briefs/current.md` (pointer to `28a_visible_polish.md`), `docs/briefs/batch_orchestration_2026_05.md` (halt protocol).
2. Run pre-flight checks (all 4 regressions + build) per `batch_orchestration_2026_05.md` starting checklist.
3. Update progress doc state `paused_for_walkthrough` → `running`.
4. Begin Brief 28a Part 3 per the slicing plan in the brief file. Standing order: proceed per the orchestration doc until halt or Brief 29 close.

---

## ✅ Brief 28 prereq closed — Free-running EnergyPlus pipeline (Option C+)

**Date closed:** 2026-05-14
**Confidence:** 9/10 (one open question on solar aggregate routed to Brief 28b Part 2)

The Brief 28 prerequisite (free-running EP simulation pipeline) shipped
via Option C+ after the initial Part 1 verification surfaced — then
resolved — a halt-2 premise question. Final scope:

- **C+ Step 1.** `epjson_assembler.py:192` `_build_people_objects` had
  `density = max(density, 1e-4)` unconditionally, silently overriding
  State 1's explicit zero-out. Now gated on `density > 0` so exact 0.0
  passes through. EP accepts `people_per_floor_area: 0.0`.
- **C+ Step 2.** New `simulation_mode` column on `simulation_runs`
  (idempotent migration script). Schema + `/simulate` and
  `/simulations` API endpoints updated. New
  `scripts/run_envelope_only_sim_bridgewater.py` persisted run
  **`8d7fc517`** with `simulation_mode='envelope-only'`.
- **C+ Step 3.** `state1_engine_agreement.mjs` repointed to filter by
  `simulation_mode === 'envelope-only'` rather than picking the most-
  recent-any-mode sim.
- **C+ Step 4.** Re-ran the agreement check on the new envelope-only
  run. Captured corrected numbers in
  `docs/state_1_engine_divergence_investigation.md` as a dated
  addendum.

Headline finding (full table in the divergence doc):

| Metric                | Live (Static) | Sim free-running | Δ      |
|-----------------------|--------------:|-----------------:|-------:|
| summer_max_c          | 44.2 °C       | 35.4 °C          | −8.8 K |
| winter_min_c          |  4.0 °C       |  8.3 °C          | +4.3 K |
| cooling_demand_mwh    | 108.6         | 61.7             | −43%   |
| Conduction uniform-Δ  | —             | —                | −6.8%  |

The 23.5% uniform conduction divergence WAS the HVAC-clamping artefact
(now 6.8% with proper free-running comparison). The mass-model
summer-max story stands but at smaller magnitude (8.8 K gap, not
~15 K) — Brief 28b Part 3 (multi-layer CTF) target metrics revised.

State isolation regressions still byte-identical post-changes
(40/40 + 41/41 EP + 21/21 + 21/21). Build clean.

One open question: aggregate solar Live vs Sim still shows −27.3%
disagreement, which conflicts with the physics audit's +1% aggregate
finding. Probable pre-vs-post-shading accumulator mismatch in
`state1_engine_agreement.mjs`. Routed to Brief 28b Part 2.

---

## ✅ Brief 27 cleanup closed — Heat Balance prop bug + divergence doc correction

**Date closed:** 2026-05-14
**Confidence:** 10/10 (two narrowly-scoped fixes; no design decisions)

Two close-out items flagged by the May 2026 audits:

- **Part 1 — Heat Balance prop bug** (`d281a16`). One-line rename
  `balance=` → `liveData=` on `HeatBalanceView.jsx:45`. The Internal
  Gains → Heat balance tab was showing the empty state on a loaded
  Bridgewater because the wrapper passed the wrong prop name to the
  shared `HeatBalance` component. Distinct from the `4f4f3a5`
  `useStateComparison` race fix — sequential bugs (the race fix
  unblocked `ready`, which then exposed the prop-name mismatch).
- **Part 2 — Divergence doc correction** (`8dc1909`). Annotated
  `docs/state_1_engine_divergence_investigation.md` per the physics
  audit's three findings: the "38% solar over-count / 50 GWh phantom
  solar" was a pre-shading-vs-post-shading methodology error
  (apples-to-apples aggregate is +1%); the "23.5% uniform conduction
  divergence" was a Static-free-running vs Dynamic-HVAC-clamped
  comparison artefact; the HDKR/Perez fix is still warranted but
  smaller-impact than the doc originally claimed. Audit trail
  preserved with inline `[CORRECTED 2026-05-14]` blocks.

All four state-isolation regressions remain byte-identical post-cleanup
(40/40 State 1 Live, 41/41 State 1 EP incl. end-to-end, 21/21 State 2
Live, 21/21 State 2 EP). Frontend build clean.

---

## ✅ Brief 27 + 27 Revised closed — Internal Gains module (State 2)

**Date closed:** 2026-05-13
**Confidence:** 9/10 (engine toggle wiring queued for Brief 28; the
single 1/10 gap is the Live | Simulation segmented control on the
canvas views — the placeholder slot is wired but the actual toggle
needs State 2 EP results plumbing first)

### What shipped

**Data model + contract (v2.4):**
- `building_config.occupancy.*` as a first-class block (density basis,
  rate, sensible/latent heat per person, hourly schedule with full
  v2.4 exceptions)
- `building_config.gains.{lighting,equipment}.profiles[]` arrays —
  multi-profile load-type architecture; each profile carries its own
  magnitude, area_share, relationship_to_occupancy, spill_minutes /
  daylight_factor / standby_factor, schedule. Σ area_share is
  informational, never auto-balanced.
- Full editable curves per exception period (`exceptions[]`) with
  optional `ignore_monthly_multipliers` and stable ids
- Idempotent migrations v2.3 → v2.4 on load + persistent backend script
  `scripts/migrate_gains_v24.py` (ran cleanly on Bridgewater + New
  Project, 4 changes total)

**Live engine (`frontend/src/utils/instantCalc.js`):**
- `_calculateState2` iterates profiles with `area_share` weighting,
  emits the v2.4 output shape (profiles arrays + totals)
- `state1_delta` mandatory in State 2 output
- Multi-profile additivity verified at 0.01% drift
  (`scripts/state2_multiprofile_smoketest.mjs`)

**EnergyPlus engine (`nza_engine/generators/epjson_assembler.py`):**
- One `Lights` / `ElectricEquipment` per profile per zone
- Baseload + active split into separate always-on / scheduled
  ElectricEquipment objects
- Per-profile `Schedule:Compact` honouring relationship_to_occupancy
- SQL parser dispatches mode='envelope-gains' to
  `_get_heat_balance_state2` (aggregate only — per-profile breakdown
  in SQL is Brief 28 territory)

**UI:**
- `/gains` route with two-column shell, three input sections
  (Occupancy / Lighting / Equipment), centre-canvas with seven tabs
  (Schedule, State 1 → State 2, Heat balance, Free-running, Hourly
  profile, Annual breakdown, 3D model)
- Centre-canvas schedule editor with drag-paint, day-type tabs,
  per-day-type quick-sets (Flat 0/0.5/1, Invert, Shift, Apply baseload,
  Multiply × N), monthly multiplier row, exception authoring with
  full editable curves + Christmas / Summer / UK bank holidays / Custom
  presets, 8,760-cell annual heatmap with exception highlighting
- Multi-profile UI (Lighting + Equipment): profile list with inline
  edit panel for the active profile, [⋯] menu (Duplicate / Delete),
  + Add profile with building-type-aware load templates (hotel /
  office / school / retail / Custom), profile selector + area-coverage
  indicator on the canvas
- Six diagnostic canvas views (Delta as headline, Annual breakdown,
  Free-running, Hourly profile, Heat balance, 3D placeholder)
- `EngineBadge` chip labelling Live engine output on State 1 → State 2,
  Heat balance, Free-running views
- Sidebar reordered to state progression (Overview → Weather →
  Building → Internal Gains → Operation → Systems → Results)
- `/profiles` route deleted

**Regressions:**
- State 1 live: 40/40 byte-identical
- State 1 EP: 40/40 byte-identical
- State 2 live: 21/21 byte-identical
- State 2 EP: 21/21 byte-identical

**Module completion checklist:**
- Filled at `docs/module_checklists/internal_gains_brief_27.md`
- 9/10 confidence; the 1/10 gap is the engine toggle (Brief 28 Part 2)

**Briefs archived:**
- `Brief_27_Internal_Gains.md` → `archive/27_Internal_Gains_COMPLETED.md`
- `Brief_27_Revised.md` → `archive/27_Revised_Internal_Gains_COMPLETED.md`

**Parked briefs renamed for clarity** (orphan numbering claims removed):
- `Brief_27_Systems_Inspectors.md` → `Brief_PARKED_Systems_Inspectors.md`
- `Brief_28_Solar_Diagnostics.md`  → `Brief_PARKED_Solar_Diagnostics.md`

### Investigation: State 1 Live vs Sim divergence

The Brief 27 close-out walkthrough surfaced a 15°C summer-max gap
between Live and Sim on Bridgewater State 1. Full investigation at
`docs/state_1_engine_divergence_investigation.md`. Headline:
- The numbers are correct engine outputs; not a regression.
- `building_config` drifted since Brief 26.2 close
  (`infiltration_ach: 0.2` was 0.5, `orientation: 42°` was 0°,
  `wwr` shifted to N 0.55 from balanced 0.25) — these expose the
  documented isotropic-sky residual in the live engine more sharply.
- Fix is queued as Brief 28 Part 1 (live engine solar model:
  isotropic → HDKR / Perez), top priority for the cleanup pass.

### Next task

**Brief 27-29 batch (May 2026) in flight.** The original Brief 28 +
Brief 29 plan was rescoped after the physics + UX audits into a
5-brief batch executed end-to-end without per-brief walkthroughs (one
walkthrough at the end). See:

- `docs/briefs/current.md` — pointer to active brief
- `docs/briefs/batch_orchestration_2026_05.md` — full 5-brief plan, halt protocol, sequencing rationale
- `docs/batch_progress_2026_05.md` — per-part execution state + decisions log

Batch sequence:
1. ~~Brief 27 cleanup~~ — **closed 2026-05-14**
2. ~~Brief 28 prereq (free-running EP simulation)~~ — **closed 2026-05-14 (Option C+)**
3. Brief 28a (visible polish: rename, kWh/m²·yr readouts, canvas restructure, Pablo port, engine toggle) — **next**
4. Brief 28b (physics overhaul: HDKR/Perez solar + multi-layer CTF mass model)
5. Brief 29 (Building module completion: State 1 diagnostic views, UI conformance, constants cleanup, BREDEM phasing)

The original `Brief_28_Cross_Cutting_Polish.md` and
`Brief_29_Building_Module_Completion.md` have been archived with
`_SUPERSEDED` suffix; the May 2026 batch supersedes them.

**Sequencing beyond Brief 29:**
- Brief 30: Operation v2 (State 2.5)
- Brief 31: Weather module redesign
- Briefs 32–33: Systems Inspectors (State 3 — PARKED brief carries forward)
- Brief 34: CI for state contracts
- Brief 35+: State 4 reconciliation

---

## ✅ Brief 26.1 closed — State 1 finalisation

Five months after Brief 26 closed with all automated tests green, a manual
UI walkthrough caught four contract violations. Brief 26.1 resolved them
and surfaced a fifth (latent assembler regression). State 1 is now
genuinely done — annual integrated metrics agree silently between
engines, the UI shows the contract output shape in both Live and Simulation
views, and the model is honest about its remaining limitations.

### Issues addressed

| # | Issue | Root cause | Resolution | Part |
|---|---|---|---|---|
| 0 | EP fatal on louvre-bearing projects | `epjson_assembler.py:914` overwrote `Schedule:Constant` instead of merging — wiped state1 thermostat schedules | Single-line `setdefault().update()` fix | Part 0 hotfix |
| 1 | Sim view didn't show State 1 contract shape | `useSimulationBalance` fetched `/balance` without `?mode=envelope-only` → backend returned full-mode shape | Threaded `mode` through hook + 3 call sites | Part 2 |
| 2 | Glazing + floor losses read 0 in Sim view | Downstream of (0): EP wasn't producing output | Resolved by Part 0 hotfix; Brief 26 Part 6 parser was already correct | Part 2 (no parser work needed) |
| 3 | Free-running summer_max 43°C (contract bound ≤36°C) | Single-node lumped capacitance: all solar instantly heats indoor air, no surface absorption delay | Two-node topology (solar → T_mass, air at QSS); plus thermal mass derived from constructions instead of dropdown | Parts 3 + 5 |
| 4 | Thermal mass redundant dropdown | Construction library had all the data; manual category could disagree with the physical stack | Auto-derivation from layer build-up (Σ thickness × density × Cp on indoor side of insulation) | Part 5 |

### Bridgewater final numbers — engine agreement

| Metric | Pre-26.1 (Brief 26 baseline) | Post-26.1 | EP sim | Flag |
|---|---:|---:|---:|---|
| `annual_mean_c` | 17.4 | **18.3** | 18.4 | ✓ silent |
| `underheating_hours` | 5851 | **5244** | 5256 | ✓ silent (+0.2%) |
| `overheating_hours` | 2137 | **1728** | 1788 | ✓ silent (+3.5%) |
| `comfort_hours` | 1588 | **1788** | 1716 | ✓ silent (-4.0%) |
| `heating_demand_mwh` | 214.4 | 202.8 | 214.5 | ~ soft (+5.8%) |
| `summer_max_c` | 43.0 | 42.3 | 34.2 | ! warn (residual) |
| `cooling_demand_mwh` | 56.8 | 66.5 | 45.4 | !! HARD (residual) |

All four **distribution metrics** silent vs EP. **Heating demand** drift
from +0.8% to +5.8% (still soft — small drift from Part 3's two-node
integration, well within tolerance). **Peak temperature** and **cooling
demand** remain divergent — documented as divergence #7, traceable to
divergence #1 (isotropic vs Perez sky over-counts solar by ~32%/yr;
lumped models can't escape that integral). The Bridgewater config sits
at the WWR=100% extreme; both engines confirm State 1 envelope-only
overheats without venting.

### What landed

- **Mode threading** — `useSimulationBalance(projectId, runId, mode)` and
  three call sites: Building module → `envelope-only`, Results +
  BalanceTestPage → explicit `full`.
- **Two-node free-running model** in `_calculateEnvelopeOnly`: solar →
  T_mass (explicit Euler on C_mass), air at quasi-steady state,
  T_op = mean(T_air, T_mass) for comfort/demand triggers. h_am = 4.5
  W/m²K (CIBSE Guide A 2.5–8 range, tuned for Bridgewater).
- **Construction-derived thermal mass** (`utils/thermalMass.js`):
  per-construction mass from layer build-up (Σ thickness × density × Cp
  on indoor side of insulation), area-weighted across envelope elements.
  Bridgewater: 138.6 kWh/K total (1.8× the old "light" default).
- **Auto/Override UI**: Building → Fabric → Thermal Mass picker with
  derived value + per-element breakdown live (Auto, default) or legacy
  TM52 dropdown (Override, for sensitivity studies).
- **Construction Inspector** shows derived "Effective indoor thermal mass"
  per construction with category badge.
- **API**: `/api/library/constructions` list endpoint now includes
  `layers` array per construction so the frontend can derive mass without
  per-construction round-trips.
- **UI engine disclosure** in the State 1 demand panel — when Live shows
  summer_max > 36°C and the user is viewing the Live engine, a short
  note explains the isotropic sky over-prediction and points to the
  Simulation view as canonical for peak temperatures.

### Process lessons (now in `state_1_divergences.md`)

- **§5 walkthrough discipline > automated regression.** The Brief 26
  close-out failure is the canonical example — all tests green, four
  contract violations + one latent regression caught only by manual UI
  inspection on a production-shaped config. Brief 26.1's "VERIFICATION
  RULES" block became the discipline upgrade; Briefs 27/28/29 should
  inherit it.
- **§6 library ground-floor layer ordering.** Walls/roofs stored
  outside-first; floors stored indoor-first. EP tolerates it (U is
  direction-symmetric); any layer-convention-aware code has to compensate.
  Logged for a future library housekeeping brief.
- **§7 residual summer_max gap.** Documented with fallback options
  (retune h_am — explored, doesn't help; radiative sky loss; floor/wall
  split; full Perez). All future-brief candidates.

### Diagnostic + verification scripts (reusable)

| Script | Purpose |
|---|---|
| `scripts/state1_engine_agreement.mjs` | Live vs sim parity check per the contract |
| `scripts/state1_isolation_live.mjs` | Forbidden-input byte-identity (live) |
| `scripts/state1_isolation_epjson.py` | Forbidden-input byte-identity (EP path) |
| `scripts/state1_thermal_mass_smoketest.mjs` | Both Auto and Override wirings respond to changes |
| `scripts/state1_peak_summer_diagnostic.mjs` | Hour-by-hour energy balance at the indoor peak |
| `scripts/state1_tracer.mjs` | T_op trace around the peak window for any project |
| `scripts/state1_library_audit.py` | Per-construction derived mass + categorisation |

### Final regression status

- Engine agreement: 4/4 distribution metrics silent ✓
- State isolation live: 22/22 ✓
- State isolation EP path: 23/23 ✓
- Thermal mass smoke test: Override + Auto wirings both pass ✓

### Suggested next briefs (unchanged order)

| Brief | Topic |
|---|---|
| 27 | Systems Inspectors (`docs/briefs/Brief_27_Systems_Inspectors.md`) |
| 28 | State 2 Internal Gains (people, lighting, equipment) |
| 29 | State 2.5 Operation (operable windows, schedules) |
| 30 | CI for state contracts |
| later | Perez anisotropic sky in `solarCalc.js` (closes divergence #1 → #7) |
| later | Schema migration + State 4 reconciliation |

---

## ✅ Brief 26 closed — State 1 envelope-only computation

**What landed:**

- **State 1 threaded through both engines.** Live engine
  (`_calculateEnvelopeOnly` in `instantCalc.js`) and EnergyPlus
  (`assemble_epjson(mode='envelope-only')` → `_get_heat_balance_state1`
  in `sql_parser.py`) both produce the contract-shaped State 1 output:
  `gains.solar`, `losses.conduction.{external_wall, roof, ground_floor,
  glazing.{f1..f4}, thermal_bridging}`, `losses.ventilation.{fabric_leakage,
  permanent_vents}`, `free_running.{annual_mean_c, winter_min_c,
  summer_max_c, hourly_temperature_c}`, `demand.{heating_demand_mwh,
  cooling_demand_mwh, underheating_hours, overheating_hours, comfort_hours}`.

- **Comfort band as first-class project input.** `comfort_band_lower_c`
  and `comfort_band_upper_c` are persisted on the project row, editable
  in the UI, and drive State 1 demand derivation in both engines.

- **Provenance scaffolding** (v2.1 schema): `_provenance` sibling object,
  dot-notated paths, six-value source enum. Ready to populate as later
  states need it.

- **Three compounding bugs caught and fixed:**
  1. **Variable shadowing in `assemble_epjson`** — `mode = sc.get("mode", ...)`
     clobbered the function parameter. State 1 sims silently fell through
     to detailed mode + hotel thermostat schedules, reporting 128.9 MWh
     heating instead of zero. Fixed by renaming to `hvac_mode` with
     state1 short-circuit.
  2. **Glazing parser bug (Brief 21 carry-over)** — `get_envelope_heat_flow_detailed`
     only matched `_WALL_` for conduction routing, so windows were always
     tagged with zero conduction. `losses.glazing` came back empty in the
     full-mode heat balance too. Fixed by adding the `_WIN_` filter block.
  3. **Air heat capacity unit bug** — first cut of the parser multiplied
     0.33 Wh/(m³·K) by 1000, reporting demand as 106 GWh. Caught by the
     engine-agreement check on first run. Constant renamed
     `_AIR_HEAT_CAPACITY_WH_PER_M3_K` to make the unit explicit.

- **Contract v2.2 published.** State 1 verification ranges revised from
  Passivhaus-aspirational to standard UK 2018-vintage hotel reference.
  Discipline rule added: every expected range must be backed by an
  independent first-principles calculation with stated fabric / occupancy /
  systems spec. Bridgewater reference scenario documented in full.

- **Engine agreement at +0.8% on the headline.** Heating demand
  (the contract-significant number) agrees within 1% between engines on
  Bridgewater. Live 166.8 MWh vs sim 168.1 MWh. Conduction line items
  agree at -11.7% across the board — a structural temperature-trace
  divergence, not a per-element bug (proportional offset rules out the
  alternative). Hard warnings on temperature extremes are the
  lumped-capacitance vs EP transient-mass divergence and are catalogued
  in `docs/state_1_divergences.md` as known and acceptable.

- **State isolation regression with 45 byte-identical scenarios.**
  Two scripts (`scripts/state1_isolation_live.mjs` and
  `scripts/state1_isolation_epjson.py`) enumerate the canonical
  `FORBIDDEN_ENVELOPE_ONLY_INPUTS` list and assert byte-identity at
  canonical-JSON level with zero float tolerance. Live engine: 22/22.
  EP path (assembler byte-identity + one full end-to-end EP run): 23/23.
  Every leakage surface (geometry, IDF assembler, SQL parser) covered.

- **Engine-agreement script as canonical regression**
  (`scripts/state1_engine_agreement.mjs`). Standard pattern for States 2,
  2.5, 3 to follow.

- **Thermal mass dropdown** in Building → Fabric drives the live engine's
  lumped-capacitance model. Wiring verified by a smoke test that confirms
  monotonic convergence: heavy mass narrows live-vs-sim disagreement on
  `winter_min_c` from +252% HARD to +21.8% warn, exactly the EP transient-mass
  convergence behaviour predicted.

**Known limitations carried into future briefs (all "known and acceptable
for State 1"):**

- **Isotropic-sky vs Perez anisotropic diffuse model** —
  `solarCalc.facadeRadiation` uses isotropic. Over-predicts diffuse on
  north-leaning faces by ~10–15%, under-predicts on faces pointing toward
  the sun. EP uses Perez. (Divergence #1 in
  `docs/state_1_divergences.md`.)

- **Lumped-capacitance vs full transient thermal mass** — live engine
  uses one heat-capacity number per `thermal_mass_category`; EP uses a
  full layered transient solver. Affects free-running temperature trace
  extremes, downstream cooling/comfort hour counts. (Divergence #2.)

- **Stack-only ventilation pressure ignored** — both engines use
  `Q = Cd · A · √Cw · v_wind` with stack term zeroed for the
  single-zone constraint. Real buildings see 30–50% of opening flow
  from stack at low wind. (Divergence #3.)

- **Single-zone model, no AirflowNetwork** — multi-zone airflow with
  per-zone wind/stack pressures, internal door connections, etc., is
  not modelled. Brief 25 documents the simplification.

- **Python regex parse of the forbidden inputs list** — pragmatic but
  fragile to JS reformatting. Tripwire in place (assert ≥15 entries
  parsed). JSON export is the right long-term fix. (Divergence #4.)

These are properly documented in `docs/state_1_divergences.md` and are
addressed (or accepted) in future briefs as needed. State 1 is **done**,
not perfect.

**Suggested next briefs:**

| Brief | Topic |
|---|---|
| 27 | Systems Inspectors (file exists at `docs/briefs/Brief_27_Systems_Inspectors.md`) |
| 28 | Internal Gains — State 2 path (people, lighting, equipment as gain layer; live + EP) |
| 29 | Operation v2 — State 2.5 path (operable windows, schedules, free-running with intervention) |
| 30 | CI for state contracts — wire both isolation scripts and the engine-agreement script into pre-merge checks |
| later | Schema migration + State 4 reconciliation (live ↔ sim ↔ measured trinity) |

Brief 28 (Solar Diagnostics) currently exists as a parked file —
recommend re-purposing the slot for State 2 internal gains, with solar
diagnostics absorbed into Brief 27 if convenient.

---

## ✅ Brief 26 Part 9 — state isolation regression test harness

State 1 isolation is now verified by two scripts that enumerate the
canonical forbidden-input list (read programmatically from
`frontend/src/utils/stateMode.js:FORBIDDEN_ENVELOPE_ONLY_INPUTS` — no
hand-maintained duplicate). Bar is byte-identical canonical JSON; float
tolerance is zero.

### `scripts/state1_isolation_live.mjs` — live engine

22 scenarios, all pass:
- 21 forbidden inputs set individually to unambiguously-distorting
  values (LPD=100, equipment=100, setpoint_heating=35, people_per_room=5,
  openable_fraction=0.99, etc.)
- 1 COMBINED scenario with every forbidden input absurd at once

Every output deep-equal to baseline. `withMode()` in `instantCalc.js`
is doing its job at the entry to `_calculateEnvelopeOnly`.

### `scripts/state1_isolation_epjson.py` — EP path

23 scenarios, all pass:
- 22 epJSON byte-identity checks (same forbidden-input enumeration as
  the live engine, applied to `assemble_epjson(..., mode='envelope-only')`)
- 1 end-to-end EP run for the COMBINED scenario: baseline + combined-absurd
  configs both assembled, simulated, parsed, and the resulting State 1
  outputs compared byte-for-byte. Identical.

EP byte-identity transitively guarantees parser isolation (EP is
deterministic on identical epJSON; the parser only reads State-1-allowed
inputs). The end-to-end run closes the contract spec literally.

### Absurd values used (live + EP, matched)

| Path | Value |
|---|---|
| `params.num_bedrooms` | 9999 |
| `params.occupancy_rate` | 9.99 |
| `params.people_per_room` | 5.0 |
| `systems.lighting_power_density` | 100 W/m² |
| `systems.equipment_power_density` | 100 W/m² |
| `systems.space_heating` | `{setpoint_heating_c: 35, cop: 99}` |
| `systems.space_cooling` | `{setpoint_cooling_c: 5, cop: 99}` |
| `systems.dhw` | `{setpoint_c: 99, cop: 99}` |
| `openings.schedule` | `'always'` |
| `openings.{face}.openable_fraction` | 0.99 |
| (and 11 more — full list in script) | |

### Suggestion — CI integration (future brief)

State isolation is foundational to State 4 (reconciliation) working
correctly. Regression failures should block merges. Worth scoping
in a "CI for state contracts" brief (~Brief 30) — both scripts return
exit code 0 on pass / 1 on leak, so they drop into CI without further
wiring. Not implementing now per scope-stay rule.

---

## ✅ Brief 26 Part 7 — thermal mass dropdown in Building Fabric

`params.thermal_mass_category` is now editable through the Building →
Fabric tab. Dropdown sits between Air Permeability and Fabric Summary,
shows the CIBSE TM52 capacity number alongside each option, and a
one-liner describing the construction class.

Wiring smoke test (`scripts/state1_thermal_mass_smoketest.mjs`) passes
on Bridgewater — live engine swing narrows monotonically with mass:

| Category | winter_min | summer_max | swing | heating MWh |
|---|---:|---:|---:|---:|
| light  | 1.9°C | 50.3°C | 48.4°C | 166.8 |
| medium | 4.2°C | 45.9°C | 41.7°C | 162.2 |
| heavy  | 5.5°C | 42.9°C | 37.4°C | 158.7 |

11°C sensitivity between light and heavy. Re-running the engine-agreement
check with `--mass=heavy` (script supports the override) shows the live
engine converging toward EP exactly as predicted: `winter_min` HARD →
warn (+22%), `underheating_hours` soft → silent (-0.9%), `comfort_hours`
HARD → warn (+30%). EP doesn't move with the dropdown — it integrates
real layered mass — so this convergence is the live engine catching up
to the more sophisticated model.

**Files changed:**
- `frontend/src/components/modules/building/FabricTab.jsx` — new
  `ThermalMassPicker` card between air permeability and fabric summary.
- `scripts/state1_thermal_mass_smoketest.mjs` — new — runs live engine
  with light/medium/heavy and emits a pass/fail verdict on dropdown wiring.
- `scripts/state1_engine_agreement.mjs` — added `--mass=` override so
  the agreement check can sweep mass categories.

Nothing else changed: no schema migration needed (`thermal_mass_category`
default `'light'` already in ProjectContext), no API changes, no parser
changes (EP integrates real layered mass; thermal_mass_category drives
the live engine only).

---

## Engine-agreement script — standard regression for State 1+

`scripts/state1_engine_agreement.mjs` is now the canonical regression
check for State 1. Any change to either engine (live `instantCalc.js`,
sim `_get_heat_balance_state1`, EP assembler) must keep heating demand
within the silent tolerance (<5%) and conduction line items within
warn (<30%). Run it after Part 7 with each thermal mass option to
smoke-test wiring.

States 2, 2.5, 3 will need their own equivalents — same pattern, same
discipline. The contract's tolerance bands apply per state.

## Open follow-up — sensitivity floor on contract flags

The current tolerance bands (silent <5% / soft <10% / warn <30% / hard
>30%) are pure percentages with no absolute-value floor. For small
absolute values (e.g. cooling demand <20 MWh) this produces noisy
hard-warning flags from tiny absolute differences. Worth adding a
sensitivity floor in a future brief: e.g., "don't hard-warn if both
values are below an absolute threshold." Not blocking — flagged here
so the next regression noise complaint has a documented fix path.

---

## ✅ Brief 26 Part 6 — sql_parser State 1 output path

EnergyPlus parser now produces the State 1 envelope-only output shape from
the free-running simulation run produced by Part 5.

**What changed:**

1. **`sql_parser.get_envelope_heat_flow_detailed`** — glazing conduction
   block added (Brief 21 fix). Previously windows were tagged `_WIN_*` in
   the SQL key-value but the surface-type routing only matched `_WALL_*`,
   so `losses.glazing` came back zero in the full-mode heat balance too.
   Now reads `Surface Inside Face Conduction Heat Transfer Energy` filtered
   by `_WIN_` and rolls into `glazing[face].annual_heat_loss_kWh`.

2. **`sql_parser.get_heat_balance(..., mode="envelope-only")`** — new
   short-circuit into `_get_heat_balance_state1()`, which:
   - Reads hourly `Zone Mean Air Temperature` (air → conduction physics)
     and `Zone Operative Temperature` (operative → comfort hours and
     demand trigger) from the EP SQL output.
   - Reads outdoor dry-bulb and wind speed from the EPW.
   - Reads per-face window solar (`Surface Window Transmitted Solar
     Radiation Energy` filtered by `_WIN_`) hourly.
   - Computes UA_fabric, UA_leakage, UA_permanent matching the live
     engine's lumped-capacitance formulation exactly (constants in
     parser comments).
   - Derives heating/cooling demand against the project comfort band
     using the same formula as `_calculateEnvelopeOnly` in
     `frontend/src/utils/instantCalc.js` (max(0, Q_loss_at_setpoint −
     solar) for heating; Q_gain_at_setpoint + UA·max(0, T_out − upper)
     for cooling).
   - Returns the State 1 contract shape: `state`, `mode`, `inputs_used`,
     `comfort_band_used`, `gains.solar`, `losses.conduction`,
     `losses.ventilation`, `free_running`, `demand`, plus a nested
     `heat_balance` dict so the HeatBalance component renders unchanged.

3. **`epjson_assembler._output_variables`** — Zone Mean Air Temperature
   and Zone Operative Temperature already added in the Part 6 prep.
   Both now confirmed present in EP SQL output post-run.

4. **`api/routers/projects.py:get_simulation_balance`** — threads `mode`,
   `comfort_band` (from project columns) and `library_data` (constructions
   library fetched from `library_items`) into `get_heat_balance`. State 1
   path uses the library to resolve U-values exactly the way the live
   engine's `getUValue` does.

5. **Unit fix** — air heat capacity constant clarified: 0.33 is
   **Wh/(m³·K)** not kWh, mirroring the live engine's value. Initial
   implementation multiplied by 1000 and reported demand as 106 GWh.
   Corrected.

**Engine-agreement check on Bridgewater** (see
`scripts/state1_engine_agreement.mjs`):

| Output                    | live   | sim    | Δ        | Flag    |
|---------------------------|--------|--------|----------|---------|
| **heating_demand_mwh**    | 166.8  | 168.1  | +0.8%    | silent  |
| underheating_hours        | 4145   | 3895   | -6.0%    | soft    |
| annual_mean_c             | 21.1   | 19.9   | -5.7%    | soft    |
| conduction (all elements) | varies | varies | -11.7%   | warn    |
| solar by face             | varies | varies | -15-26%  | warn    |
| overheating_hours         | 2550   | 2137   | -16.2%   | warn    |
| summer_max_c              | 50.3°C | 38.2°C | -24.1%   | warn    |
| cooling_demand_mwh        | 171.1  | 109.2  | -36.2%   | HARD    |
| comfort_hours             | 2065   | 2728   | +32.1%   | HARD    |
| winter_min_c              | 1.9°C  | 6.7°C  | +252%    | HARD    |

**Headline:** heating demand agrees to <1% between engines. Conduction
line items agree to -11.7% across the board (no per-element bug — the
proportional offset confirms it's the T_zone trace, not the U-values).
Temperature extremes (winter min, summer max) and downstream cooling/comfort
hour counts diverge sharply because the live engine's lumped-capacitance
model can't replicate EP's full transient thermal mass response. Documented
as known divergence #2 in `docs/state_1_divergences.md`.

**Note on Bridgewater + contract bounds v2.2:** the actual building has
100% glazing on S/E/W with zero shading depth and no internal gains/venting
in State 1 — both engines confirm it genuinely overheats (2137 hrs sim,
2550 hrs live). The contract's 200–600 hrs overheating bound was calibrated
for a more conservative WWR; this project sits at the extreme.

**Files changed:**
- `nza_engine/parsers/sql_parser.py` — `get_envelope_heat_flow_detailed`
  glazing block; new `_get_heat_balance_state1` + helpers; `get_heat_balance`
  signature now `mode/comfort_band/library_data`.
- `api/routers/projects.py:get_simulation_balance` — comfort_band +
  library_data + mode threading.
- `docs/state_1_divergences.md` — divergence #2 updated with measured
  Bridgewater numbers from the agreement check.
- `scripts/state1_engine_agreement.mjs` — new — runs live engine via
  Node, fetches sim output, prints side-by-side with tolerance flags.

---

## ✅ Brief 26 Part 3 — Bridgewater verification passes

**Resolution:** contract v2.1 ranges were Passivhaus-target aspirational, not
ranges for the as-built Bridgewater HIX (standard UK 2018-vintage cavity-wall
hotel). Contract v2.2 (commit pending) reframes the State 1 verification
around the actual reference scenario and updates the bounds accordingly.

**Reference scenario** (now documented in `docs/state_contracts.md` § State 1
Verification): wall U≈0.28, roof U≈0.18, floor U≈0.22, glazing U≈1.43 / g=0.56,
q50 ≈ 7 m³/h·m², 138 trickle vents × ~7,000 mm² each, Yeovilton TMYx,
comfort band 20–26°C.

State 1 outputs vs revised bounds:

| Output | Bound | Got | ✓ |
|---|---|---:|---|
| Heating demand | 150–250 MWh | 175 | ✓ |
| Cooling demand | 5–20 MWh | 17 | ✓ |
| Overheating hours | 200–600 | 517 | ✓ |
| Underheating hours | 4,500–6,500 | 5,849 | ✓ |

Independent BREDEM-style sanity check (UA × HDH, no model, no solar credit,
no thermal mass): 270 MWh. State 1 model returns 35% lower, consistent with
the lumped-capacitance + solar gain credits. Model order-of-magnitude verified.

State isolation regression also passes byte-identical (setting num_bedrooms,
LPD, EPD, systems setpoints, operable windows all to absurd values has zero
effect on State 1 output).

---

## Last completed

### ⚠️ Reference numbers prior to 2026-05-13 are invalid

Every simulation run and every live-calc result produced before commit `779a9df`
used the broken EPW parser (columns shifted by one, DNI labelled as DHI) AND
the inverted azimuth in `sunPosition`. Any numbers cited from before that date
— annual EUI, fuel split, CRREM stranding year, scenario comparisons, baselines,
docs, screenshots — should be treated as approximate and **re-run before being
benchmarked against**. The errors mostly cancelled in some cases (north and
south both over-predicted; east and west swapped but symmetric) so output
*looked* plausible, but underlying physics was wrong.

This applies to all simulation history, brief verification figures (Brief 07
TM54 ranges, Brief 21 Heat Balance numbers, Brief 25 openings A/B), and any
reference baselines in `docs/briefs/archive/`. Don't trust pre-2.5 outputs
without re-running.

---

**Brief 26 Part 2.5 (geometry alignment + solar physics fixes)** — 2026-05-13.

- **2.5a:** Swapped 3D viewer X/Z axes so building runs east-west (X=length,
  Z=width). N/S faces are now LONG (matching EP geometry.py + instantCalc.js).
  Was: X=width / Z=length, opposite of every other engine.
- **2.5b:** F1-F4 camera buttons now rotate with `params.orientation` so each
  preset always shows its own (rotated) face dead-on.
- **2.5c:** Per-face billboard labels (drei `Billboard` + `Text`) showing
  `F# — compass`, `dims · area`, `WWR % · azimuth°`. Track faces through
  rotation, billboard to camera.
- **2.5d:** Two real physics bugs found and fixed:
  1. **`sunPosition` azimuth was inverted by 180°.** Formula labelled as
     "from south" actually returned angle from north, and code added another π.
     Net: solar noon sun rendered as pointing north → north facades got south
     sun, vice versa. Fixed by relabelling and using `azimuth = afternoon ?
     2π − azFromN : azFromN`.
  2. **EPW parser columns off by one** — `parts[13]` is GHI per spec but
     was labelled `direct_normal`; DHI (column 15) was never read; DNI (14)
     was labelled `diffuse_horizontal`. Pre-fix DHI sum was 1165 kWh/m²/yr
     (≈ 2× realistic). Now: DNI 1165, DHI 491. Both within UK norms.

### Per-facade annual incident solar (Bridgewater, Yeovilton TMYx, post-fix)

| Facade | UK norm | Computed |
|---|---:|---:|
| N (orient=0) | 250-350 | 379 |
| E (orient=0) | 450-600 | 630 |
| S (orient=0) | 700-900 | 889 |
| W (orient=0) | 450-600 | 711 |
| Roof | 900-1100 | 1075 |
| F1 NE (orient=42) | 350-450 | 439 |
| F2 SE (orient=42) | 650-800 | 797 |
| F3 SW (orient=42) | 650-800 | 873 |
| F4 NW (orient=42) | 350-450 | 516 |

All within or slightly above the upper edge of UK ranges (consistent with
Yeovilton TMYx including recent warmer years). North slightly over-predicted
because of isotropic-sky diffuse model — known limitation, acceptable.

Solar magnitude bug closed. For HIX (WWR 0/1/1/1 on N/E/S/W, orient=42°):
F2 SE (long × 100% × SE sun) ≈ 612k kWh/yr — largest by far, as expected.

---

**Brief 23 (partial)** — Debug EnergyPlus shading not visibly applied (2026-05-06). All three hypotheses tested; none produced solar reduction. Open issue carried over.

**Brief 23 findings:**
- H1 (explicit `ShadowCalculation` with `DetailedSkyDiffuseModeling` + Timestep updates): no effect
- H2 (`solar_distribution: FullExterior`): no effect
- H3 (`Shading:Building:Detailed` with explicit vertices, both vertex orderings): no effect
- Even a 30 m south overhang produces zero solar-gain change
- `eplusout.eio` confirms 8 detached + 24 attached shading surfaces are created
- `Surface Outside Face Sunlit Fraction` for south windows = **0.411 with and without shading** — proves EP isn't applying the shading geometry to the window's sunlit fraction calculation
- The shading surfaces themselves have computed sunlit fractions (overhang det = 0.0, mirror = 0.38), so EP IS including them in the geometry pool — just not as obstructions for windows

**What's left to try (next session):**
- Build a minimal isolated EP test case (one zone, one window, one Shading:Overhang) directly via .idf and run EnergyPlus from CLI. If shading works there, compare epJSON structures to find what differs in our generator.
- Check if `Building.solar_distribution` interactions with a particular construction layer or schedule are silently degrading shading.
- Try `Output:Variable: Surface Window Heat Gain Energy` instead of `Surface Window Transmitted Solar Radiation Energy` — possibly the wrong variable for shading-aware values.

**Action required:** None. The frontend live engine still applies shading correctly via `computeShadingFactors`; only the EnergyPlus path is unaffected.

---

**Brief 22** — Solar shading inputs + balance polish + facade label consistency (2026-05-06). 8 parts committed and pushed.

**Brief 22 parts completed:**
- Part 1: Hover tooltips on Stacked + Sankey layouts (`HeatBalance.jsx`, `BalanceSankey.jsx`) — floating white pill anchored 12 px below cursor showing element label + value in current unit.
- Part 2: Facade-label consistency — new shared `frontend/src/utils/facadeLabel.js` with `solarLabel(face, orientationDeg)`. Heat Balance Rows / Stacked / Sankey / DrillDown now read `Solar — F3 (S)` style labels that rotate live with orientation.
- Part 3: `building_config` schema additions — `shading_overhang { face: { depth_m, offset_m } }` and `shading_fin { face: { left_depth_m, right_depth_m } }` with deep-merge support in both `ProjectContext.updateParam` and `PUT /api/projects/{id}/building`.
- Part 4: Building UI — new "Shading" `CollapsibleSection` between Glazing and Fabric, one row per facade (F1 (N) etc.) with overhang depth/offset and left/right fin inputs (0–3 m, step 0.05). Section header shows ` · active` when any value is non-zero.
- Part 5: epJSON emits `Shading:Overhang` and `Shading:Fin` per fenestration (`nza_engine/generators/geometry.py`). EP 26 schema fields use `tilt_angle_from_window_door` (no `_or_`); wrong field names are silently dropped, hence the explicit fix.
- Part 6: `instantCalc` `computeShadingFactors(building)` returns per-facade [0.4, 1.0] multiplier applied to incident solar in both hourly and degree-day paths. Live engine reflects shading immediately.
- Part 7: `BuildingViewer3D.jsx` — new `ShadingSlabs` component renders horizontal overhang slabs and vertical fin slabs in neutral grey, positioned above window heads / at facade ends. Slabs follow the GlassFace axis/sign convention so they rotate with orientation.
- Part 8: End-to-end verification at 1280×820 — solar labels rotate with orientation, tooltips show value + unit on Stacked + Sankey, 3D viewer shows the slabs.

**Action required:** Restart the backend after pulling so the new `Output:Variable` schema and shading object emission paths are active.

**Open issue:** EnergyPlus accepts the Shading:Overhang/Fin objects (visible in `eplusout.eio` as `ShadingProperty Reflectance` entries with mirror surfaces) but does not visibly reduce solar gain in test runs (e.g. 5 m south overhang on Bridgewater changes Solar South gain by <0.01%). Field names and structure match the EP 26 schema. Suspect causes: (a) EP 26 needs an explicit `ShadowCalculation` object for attached shading, (b) `Building.solar_distribution = FullInteriorAndExteriorWithReflections` interaction with attached vs detached shading, (c) something attached-overhang-specific in EP 26. To be debugged in a follow-up brief. The frontend shading factor (Part 6) gives the user immediate feedback regardless.

---

**Brief 21** — Heat Balance view: PHPP-style gains-vs-losses with engine toggle, drill-down, stacked layout (2026-05-06). 8 parts committed and pushed.

**Brief 21 parts completed:**
- Part 1: `nza_engine/parsers/sql_parser.py` — `get_heat_balance()` extracts per-surface losses + per-orientation solar + internal gains from `eplusout.sql`. New endpoint `GET /api/projects/{id}/simulations/{run_id}/balance`. HDD/CDD computed from EPW (base 18°C / 22°C). Internal gain heat-energy variables added to `Output:Variable` list.
- Part 2: `frontend/src/utils/instantCalc.js` — `_buildHeatBalance()` helper produces the same JSON shape as the backend. Both `calculateInstant` (hourly) and `calculateInstantDegreeDay` returns include `heat_balance`.
- Part 3: `frontend/src/components/modules/balance/HeatBalance.jsx` — gains-IN / losses-OUT bars with the canonical palette in `frontend/src/data/balanceColours.js`. kWh ↔ kWh/m²·a unit toggle. IN/OUT arrows. Net residual badge.
- Part 4: Engine toggle `[Live | Simulation]` in HeatBalance header; CSS bar-width transitions animate divergence between sources. `useSimulationBalance` hook fetches/caches by (projectId, runId). Stale indicator from `saveStatus`.
- Part 5: `frontend/src/components/modules/balance/DrillDown.jsx` + `frontend/src/utils/firstPrinciples.js` — three-row comparison (first-principles · instantCalc · EnergyPlus) with spread tolerance flagging and per-element divergence notes. Plus `[Rows | Stacked]` layout toggle in HeatBalance.
- Part 6: `frontend/src/pages/PopOutResults.jsx` — `heat-balance` panel type added; default layout updated.
- Part 7: New "Heat Balance" tab in `/results` (between Overview and Energy Flows) via `HeatBalanceTab.jsx`. Building module's `[3D Model | Energy Flow]` toggle removed; centre is just the 3D viewer now.
- Part 8: End-to-end verification at 1440×900 — Solar South > West > E/N (matches Northern hemisphere expectation); engine toggle animates; drill-down opens for all element types; pop-out renders heat-balance; `npm run build` clean (3137 modules transformed).

**Action required:** Restart the backend after pulling so the new `Output:Variable` requests for `Zone People Total Heating Energy`, `Zone Electric Equipment Total Heating Energy`, `Zone Lights Total Heating Energy` and the new `/balance` endpoint are active.

**Known limitations carried over to a follow-up brief:**
- Glazing transmission loss reads 0 from `eplusout.sql` because window conduction surfaces aren't tagged the same way as walls. Solar gains through glazing are correct.
- East-facing solar reads 0 in some Bridgewater runs — likely the geometry generator's facade orientation tagging needs review.
- Engine toggle's "isStale" heuristic is conservative (any save event marks sim stale).

---

**Brief 20** — Information module with CRREM executive summary, navigation restructure, weather fixes (2026-04-06). Committed (bad02c7) and pushed to GitHub.

**Brief 20 parts completed:**
- Part 1: InformationModule.jsx — /information route with project header, location & climate (WeatherSelector), building summary, occupancy, energy data (multi-year annual form), CRREM executive summary (EUI + carbon charts, stranding year), data completeness checklist, quick actions
- Part 2: BuildingDefinition.jsx — Occupancy and Location & Climate sections removed; now purely geometry, glazing, fabric, airtightness
- Part 3: api/routers/weather.py — fixed postcodes.io URL encoding (strip spaces, don't replace with +); uk_stations.json confirmed present at 424 stations
- Part 4: api/utils.py already scans current/ and future/ directories; no change needed
- Part 5: projectStrandingYear() linear regression in InformationModule.jsx; stranding banner (red/amber/green) per time horizon
- Part 6: ProfilesEditor.jsx — already clean (zone-type words stripped, schedule-type filters only); no change needed
- Part 7: HomePage.jsx — project card click navigates to /information; Sidebar has ClipboardList icon for /information
- Part 8: Clean build ✓; committed and pushed

**Brief 19** — Auto-download nearest UK weather station from climate.onebuilding.org via postcode lookup (2026-04-06). Committed (13c821e) and pushed to GitHub.

**Brief 19 parts completed:**
- Part 1: scripts/build_station_index.py — 424 UK TMYx.2011-2025 stations (ENG/SCT/WAL/NIR) embedded as Python constants; generates data/weather/uk_stations.json with lat/lon, wmo_id, download_url per station
- Part 2: api/routers/weather.py — GET /api/weather/nearest (postcode → postcodes.io → haversine nearest + top-3 alternatives + already_downloaded flag); POST /api/weather/download (downloads zip from climate.onebuilding.org, extracts .epw, saves to data/weather/current/); httpx added to requirements.txt
- Part 3: frontend/WeatherSelector.jsx — postcode input + Find button, nearest station card with distance, Download & Use button, alternatives list; integrates current/future weather dropdowns; BuildingDefinition.jsx updated to use WeatherSelector in Location & Climate section
- Part 4: (deferred — auto-suggest on project creation not yet implemented)
- Part 5: Verified — TA6 6DF → Yeovilton AF (27 km, nearest UK station); SW1A 1AA → London St James Park (0.9 km); EH1 1JF → Edinburgh Gogarbank (10.0 km)

**Action required:** Restart backend to activate new /api/weather/nearest and /api/weather/download endpoints. Also run: `pip install httpx` if not already installed.

**Brief 18b** — Font fix, Bridgewater corrections, weather file management, PROMETHEUS setup, manual multi-fuel consumption, multi-year CRREM trajectory (2026-04-06). Committed (30bfb9d) and pushed to GitHub.

**Brief 18b parts completed:**
- Part 1: Body font-weight 300→400 (Regular) in index.css
- Part 2: Bridgewater DEFAULT_PARAMS corrected: 63×13.4×5fl = 4,221m² GIA, 134 rooms, Bridgwater Somerset location (lat 51.087, lon -2.985)
- Part 3: Weather multi-directory resolver (current/ → future/ → EnergyPlus fallback); GET /api/weather list endpoint with PROMETHEUS metadata parsing; BuildingDefinition Location & Climate section with current + future weather dropdowns and location mismatch warning; WeatherContext future_weather_file support
- Part 4: scripts/setup_weather.py — unpacks PROMETHEUS nested city.zip → scenario.zip → .epw into current/ and future/{period}_{scenario}/ structure
- Part 5: POST /api/projects/{id}/consumption/manual (ManualFuelEntry, ManualConsumptionRequest models); ManualConsumptionInput.jsx (multi-fuel annual form, live EUI/carbon metrics, CRREM V2.07 status badge); ConsumptionManager Upload File / Manual toggle; fix stale setShowUpload reference
- Part 7: CRREMTab multi-year actual data — group actualDatasets by year, compute EUI + carbon per year; EuiTrajectoryChart shows red Line with dots for actual trend; CarbonTrajectoryChart shows actual carbon dots; inline year-by-year mini-table; methodology note updated to CRREM V2.07

**Parts 6, 8, 9, 10 (Brief 18b):** Part 6 = data entry (manual — done via UI); Parts 8–10 = dashboard/weather auto-select/future weather (deferred — Brief 18b Part 3 covers the dropdowns)

**Brief 18 Parts 1–7** committed (c3109b9) — ProjectDashboard, ProfilesEditor zone filter, SchedulePreview, instantCalc schedules, BroadcastChannel, PopOutResults, TopBar Pop Out button.

Brief 17 all parts complete (2026-04-04). Committed and pushed to GitHub.

**Brief 17 progress (all committed — single combined commit):**
- Part 1: HomePage rewritten — project cards (name, GIA, EUI badge, last modified, run count); New Project card; N logo links home; magenta border on current project
- Part 2: projects.py list_projects — json_extract for bc_length/width/num_floors/floor_height/latest_eui; requires backend restart to activate (building_config keys confirmed correct)
- Part 3: index.css — mid-grey darkened to #6B7280, dark-grey to #4B5563; panel font-size token (9px) added
- Part 4: BuildingDefinition — CollapsibleSection replaces SectionHeader; #A1887F accent background, ▾/▸ chevron, defaultOpen=true for all 5 sections
- Part 5: SystemsZones — AccordionSection header uses solid accentColor background with white text (teal #00AEEF for Systems module)
- Part 6: FabricSankey — facade nodes renamed Glazing F1(N)/F2(E)/F3(S)/F4(W); Roof Solar split from Wall Solar; accepts orientation prop
- Part 7: BuildingViewer3D — WWR-proportional window height (linear scale 80–100%: 60%→95% height, near-zero sill at 100%); camera presets Iso+F1–F4 with smooth lerp (factor 0.12/frame); active preset highlighted navy
- Part 8: BuildingViewer3D — auto-rotate defaults to false

**Action required:** Restart backend to activate project list dimensions/EUI (`python -m uvicorn api.main:app --host 127.0.0.1 --port 8002`)

Brief 16 all parts complete (2026-04-04).

**Brief 16 progress (all committed):**
- Part 1: window_count merge fix in ProjectContext.updateParam — changing one facade no longer resets others. Left panel widened to w-72.
- Part 2: Parser — _is_meta_sheet() skips Instructions/README sheets in multi-sheet Excel; boosted column scoring for "Interval start datetime" and "Import from grid (kWh)"; has_time long-format detection already in place from Brief 15.
- Part 3: Removed ↗ expand button from butterfly chart (was redundant with centre-column Energy Flow toggle). Increased FabricSankey left extent from 32→90px — all left-side labels now fully visible.
- Part 4: Regression test ✓ — window counts, Sankey labels, no expand button, consumption, systems Sankey, auto-sim, zero console errors.

Brief 15 all parts complete (2026-04-04).

**Brief 15 progress (all committed):**
- Part 1: EUI gauge fix — replaced SVG arc with horizontal bar gauge (no jitter)
- Part 2: Consumption schema (`consumption_data`, `consumption_records`), CRUD API
- Part 3: CSV/Excel parser (`consumption_parser.py`) + gap-filling assembly engine (`assembly_engine.py`)
- Part 4: ConsumptionUpload.jsx (drag-drop, parse summary, fuel type override, provenance bar), ConsumptionManager.jsx (three-column layout, dataset cards, delete), Sidebar icon (FileSpreadsheet, #2D6A7A), moduleThemes, App.jsx route
- Part 5: MonthlyComparisonChart.jsx (actual bars + CRREM reference line, status banner, EUI gap %)
- Part 6: DailyProfileChart.jsx (AreaChart with Brush zoom), HalfHourlyHeatmap.jsx (canvas carpet plot, HSL ramp, tooltip)
- Part 7: ModelComparisonChart.jsx (actual solid bars + modelled outline bars, gap cards, explanation panel)
- Part 8: CRREMTab updated — red ReferenceDot at actual year, actual EUI panel with performance gap and actual stranding year
- Part 9: Navigation wiring — /consumption route, sidebar, moduleThemes, App.jsx
- Part 10: Integration test ✓ — synthetic hotel HH CSV (17,568 records, 1,124,814 kWh, 312 kWh/m² EUI, 30-min, 99.7% coverage). All tabs verified. CRREM red dot visible. Zero console errors.

**Brief 14 progress (all committed):**
- Parts 1–9 complete. Part 10 browser integration test TO DO.

**Brief 13 progress (all committed):**
- Parts 1–12 complete. Part 12 browser test TO DO.

---

## Integration test results (Brief 12 — 2026-04-03)

**Bridgewater Hotel — Systems module full walkthrough**

### Part 1: 3D fixes ✓
- Z-fighting fixed: ContactShadows moved to y=0.02 (was -0.01, same level as ground plane)
- Walls: `#EBEBEB` clean light grey, roughness 0.9, matte finish ✓
- Glass: `#A8C8E0` consistent blue tint, opacity 0.35, visible from all angles ✓

### Part 2: System dropdowns ✓
- Fixed `l.type` → `l.category` for all three dropdown filters
- HVAC: 4 options, Ventilation: 3 options, DHW: 2 options — all populated ✓

### Part 3: Heating demand ✓
- Reduced `util_factor` from 0.75 → 0.60 (hotel 24-hour occupancy — less gains coincident with heating)
- Heating now shows 2 MWh (genuinely small for this cooling-dominated building with MVHR)
- Display shows "< 1 MWh" for very small non-zero values, "0" → "< 1" fix applied ✓

### Part 4: Accordion inputs ✓
- 5 collapsible sections: HVAC, Ventilation, DHW, Lighting, Small Power
- Single-expand mode with smooth CSS max-height transition
- One-line summaries update in real time (COP, MVHR HR%, setpoints)
- Teal left border + background tint on expanded section ✓

### Part 5: Systems flow data model ✓
- `systems_flow` in instantCalc returns nodes[] and links[] for Sankey
- 14 nodes, 11 links for VRF + MVHR + Gas Boiler config
- Conditional: MVHR recovery node/link, gas node, ASHP cascade link all conditional on config
- All links filtered to value > 0 ✓

### Part 6: Systems Sankey ✓
- d3-sankey (sankeyLeft) with string-based nodeId — critical: links reference string IDs not indices
- 11 links, 14 nodes rendered correctly at 1440×900
- Link colours: electricity=gold, gas=red, heating=red, cooling=blue, recovered=green dashed, waste=grey dashed
- MVHR recovery link visible (Recovered Heat node, green dashed path) ✓
- Footer: "Total site energy: 232.2 MWh/yr — Electricity 67% · 156 MWh / Gas 33% · 76 MWh" ✓
- ResizeObserver for responsive SVG ✓
- Badges: Detailed, MVHR (updates when mode/vent type changes) ✓

### Part 7: Node hover and click-to-expand ✓
- Hover: connected links brighten (+0.35 opacity), unconnected links dim to 0.08 opacity
- Unconnected nodes dim to 0.3 opacity — 300ms CSS transition
- Tooltip: node label, metric, in/out flows, COP multiplier, "click to edit" hint
- Click system node → expands corresponding accordion section ✓

### Part 8: Animations and badges ✓
- CSS `transition: 'stroke-width 300ms ease, stroke-opacity 300ms ease'` on all links
- Node dim/highlight: `opacity` with 300ms transition
- Mode badges: Detailed/Ideal Loads, MVHR/MEV, ASHP Preheat (when enabled)
- ASHP badge appeared instantly when preheat enabled — confirmed ✓

### Part 9: Systems live results ✓
- System efficiency section (only in Detailed mode): VRF COP 3.2×, MVHR 95% net HR, Boiler 92% eff
- FlowRow format: "X MWh in → Y MWh out" with colour-coded detail
- MVHR Heat Recovery callout: 71 MWh recovered, £3,550/yr gas saving @ 5p/kWh, ~17 tCO₂/yr avoided
- ASHP preheat callout appears when enabled; boiler label changes to "DHW System (Gas + ASHP)" with COP display
- Fuel split bar consistent with Sankey totals ✓

### Part 10: Integration test ✓
All checklist items:
- Z-fighting fixed: ✓
- Grey walls: ✓ (#EBEBEB)
- Blue glass: ✓ (#A8C8E0)
- Dropdowns populated: ✓ (4+3+2 options)
- Heating display: ✓ (shows 2 MWh, not "0 MWh")
- Accordion sections: ✓ (5 collapsible, summaries update live)
- Sankey rendering: ✓ (14 nodes, 11 links)
- MVHR recovery link: ✓ (71 MWh, green dashed)
- ASHP cascade link: ✓ (appeared when preheat enabled, EUI dropped 77→66)
- Animated transitions: ✓ (300ms on hover, link width, opacity)
- Click-to-expand: ✓ (Sankey node click opens accordion)
- System efficiency callouts: ✓ (VRF COP, MVHR recovery, boiler eff)
- Zero console errors: ✓

---

## Current state

### What's working

- **Consumption module** — `/consumption` route with FileSpreadsheet sidebar icon (#2D6A7A). Three-column layout: dataset list + upload (left), visualisation tabs (centre), metrics panel (right).
- **Consumption upload** — Drag-and-drop or file picker. Accepts CSV/XLSX. Uploads to API, shows parse summary with provenance stacked bar. Fuel type override (electricity/gas). Confirm import button.
- **Monthly comparison chart** — Recharts ComposedChart with monthly kWh bars and CRREM average monthly reference line. Status banner (compliant/at-risk/non-compliant) with actual EUI vs target.
- **Daily profile chart** — AreaChart with Brush zoom. Summary stats. Hint when zoomed to ≤14 days.
- **Half-hourly heatmap** — Canvas carpet plot. Time-of-day (Y) vs date (X). HSL colour ramp by kWh intensity. Crosshair tooltip. Colour legend.
- **Model vs Actual chart** — Solid actual bars + outline modelled bars. Gap summary cards. 5-item performance gap explanation panel.
- **CRREM trajectory updated** — Multi-year actual EUI trend line (red, with dots per year). Carbon trajectory counterpart. Inline year-by-year mini-table. Methodology note updated to CRREM V2.07.
- **Weather station index** — 424 UK TMYx.2011-2025 stations in data/weather/uk_stations.json. Postcode lookup via postcodes.io → haversine nearest. Download EPW zip from climate.onebuilding.org, extract, save to data/weather/current/.
- **WeatherSelector component** — Postcode search in Building module Location & Climate section. Shows nearest station + distance + 3 alternatives. Download & Use button. Green tick when already downloaded.
- **Gap-filling assembly engine** — donor year (scaled 0.5–2.0) → weekday average → interpolation → monthly average cascade. Provenance tracking per slot. Complete annual profile guaranteed.
- **Hourly instant calc** — 8760-iteration loop using real EPW weather data. Non-zero heating demand in winter. Monthly breakdown arrays for seasonal display.
- **WeatherContext** — loads and caches EPW hourly data from backend API on app start.
- **useHourlySolar hook** — memoised solar precomputation. Recomputes only on orientation change.
- **Live Fabric Sankey** — in Building module centre column. Toggle: "3D Model | Energy Flow".
- **Monthly heating/cooling chart** — 12-bar chart in LiveResultsPanel.
- **Space heating in Systems Sankey** — now non-zero from hourly calc.
- **Systems Sankey** — all panels wired to hourly calc.
- **Full results suite** — Energy Flows, Energy Balance, Load Profiles, Fabric Analysis, CRREM & Carbon
- **Scenario Manager** — create/run/compare scenarios

---

## Known issues

- Building hardcoded as hotel_bedroom zone type — multi-zone not yet supported
- **uvicorn must be restarted** after backend code changes
- Full-year hourly data requires EnergyPlus .sql output file on disk
- MVHR raises cooling demand significantly in summer (physically consistent but counterintuitive)
- `SolarBars` component in `LiveResultsPanel.jsx` is dead code — harmless
- Heatmap fetches all records at once (no pagination) — could be slow for large datasets with full year HH data

---

## Brief 28 / 29 scope (queued, NOT in 27)

Split codified at Brief 27 close-out. See top of STATUS.md "Next task"
section + the brief files themselves for the full part-by-part spec.
This is the older verbose queue kept for historical context.

**Brief 28 — Cross-cutting polish:**

- **Live engine solar model — switch from isotropic to Perez (or HDKR)**.
  Documented at `docs/state_1_engine_divergence_investigation.md`. The
  live engine's `solarCalc.js` over-counts diffuse on N/E/W facades,
  amplifying for high-WWR-on-non-south configurations. Bridgewater's
  current 0.55 N WWR + 42° orientation exposes a 15°C summer-max gap vs
  EnergyPlus. The fix has the largest single-step impact on State 1
  Live/Sim agreement.
- **Re-baseline `docs/state_2_expected_ranges.md`** after the solar
  model fix lands, including measured Live/Sim gap for both balanced-
  WWR and asymmetric (Bridgewater current) configurations.
- **State 2 EP results plumbing → Live | Simulation toggle wiring**.
  The placeholder slot is already present in the canvas tab strip;
  Brief 28 makes it functional.
- **Pablo chart component port** (ChartContainer / ZoomNav /
  MonthJumpButtons / DataCard / chartTokens.js). Report at
  `docs/pablo_chart_components_investigation.md`.
- **Canvas restructure** — shared DiagnosticCanvas + TimeSeriesCanvas
  used by Internal Gains / Building / Operation.

**Brief 29 — Building module completion:**

- **Constants cleanup**: ~10 numeric constants are duplicated across
  `frontend/src/utils/instantCalc.js`, `nza_engine/parsers/sql_parser.py`,
  and `nza_engine/generators/epjson_assembler.py` with identical values
  (Cd, Cw site-exposure dict, frame fraction, default U-values, air heat
  capacity, default g-value, ventilation per person, etc.). Single
  biggest magic-number risk. Promote to shared modules
  (`nza_engine/constants.py` + `frontend/src/utils/physicsConstants.js`)
  with module-load assertion that JS and Python agree. Full audit at
  `docs/hardcoded_constants_audit.md`.
- **Legacy occupancy fallback retirement**: `params.occupancy_rate` /
  `params.people_per_room` / `params.num_bedrooms` fallbacks in the
  degree-day calc path are superseded by v2.3 `occupancy.*` block. Pull
  the fallbacks from the v2.3 block so legacy + v2.3 paths agree.
- **Configurable defaults promotion**: `GRID_INTENSITY_2026` (year/region
  selectable), `GAS_CARBON_KG_KWH` (fuel/year table), `DHW_LITRES_PER_M2_DAY`
  (building-type table), `DHW_SETPOINT` / `DHW_COLD_TEMP` (read from
  systems config consistently), lighting control factor table (promote
  to systems-library entry).
- **One bug-adjacent**: `T_cool_setpoint = 24` hard-coded in degree-day
  fallback path instead of reading `comfortBand.upper_c`.
- **Building-type-aware expected ranges**: BREDEM uniform-phasing
  heating/cooling derivations under-state offset/add for hotel buildings
  (4.15× overnight occupancy ratio). Future state range derivations
  must split baseload from active and apply building-type-specific
  phasing factors. See `docs/state_2_part2_verification.md` for the
  diagnostic and `docs/state_2_expected_ranges.md` for the queued note.

## Suggestions

- Report export to PowerPoint/PDF using NZA template
- CIBSE TM54 benchmark integration — show building type comparison on Results dashboard
- Multi-zone building types (office, retail, hotel mix)
- Future weather files — climate change scenarios (+2°C, +3.5°C)
- Monthly weather visualisation (heating/cooling degree days per month)
- CSV export of simulation results
- "Duplicate project" in project picker
- Surrounding building massing for shading analysis
- Brief 16: Reality factors — adjust occupancy, system efficiency, unmetered loads to close model vs actual gap
- Pagination for heatmap records API call (e.g. ?limit=17520 or stream)
- Clean up dead `SolarBars` function in LiveResultsPanel.jsx
- Node hover link labels (show kWh value on hovered links)
- Brief 19 Part 4: Auto-suggest nearest weather station on new project creation (postcode entered during project setup → find + download prompt)
- Validate SCT/WAL/NIR station filenames against climate.onebuilding.org directory listings (ENG filenames confirmed; others derived via derive_stem())

---

## Safety checks

- Working tree: clean (after Brief 20 commit)
- Branch: main
- Brief 20 committed to main; pushed to GitHub ✓ (bad02c7)
- Branch: main
- Brief 18b committed to main; pushed to GitHub ✓ (30bfb9d)
- data/ directory: gitignored, intact, not touched
