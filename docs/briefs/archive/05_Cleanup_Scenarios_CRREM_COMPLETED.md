# Brief 05: Code Cleanup, Scenario Manager & CRREM/Carbon Trajectory

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read docs/briefs/00_project_brief.md — sections 5.4 (Scenario Manager), 6.5 (Benchmarking & Targets), 7 (Sanity Checks)
4. Read docs/pablo_design_system_reference.md — refresh on DataCard, ChartContainer, chart tokens
5. Read this ENTIRE brief before writing a single line of code
6. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** After completing each part, you MUST open the application in a real browser and visually confirm it works. Take screenshots. Report what you actually see. Check browser DevTools console for red errors. If anything is broken, fix it before committing.

---

## Context

The codebase has grown across four briefs and needs a cleanup pass before adding more features. There are duplicated functions, a leftover file, and some minor inconsistencies to tidy up.

After cleanup, this brief builds two major features:

1. **Scenario Manager** — duplicate a project configuration as a named scenario, run simulations for multiple scenarios, and compare results side by side with automatic input-delta tracking (what changed between scenarios and what effect it had).

2. **CRREM & Carbon Trajectory** — plot the building's EUI and carbon intensity against CRREM decarbonisation pathways, showing when/if the building becomes stranded and how each scenario affects the trajectory.

13 parts. Do them in order.

---

## PART 1: Code cleanup

**File(s):** Multiple files across the codebase

Fix the following housekeeping issues:

**1a. Remove duplicate `_resolve_weather_file`**
The function exists in both `api/routers/simulate.py` and `api/routers/projects.py` with identical logic. Extract it to a shared module:
- Create `api/utils.py` with the function
- Import from there in both routers
- Delete the duplicate definitions

**1b. Fix `updateConstruction` debounce duplication in ProjectContext**
`frontend/src/context/ProjectContext.jsx` — the `updateConstruction` callback manually implements its own debounce/save logic instead of using `_scheduleSave`. Refactor it to use `_scheduleSave` or a generalised save function, like `updateParam` and `updateSystem` do. The construction update should go through `PUT /api/projects/{id}` with `{ construction_choices: next }` — use `_scheduleSave` with an appropriate endpoint or generalise `_scheduleSave` to accept arbitrary update bodies.

**1c. Delete leftover `BuildingContext.jsx`**
`frontend/src/context/BuildingContext.jsx` is a 512-byte stub left over from the ProjectContext refactor. Delete it. Search the codebase for any remaining imports of `BuildingContext` and remove them — everything should use `ProjectContext` now.

**1d. Gitignore the `.command` file**
`NZA Simulate.command` was committed to the repo but should be gitignored (it's machine-specific, like `go.bat`). Add `*.command` to `.gitignore` and remove the file from git tracking: `git rm --cached "NZA Simulate.command"`

**1e. Clean up the standalone simulate endpoint**
`api/routers/simulate.py` contains the original `/api/simulate` endpoint from Brief 01. The frontend now uses `/api/projects/{id}/simulate` instead. The standalone endpoint is still useful for quick testing without a project, so keep it but add a deprecation comment at the top of the file noting that the project-based endpoint is the primary one.

**1f. Fix `_row_to_item` in library.py**
The function builds a slim `config_json` then immediately overwrites it when `include_config=True` (which is the default). Simplify: if `include_config` is True, just use the full config. Only build the slim version when `include_config` is False.

**Commit message:** "Part 1: Code cleanup — deduplicate weather resolver, fix construction save, remove stubs"

**Verify:**
1. Start both servers
2. Open the app in the browser — confirm everything still works (no regressions)
3. Navigate to /building → Fabric tab — change a construction, confirm save indicator appears and persists through refresh
4. Navigate to /building → Geometry tab — change length, confirm save works
5. Navigate to /systems — change LPD, confirm save works
6. Run a simulation — confirm it completes successfully
7. Open browser DevTools → Console — zero red errors
8. Run `git status` — confirm `NZA Simulate.command` is no longer tracked, `BuildingContext.jsx` is deleted
9. Report: "Cleanup complete. Weather resolver deduplicated to api/utils.py. Construction save uses shared debounce. BuildingContext stub deleted — no remaining imports found. .command file removed from tracking. Standalone simulate endpoint kept with deprecation note. Library _row_to_item simplified. All functionality verified — no regressions."

---

## PART 2: Scenario database schema

**File(s):** `api/db/schema.sql`, `api/db/database.py`

Add a scenarios table to support the scenario manager. A scenario is a named variant of a project's configuration — a full copy of building, systems, constructions, and schedules with metadata about what was changed.

Add to the schema:

```sql
-- Scenarios within a project
CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,                   -- e.g. "Baseline", "Enhanced Fabric", "MVHR + ASHP"
    description TEXT,
    is_baseline INTEGER DEFAULT 0,        -- 1 for the baseline scenario
    building_config JSON NOT NULL,
    systems_config JSON NOT NULL,
    construction_choices JSON NOT NULL,
    schedule_assignments JSON,
    weather_file TEXT,
    changes_from_baseline JSON,           -- auto-computed: what differs from baseline
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scenarios_project_id ON scenarios (project_id, created_at);
```

Update the `simulation_runs` table to include a `scenario_id` column:
```sql
ALTER TABLE simulation_runs ADD COLUMN scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL;
```

Handle the ALTER gracefully — if the column already exists, skip it. SQLite doesn't support `ADD COLUMN IF NOT EXISTS`, so catch the error.

Update `init_db()` to create the new table and add the column.

**Commit message:** "Part 2: Scenarios database table and simulation_runs.scenario_id column"

**Verify:**
1. Restart the backend (this triggers init_db)
2. Run `sqlite3 data/nza_sim.db ".tables"` — should show `scenarios` in the list
3. Run `sqlite3 data/nza_sim.db ".schema scenarios"` — should match the schema above
4. Run `sqlite3 data/nza_sim.db "PRAGMA table_info(simulation_runs)"` — should include `scenario_id` column
5. Existing functionality still works — load the app, navigate around, run a simulation
6. Report: "Scenarios table created. scenario_id column added to simulation_runs. Existing data and functionality unaffected."

---

## PART 3: Scenario CRUD API

**File(s):** `api/routers/scenarios.py`, update `api/main.py`, update `api/routers/projects.py`

Create REST API endpoints for scenario management:

**POST /api/projects/{project_id}/scenarios** — Create a new scenario
- Accepts: `{ name, description?, source }` where `source` is either `"baseline"` (copy from project defaults) or a scenario ID (copy from that scenario)
- Creates a full copy of the source configuration
- If this is the first scenario for the project, mark it as `is_baseline=1`
- Auto-computes `changes_from_baseline` by comparing this scenario's config against the baseline scenario's config (if a baseline exists)
- Returns: full scenario object

**GET /api/projects/{project_id}/scenarios** — List all scenarios for a project
- Returns: array of scenarios with id, name, is_baseline, changes summary, latest simulation EUI

**GET /api/projects/{project_id}/scenarios/{scenario_id}** — Get full scenario details

**PUT /api/projects/{project_id}/scenarios/{scenario_id}** — Update scenario config
- Accepts partial updates to building_config, systems_config, construction_choices
- Auto-recomputes `changes_from_baseline`
- Returns: updated scenario

**DELETE /api/projects/{project_id}/scenarios/{scenario_id}** — Delete a scenario
- Cannot delete the baseline scenario if other scenarios exist

**POST /api/projects/{project_id}/scenarios/{scenario_id}/simulate** — Run simulation for a specific scenario
- Reads config from the scenario (not the project)
- Stores results in simulation_runs with scenario_id set
- Returns results

**The `changes_from_baseline` auto-computation:**

Write a helper function `compute_changes(baseline_config, scenario_config)` that compares two configuration dicts and returns a structured list of what changed:
```python
[
    {
        "category": "construction",
        "parameter": "external_wall",
        "baseline_value": "cavity_wall_standard",
        "scenario_value": "cavity_wall_enhanced",
        "baseline_display": "Cavity Wall Standard (U=0.28)",
        "scenario_display": "Cavity Wall Enhanced (U=0.18)"
    },
    {
        "category": "systems",
        "parameter": "ventilation_type",
        "baseline_value": "mev_standard",
        "scenario_value": "mvhr_standard",
        "baseline_display": "Mechanical Extract (no recovery)",
        "scenario_display": "MVHR (85% recovery)"
    }
]
```

This list is stored in the scenario record and displayed in the comparison view. It lets the user see exactly what they changed without manually comparing parameter lists.

**Commit message:** "Part 3: Scenario CRUD API with auto-computed changes_from_baseline"

**Verify:**
1. Start the API
2. Create a baseline scenario: `curl -X POST http://127.0.0.1:8002/api/projects/{pid}/scenarios -H "Content-Type: application/json" -d '{"name": "Baseline", "source": "baseline"}'` — should return scenario with is_baseline=1
3. Create a variant: `curl -X POST http://127.0.0.1:8002/api/projects/{pid}/scenarios -H "Content-Type: application/json" -d '{"name": "Enhanced Fabric", "source": "{baseline_scenario_id}"}'` — should return a copy
4. Update the variant's wall construction: `curl -X PUT http://127.0.0.1:8002/api/projects/{pid}/scenarios/{sid} -H "Content-Type: application/json" -d '{"construction_choices": {"external_wall": "cavity_wall_enhanced"}}'`
5. Get the variant: `curl http://127.0.0.1:8002/api/projects/{pid}/scenarios/{sid}` — `changes_from_baseline` should list the wall construction change
6. List scenarios: `curl http://127.0.0.1:8002/api/projects/{pid}/scenarios` — should show both
7. Report: "Scenario CRUD working. Baseline created (is_baseline=1). Variant created from baseline copy. Updated variant wall — changes_from_baseline correctly shows: external_wall changed from cavity_wall_standard to cavity_wall_enhanced. List endpoint returns both scenarios."

---

## PART 4: Scenario manager frontend — scenario list and creation

**File(s):** `frontend/src/components/modules/ScenarioManager.jsx`, `frontend/src/components/modules/scenarios/ScenarioList.jsx`, `frontend/src/components/modules/scenarios/CreateScenarioModal.jsx`, update `frontend/src/App.jsx`

Replace the /scenarios placeholder with the Scenario Manager module.

**ScenarioManager.jsx** — Uses ExplorerLayout.

**Sidebar — ScenarioList.jsx:**
- List of all scenarios for the current project, fetched from the API
- Each scenario shown as a card:
  - Name (bold)
  - "Baseline" badge on the baseline scenario
  - Number of changes from baseline (e.g. "3 changes") or "Baseline" for the baseline
  - Latest EUI if a simulation has been run (or "Not run" in mid-grey)
  - Run button (small play icon) to trigger simulation for that scenario
  - Status indicator: idle / running / complete / error
- "New Scenario" button at the top — opens CreateScenarioModal
- Click a scenario to select it and show its details in the main area

**CreateScenarioModal.jsx:**
- Modal overlay with:
  - Name input
  - Description input (optional)
  - Source selector: "Copy from Baseline" or dropdown of existing scenarios
  - "Create" button
- On create: POST to API, close modal, select the new scenario

**Main content area (when a scenario is selected):**
- Show the scenario's full configuration as a summary — building params, constructions, systems
- If it's not the baseline, show the `changes_from_baseline` list prominently at the top:
  - Each change as a row: parameter name, baseline value → scenario value, with a visual arrow
  - Colour-coded: green for improvements (lower U-value, higher efficiency), red for worse, neutral for lateral changes
- "Edit" button that navigates to a scenario-specific edit view (Part 5)
- "Run Simulation" button for this specific scenario
- If results exist: show key metrics (EUI, heating, cooling, peak loads) as DataCards

**Commit message:** "Part 4: Scenario Manager frontend with scenario list and creation"

**Verify:**
1. Open `http://127.0.0.1:5176` and click the Scenarios icon in the sidebar
2. **SCREENSHOT 1:** The Scenario Manager should show an empty state with a "Create your first scenario" prompt or auto-create a baseline
3. **INTERACT:** Click "New Scenario" — the modal should appear. Enter "Baseline", select "Copy from project defaults", click Create
4. **INTERACT:** Click "New Scenario" again — enter "Enhanced Fabric", select "Copy from Baseline", click Create
5. **SCREENSHOT 2:** The sidebar should show two scenarios: "Baseline" with a badge, "Enhanced Fabric" below it
6. Click "Enhanced Fabric" — the main area should show its configuration and "0 changes from baseline" (since it's an exact copy so far)
7. Open browser DevTools → Console — zero red errors
8. Report: "Scenario Manager renders with scenario list in sidebar. Created Baseline and Enhanced Fabric scenarios. Baseline has badge. Enhanced Fabric shows 0 changes (correct — it's an exact copy). Create modal works. No console errors."

---

## PART 5: Scenario editing

**File(s):** `frontend/src/components/modules/scenarios/ScenarioEditor.jsx`, update `frontend/src/components/modules/ScenarioManager.jsx`

When "Edit" is clicked on a non-baseline scenario, show an inline editor (not a new page — stays within the Scenario Manager module) that lets the user modify the scenario's configuration.

**ScenarioEditor.jsx** — Replaces the main content area when editing.

The editor should be a focused, simplified version of the Building + Systems modules — not a full copy of all those tabs, but a streamlined panel showing only the parameters that are likely to change between scenarios:

**Fabric section:**
- Dropdown for each construction element (wall, roof, floor, glazing) — same as Fabric tab
- U-value shown next to each

**Systems section:**
- HVAC type dropdown
- Ventilation type dropdown + natural vent toggle
- DHW primary + preheat dropdowns
- Lighting power density slider

**Key building parameters:**
- Infiltration rate
- Heating setpoint
- Cooling setpoint

Each field shows its current value alongside the baseline value (in lighter text) so the user can see what they're changing at a glance.

When any value is changed:
1. Auto-save to the scenario via PUT API (debounced, same as project auto-save)
2. Recompute and display `changes_from_baseline` in real time — the changes list at the top should update immediately

A "Done Editing" button returns to the scenario summary view.

**Commit message:** "Part 5: Scenario editor with inline parameter modification and live change tracking"

**Verify:**
1. Navigate to /scenarios, select "Enhanced Fabric"
2. Click "Edit"
3. **SCREENSHOT 1:** The editor should show all parameter sections with current values and baseline values visible
4. **INTERACT:** Change the external wall from "cavity_wall_standard" to "cavity_wall_enhanced"
5. The changes list should immediately update to show: "External Wall: Cavity Wall Standard (U=0.28) → Cavity Wall Enhanced (U=0.18)"
6. **INTERACT:** Change ventilation from MEV to MVHR
7. The changes list should now show 2 changes
8. Click "Done Editing" — return to summary view, changes list still visible
9. **SCREENSHOT 2:** The scenario summary showing 2 changes with baseline → scenario values
10. Refresh the page — changes should persist (auto-saved to DB)
11. Open browser DevTools → Console — zero red errors
12. Report: "Scenario editor working. Changed wall construction and ventilation type. Changes list updated in real time showing 2 changes with baseline comparison. Values persisted through refresh. No console errors."

---

## PART 6: Run simulations for scenarios and store results

**File(s):** Update `frontend/src/components/modules/scenarios/ScenarioList.jsx`, update `frontend/src/components/modules/ScenarioManager.jsx`

Wire the "Run Simulation" button on each scenario to the API:

- Clicking the play button on a scenario card triggers `POST /api/projects/{pid}/scenarios/{sid}/simulate`
- The scenario card shows running state (spinner)
- On completion, the card updates to show the EUI
- Results are stored in the simulation_runs table with scenario_id set

Add a "Run All" button at the top of the scenario list that runs simulations for all scenarios sequentially (not in parallel — EnergyPlus is single-threaded). Show a progress indicator: "Running 1 of 3...", "Running 2 of 3...", etc.

When a scenario's simulation completes, its results should be immediately available in the main content area — show DataCards with EUI, heating, cooling, peak loads.

**Commit message:** "Part 6: Scenario simulation execution with Run All and per-scenario results"

**Verify:**
1. Navigate to /scenarios with at least 2 scenarios (Baseline and Enhanced Fabric)
2. **INTERACT:** Click the play button on "Baseline" — it should show a spinner, then complete with an EUI value
3. **INTERACT:** Click the play button on "Enhanced Fabric" — same flow, different EUI
4. **SCREENSHOT 1:** Both scenarios showing their EUI values in the sidebar
5. **INTERACT:** Click "Run All" — both should run sequentially with progress indicator
6. **DATA CHECK:** The Enhanced Fabric scenario should have a different EUI from Baseline (the wall and ventilation changes should produce a measurable difference)
7. Click each scenario — the main area should show its specific results with DataCards
8. Open browser DevTools → Console — zero red errors
9. Report: "Scenario simulations working. Baseline EUI: [X] kWh/m². Enhanced Fabric EUI: [X] kWh/m². Difference: [X] kWh/m² ([X]%). Run All executed sequentially with progress. Results displayed per scenario. No console errors."

---

## PART 7: Scenario comparison view

**File(s):** `frontend/src/components/modules/scenarios/ComparisonView.jsx`, update `frontend/src/components/modules/ScenarioManager.jsx`

This is the key deliverable — a side-by-side comparison of all scenarios.

Add a "Compare" tab or toggle to the Scenario Manager that switches from the single-scenario detail view to the comparison view.

**ComparisonView.jsx:**

**Top section — Input differences table:**
- Rows: each parameter that differs across any scenario
- Columns: one per scenario (Baseline, Enhanced Fabric, etc.)
- Cells: the value for that parameter in that scenario
- Cells that differ from baseline are highlighted (green for better, red for worse, based on whether lower U-value or higher COP is an improvement)
- Only show parameters that actually differ — don't show 50 rows of identical values

Example:
```
Parameter           | Baseline              | Enhanced Fabric         | MVHR Option
--------------------|----------------------|------------------------|------------------
External Wall       | Standard (U=0.28)    | ✨ Enhanced (U=0.18)   | Standard (U=0.28)
Ventilation         | MEV (no recovery)    | MEV (no recovery)      | ✨ MVHR (85% recovery)
```

**Middle section — Results comparison:**

**Grouped bar chart** (Recharts BarChart):
- X axis: metric names (EUI, Heating, Cooling, Lighting, Equipment)
- Groups: one bar per scenario, coloured differently
- This shows at a glance which scenario performs best on each metric

**EUI comparison bar chart:**
- Horizontal bars, one per scenario
- Sorted by EUI (best at top)
- Baseline shown with a dashed vertical reference line
- Each bar labelled with the EUI value and the % change from baseline

**Bottom section — Delta summary DataCards:**
For each non-baseline scenario:
- EUI change from baseline (kWh/m² and %)
- Heating demand change (%)
- Cooling demand change (%)
- Net energy change (kWh/yr)
- A simple verdict: "Better" (green), "Worse" (red), or "Mixed" (amber) based on whether total energy decreased

**Commit message:** "Part 7: Scenario comparison view with input deltas, grouped bar chart, and EUI ranking"

**Verify:**
1. Ensure at least 2 scenarios have been run with results
2. Navigate to /scenarios and switch to the Compare view
3. **SCREENSHOT 1:** The input differences table showing which parameters differ across scenarios, with green highlighting for improvements
4. **SCREENSHOT 2:** The grouped bar chart comparing EUI, heating, cooling across scenarios
5. **SCREENSHOT 3:** The EUI ranking chart showing scenarios sorted by performance with % change from baseline
6. **INTERACT:** Hover on bars in the grouped chart — tooltips should show scenario name and metric value
7. **DATA CHECK:** Do the differences make physical sense? Enhanced fabric should show lower heating but potentially higher cooling (trapped gains). The delta summary should reflect this.
8. Open browser DevTools → Console — zero red errors
9. Report: "Comparison view working. Input differences table shows [X] differing parameters across [Y] scenarios. Grouped bar chart compares all metrics. EUI ranking: 1st [scenario] at [X] kWh/m², 2nd [scenario] at [X] kWh/m². Delta from baseline: [scenario] is [X]% [better/worse]. No console errors."

---

## PART 8: CRREM pathway data

**File(s):** `nza_engine/library/benchmarks.py`, update `api/db/database.py`, update `api/routers/library.py`

Create a benchmarks library for CRREM decarbonisation pathways and carbon intensity data.

**`nza_engine/library/benchmarks.py`:**

Define the CRREM 1.5°C pathway for UK hotels. CRREM provides year-by-year EUI targets (kWh/m²) and carbon intensity targets (kgCO₂/m²). The values decrease over time as the pathway tightens.

Approximate CRREM 1.5°C values for UK Hotels (use these as starting values — we can refine later with actual CRREM data):

```python
CRREM_HOTEL_UK_15 = {
    "name": "CRREM 1.5°C — UK Hotel",
    "pathway": "1.5C",
    "country": "UK",
    "building_type": "hotel",
    "eui_targets": {
        # Year: EUI target (kWh/m²)
        2020: 280, 2025: 230, 2030: 180, 2035: 140,
        2040: 110, 2045: 90, 2050: 75, 2055: 65, 2060: 55
    },
    "carbon_targets": {
        # Year: kgCO₂/m²
        2020: 80, 2025: 55, 2030: 38, 2035: 25,
        2040: 18, 2045: 12, 2050: 8, 2055: 5, 2060: 2
    }
}
```

Also define UK grid carbon intensity projections (for converting electricity kWh to kgCO₂). Use a simplified version of National Grid FES:

```python
UK_GRID_CARBON_INTENSITY = {
    "name": "UK Grid Carbon Intensity — FES Baseline",
    "source": "National Grid FES (simplified)",
    "intensity_kgCO2_per_kWh": {
        2020: 0.233, 2025: 0.180, 2030: 0.120, 2035: 0.070,
        2040: 0.040, 2045: 0.020, 2050: 0.010, 2055: 0.005, 2060: 0.002
    }
}

# Gas carbon intensity (relatively stable)
GAS_CARBON_INTENSITY_KG_PER_KWH = 0.183
```

Seed these into the library as `benchmark` type items.

Also add a helper function `compute_building_carbon(annual_energy_by_fuel, year, grid_intensity_data)` that calculates the building's operational carbon intensity in kgCO₂/m² for a given year using the energy breakdown and carbon factors.

**Commit message:** "Part 8: CRREM pathway data and carbon intensity projections"

**Verify:**
1. Restart backend (seeds new data)
2. `curl "http://127.0.0.1:8002/api/library?type=benchmark"` — should return CRREM and carbon intensity items
3. Check the CRREM data: `curl http://127.0.0.1:8002/api/library/{crrem_id}` — should return year-by-year targets
4. Report: "CRREM 1.5°C UK Hotel pathway seeded with EUI targets (280 → 55 kWh/m², 2020-2060) and carbon targets (80 → 2 kgCO₂/m²). UK grid carbon intensity seeded (0.233 → 0.002 kgCO₂/kWh). Gas intensity at 0.183 kgCO₂/kWh. Compute function ready."

---

## PART 9: CRREM trajectory chart

**File(s):** `frontend/src/components/modules/results/CRREMTab.jsx`, update `frontend/src/components/modules/results/ResultsDashboard.jsx`

Add a new "CRREM & Carbon" tab to the Results Dashboard.

**CRREMTab.jsx:**

**Top section — EUI Trajectory Chart** (Recharts ComposedChart inside ChartContainer):

- X axis: Year (2020–2060)
- Y axis: EUI (kWh/m²)
- **CRREM pathway line:** Dashed line showing the CRREM target EUI declining over time. Colour: mid-grey with the area below shaded very light green (the "safe zone")
- **Building EUI line:** Horizontal solid line at the building's current modelled EUI. Colour: navy. This extends from the current year to 2060.
- **Stranding point:** Where the building line crosses the CRREM pathway — mark with a red dot and a vertical dashed red line to the x-axis. Label: "Stranding year: 20XX"
- If the building EUI is already below the CRREM pathway: show a green "Compliant" badge and no stranding point

For scenario comparison: if multiple scenarios have results, show each scenario as a separate horizontal line (different colours/dashes) so you can see which scenarios delay or avoid stranding.

**Bottom section — Carbon Trajectory Chart** (similar layout):

- X axis: Year (2020–2060)
- Y axis: Carbon intensity (kgCO₂/m²)
- **CRREM carbon pathway:** Dashed line declining over time
- **Building carbon intensity:** This one is NOT flat — it decreases over time even for the same building because grid electricity is decarbonising. Calculate: `(electricity_kWh × grid_intensity[year] + gas_kWh × gas_intensity) / GIA` for each year.
- **Stranding point on carbon:** Where the building carbon line crosses the CRREM carbon pathway

**DataCards between the charts:**
- Current EUI (kWh/m²)
- CRREM target for current year (kWh/m²)
- EUI gap (how far above/below the target)
- Stranding year (or "Compliant")
- Current carbon intensity (kgCO₂/m²)
- Carbon stranding year

Fetch the CRREM data from the library API when the tab loads.

**Commit message:** "Part 9: CRREM trajectory chart with EUI and carbon pathways and stranding year"

**Verify:**
1. Ensure a simulation has been run
2. Navigate to /results → click the "CRREM & Carbon" tab (should be the last tab)
3. **SCREENSHOT 1:** The EUI trajectory chart showing the CRREM pathway declining and the building's EUI as a horizontal line. If EUI is ~56 kWh/m², it should be BELOW the CRREM pathway for 2026 — meaning it's currently compliant but may not be by 2050.
4. **SCREENSHOT 2:** The carbon trajectory chart showing the building's carbon decreasing over time (grid decarbonisation) against the CRREM carbon pathway
5. **DATA CHECK:** The stranding year should make sense. With a 56 kWh/m² EUI, the building should cross the CRREM pathway somewhere around 2050-2060 (when the target drops below 55). If EUI is higher, stranding is earlier.
6. **INTERACT:** Hover on the stranding point — tooltip should show the year and the values where the lines cross
7. DataCards should show current EUI, target, gap, and stranding year
8. Open browser DevTools → Console — zero red errors
9. Report: "CRREM trajectory tab working. EUI chart shows building at [X] kWh/m² against CRREM pathway. Stranding year: [XXXX] (or 'Compliant'). Carbon chart shows building carbon declining from [X] to [X] kgCO₂/m² (2026-2060) due to grid decarbonisation. Carbon stranding year: [XXXX]. DataCards populated. No console errors."

---

## PART 10: CRREM with scenario overlay

**File(s):** Update `frontend/src/components/modules/results/CRREMTab.jsx`

Enhance the CRREM charts to show multiple scenarios when viewing from the Scenario Manager context.

When the user has multiple scenarios with simulation results:
- Each scenario appears as a separate line on the EUI trajectory chart
- Each line is a different colour (use a colour palette that distinguishes 4-5 scenarios clearly)
- A legend shows scenario names with their line colours
- Each stranding point is marked with the scenario's colour
- The DataCards show the baseline scenario's metrics, with a comparison row for the best-performing scenario

This requires the CRREM tab to know about scenarios. Add a prop or context that provides scenario results. If viewing results from the main Results Dashboard (not Scenario Manager), show only the current project's latest simulation. If viewing from the Scenario Manager comparison view, show all scenarios.

Consider adding a "View CRREM" button in the Scenario Manager comparison view that navigates to the Results → CRREM tab with all scenario data pre-loaded.

**Commit message:** "Part 10: CRREM trajectory with multi-scenario overlay"

**Verify:**
1. Ensure at least 2 scenarios have been run
2. Navigate to /results → CRREM & Carbon tab
3. If accessed from Results Dashboard: should show only the latest simulation's line
4. Navigate to /scenarios → Compare view → click "View CRREM" (or navigate to CRREM tab with scenario context)
5. **SCREENSHOT:** The EUI trajectory chart with multiple scenario lines, each in a different colour, with the CRREM pathway. Each scenario's stranding point should be visible.
6. **DATA CHECK:** The scenario with lower EUI should have a later stranding year (or be compliant). The scenario with higher EUI should strand earlier.
7. The legend should clearly identify each scenario
8. Open browser DevTools → Console — zero red errors
9. Report: "Multi-scenario CRREM overlay working. [X] scenarios plotted. Baseline stranding year: [X]. Enhanced Fabric stranding year: [X]. [Best scenario] extends compliance by [X] years. Legend and stranding points clear. No console errors."

---

## PART 11: Auto-create baseline scenario for existing projects

**File(s):** Update `frontend/src/context/ProjectContext.jsx` or `frontend/src/components/modules/ScenarioManager.jsx`

Currently, existing projects (created before the scenario system) have no scenarios. When the Scenario Manager loads for a project with zero scenarios, it should automatically:

1. Create a "Baseline" scenario by copying the project's current configuration
2. If the project has existing simulation runs (without a scenario_id), associate the most recent one with the new baseline scenario
3. Show the baseline in the scenario list

This ensures a smooth transition — users don't have to manually recreate their baseline.

Also: when a NEW project is created (via the project picker), auto-create a baseline scenario for it.

**Commit message:** "Part 11: Auto-create baseline scenario for new and existing projects"

**Verify:**
1. Open a project that was created before Brief 05 (should have simulation results but no scenarios)
2. Navigate to /scenarios
3. The Scenario Manager should automatically show a "Baseline" scenario with the existing simulation results associated
4. **SCREENSHOT:** The baseline scenario showing EUI from the existing simulation
5. Create a brand new project via the project picker
6. Navigate to /scenarios for the new project — a baseline should already exist
7. Open browser DevTools → Console — zero red errors
8. Report: "Auto-baseline working. Existing project [name]: baseline scenario auto-created with existing simulation results (EUI [X]). New project: baseline auto-created with default config. No console errors."

---

## PART 12: Navigation polish — linking Results and Scenarios

**File(s):** Various — update navigation and cross-linking

Add smooth navigation between the Results Dashboard and Scenario Manager:

1. **Results Dashboard top bar:** If scenarios exist, show a dropdown to select which scenario's results to view. Changing the dropdown reloads all Results tabs with that scenario's data.

2. **Scenario Manager → Results:** Clicking "View Full Results" on a scenario navigates to /results with that scenario's results loaded.

3. **Results Dashboard → Scenarios:** Add a "Compare Scenarios" button/link on the Overview tab that navigates to /scenarios comparison view.

4. **Top bar Run Simulation button:** When scenarios exist, the button should show a small dropdown: "Run Baseline" / "Run [Scenario Name]" / "Run All Scenarios". Default (single click) runs the currently selected scenario or the baseline if none selected.

**Commit message:** "Part 12: Cross-linking between Results Dashboard and Scenario Manager"

**Verify:**
1. With multiple scenarios and results, navigate to /results
2. **INTERACT:** Use the scenario dropdown to switch between scenario results — charts should update
3. **INTERACT:** Click "Compare Scenarios" — should navigate to /scenarios comparison view
4. From /scenarios, click "View Full Results" on a scenario — should navigate to /results with that scenario loaded
5. **INTERACT:** Click the Run Simulation dropdown — should show options for each scenario
6. **SCREENSHOT:** The Results Dashboard with scenario selector dropdown visible
7. Open browser DevTools → Console — zero red errors
8. Report: "Cross-navigation working. Results ↔ Scenarios linking smooth. Scenario dropdown on Results tab switches data correctly. Run button shows scenario options. No console errors."

---

## PART 13: Full integration test

Run a complete Bridgewater scenario comparison workflow:

1. Open the app, load or create the Bridgewater Hotel project
2. Navigate to /scenarios
3. Ensure a Baseline scenario exists with current config (auto-created or manually)
4. Create 3 new scenarios:
   - **"Enhanced Fabric"** — change walls to cavity_wall_enhanced, roof to flat_roof_enhanced, glazing to triple_glazing
   - **"MVHR Upgrade"** — change ventilation from MEV to MVHR (keep standard fabric)
   - **"Fabric + MVHR"** — both fabric improvements AND MVHR
5. Click "Run All" — all 4 scenarios simulate sequentially
6. Switch to Compare view — verify:
   - Input differences table shows the correct changes for each scenario
   - Grouped bar chart compares all 4 scenarios
   - EUI ranking shows them in order
   - Delta summary shows % change from baseline
7. Navigate to CRREM tab — verify all 4 scenario lines are plotted with different stranding years
8. Navigate to /results — use the scenario dropdown to switch between results. Sankey diagram, energy balance, load profiles, and fabric analysis should all update per scenario.

**SCREENSHOTS (take all of these):**
1. Scenario Manager with 4 scenarios listed, all with EUI values
2. Comparison view — input differences table
3. Comparison view — grouped bar chart
4. Comparison view — EUI ranking
5. CRREM chart with 4 scenario lines
6. Results Overview with scenario selector

**Commit message:** "Part 13: Full integration test — 4 Bridgewater scenarios compared"

**Verify — report these numbers:**

| Scenario | EUI (kWh/m²) | Heating (kWh) | Cooling (kWh) | Stranding Year |
|----------|-------------|---------------|---------------|----------------|
| Baseline | | | | |
| Enhanced Fabric | | | | |
| MVHR Upgrade | | | | |
| Fabric + MVHR | | | | |

- Enhanced Fabric should reduce heating but may increase cooling (trapped gains)
- MVHR should reduce heating significantly (recovered ventilation heat)
- Fabric + MVHR should be the best overall
- Stranding years should differ meaningfully

Browser DevTools → Console: zero red errors across entire workflow.

---

## After all 13 parts are complete

Update STATUS.md with:
- All 13 parts completed
- Code cleanup items resolved
- Scenario comparison results (the table from Part 13)
- CRREM stranding years for each scenario
- Known issues
- Suggestions for Brief 06 (detailed HVAC with COP curves, report export to PowerPoint, EV charging, future weather files, interactive web client for Zeal Hotels)

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 05 complete. Code cleaned up. Scenario Manager working with 4 Bridgewater scenarios compared. Best performer: [scenario] at [X] kWh/m² ([X]% better than baseline). CRREM stranding: Baseline [year], best scenario [year] — [X] years of additional compliance. Full walkthrough screenshots taken."
