# Brief 06: Bug Fixes, UI Gaps, Custom Library Items & Full-Year Load View

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read docs/pablo_design_system_reference.md — refresh on chart tokens, DataCard, component patterns
4. Read this ENTIRE brief before writing a single line of code
5. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** After completing each part, you MUST open the application in a real browser and visually confirm it works. Take screenshots. Report what you actually see. Check browser DevTools console for red errors. If anything is broken, fix it before committing.

---

## Context

Chris has done a full walkthrough of the tool and identified bugs, UI gaps, and missing functionality. This brief addresses all of those issues plus adds custom library item creation and a full-year zoomable load profile view.

**Bugs to fix:**
- Energy Flows (Sankey) tab showing "layout error, missing undefined"
- Carbon trajectory showing zero for baseline — carbon factors not being applied
- Envelope data not persisting to DB — Fabric Analysis tab empty after page refresh
- Scenario selector in Results Dashboard only updates CRREM tab, not Overview/Balance/Profiles/Fabric tabs

**UI gaps:**
- No infiltration rate input anywhere in the UI
- Heat recovery slider visible/editable when MEV selected (should be hidden or locked)
- Lighting power density minimum is 4 W/m² (should be 0)
- No ventilation schedule in profiles
- Load profiles only show heating, cooling, lighting, equipment — missing ventilation fan energy and DHW
- No fuel-type toggle (electricity vs gas) on load profiles and results
- No way to create custom constructions or systems from the library

**New features:**
- Custom library item creation for constructions and systems
- Full-year zoomable load profile view (8760 hours with brush/zoom)
- Lighting presets (LED, fluorescent, etc.)

14 parts. Do them in order.

---

## PART 1: Fix Energy Flows Sankey layout error

**File(s):** `frontend/src/components/modules/results/EnergyFlowsTab.jsx`

The Sankey diagram is showing "layout error, missing undefined" when trying to render. This is likely caused by:
- A node or link referencing a name that doesn't exist in the nodes array
- A link with a zero or undefined value causing the d3-sankey layout algorithm to fail
- Missing data in the simulation results that the Sankey component expects

Steps:
1. Open browser DevTools → Console while on the Energy Flows tab — read the full error
2. Check the simulation results object: are all the fields the Sankey component expects present? (annual_energy, envelope_detailed, etc.)
3. Add defensive handling: filter out any links with zero/undefined/NaN values before passing to d3-sankey. Filter out nodes that have no connections.
4. If a required data field is missing from the results, show a graceful message ("Run a new simulation to see energy flows") instead of crashing

**Commit message:** "Part 1: Fix Sankey diagram layout error — defensive data handling"

**Verify:**
1. Open `http://127.0.0.1:5176`, run a simulation, navigate to Results → Energy Flows
2. **SCREENSHOT:** The Sankey diagram should render without errors, showing energy flows from sources through systems to end uses
3. If the diagram was already working on some runs but not others, test with both a fresh simulation and with results loaded from the database (refresh the page)
4. Open browser DevTools → Console — zero red errors on the Energy Flows tab
5. Report: "Sankey diagram rendering correctly. Issue was [describe root cause]. [X] nodes, [X] links displayed. No console errors."

---

## PART 2: Fix carbon trajectory showing zero

**File(s):** `frontend/src/components/modules/results/CRREMTab.jsx`, potentially `nza_engine/parsers/sql_parser.py`

The carbon trajectory chart shows zero for the baseline building. Investigate and fix.

The carbon calculation requires knowing how much energy is electricity and how much is gas. With ideal loads mode, EnergyPlus treats everything as a perfect electric system — there's no gas consumption in the model. However, the building DOES have gas-fired DHW and potentially gas heating, so the carbon calculation should account for the systems configuration.

Two approaches (choose the more practical one):

**Approach A — Use systems config to infer fuel split:**
Read the project's systems configuration. If `dhw_primary` is a gas boiler, assume DHW energy is gas. If HVAC is VRF, heating and cooling are electric. Lighting and equipment are always electric. Apply:
- Electricity: `electricity_kWh × grid_carbon_intensity[year]`
- Gas: `gas_kWh × 0.183` (kgCO₂/kWh, relatively constant)
- Total carbon = sum / GIA → kgCO₂/m²

**Approach B — EnergyPlus fuel reporting:**
Check whether the EnergyPlus output distinguishes fuel types in the end-use breakdown. The `TabularDataWithStrings` table may have "End Uses By Subcategory" broken down by fuel (Electricity, Natural Gas). If available, use these directly.

Whichever approach is used, the carbon trajectory line should show a declining curve (grid decarbonisation reduces the electricity component) that is meaningfully above zero.

**Commit message:** "Part 2: Fix carbon trajectory — apply fuel-split carbon factors"

**Verify:**
1. Run a simulation, navigate to Results → CRREM & Carbon
2. **SCREENSHOT:** The carbon trajectory chart should now show a non-zero declining line for the building, plotted against the CRREM carbon pathway
3. **DATA CHECK:** The 2026 carbon intensity should be plausible for a UK hotel — roughly 15-60 kgCO₂/m² depending on EUI and fuel mix. It should NOT be zero.
4. The carbon trajectory should decline over time (grid decarbonisation) even though energy use is constant
5. DataCards should show non-zero carbon values
6. Open browser DevTools → Console — zero red errors
7. Report: "Carbon trajectory now showing [X] kgCO₂/m² for 2026, declining to [X] kgCO₂/m² by 2060. Fuel split method used: [A or B]. Electricity assumed for [heating/cooling/lighting/equipment], gas assumed for [DHW/other]. Carbon stranding year: [XXXX]. No console errors."

---

## PART 3: Fix envelope data persistence

**File(s):** `api/routers/projects.py` or `api/routers/scenarios.py`

The Fabric Analysis tab shows empty after a page refresh because the basic `envelope` summary isn't persisted to the database — only `envelope_detailed` is stored.

Fix: when storing simulation results in the `simulation_runs` table, also store the basic `envelope` data. Update the `_row_to_sim_run` function to include it when loading results. Alternatively, if `envelope_detailed` contains all the information the Fabric Analysis tab needs, update the tab to use `envelope_detailed` instead of `envelope`.

**Commit message:** "Part 3: Fix envelope data persistence — Fabric Analysis survives page refresh"

**Verify:**
1. Run a simulation
2. Navigate to Results → Fabric Analysis — confirm it shows the heat loss chart
3. **PERSISTENCE TEST:** Refresh the browser (Cmd+R)
4. Navigate back to Results → Fabric Analysis — it should STILL show the chart, NOT empty state
5. **SCREENSHOT:** Fabric Analysis tab showing data after a page refresh
6. Report: "Fabric Analysis now persists through page refresh. Fix: [describe what was changed]. Heat loss chart shows [X] elements after refresh."

---

## PART 4: Fix scenario selector for all Results tabs

**File(s):** `frontend/src/components/modules/results/ResultsDashboard.jsx`, potentially update `OverviewTab.jsx`, `EnergyBalanceTab.jsx`, `LoadProfilesTab.jsx`, `FabricAnalysisTab.jsx`

Currently the scenario dropdown in the Results sidebar only affects the CRREM tab. When you select a different scenario, the Overview, Energy Balance, Load Profiles, and Fabric Analysis tabs still show the project's latest simulation (from SimulationContext), not the selected scenario's results.

Fix: when a scenario is selected in the dropdown, ALL tabs should display that scenario's results. Options:

**Option A (cleanest):** Pass the active results data as a prop to each tab component. When a scenario is selected, use `scenarioResults[selectedScenarioId]` instead of the SimulationContext results. Each tab reads from the prop instead of directly from SimulationContext.

**Option B:** Override the SimulationContext results when a scenario is selected. This is messier but requires fewer changes to individual tabs.

Use Option A — it's more explicit and doesn't pollute the SimulationContext.

Each tab component should accept an optional `results` prop. If provided, use it. If not, fall back to SimulationContext (for when viewing from the main Results Dashboard without scenarios).

**Commit message:** "Part 4: Scenario selector updates all Results tabs, not just CRREM"

**Verify:**
1. Ensure at least 2 scenarios have different simulation results
2. Navigate to Results Dashboard
3. Select a scenario from the dropdown
4. **INTERACT:** Check each tab:
   - Overview: DataCards should show the selected scenario's EUI and metrics
   - Energy Balance: monthly bars should reflect the selected scenario's data
   - Load Profiles: hourly profile should change
   - Fabric Analysis: heat loss bars should differ
   - CRREM: should still work as before
5. Switch back to "Project (latest run)" — all tabs should revert to the project's latest simulation
6. **SCREENSHOT:** Overview tab showing a different EUI after switching scenario
7. Open browser DevTools → Console — zero red errors
8. Report: "All Results tabs now respond to scenario selector. Tested switching between Baseline (EUI [X]) and Enhanced Fabric (EUI [X]) — Overview, Energy Balance, Load Profiles, Fabric Analysis, and CRREM all updated. No console errors."

---

## PART 5: Add infiltration rate input

**File(s):** `frontend/src/components/modules/building/FabricTab.jsx`, update `frontend/src/context/ProjectContext.jsx`

Add an infiltration rate input to the Fabric tab — it belongs with fabric because infiltration is a measure of build quality and airtightness.

Add to the ProjectContext building params:
```js
infiltration_ach: 0.5  // default: 0.5 air changes per hour
```

Add to the Fabric tab sidebar, below the construction selectors:

**Infiltration Rate section:**
- Label: "Air Permeability"
- Slider: range 0.1 to 2.0 ACH, step 0.05
- Show the current value as a number next to the slider
- Below the slider, show contextual guidance:
  - < 0.3 ACH: "Very airtight (Passivhaus level)" — green text
  - 0.3–0.6 ACH: "Good (modern construction)" — green text
  - 0.6–1.0 ACH: "Average (typical existing building)" — amber text
  - > 1.0 ACH: "Leaky (poor airtightness)" — red text

Ensure the infiltration value flows through to the simulation: update the assembler to read `infiltration_ach` from the building config instead of using the hardcoded 0.5 default. Also update the projects API building endpoint to accept and persist it.

**Commit message:** "Part 5: Infiltration rate input on Fabric tab with airtightness guidance"

**Verify:**
1. Navigate to /building → Fabric tab
2. **SCREENSHOT:** The infiltration slider should be visible below the construction selectors, showing 0.5 ACH with "Good (modern construction)" guidance
3. **INTERACT:** Drag to 1.5 ACH — guidance should change to "Leaky (poor airtightness)" in red
4. **INTERACT:** Drag to 0.2 ACH — guidance should change to "Very airtight (Passivhaus level)" in green
5. **PERSISTENCE:** Refresh the page — infiltration value should persist
6. **SIMULATION TEST:** Set infiltration to 1.5 ACH, run simulation. Note the heating demand. Set to 0.2 ACH, run again. Heating demand should decrease significantly (less heat lost through air leakage). If it doesn't change, the value isn't feeding through to the assembler.
7. Report: "Infiltration input working. Slider range 0.1–2.0 ACH with contextual guidance. Persists through refresh. Simulation impact tested: at 1.5 ACH, heating = [X] kWh; at 0.2 ACH, heating = [X] kWh. Difference confirms infiltration feeds through to engine."

---

## PART 6: Fix heat recovery visibility and LPD range

**File(s):** `frontend/src/components/modules/systems/VentilationTab.jsx`, `frontend/src/components/modules/systems/LightingTab.jsx`

**6a — Heat recovery slider:**
When MEV (mechanical extract ventilation) is selected, the heat recovery efficiency field should be hidden or shown as a locked zero with a note: "Heat recovery not available with extract-only ventilation." Only show it as editable when MVHR is selected.

**6b — Lighting power density range:**
Change the LPD slider minimum from 4 to 0 W/m². A building with 100% daylight and no artificial lighting should be expressible (even if unrealistic, it's a useful boundary test).

Add lighting preset buttons above the slider:
- **LED Modern:** 4 W/m² (click sets slider to 4)
- **LED Standard:** 7 W/m² (click sets slider to 7)
- **Fluorescent:** 11 W/m² (click sets slider to 11)
- **Incandescent:** 18 W/m² (click sets slider to 18, extend max if needed)

Active preset button should be highlighted. If the slider is at a value that doesn't match any preset, no preset is highlighted.

**Commit message:** "Part 6: Hide heat recovery for MEV, fix LPD range, add lighting presets"

**Verify:**
1. Navigate to /systems → Ventilation tab
2. Select MEV — heat recovery should be hidden or locked at 0 with an explanation
3. Select MVHR — heat recovery should appear as editable, defaulting to 85%
4. **SCREENSHOT 1:** Ventilation tab with MEV selected (no heat recovery visible)
5. Navigate to /systems → Lighting tab
6. Drag LPD slider to 0 — it should allow it
7. Click "LED Modern" preset — slider should jump to 4 W/m², button highlighted
8. Click "Fluorescent" — slider jumps to 11, button highlighted
9. Drag slider to 6 — no preset highlighted (it's between LED Modern and LED Standard)
10. **SCREENSHOT 2:** Lighting tab with preset buttons and slider
11. Report: "Heat recovery hidden for MEV, editable for MVHR. LPD range now 0–[max]. Presets working: LED Modern (4), LED Standard (7), Fluorescent (11), Incandescent (18). No console errors."

---

## PART 7: Add ventilation schedule to profiles

**File(s):** `nza_engine/library/schedules.py`, `api/db/database.py`

Add ventilation operating schedules to the schedule library:

- `hotel_ventilation_continuous` — Runs 24/7 at full rate (fraction 1.0 all hours). Common for centralised extract systems.
- `hotel_ventilation_occupied` — Runs at full rate during occupied hours (6am–11pm: 1.0), reduced rate overnight (11pm–6am: 0.3). Better for energy but may not meet building regs.
- `hotel_ventilation_timer` — Fixed timer: 7am–10pm at 1.0, 10pm–7am at 0.5. Typical for simple time-clock controls.

Each schedule should have `schedule_type: "ventilation"` in its config.

Seed these into the library via `init_db()`.

Update the assembler: if a ventilation schedule is assigned via `schedule_assignments`, use it for the `ZoneVentilation` objects' schedule. Currently ventilation runs continuously — this should be overridable.

**Commit message:** "Part 7: Ventilation schedules added to library and wired to assembler"

**Verify:**
1. Restart the backend (to seed new schedules)
2. Navigate to /profiles — filter by "Ventilation" type. Three new schedules should appear.
3. Click on "hotel_ventilation_occupied" — the day profile should show 1.0 during the day, 0.3 overnight
4. **SCREENSHOT:** Ventilation schedule profile in the Profiles editor
5. Assign the occupied ventilation schedule to the project
6. Run a simulation — ventilation energy should be lower than with continuous operation (if the previous default was continuous)
7. Report: "Three ventilation schedules added. Assigned 'occupied' schedule — ventilation fan energy [changed/unchanged] from previous run. Profiles editor shows correct day/night pattern."

---

## PART 8: Expand load profile end uses and add fuel toggle

**File(s):** `nza_engine/parsers/sql_parser.py`, `frontend/src/components/modules/results/LoadProfilesTab.jsx`

**8a — Add missing end uses to hourly profiles:**

Update `get_typical_day_profiles()` and `get_hourly_profiles()` in the SQL parser to include:
- Fan energy (from `Fan Electricity Energy` or equivalent EnergyPlus output)
- Pump energy (from pump output variables)
- DHW energy (from water heater output variables)
- Ventilation heat loss/gain (from `Zone Ventilation Sensible Heat Loss Energy`)

If any of these variables aren't available in the EnergyPlus output (because the output variables weren't requested), add them to the assembler's output variable requests. Note that a new simulation run will be needed.

**8b — Fuel type toggle on Load Profiles tab:**

Add a toggle or button group at the top of the Load Profiles tab: **"All Energy" | "Electricity" | "Gas"**

- **All Energy:** Shows all end uses stacked (current behaviour)
- **Electricity:** Shows only electrically-powered end uses (lighting, equipment, VRF heating/cooling, fans, pumps)
- **Gas:** Shows only gas-powered end uses (DHW if gas boiler, heating if gas boiler)

In ideal loads mode, everything is effectively electric, so the Gas view will be empty (or show only DHW if we're inferring gas from the systems config). Show a note: "Ideal loads mode — all energy treated as electric. Switch to detailed HVAC for fuel-specific analysis."

Update the chart legend to show the newly added end uses:
- Fans: `#8B5CF6` (fan-purple)
- DHW: `#F97316` (dhw-orange)
- Ventilation loss: `#06B6D4` (ventilation-cyan)

**Commit message:** "Part 8: Expanded load profile end uses (fans, DHW, ventilation) and fuel toggle"

**Verify:**
1. Run a NEW simulation (the assembler may have new output variable requests)
2. Navigate to Results → Load Profiles
3. **SCREENSHOT 1:** The stacked area chart should now show more end uses than before — fans, DHW visible as additional coloured areas
4. **INTERACT:** Hover on the chart — tooltips should list all end uses including the new ones
5. **INTERACT:** Click "Electricity" toggle — the chart should filter to only electric end uses
6. **INTERACT:** Click "Gas" toggle — should show DHW only (or empty with a note about ideal loads mode)
7. **INTERACT:** Click "All Energy" — should return to the full view
8. Check the legend — all end uses should be listed with correct colours
9. Report: "Load profiles now show [X] end uses (added fans, DHW, ventilation). Fuel toggle working: Electricity shows [X] end uses, Gas shows [X] (or empty with ideal loads note). New output variables added — required fresh simulation. No console errors."

---

## PART 9: Custom construction creation

**File(s):** `frontend/src/components/modules/LibraryBrowser.jsx`, `frontend/src/components/modules/library/ConstructionEditor.jsx` (new)

Add the ability to create custom constructions from the Library Browser.

**Two creation methods:**

**Method 1 — Quick U-value:**
A simple form: name, element type (wall/roof/floor/glazing), target U-value. The tool generates a generic buildup that achieves approximately that U-value (e.g. for a wall: brick + variable insulation thickness + block + plasterboard, where insulation thickness is calculated to hit the target U-value). This is the fast path for feasibility.

The U-value to insulation thickness calculation:
- For a wall with fixed layers (brick outer: R=0.12, cavity: R=0.18, block inner: R=0.13, plasterboard: R=0.06, surface resistances: R=0.17):
- Total R excluding insulation ≈ 0.66 m²K/W
- Required insulation R = (1/U_target) - 0.66
- Insulation thickness = R_insulation × conductivity (e.g. mineral wool at 0.035 W/mK)
- So for U=0.18: R_ins = (1/0.18) - 0.66 = 4.90, thickness = 4.90 × 0.035 = 0.171m ≈ 175mm

Implement this calculation for each element type (wall, roof, floor) with appropriate fixed layer assumptions. For glazing, just store the U-value and g-value directly (no layer buildup needed — use `WindowMaterial:SimpleGlazingSystem`).

**Method 2 — Duplicate and edit:**
Select an existing construction, click "Duplicate", give it a new name, then modify individual layer thicknesses or swap materials. The U-value recalculates automatically. This is the detailed path.

**ConstructionEditor.jsx:**
- Name input
- Element type selector (wall, roof, floor, glazing)
- For wall/roof/floor:
  - Visual layer stack (same as the Fabric tab buildup diagram)
  - Each layer: material name, thickness (mm), conductivity (W/mK), density (kg/m³)
  - Calculated U-value shown prominently, updating in real time as layers change
  - "Add Layer" and "Remove Layer" buttons
- For glazing:
  - U-value input (W/m²K)
  - g-value input (solar transmittance, 0-1)
- "Save to Library" button — POST to `/api/library`

From the Library Browser, add a "New Construction" button (and a "Duplicate" button on each construction card) that opens this editor.

**Commit message:** "Part 9: Custom construction creation with quick U-value and layer editor"

**Verify:**
1. Navigate to /library
2. **INTERACT:** Click "New Construction" (or however the creation flow is triggered)
3. Select "Wall", enter name "Test Custom Wall", enter target U-value 0.15
4. **SCREENSHOT 1:** The editor should show a generated buildup with insulation thickness calculated to achieve approximately U=0.15. The calculated U-value should be close to 0.15 (within ±0.01).
5. **INTERACT:** Adjust the insulation thickness manually — the U-value should recalculate in real time
6. Click "Save to Library"
7. Navigate back to /library — the custom construction should appear with a "Custom" badge
8. Navigate to /building → Fabric tab — the custom construction should appear in the wall dropdown
9. Select it — the U-value should display as ~0.15
10. **INTERACT:** Go back to /library, find an existing construction, click "Duplicate". Rename it, change a layer thickness, save. Should create a second custom item.
11. **CLEANUP:** Delete both test items from the library
12. Report: "Custom construction creation working. Quick U-value method: entered 0.15, generated buildup with [X]mm insulation, calculated U=[X]. Layer editor: manual thickness adjustment recalculates U-value in real time. Duplicate existing construction working. Custom items appear in Fabric tab dropdown. Deletion working."

---

## PART 10: Custom system creation

**File(s):** `frontend/src/components/modules/library/SystemEditor.jsx` (new), update `frontend/src/components/modules/LibraryBrowser.jsx`

Similar to constructions, allow creating custom HVAC system templates from the Library Browser.

**SystemEditor.jsx:**
- Name input
- System type selector (VRF, ASHP, Gas Boiler, MEV, MVHR, Natural Ventilation)
- Based on type, show relevant parameter inputs:
  - VRF: Heating COP, Cooling EER, Fan Power (W/m²)
  - ASHP: Heating COP, Hot Water Setpoint
  - Gas Boiler: Efficiency (%)
  - MEV: Specific Fan Power (W/(l/s))
  - MVHR: Specific Fan Power, Heat Recovery Efficiency (%)
  - Natural Ventilation: Opening Threshold Temp, Max Opening Fraction
- Each parameter has a sensible default and a plausible range
- "Save to Library" button

Add "New System" and "Duplicate" buttons in the Library Browser for system items.

**Commit message:** "Part 10: Custom system template creation with parameter editor"

**Verify:**
1. Navigate to /library
2. **INTERACT:** Create a new system: type "VRF", name "High Efficiency VRF", COP 4.5, EER 4.0
3. **SCREENSHOT:** The system editor with parameters filled in
4. Save to library — should appear in the library list
5. Navigate to /systems → HVAC tab — the custom system should appear in the dropdown
6. Select it — COP should display as 4.5
7. **INTERACT:** Duplicate an existing system, modify the COP, save as a new item
8. Delete both test items
9. Report: "Custom system creation working. Created VRF with COP 4.5, appeared in Systems dropdown. Duplicate and edit working. Deletion working."

---

## PART 11: Full-year zoomable load profile view

**File(s):** `frontend/src/components/modules/results/LoadProfilesTab.jsx` or new `FullYearProfileView.jsx`

Add a full-year view to the Load Profiles tab — a second view mode alongside the existing typical-day view.

Add a toggle: **"Typical Day" | "Full Year"**

**Full Year view:**

Fetch the full 8760-hour dataset from `GET /api/simulate/{run_id}/hourly` (or the project-based equivalent).

**Main chart:** A Recharts AreaChart showing the full year of hourly data.
- X axis: date/time (Jan 1 → Dec 31), with month labels
- Y axis: Power (kW)
- Stacked areas per end use (same colours as typical day view)
- This will be a large dataset (8760+ points × multiple series). For performance:
  - Downsample to daily averages for the initial view
  - Use Recharts' `Brush` component at the bottom to allow zooming into specific date ranges
  - When zoomed in to a 1-2 week range, switch to hourly resolution

**Brush/zoom interaction:**
- A small overview chart at the bottom (like Pablo's approach) showing the full year in miniature
- Drag handles to select a date range
- The main chart zooms to show that range in detail
- Show the selected date range as text: "Showing: 15 Jan — 21 Jan 2026"

**Below the chart:**
- DataCards for the visible range: peak demand, average demand, total energy for the selected period, load factor

This is the view that lets you zoom into a specific cold week and see exactly how the building responds hour by hour.

**Commit message:** "Part 11: Full-year zoomable load profile with brush navigation"

**Verify:**
1. Run a simulation
2. Navigate to Results → Load Profiles → toggle to "Full Year"
3. **SCREENSHOT 1:** The full-year chart should show 12 months of data with seasonal patterns visible (more heating in winter, more cooling in summer)
4. **INTERACT:** Drag the brush handles to zoom into January — the main chart should show daily/hourly detail for that month
5. **INTERACT:** Zoom into a single week — hourly resolution should be visible with clear diurnal patterns
6. **SCREENSHOT 2:** Zoomed into a winter week showing hourly heating/cooling patterns
7. **DATA CHECK:** The DataCards should update for the selected range. Peak demand for a winter week should be higher than for a summer week.
8. **PERFORMANCE CHECK:** Does the chart render smoothly? Any lag when zooming? If performance is poor with 8760 points, confirm downsampling is working.
9. Open browser DevTools → Console — zero red errors
10. Report: "Full-year view rendering with [daily/hourly] resolution. Brush zoom working — tested January week: peak [X] kW, average [X] kW. Seasonal pattern visible (heating dominant in winter). Performance: [smooth / some lag]. No console errors."

---

## PART 12: Deduplicate shared constants

**File(s):** `frontend/src/data/chartTokens.js`, update `frontend/src/components/modules/scenarios/ComparisonView.jsx`, update `frontend/src/components/modules/results/CRREMTab.jsx`

Move the `SCENARIO_COLORS` array (currently duplicated in ComparisonView.jsx and CRREMTab.jsx) to `chartTokens.js` alongside the other shared chart constants. Import from there in both components.

Also add the building simulation colour tokens to `chartTokens.js` if they aren't already there:
```js
export const ENDUSE_COLORS = {
  heating:      '#DC2626',
  cooling:      '#3B82F6',
  lighting:     '#F59E0B',
  equipment:    '#64748B',
  fans:         '#8B5CF6',
  dhw:          '#F97316',
  ventilation:  '#06B6D4',
  infiltration: '#9E9E9E',
}

export const SCENARIO_COLORS = [
  '#2B2A4C', '#00AEEF', '#E84393', '#ECB01F', '#16A34A', '#8B5CF6',
]

export const FABRIC_COLORS = {
  wall:         '#A1887F',
  glazing:      '#4FC3F7',
  roof:         '#78909C',
  floor:        '#795548',
  infiltration: '#9E9E9E',
  ventilation:  '#06B6D4',
}
```

Update all components that hardcode these colours to import from chartTokens.js instead.

**Commit message:** "Part 12: Centralise colour constants in chartTokens.js"

**Verify:**
1. Open the app and navigate through all Results tabs — colours should be identical to before (no visual change)
2. Check Scenario comparison charts — same colours
3. Check CRREM chart — same scenario line colours
4. `grep -r "SCENARIO_COLORS" frontend/src/` should show only chartTokens.js as the definition, everywhere else as imports
5. Report: "Colour constants centralised. SCENARIO_COLORS, ENDUSE_COLORS, FABRIC_COLORS all in chartTokens.js. [X] files updated to import instead of hardcode. No visual changes — all colours match previous behaviour."

---

## PART 13: Polish pass — small UI improvements

**File(s):** Various

A collection of small improvements:

**13a.** On the Fabric tab, show the current infiltration rate in the summary cards alongside U-values. Something like: "Air Permeability: 0.5 ACH (Good)"

**13b.** On the Results Overview, add a small "Building Summary" card at the top showing: GIA, floor count, orientation, weather file name. This grounds the results in the physical building and serves as a sanity check.

**13c.** On the Sankey diagram, add a title showing the scenario name and total annual energy: "Energy Flows — Baseline (201.9 MWh/yr)"

**13d.** In the Scenario Manager comparison view, add a "best performer" badge on the scenario with the lowest EUI in the ranking chart.

**13e.** On the Home page, if no simulation has been run, show a clear step-by-step getting started guide: "1. Define your building geometry → 2. Select fabric constructions → 3. Configure systems → 4. Run simulation → 5. View results". Each step should link to the relevant page.

**Commit message:** "Part 13: UI polish — summary cards, Sankey title, best performer badge, getting started guide"

**Verify:**
1. Navigate through each changed area and confirm the improvements are visible
2. **SCREENSHOT 1:** Fabric tab with infiltration in the summary
3. **SCREENSHOT 2:** Results Overview with building summary card
4. **SCREENSHOT 3:** Sankey diagram with title showing scenario name and total energy
5. **SCREENSHOT 4:** Comparison view with "best performer" badge
6. **SCREENSHOT 5:** Home page with getting started guide (for a project with no simulations)
7. Report: "Polish items complete. Infiltration shown on Fabric summary. Building summary on Results Overview. Sankey title with scenario name and energy total. Best performer badge in comparison. Getting started guide on Home page."

---

## PART 14: Full integration test

Run a complete end-to-end test:

1. Start fresh or use existing Bridgewater project
2. Navigate to /building → Fabric: set infiltration to 0.7 ACH, confirm guidance shows "Average"
3. Navigate to /systems → Lighting: click "LED Modern" preset (4 W/m²), confirm slider updates
4. Navigate to /systems → Ventilation: select MEV, confirm heat recovery hidden. Select MVHR, confirm heat recovery appears.
5. Navigate to /profiles → filter "Ventilation" — assign "Occupied" schedule to project
6. Navigate to /library → create a custom wall construction with target U=0.12
7. Navigate to /building → Fabric → select the custom wall
8. Run simulation
9. Navigate to Results → check ALL tabs:
   - Overview: building summary card visible, metrics populated
   - Energy Flows: Sankey renders with title
   - Energy Balance: monthly chart
   - Load Profiles: typical day with all end uses including fans/DHW. Toggle to Full Year — zoom into a winter week. Toggle fuel type.
   - Fabric Analysis: persistent after refresh
   - CRREM: carbon trajectory non-zero
10. Navigate to /scenarios → create "Custom Fabric" scenario, assign the custom wall
11. Run All scenarios
12. Compare view → confirm best performer badge, input differences table
13. CRREM → confirm multi-scenario overlay

**SCREENSHOTS:** Overview, Sankey with title, Full Year zoomed, Fabric Analysis, CRREM with non-zero carbon, Comparison with best performer badge.

**Commit message:** "Part 14: Full integration test — all bug fixes, UI gaps, and new features verified"

**Verify — report:**
- All bugs fixed (Sankey, carbon, envelope persistence, scenario selector)
- All UI gaps closed (infiltration, heat recovery, LPD, ventilation schedule, expanded end uses, fuel toggle)
- Custom constructions and systems creation working
- Full-year zoom working
- Browser console: zero red errors across entire walkthrough

---

## After all 14 parts are complete

Update STATUS.md with:
- All 14 parts completed
- Bugs fixed (list each with confirmation)
- UI gaps closed (list each)
- New features added (custom library items, full-year view, fuel toggle)
- Known issues
- Suggestions for Brief 07 (detailed HVAC with COP curves, report export to PowerPoint, EV charging, future weather files)

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 06 complete. All bugs fixed — Sankey renders, carbon non-zero, envelope persists, scenario selector works across all tabs. Custom construction and system creation working. Full-year zoomable load profile with brush navigation. Fuel toggle on load profiles. [X] UI improvements. Full walkthrough clean — zero console errors."
