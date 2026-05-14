# Brief 28a — Visible Polish

**Scope:** UX improvements that the audit and walkthrough found necessary. No physics changes — those are Brief 28b.

**Estimated time:** 2 weeks.

**Dependencies:** Brief 27 cleanup + Brief 28 prereq complete.

**Pre-flight checks:** Standard.

---

## Reading list (read before starting)

1. `docs/state_contracts.md` (current version — note any v2.5 needed for terminology rename)
2. `docs/ui_principles.md`
3. `docs/module_completion_checklist.md`
4. `docs/ux_audit_2026_05.md` (drives most of this brief's scope)
5. `docs/pavlo_chart_components_investigation.md`
6. `docs/state_1_engine_divergence_investigation.md` (updated by Brief 28 prereq)

---

## Part 1 — Static / Dynamic terminology rename across the tool

**Files:** Cross-cutting. Anywhere "Live engine" or "Simulation" appears as user-facing text.

**Goal:** Rename engine terminology consistently:
- "Live engine" → "Static"
- "Simulation" → "Dynamic"
- Engine toggle labels, badges, tooltips, all user-facing strings

Internal code names (e.g., `liveData`, `simulationResults`) stay as-is — these are implementation details. Only user-facing text changes.

**Steps:**

1. Grep for "Live engine" across `frontend/src/` and identify all user-facing instances.
2. Grep for "Simulation" — be careful to distinguish:
   - User-facing labels referring to the EP engine (→ rename to "Dynamic")
   - Code names referring to the simulation pipeline (→ keep)
   - Button labels like "Re-run Simulation" (→ rename to "Re-run Dynamic")
3. Make the renames consistently.
4. Update tooltips to use new terminology with brief explanations:
   - Static: "Instant calculation, updates as you edit inputs"
   - Dynamic: "Full EnergyPlus simulation, run on demand"
5. Update STATUS.md, state contracts, and any docs to use new terminology in user-facing contexts (but keep "Live engine" / "Simulation" in historical doc references where they were the original names).

**Verify:**
- No user-facing "Live engine" remains anywhere
- No user-facing "Simulation" remains where "Dynamic" should be
- Tooltips explain the distinction
- Internal code is unchanged (compiles, regressions pass)

**Commit message:** "Brief 28a Part 1: Static/Dynamic terminology rename"

**Decision points:**
- "Live" without "engine" — context-dependent (e.g., "live updates" stays). Use judgement.
- "Simulation" in API endpoints or DB columns stays (internal).
- Any mid-flight UI strings that are ambiguous: default to keeping the term unless clearly user-facing.

---

## Part 2 — kWh/m²·yr live readouts on gain inputs

**Files:** `frontend/src/components/modules/gains/OccupancySection.jsx`, `LightingSection.jsx`, `EquipmentSection.jsx`, profile cards

**Goal:** Every input that produces a gain shows its kWh/yr AND kWh/m²·yr equivalent live as the user types.

**Steps:**

1. For each profile card in Internal Gains, add to the live readout:
   - Current: "Annual: X MWh · Peak: Y kW"
   - New: "Annual: X MWh · Y kWh/m²·yr · Peak: Z kW"
2. For each section (Occupancy, Lighting, Equipment), show the section total in both units in the section header.
3. Add a "Gains vs demand" stacked bar chart somewhere visible (centre canvas — could be a new "Summary" tab or integrated into existing tab). Stacked bars showing:
   - Internal gains (stacked by People / Lighting / Equipment) in kWh/m²·yr
   - Comparative bars for heating demand and cooling demand in kWh/m²·yr
   - Unit toggle: kWh vs kWh/m²·yr
4. Use GIA from `building_config.GIA` for the m² basis. Make sure this is reactive to any GIA changes from the Building module.

**Verify:**
- Edit LPD in a Lighting profile → both kWh and kWh/m²·yr update within ~100ms
- Edit occupancy density → People kWh/m²·yr updates
- Stacked bar chart shows live gain breakdown
- Unit toggle works
- Section totals match sum of profile totals
- No mental arithmetic required to relate inputs to EUI

**Commit message:** "Brief 28a Part 2: kWh/m²·yr live readouts on gain inputs"

**Decision points:**
- Where the stacked bar lives: my suggestion is a new "Summary" tab that becomes the default landing tab for Internal Gains. But if there's a cleaner integration with existing tabs, use it.
- Whether to show kWh and kWh/m²·yr always, or via toggle: my suggestion is both shown always (less cognitive load than toggling).

---

## Part 3 — Canvas tab restructure

**Files:** `frontend/src/components/modules/gains/`, tab strip configuration

**Goal:** Internal Gains has 7 tabs (Schedule, State 1 → State 2 Delta, Heat balance, Free-running, Hourly profile, Annual breakdown, 3D Model). Audit flagged this as too many. Consolidate.

**Target structure (5 tabs):**

1. **Summary** (new, default) — stacked bar of gains vs demand, total kWh/m²·yr, headline numbers, State 1 → State 2 delta as a section within
2. **Schedule** — the centre-canvas schedule editor for the active gain (Occupancy / Lighting profile / Equipment profile)
3. **Heat balance** — the State 2 heat balance (Sankey / Stacked / Rows layouts, plus a new "Delta" layout showing State 1 → State 2 change as a layout option)
4. **Conditions** (rename of Free-running OR merge with Hourly Profile + Annual Breakdown) — single time-series view with Pavlo zoom controls
5. **(Optional) 3D Model** — hide entirely in Internal Gains until multi-zone arrives. Don't keep as placeholder.

**Steps:**

1. Add new Summary tab as default. Move headline content there.
2. Fold State 1 → State 2 Delta content into the Summary tab and into Heat balance as a "Delta" layout.
3. Merge Free-running + Hourly Profile + Annual Breakdown into a single Conditions tab. This is where the Pavlo zoom pattern lands (Part 4 below provides the components).
4. Remove 3D Model tab from Internal Gains canvas configuration. (Keep the component code in case it's revived for multi-zone.)
5. Apply the same tab structure pattern to Building module: Summary / Heat balance / Conditions / 3D Model (the 3D model is kept here because facades / orientation / shading have visual meaning).
6. Update `docs/ui_principles.md` with the canonical tab structure: Summary / Schedule (if module has schedules) / Heat balance / Conditions / 3D Model (optional).

**Verify:**
- Internal Gains has 5 tabs (or 4 if 3D Model removed)
- Summary tab is the default landing
- All content from removed tabs is reachable in the new tabs
- Building module has matching pattern
- UI principles doc updated

**Commit message:** "Brief 28a Part 3: Canvas tab restructure across modules"

**Decision points:**
- "Free-running" terminology — rename to "Conditions" per audit recommendation, or keep? My lean: rename to "Conditions" to remove industry jargon.
- 3D Model tab removal in Internal Gains: my lean is hide entirely (placeholder is worse than absent). But if there's reason to keep it visible with a clear "coming with multi-zone" message, that's defensible.
- Building module restructure scope: if it expands significantly, halt under SH and reassess. Don't expand beyond the tab structure.

---

## Part 4 — Pavlo component port

**Files:** `frontend/src/components/chart/` (new directory), `frontend/src/data/chartTokens.js`, updates to consumers

**Goal:** Port the Pavlo chart components per the investigation report. Five components clean lift, ChartContainer needs stripping.

**Steps:**

1. Re-read `docs/pavlo_chart_components_investigation.md` for the specific components and line counts.
2. Copy components from Pavlo repo:
   - `ZoomNav` — clean lift
   - `MonthJumpButtons` — clean lift
   - `DataCard` — clean lift
   - `chartTokens.js` — clean lift, merge with any existing NZA-Sim tokens
   - `ChartContainer` — strip export functionality (lose html2canvas + jspdf deps, ~250KB). Build a `ChartContainerMinimal` if that's cleaner.
3. Add appropriate import paths.
4. NZA-Sim already has its own tab strip — do NOT port Pavlo's TabBar (audit confirmed).
5. Add comment headers to ported files: "Ported from Pavlo {date}. Original at: {Pavlo path}. Adjustments: {list}."
6. Create a simple test harness that demonstrates each component working in isolation.

**Verify:**
- All 5 components compile and render in isolation
- chartTokens.js exports the shared tokens
- ChartContainer (stripped) renders without bringing in html2canvas / jspdf
- No NZA-Sim-specific dependencies broken
- Existing charts unaffected (they still use Recharts directly until Part 5 migrates them)

**Commit message:** "Brief 28a Part 4: Port Pavlo chart components"

**Decision points:**
- Whether to strip ChartContainer or build minimal version: try strip first, fall back to minimal if strip is messy.
- Tokens merge: keep Pavlo's where they exist, add NZA-Sim ones where Pavlo doesn't cover (e.g., gain-specific colours from `gainColours.js` stay).

---

## Part 5 — Migrate Conditions tab to Pavlo pattern + engine toggle wiring

**Files:** `frontend/src/components/modules/gains/canvas/LoadShapeView.jsx` (new), engine result fetchers, SQL parser

**Goal:** The new Conditions tab uses Pavlo's zoom pattern AND wires the Static/Dynamic engine toggle.

**Steps:**

1. Build `LoadShapeView.jsx`:
   - Uses `ZoomNav` for period selection (1 Day / 1 Week / 1 Month / Quarter / 6 Months / Year)
   - Uses `MonthJumpButtons` for month picker when period is shorter than year
   - Uses `DataCard` for the stat panel (Peak / Mean / Annual / Load Factor / etc.)
   - Renders the gain time series with appropriate gain colours
   - Engine toggle (Static / Dynamic) in the top-right
2. Wire the engine toggle:
   - Static path: existing `instantCalc` output (already in state)
   - Dynamic path: needs SQL parser to return per-profile hourly data
3. SQL parser update — `nza_engine/parsers/sql_parser.py`:
   - Extend `_get_heat_balance_state2` to optionally include per-profile breakdown
   - Ensure the parser handles the multi-profile structure from Brief 27 Revised Part 10
   - Output shape matches the live engine's per-profile structure where possible
4. Add a fetch mechanism: when user toggles to "Dynamic," the LoadShapeView fetches the latest sim run's per-profile output.
5. Handle loading states: Static is instant; Dynamic might need a fetch.
6. Engine agreement indicator: if Static and Dynamic disagree significantly on the same time period, show a flag (per existing Brief 26.1 pattern).

This part closes Brief 27's 9/10 holdback (engine toggle wiring).

**Verify:**
- Conditions tab renders with Static engine on first visit
- Zoom navigation works (Year → Month → Week → Day)
- Stat panel updates as zoom changes
- Toggle to Dynamic fetches and renders the latest sim run's data
- Engine agreement indicator visible when divergence is significant
- State 2 EP run produces per-profile data extractable by the parser
- State isolation regressions still byte-identical

**Commit message:** "Brief 28a Part 5: Conditions view + Pavlo zoom + engine toggle wiring"

**Decision points:**
- Default engine for LoadShapeView: Static (instant). Dynamic is opt-in.
- Engine agreement threshold for the indicator: use the existing tier system from Brief 26.1 if it applies.
- Per-profile breakdown in SQL: if the parser can't return per-profile cleanly (e.g., due to how EP aggregates Lights/ElectricEquipment objects), fall back to aggregate and document. Don't halt for this — just document.

---

## Part 6 — Apply Pavlo pattern to remaining time-series views

**Files:** Building module's Free-running view (if any), any other time-series in the tool

**Goal:** Establish Conditions / Pavlo pattern as the standard for time-series visualisation. Apply it where it makes sense.

**Steps:**

1. Audit time-series views across the tool:
   - Building module Free-running (if it exists as a tab)
   - Building module's other time-series outputs
   - Internal Gains Conditions (done in Part 5)
   - Anywhere else hourly data is displayed
2. For each, migrate to use the Pavlo components (ZoomNav, MonthJumpButtons, DataCard, ChartContainer).
3. Standardise the layout: stat panel on left or top, chart on right or bottom, controls above.
4. Document the canonical pattern in `docs/ui_principles.md` under "Time-series views."

**Verify:**
- All time-series views in the tool use the same pattern
- Stat panel content varies by view but layout is consistent
- Zoom navigation works uniformly
- Visual style consistent across modules

**Commit message:** "Brief 28a Part 6: Apply Pavlo pattern across time-series views"

**Decision points:**
- Some time-series might not benefit from Pavlo zoom (e.g., a small inline mini-profile). Use judgement.
- Building module work in this part should be minimal — substantial Building changes belong to Brief 29.

---

## Part 7 — Completion checklist + walkthrough preparation

**Files:** `docs/module_checklists/internal_gains_brief_28a.md`, `STATUS.md`, archive

**Goal:** Fill in the completion checklist honestly. Prepare for walkthrough.

**Steps:**

1. Fill in the completion checklist for Brief 28a's affected modules (Internal Gains primarily, Building partially):
   - Every section answered honestly
   - Specific Bridgewater verification numbers in the sign-off
   - Confidence rating /10
2. Update STATUS.md narrative:
   - What shipped (specific deliverables)
   - What's queued for Brief 28b (physics)
   - What's queued for Brief 29 (Building completion)
3. Note any deferred items in the completion checklist's deferred-to table.
4. Archive `docs/briefs/active/28a_visible_polish.md` → `docs/briefs/archive/28a_visible_polish_COMPLETED.md`.
5. Update `current.md` to point at Brief 28b.

**Verify:**
- Completion checklist filled in
- STATUS.md reflects current state honestly
- Archive done
- Pre-flight checks pass for Brief 28b

### Acceptance gate — canvas rendering smoketest (added 2026-05-14)

Brief 27 cleanup walkthrough exposed a discipline gap: the Heat balance prop-fix passed isolation regressions + static code inspection but the canvas still rendered the empty state because the consumer's data-shape contract was a layer deeper than the prop name. A rendering smoketest would have caught it. Add as a Part 7 acceptance gate:

- Write `scripts/state2_canvas_rendering_smoketest.mjs` that:
  1. Loads Bridgewater state2 via `calculateInstant(..., mode: 'envelope-gains')` (same path the canvas views consume via `useStateComparison`).
  2. Imports `HeatBalance` from `frontend/src/components/modules/balance/HeatBalance.jsx`.
  3. Renders it with `liveData={state2.heat_balance}` using `react-dom/server` (no browser needed — pure SSR).
  4. Asserts on visible output:
     - The rendered HTML does NOT contain "No heat balance data available" (empty-state branch did not fire)
     - The rendered HTML DOES contain at least one of the loss labels ("External walls" / "Roof" / "Glazing") with a non-zero numeric value
     - The rendered HTML DOES contain at least one of the internal gain labels ("People" / "Lighting" / "Equipment") with a non-zero numeric value (proving `gains.internal.*` resolves through `flattenGains`)
- Add the smoketest to the Brief 28a Part 7 close-out verification checklist alongside the byte-identity regressions.
- Repeat the pattern for `DeltaView`, `FreeRunningView`, `AnnualBreakdownView` if scope allows; minimum bar is HeatBalance.

This gate exists because the Brief 27 cleanup Part 1 fix passed every other gate (build, byte-identity, static inspection) but failed at the user-visible layer. A rendering smoketest is the cheap discipline that catches the gap between "the prop is renamed" and "the component renders data."

**Commit message:** "Brief 28a Part 7: Close-out + completion checklist + canvas rendering smoketest"

---

## Part 8 — State-aware Dynamic runs

**Files:** `frontend/src/utils/stateMode.js` (new helper), `frontend/src/context/SimulationContext.jsx` (use detected mode), optionally `frontend/src/components/layout/TopBar.jsx` (mode badge)

**Goal:** When the user clicks "Run Dynamic," the simulation triggered should match the current project state — envelope-only if only envelope is defined, envelope-gains if gains added, envelope-gains-operation if operable windows configured, full if systems set. Today the Run Dynamic button always POSTs with no mode parameter, falling through to backend default `mode='full'`. Runs faster + more honestly per state.

The envelope-only EP pipeline shipped in Brief 28 prereq (Option C+ — `simulation_mode` column, `run_envelope_only_sim_bridgewater.py`) is the foundation. Backend `simulate_project` endpoint already accepts a `mode` query param (`api/routers/projects.py:427`). The missing piece is frontend detection + threading the mode through `runSimulation()`.

### Detection logic

New helper in `frontend/src/utils/stateMode.js`:

```js
export function detectProjectState(building, systems) {
  // Order matters — return the most specific state that matches.
  if (hasRealSystems(systems))              return 'full'
  if (hasOperableWindows(building))         return 'envelope-gains-operation'
  if (hasInternalGains(building))           return 'envelope-gains'
  return 'envelope-only'
}
```

Predicates:
- `hasRealSystems(systems)` — `systems.space_heating?.primary?.system` exists AND is not an `ideal_loads_*` placeholder, OR `systems.hvac_type` is set to a real system (VRF, ASHP, gas boiler, etc.).
- `hasOperableWindows(building)` — `building.openings.schedule` is populated (non-empty schedule object).
- `hasInternalGains(building)` — `building.occupancy.density.value > 0` OR `building.gains.lighting.profiles[].magnitude.value > 0` OR `building.gains.equipment.profiles[].baseload.value > 0` (etc.).

The predicates are conservative — a populated-but-zeroed config returns false (no gains genuinely defined). Match the same conservativeness the FORBIDDEN_*_INPUTS lists use.

### Steps

1. Implement `detectProjectState` + its predicates in `stateMode.js`. Add unit-test-style assertions in a small smoketest script (`scripts/detect_project_state_smoketest.mjs`):
   - Bridgewater → returns `'full'` (has gains, has systems)
   - Bridgewater with systems object stripped → returns `'envelope-gains'`
   - Bridgewater with gains profiles emptied AND systems stripped → returns `'envelope-only'`
   - Bridgewater with operable windows configured + systems stripped → returns `'envelope-gains-operation'`
2. Update `SimulationContext.runSimulation()` to call the helper and pass mode to the POST URL:
   ```js
   const mode = detectProjectState(building, systems)
   const response = await fetch(
     `/api/projects/${currentProjectId}/simulate?mode=${encodeURIComponent(mode)}`,
     { method: 'POST' },
   )
   ```
3. **Optional UI affordance:** add a `Will run: <mode>` line to the Run Dynamic button's `title` attribute (tooltip), so the user can see what mode will be triggered before clicking. Cheap; ships with the rest.
4. Backend verification: after a Run Dynamic click, query the new run row in `simulation_runs` — confirm `simulation_mode` column matches the detected mode.

### Verify

- Bridgewater (default, all sections populated): detection returns `'full'` ; Run Dynamic triggers `?mode=full` ; row written with `simulation_mode='full'`. Matches current behaviour.
- Bridgewater with `systems_config` stripped to empty: detection returns `'envelope-gains'` ; run completes in less time than a full mode run (gains evaluated but no real system curves).
- Fresh project with only geometry: detection returns `'envelope-only'` ; run completes faster still (~35 s on a typical box).
- `simulation_mode` column populated correctly for each detection outcome.
- State isolation regressions still byte-identical (this changes frontend dispatch, not engine output).

### Decision points

- **Override?** Should the user be able to manually override the auto-detected mode (e.g., "Run as State 1 even though systems are configured")? My lean: **no for now** — keep it simple, add an override only if a real workflow needs it. Filing this as a follow-up if it surfaces.
- **State 2.5 (`envelope-gains-operation`):** the assembler may not yet support this mode end-to-end (Brief 30 territory). If detection returns 2.5, fall through to `'envelope-gains'` for the run and surface a note in the tooltip ("operable windows detected; running as State 2 until State 2.5 lands in Brief 30"). Document the limitation.
- **Badge placement:** my lean is the Run Dynamic button's `title` tooltip rather than a separate badge — keeps the top bar compact. A persistent visible badge is a Brief 28a Part 4 / 6 polish if it becomes important.

### Halt triggers

- Detection returns wrong mode for Bridgewater (e.g., returns `'envelope-only'` when systems are populated) → HH4 (premise wrong)
- Backend rejects the mode param value or fails the run → HH5 (build broken)
- Detection produces a different mode for the same config across two consecutive calls → HH6 (deterministic dispatch violation)

### Confidence target

**9/10.** Well-scoped; foundation exists (envelope-only persisted run pipeline from Brief 28 prereq); detection logic is straightforward; backend already accepts the mode param. The 1/10 gap is the State 2.5 fallthrough edge case (no Brief 30 yet).

**Commit message:** "Brief 28a Part 8: State-aware Dynamic runs"

---

## Close-out

After all parts complete:

1. Run full regression suite — all green.
2. Confirm pre-flight checks pass for Brief 28b.
3. Proceed to Brief 28b without pause (no walkthrough between briefs).

**Confidence target:** 9/10 (substantial UX work, no physics changes).

**Halt triggers specific to this brief:**
- Tab restructure breaks an existing test → HH1 / HH6
- Pavlo port introduces dependencies that break the build → HH5
- Engine toggle wiring reveals SQL parser issues that can't be cleanly resolved → SH3
- Static/Dynamic rename misses cases that cause confusion → not halt-worthy; document and continue
