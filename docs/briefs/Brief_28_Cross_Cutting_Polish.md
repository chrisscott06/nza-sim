# Brief 28: Cross-cutting polish

BEFORE DOING ANYTHING:
1. Read `CLAUDE.md`
2. Read `STATUS.md` (Brief 27 close-out + Brief 28 scope as per the
   28/29 split)
3. Read `docs/state_contracts.md` v2.4 (Brief 27 close)
4. Read `docs/state_1_engine_divergence_investigation.md` — the solar
   model fix scope and the engine-toggle holdback rationale
5. Read `docs/pavlo_chart_components_investigation.md` — the lift plan
   for the Pablo primitives
6. Read `docs/ui_principles.md` v1.0 + `docs/module_completion_checklist.md`
7. Read this ENTIRE brief before writing a single line of code
8. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## Why this brief

Brief 27 (Internal Gains, State 2) closed at 9/10 confidence. The 1/10
gap is the engine toggle on the canvas diagnostic views — a
placeholder slot is wired in the tab strip, but the actual
Live | Simulation segmented control needs (a) the live engine producing
accurate enough output to compare honestly against EP, and (b) State 2
EP per-profile results flowing through the SQL parser.

Both of those are blockers that need to land in the right order. Brief
28 takes the cross-cutting polish work that makes the tool feel
coherent + credible:

1. **Solar model fix first** — the live engine's isotropic-sky model
   over-counts diffuse on N/E/W facades. With Bridgewater's current
   asymmetric WWR + 42° rotation, it produces a 15°C summer-max gap vs
   EnergyPlus and 38% solar over-count. Fixing this is the biggest
   single-step accuracy improvement in the live engine and a prerequisite
   for the engine toggle being a useful comparison rather than an
   exposure of a known limitation.

2. **Engine toggle plumbing** — once the engines agree, wire the
   segmented control. Requires SQL parser per-profile breakdown +
   `useStateComparison` reading from the most recent EP run.

3. **Pablo component port + canvas restructure** — bring the Pavlo
   chart primitives in (ChartContainer / ZoomNav / MonthJumpButtons /
   DataCard / chartTokens.js) and consolidate the time-series + Heat
   Balance views across modules so the tool reads as one coherent
   diagnostic surface, not seven module-flavoured ones.

Building module State 1 diagnostic views, constants cleanup, BREDEM
building-type-aware phasing → **Brief 29 (Building module completion)**.

Estimated effort: 7–8 parts, ~5 sessions of focused work.

---

## VERIFICATION RULES

- Module completion checklist (`docs/module_completion_checklist.md`)
  applies. Brief 28 affects multiple modules; Sections E + F + G are
  the operative ones for cross-cutting work.
- Engine agreement (`scripts/state1_engine_agreement.mjs`) is the
  acceptance gate for Part 1. Headline summer-max divergence must drop
  from current 15°C to ≤5°C, total solar gain divergence from −27% to
  within ±10%, cooling demand gap from −95% to within ±30%.
- State 1 + State 2 isolation regressions must continue byte-identical
  on both engines after every part.
- New State 2 engine agreement script needs to exist by close-out
  (acceptance gate for Part 2).
- Bridgewater walkthrough mandatory at close-out per Section J. Brief
  27 closed at 9/10 because the walkthrough was pending; Brief 28 must
  not repeat that pattern.

---

## PART 1: Live engine solar model — isotropic → HDKR / Perez

**File(s):** `frontend/src/utils/solarCalc.js`,
`scripts/state1_engine_agreement.mjs` (regression target),
`docs/state_2_expected_ranges.md` (re-baseline)

### Context

Documented at `docs/state_1_engine_divergence_investigation.md`. Live's
diffuse sky model is isotropic — treats sky as uniformly bright,
overcounts diffuse on facades not facing the sun. EnergyPlus uses the
Perez (anisotropic) model. The two engines agree well on south-facing
surfaces; they diverge sharply on N/E/W. Bridgewater's WWR of 0.55 on
the rotated-N facade hits the worst case.

### Fix

Replace the isotropic diffuse term in `computeHourlySolarByFacade` with
**HDKR (Hay, Davies, Klucher, Reindl)** — the cleanest JS port. HDKR is
closed-form, doesn't need lookup tables, gets within ~2-5% of Perez for
most cases, and reduces to isotropic when there's no beam radiation
(preserves fully-overcast behaviour).

HDKR equations:
- Anisotropy index: `A = I_b / I_o` (beam normal / extraterrestrial normal)
- Modulating factor: `f = sqrt(I_b / I_h)` (beam / total horizontal)
- Diffuse on tilted surface:
  ```
  I_dt = I_d × [(1 - A) × (1 + cos(β)) / 2 × (1 + f × sin³(β/2)) + A × R_b]
  ```
  where `β` is surface tilt, `R_b = cos(θ_i) / cos(θ_z)` is the beam
  tilt factor.

If HDKR proves insufficient against EP on Bridgewater (off by >10%
after the fix), fall back to a full Perez implementation (more code,
better accuracy near horizon).

### Verify — Part 1

1. Run `scripts/state1_engine_agreement.mjs` against Bridgewater
   (current asymmetric-WWR config — don't reset infiltration/orientation
   for testing; the fix should work for arbitrary configs).
2. Summer-max gap drops from 15°C to **≤5°C**.
3. Total solar gain divergence drops from −27% (Live high) to within ±10%.
4. Cooling demand divergence drops from −95% (Sim 5 MWh vs Live 109 MWh)
   to within ±30%.
5. State 1 isolation regression still passes 40/40 byte-identical (the
   math change is universal, not input-gated).
6. Update `docs/state_2_expected_ranges.md` with new Bridgewater
   baseline numbers post-fix.
7. Update `docs/state_1_engine_divergence_investigation.md` close-out
   note documenting the before/after gap.
8. SCREENSHOT before/after `engine_agreement` output to commit alongside.

**Commit:** `Brief 28 Part 1: Live engine solar — isotropic → HDKR`

---

## PART 2: SQL parser per-profile breakdown

**File(s):** `nza_engine/parsers/sql_parser.py`,
`scripts/state2_isolation_epjson.py` (regression target),
new `scripts/state2_engine_agreement.mjs`

### Context

Brief 27 Revised Part 10 introduced per-profile `Lights` /
`ElectricEquipment` objects in the EP path (one per profile per zone,
named `Floor_N_Lights_<profile_id>` etc.). The SQL parser's
`_get_heat_balance_state2` currently sums these into aggregate gain
totals and returns the v2.4 output shape with EMPTY `profiles[]` arrays.

For the engine toggle to show meaningful per-profile attribution in the
Delta view's bottom panel ("What gains contribute" — bedroom 37 MWh,
corridor 18 MWh, etc.), the SQL parser needs to sum per profile_id.

### Fix

In `_get_heat_balance_state2`:
1. Query EnergyPlus output meters by zone+object name (the
   `Output:Variable` "Zone Lights Total Heating Energy" gives per-Lights
   object output if "*" is replaced by the specific object name; or use
   ReportData with Zone+KeyValue).
2. Group by parsing the object name back to its profile id: strip the
   zone prefix (`Floor_N_Lights_` or `Floor_N_Equip_`) and the
   `_baseload` / `_active` suffix.
3. Sum across zones per profile_id.
4. Emit the v2.4 output shape:
   ```py
   "gains": {
     "lighting": {
       "profiles": [{ id, label, kwh, peak_kw, hours_active }, ...],
       "total_kwh", "total_peak_kw", "effective_lpd_w_per_m2", "total_hours_active"
     },
     "equipment": {
       "profiles": [{ id, label, kwh, peak_kw, baseload_kwh, active_kwh, hours_active }, ...],
       "total_kwh", "total_peak_kw", "total_baseload_kwh", "total_active_kwh", "total_hours_active"
     }
   }
   ```

Build a small `scripts/state2_engine_agreement.mjs` (sibling to
state1_engine_agreement.mjs) that runs the live engine + reads the most
recent State 2 EP run and prints a three-tier disagreement table for
the v2.4 contract metrics.

### Verify — Part 2

1. Run a fresh State 2 simulation on Bridgewater.
2. `get_heat_balance(sql_path, mode='envelope-gains', ...)` returns
   `gains.lighting.profiles[]` with the same number of profiles as the
   live engine (post-Brief-27 default: 1 per category).
3. Per-profile `kwh` from EP within ±15% of live (Schedule:Compact has
   coarser resolution than the live engine's per-hour math; some drift
   expected).
4. Add a second lighting profile programmatically (corridor 2 W/m² ×
   0.3 area, always-on); re-run; EP output has TWO profiles in
   `gains.lighting.profiles[]`.
5. `state2_engine_agreement.mjs` runs cleanly and reports headline
   metrics in the same shape as the State 1 script.
6. State 2 isolation regression still passes 21/21 byte-identical.

**Commit:** `Brief 28 Part 2: SQL parser per-profile breakdown + State 2 agreement script`

---

## PART 3: useStateComparison + EngineToggle wiring

**File(s):** `frontend/src/components/modules/gains/canvas/useStateComparison.js`,
new `frontend/src/components/modules/gains/canvas/EngineToggle.jsx`,
update DeltaView / FreeRunningView / HeatBalanceView,
update `InternalGainsModule.jsx`

### Context

Brief 27 shipped `EngineBadge` (a label-only chip). Brief 28 Part 3
replaces it with `EngineToggle` (a segmented control that flips the
view between engines), now possible because Part 1 fixed the live
engine's accuracy and Part 2 provided per-profile EP output.

### Fix

1. `useStateComparison` extended with an `engine: 'live' | 'sim'` arg:
   - `live` → existing behaviour, runs `calculateInstant` in-browser
   - `sim` → fetches `/api/projects/{id}/heat-balance?mode=envelope-gains&run_id=latest`
     (or similar — re-use the existing endpoint pattern from /balance)
2. Module-level state in `InternalGainsModule` for selected engine
   (session-local, default 'live').
3. New `EngineToggle.jsx` — segmented pill with two states. Disabled
   right side when no recent EP run for the project, with tooltip:
   "Run a simulation to compare engines". Click → `setEngine('sim')`.
4. Replace `<EngineBadge />` with `<EngineToggle engine={engine}
   onChange={setEngine} hasSimResult={...} />` in DeltaView,
   FreeRunningView, HeatBalanceView.
5. Each view reads its data from the right side of `useStateComparison`'s
   output based on `engine`. State 2 EP output shape is identical (v2.4
   contract) so views don't need to branch beyond the data source.

### Verify — Part 3

1. Run a Bridgewater simulation in `/building` (the existing entry
   point).
2. Open `/gains` → State 1 → State 2 tab.
3. Toggle reads "Live | Simulation" — both clickable.
4. Live shows the brief-27 numbers (Bridgewater multi-profile config).
5. Switch to Simulation — numbers come from the EP run. Per-profile
   breakdown intact (after Part 2). Engine label in the EngineToggle
   reflects current state.
6. Heat balance + Free-running tabs also toggle.
7. Delete sim history, refresh page → Simulation side disabled with
   tooltip.
8. Brief 27 close-out checklist Section J's engine-toggle row flips
   from ⚠ deferred to ✓.

**Commit:** `Brief 28 Part 3: Engine toggle wired on Internal Gains canvas`

---

## PART 4: Pablo component port

**File(s):** new `frontend/src/data/chartTokens.js`,
new `frontend/src/components/ui/ZoomNav.jsx`,
new `frontend/src/components/ui/MonthJumpButtons.jsx`,
new `frontend/src/components/ui/DataCard.jsx`,
new `frontend/src/components/ui/ChartContainer.jsx`

### Context

Full report at `docs/pavlo_chart_components_investigation.md`. Five
primitives lift cleanly from Pablo; TabBar is excluded (nza-sim's
existing tab strip pattern is canonical). ChartContainer ships
stripped — no ChartPrintModal yet, so no html2canvas / jspdf
dependencies (defer export to a later brief).

### Fix

Per the investigation's recommended port plan:

1. **chartTokens.js** — lift cleanly, drop `MODELLER_COLORS` (Pablo-
   specific). Reconcile `BUILDING_SERVICE_COLORS` with existing
   `frontend/src/data/balanceColours.js` — settle on one canonical
   palette covering both heat-balance flows and chart series.
2. **ZoomNav** — copy, add optional `accent` prop so the active-period
   bg colour can match the active module's theme (vermillion for gains,
   earth for building, etc.).
3. **MonthJumpButtons** — copy + `dayOffsetForMonth` helper. Brief 28
   Part 5 will use it inside the new Free-running canvas time-series.
4. **DataCard** — copy + refactor `accent` from a named-lookup string
   to a free-form CSS colour. Eliminates the Tailwind-config bloat
   (no need to add `border-l-nza-green` / `border-l-nza-red` / etc.)
   and gives module accents first-class support.
5. **ChartContainer (stripped)** — port without the ChartPrintModal.
   Print icon hidden behind a feature flag (`enablePrint` prop, default
   false) so the modal can be added later by enabling the flag.

After landing, migrate existing nza-sim sites onto the shared
primitives:
- `Annual breakdown` view's inline `StatCard` → `DataCard`
- `Internal Gains canvas` view headers / containers → `ChartContainer`
- `Hourly profile view` / `Free running view` `<canvas>` wrappers →
  wrap in `ChartContainer`

Update `docs/ui_principles.md` to point at the new shared primitives
as the canonical patterns.

### Verify — Part 4

1. All six files exist + import cleanly. No npm dep additions (zero
   new deps beyond react / lucide-react).
2. Internal Gains module's canvas views render unchanged after the
   migration (no visual regression; the shared primitives match the
   existing layouts).
3. Build clean. State 1 + State 2 isolation regressions still 40/40
   + 21/21.

**Commit (per file or batched):** `Brief 28 Part 4: Pablo primitives port`

---

## PART 5: Canvas restructure — Heat Balance + time-series consolidation

**File(s):** `frontend/src/components/modules/balance/HeatBalance.jsx`
(or its successor), new shared canvas views, multiple module updates

### Context

The Heat Balance canvas view currently lives in `/balance` and renders
a State-aware bar + Sankey visualisation. The "Delta layout" from
Brief 27's `DeltaView` is the clearer pattern for showing
state-to-state comparison (paired bars + arrow deltas + per-profile
attribution).

**Goal:** consolidate Heat Balance + the various module-specific
diagnostic views into one shared, state-aware canvas component used
across Internal Gains, Building, Operation, Systems. Same look + feel,
different data source.

The time-series situation similar — multiple modules have their own
chart layouts that don't match. Brief 27's `FreeRunningView` is the
template (canvas-based, full-width, ResizeObserver-tracked, hover
tooltip, comfort band shading). Time-series consolidation means
extracting that template into a shared `TimeSeriesCanvas.jsx` reusable
across Internal Gains, Building, Operation.

### Fix

1. New `frontend/src/components/canvas/DiagnosticCanvas.jsx` — the
   Delta-layout pattern as a reusable component: title bar with engine
   toggle slot, paired-bar comparison (State X vs State Y, configurable),
   hours-changed sub-panel, per-category attribution panel.
2. New `frontend/src/components/canvas/TimeSeriesCanvas.jsx` — the
   FreeRunningView template extracted: HTML5 canvas, ResizeObserver,
   comfort band shading, hover tooltip, optional second-line overlay
   for state comparison.
3. Migrate Internal Gains `DeltaView` → consumes `DiagnosticCanvas`.
4. Migrate Internal Gains `FreeRunningView` → consumes `TimeSeriesCanvas`.
5. Migrate Building module's Heat Balance display → also via
   `DiagnosticCanvas` (showing State 1 fabric losses vs State 1 demand).
6. Consolidate the two `HeatBalance` implementations (`/balance` route
   + the embedded view in Internal Gains' HeatBalanceView) — they
   should both delegate to one shared component fed with a single
   shape.

### Verify — Part 5

1. Internal Gains' six canvas views all render via the new shared
   primitives. No visual regression.
2. Building module's Heat Balance tab reads consistently with Internal
   Gains' Heat Balance tab — same component, different data feed.
3. The Pablo primitives (ChartContainer / ZoomNav / etc.) are visible
   inside both shared canvas components; the time-series canvas uses
   ZoomNav for period selection.
4. Build clean. Isolation regressions still byte-identical.
5. UI principles checklist (Section G of module checklist) updates:
   tab strips pattern, engine toggle pattern, multi-tab view pattern
   all reference the new shared components.

**Commit:** `Brief 28 Part 5: Canvas restructure — shared Diagnostic + TimeSeries`

---

## PART 6: Walkthrough on Bridgewater + close-out

**File(s):** `docs/state_2_expected_ranges.md` (re-baseline),
`docs/module_checklists/internal_gains_brief_27.md` (post-Brief-28 update),
new `docs/module_checklists/brief_28_close_out.md`

### Context

Per Brief 27's lesson: walkthrough is a mandatory close-out gate, not a
nice-to-have. Brief 28 must close with a clean Bridgewater walkthrough.

### Fix

1. Re-run engine agreement scripts (State 1 + State 2) on Bridgewater.
2. Update `state_2_expected_ranges.md` with post-Brief-28 baseline.
3. Open `/gains` and walk through:
   - Each section's profile list editable (Brief 27 close-out bug 1
     still holds)
   - Schedule editor at canvas width
   - Exception authoring (Christmas shutdown + UK bank holidays
     presets)
   - Annual heatmap renders with exception highlights
   - All seven tabs render
   - **Engine toggle works on Delta + Heat balance + Free-running**
     (the named 1/10 holdback closes here)
   - Switching tabs / sections / exception edit mode all clean
   - Console clean of red errors throughout
4. Update `internal_gains_brief_27.md` checklist Section J (walkthrough)
   with the new walkthrough results. Bump confidence to **10/10** if
   the engine toggle now works end-to-end + the walkthrough is clean.
5. Write a Brief 28 completion checklist following the canonical
   template for the cross-cutting work that doesn't fit any single
   module.

### Verify — Part 6

- All four canvas-view engine toggles work on Bridgewater
- Live + Sim agree on Bridgewater State 1 within ±5°C summer max
- Live + Sim agree on Bridgewater State 2 aggregate within ±10%
- State 1 + State 2 isolation regressions: 40/40 + 21/21 byte-identical
- Brief 27 close-out checklist's engine-toggle holdback row flips to ✓
- Brief 28 completion checklist filled in honestly, confidence 8+/10

**Commit:** `Brief 28 close-out: walkthrough clean + re-baseline + 10/10`

---

## Out of scope for Brief 28

All these go to Brief 29 (Building module completion) or later:

- State 1 diagnostic views (Free-running Temperature canvas as a
  first-class Building view, Heat Loss Breakdown canvas) — Brief 29
- Building UI principles conformance pass (audit + fix) — Brief 29
- Cross-cutting constants cleanup (~10 duplicated values) — Brief 29
- Building-type-aware BREDEM phasing factors in
  `state_2_expected_ranges.md` — Brief 29
- 3D zone gain heatmap (multi-zone modelling — future brief)
- Operation v2 (State 2.5 path, operable windows control mechanism) —
  Brief 30+
- Weather module redesign — Brief 31+
- Systems Inspectors — Brief 32–33+ (PARKED brief carries forward)
- CI for state contracts (engine agreement in pre-merge) — Brief 34+
- State 4 reconciliation (live ↔ sim ↔ measured) — Brief 35+

---

## Sequencing

Parts 1 → 2 → 3 → 4 → 5 → 6 in order. Part 1 must land before Part 3
(engine toggle exposes the solar model's accuracy). Part 2 must land
before Part 3 (per-profile EP output feeds Delta view's attribution
panel). Parts 4 + 5 can swap if convenient, but Part 5 reads better
after Part 4 (canvas restructure consumes the Pablo primitives).
