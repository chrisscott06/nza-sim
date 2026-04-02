# Brief 03: Bug Fixes, Data Gaps, Sankey Diagram & Systems Module

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read docs/briefs/00_project_brief.md — sections 5 (Input Modules), 6 (Results & Visualisation — especially 6.1 Sankey and 6.4 Systems Performance), and 7 (Sanity Checks)
4. Read docs/pablo_design_system_reference.md — refresh on chart tokens and component patterns
5. Read this ENTIRE brief before writing a single line of code
6. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES — READ THIS BEFORE EVERY PART

**Browser verification is mandatory.** After completing each part, you MUST open the application in a real browser and visually confirm it works. Do not verify through code review, terminal output, or API calls alone. The browser shows what the user actually sees — if you haven't seen it in the browser, it is not verified.

**For every part, the verification step requires you to:**
1. Ensure both servers are running (backend on 8002, frontend on 5176)
2. Open `http://127.0.0.1:5176` in the browser
3. Navigate to the relevant page/tab
4. Perform the specific checks listed in the Verify section
5. Take a screenshot of the working result
6. Report what you see — describe the actual visual state, not what you expect to see
7. If ANYTHING looks wrong, broken, or missing — fix it before committing. Do not commit broken UI.

**What counts as broken:**
- Blank white page or error screen
- Components that render but show no data when data should be present
- Charts with no bars/lines/areas when simulation results exist
- 3D viewer that shows a black box or doesn't render the building
- Buttons that don't respond to clicks
- Layout that overflows, overlaps, or has broken scroll
- Console errors (check the browser console — red errors must be resolved)

**If the dev server won't start or the browser shows errors:**
Fix that FIRST. No part is complete until the full application loads in the browser and the specific verification checks pass visually.

---

## Context

Brief 02 built the frontend: React app shell, Building Definition module with 3D viewer, Run Simulation button, and Results Dashboard with four tabs. Most things work. There are three known issues to fix, then we're adding the Sankey energy flow diagram and the Systems & Zones module.

**Known issues from Brief 02:**
1. Fabric tab crashes to white screen (likely component error when fetching/rendering constructions)
2. Load Profiles tab shows empty state because `hourly_profiles` isn't in the API response
3. Solar gain output variable returning 0 from EnergyPlus (reported in Brief 01)

This brief: fix all three bugs, build the Sankey diagram, and build the Systems & Zones module.

12 parts. Do them in order.

---

## PART 1: Fix Fabric tab white screen crash

**File(s):** `frontend/src/components/modules/building/FabricTab.jsx` and any related files

Investigate and fix the Fabric tab crash. The tab currently shows a white screen when navigated to. Likely causes:
- API call to `/api/library/constructions` failing or returning unexpected data shape
- Missing error boundary or try/catch around the data fetching
- Component trying to access a property on undefined data

Steps:
1. Open the browser, navigate to /building, click the Fabric tab
2. Open browser DevTools → Console — read the error message. It will tell you exactly what's crashing.
3. Fix the root cause. Also add defensive checks: if the API call fails or returns empty, show a graceful message ("Unable to load constructions — check backend is running") instead of crashing.
4. Ensure the Fabric tab loads constructions from the API and displays them as dropdowns with U-values, as specified in Brief 02 Part 4.

**Commit message:** "Part 1: Fix Fabric tab white screen crash"

**Verify:**
1. Start both servers
2. Open `http://127.0.0.1:5176` in browser
3. Navigate to /building → click the Geometry tab first, confirm it still works (no regression)
4. Click the Fabric tab
5. **SCREENSHOT:** The Fabric tab should render without crashing. It should show dropdown selectors for External Wall, Roof, Ground Floor, and Glazing. Each should be populated with options from the construction library.
6. **INTERACT:** Select a different wall construction (e.g. change from "cavity_wall_standard" to "cavity_wall_enhanced"). The displayed U-value should update.
7. **INTERACT:** Select a different glazing type. The U-value should change.
8. Click back to Geometry tab — confirm it still works. Click to Fabric tab again — should load instantly without crashing.
9. **ERROR TEST:** Stop the backend API. Refresh the page and navigate to Fabric tab. It should show a graceful error message, NOT a white screen crash.
10. Restart the backend.
11. Open browser DevTools → Console — zero red errors during normal operation
12. Report: "Fabric tab now renders correctly. Tested construction selection for walls (U-value changed from [X] to [Y]) and glazing. Tab switching works without crashes. Graceful error state tested with backend stopped. No console errors."

---

## PART 2: Fix solar gains output variable

**File(s):** `nza_engine/generators/epjson_assembler.py`, `nza_engine/parsers/sql_parser.py`

The solar gains output variable is returning 0 from EnergyPlus. Investigate and fix.

Common causes in EnergyPlus 25.2:
- Wrong variable name — the exact string must match what EnergyPlus offers. Check the `.rdd` file (Report Data Dictionary) in a previous simulation's output folder. It lists every available output variable with the exact name.
- The variable might be `Zone Windows Total Transmitted Solar Radiation Rate` (rate in W) vs `Zone Windows Total Transmitted Solar Radiation Energy` (energy in J) — make sure we're requesting the right one and converting units correctly.
- The variable might need `Surface Window Transmitted Solar Radiation Rate` at the surface level rather than the zone level.

Steps:
1. Look at the `.rdd` file from a previous simulation run (in `data/simulations/` — find the most recent run folder)
2. Search for "solar" in the `.rdd` file to find the exact available variable names
3. Update the assembler to request the correct variable name(s)
4. Update the SQL parser to read and return solar gain data correctly
5. Re-run the test simulation and confirm solar gains are now non-zero

**Commit message:** "Part 2: Fix solar gains output variable — correct variable name for E+ 25.2"

**Verify:**
1. Run `python scripts/test_simulate.py` from the project root
2. Check the printed results — solar gains should now be a non-zero positive number
3. The value should be plausible: for a 3,600 m² hotel with 25% WWR, annual solar gains through glazing might be roughly 50,000-200,000 kWh depending on weather file and g-value
4. Open the browser, run a simulation via the UI, navigate to Results → Overview — if solar gains feed into any of the displayed metrics, confirm they've changed from the previous zero value
5. Report: "Solar gains now reporting [X] kWh annually. Variable name corrected to [exact name]. Value is plausible for building size and glazing area."

---

## PART 3: Add hourly profile data to backend API

**File(s):** `nza_engine/parsers/sql_parser.py`, `api/routers/simulate.py`

Add hourly profile data extraction so the Load Profiles tab can show real simulation data.

In `sql_parser.py`, add a new function `get_hourly_profiles(sql_path)` that:
1. Queries the EnergyPlus SQLite output for hourly values of key variables:
   - Heating energy (from IdealLoads or zone heating)
   - Cooling energy
   - Lighting electricity
   - Equipment electricity
   - Solar gains (now fixed in Part 2)
2. Returns a structured dict:
   ```python
   {
     "hours": [0, 1, 2, ..., 8759],
     "heating_kwh": [float, float, ...],    # 8760 values
     "cooling_kwh": [float, float, ...],
     "lighting_kwh": [float, float, ...],
     "equipment_kwh": [float, float, ...],
     "solar_gains_kwh": [float, float, ...],
   }
   ```
3. Also provide a helper function `get_typical_day_profiles(sql_path)` that extracts representative 24-hour profiles for:
   - Peak heating day (the day with highest total heating demand)
   - Peak cooling day
   - Typical winter day (average of December-February weekdays)
   - Typical summer day (average of June-August weekdays)
   
   Each returns 24 hourly values per end use.

In `api/routers/simulate.py`, include `hourly_profiles` (the typical day profiles, not the full 8760 — that's too large for a single API response) in the simulation results response. Also add a new endpoint:

**GET /api/simulate/{run_id}/hourly** — Returns the full 8760-hour dataset for detailed analysis (used later for heatmaps and carpet plots).

**Commit message:** "Part 3: Hourly profile extraction from EnergyPlus SQL output"

**Verify:**
1. Run `python scripts/test_simulate.py` — confirm it still works and now also prints a summary of the hourly data: "Hourly data: 8760 rows, peak heating hour: [X] kWh, peak cooling hour: [X] kWh"
2. Start the backend API
3. Run a simulation via curl or the UI
4. Hit the new endpoint: `curl http://127.0.0.1:8002/api/simulate/{run_id}/hourly | python3 -m json.tool | head -50` — confirm it returns JSON with arrays of 8760 values
5. Check the typical day profiles are included in the main simulation response: `curl http://127.0.0.1:8002/api/simulate/{run_id} | python3 -m json.tool | grep -A5 "hourly_profiles"`
6. Report: "Hourly data extraction working. 8760 values per variable. Peak heating hour: [X] kWh at hour [Y]. Typical day profiles: peak heating day average demand [X] kW, peak cooling day average demand [X] kW. New /hourly endpoint returns full dataset."

---

## PART 4: Wire hourly profiles to Load Profiles tab

**File(s):** `frontend/src/components/modules/results/LoadProfilesTab.jsx`

Update the Load Profiles tab to use the real hourly profile data from the API response instead of showing an empty state.

The tab should now:
1. Read `hourly_profiles` from the simulation results (the typical day profiles)
2. Show the day-type selector buttons: "Peak Heating Day", "Peak Cooling Day", "Typical Winter", "Typical Summer"
3. When a day type is selected, display its 24-hour profile as a stacked area chart
4. Default to "Peak Heating Day" on first load

The stacked area chart:
- X axis: Hour (0-23), labelled as "00:00", "01:00", etc.
- Y axis: Power (kW)
- Stacked areas: Heating (heating-red), Cooling (cooling-blue), Lighting (lighting-amber), Equipment (equipment-slate)
- Smooth curves (`type="monotone"`)
- Use Pablo's chart tokens for axes, grid, tooltip
- Tooltip shows hour and per-end-use breakdown

Below the chart, show DataCards:
- Peak demand (kW) for the selected day type
- Average demand (kW)
- Load factor (average / peak)
- Demand at midnight vs demand at midday (to show the diurnal swing)

**Commit message:** "Part 4: Load Profiles tab wired to real hourly simulation data"

**Verify:**
1. Ensure a simulation has been run (if not, run one first)
2. Navigate to /results → Load Profiles tab
3. **SCREENSHOT 1:** The tab should now show a stacked area chart with real data (not empty state). Default view should be "Peak Heating Day."
4. **INTERACT:** Click "Peak Cooling Day" — the chart shape should change noticeably (more cooling, less heating)
5. **INTERACT:** Click "Typical Winter" and "Typical Summer" — each should show a different profile shape
6. **INTERACT:** Hover on the chart at different hours — tooltip should show hour and per-end-use values in kW
7. **DATA CHECK:** Do the profiles make intuitive sense? For a hotel: heating higher at night/early morning (cold, occupied), lighting higher in evening hours, equipment relatively constant. If the profile is flat or all zeros for an end use, investigate.
8. **DATA CHECK:** The DataCards below should show sensible values. Load factor should be between 0.2 and 0.8 for a hotel. Peak should be higher than average.
9. Open browser DevTools → Console — zero red errors
10. Report: "Load Profiles tab now shows real simulation data. Tested all 4 day types — profiles change shape when switching. Peak Heating Day: peak [X] kW at [hour], average [X] kW, load factor [X]. Profiles show [sensible/questionable] diurnal patterns. Tooltip working. No console errors."

---

## PART 5: Enhance envelope heat flow data for Fabric Analysis

**File(s):** `nza_engine/parsers/sql_parser.py`, `nza_engine/generators/epjson_assembler.py`

Improve the `get_envelope_heat_flow()` function to provide richer data for the Fabric Analysis tab and the upcoming Sankey diagram.

The function should return:
```python
{
  "walls": {
    "north": {"area_m2": float, "u_value": float, "annual_heat_loss_kwh": float, "annual_heat_gain_kwh": float},
    "south": {"area_m2": float, "u_value": float, "annual_heat_loss_kwh": float, "annual_heat_gain_kwh": float},
    "east": {...},
    "west": {...}
  },
  "glazing": {
    "north": {"area_m2": float, "u_value": float, "annual_heat_loss_kwh": float, "solar_gain_kwh": float},
    "south": {...},
    "east": {...},
    "west": {...}
  },
  "roof": {"area_m2": float, "u_value": float, "annual_heat_loss_kwh": float, "annual_heat_gain_kwh": float},
  "ground_floor": {"area_m2": float, "u_value": float, "annual_heat_loss_kwh": float},
  "infiltration": {"annual_heat_loss_kwh": float, "annual_heat_gain_kwh": float},
  "ventilation": {"annual_heat_loss_kwh": float, "annual_heat_gain_kwh": float}
}
```

To get per-surface heat flow data, you may need to add additional `Output:Variable` requests in the assembler:
- `Surface Inside Face Conduction Heat Transfer Energy` — per surface
- `Zone Infiltration Sensible Heat Loss Energy` and `Zone Infiltration Sensible Heat Gain Energy`

If per-surface data isn't available from the SQL for this simulation (because the output variables weren't requested in earlier runs), add them to the assembler and note that a new simulation run is needed.

Also include this data in the API response under `envelope_heat_flow`.

**Commit message:** "Part 5: Enhanced envelope heat flow data with per-facade breakdown"

**Verify:**
1. Run a NEW simulation (the assembler may have new output variable requests)
2. Run `python scripts/test_simulate.py` — confirm envelope heat flow data is printed with per-facade breakdown
3. Check the numbers: south-facing glazing should have the highest solar gains. North walls should have the highest conduction heat loss (no solar offset). Total infiltration should be a significant fraction of total heat loss.
4. Start the API and run a simulation via curl — confirm `envelope_heat_flow` is in the response with the full structure
5. Report: "Envelope heat flow data now includes per-facade breakdown. South glazing solar gain: [X] kWh (highest). North wall heat loss: [X] kWh. Total infiltration loss: [X] kWh ([X]% of total heating demand). New output variables added to assembler — required fresh simulation run."

---

## PART 6: Update Fabric Analysis tab with per-facade data

**File(s):** `frontend/src/components/modules/results/FabricAnalysisTab.jsx`

Update the Fabric Analysis tab to use the enriched envelope data from Part 5.

**Horizontal bar chart** — now with per-facade breakdown:
- North walls (warm brown)
- South walls (warm brown, slightly lighter)
- East walls (warm brown, slightly lighter again)
- West walls (warm brown, lightest)
- North glazing (light blue)
- South glazing (light blue, slightly different shade)
- East glazing
- West glazing
- Roof (grey)
- Ground floor (dark brown)
- Infiltration (grey)
- Ventilation (cyan)

Bars show annual heat loss in kWh. Sort by magnitude (largest at top).

**Add a second chart below:** Solar Gains by Facade
- Vertical bar chart (Recharts BarChart)
- 4 bars: North, South, East, West
- Bar height = annual solar gain through glazing on that facade
- Colours: graduated warm yellows (light for north, warm amber for south) — use the solar gain colours from the project brief
- This immediately shows which facades are contributing most solar gain

**DataCards below the charts:**
- Total fabric heat loss (kWh)
- Total solar gains (kWh)
- Net fabric balance (loss minus gains)
- Worst-performing element (name + kWh)
- Best solar facade (name + kWh gained)

**Commit message:** "Part 6: Fabric Analysis tab with per-facade heat loss and solar gains charts"

**Verify:**
1. Ensure a simulation has been run with the updated backend (from Part 5)
2. Navigate to /results → Fabric Analysis tab
3. **SCREENSHOT 1:** The horizontal bar chart should show ~12 elements sorted by heat loss magnitude. Each bar should be colour-coded by type.
4. **SCREENSHOT 2:** Below it, the Solar Gains by Facade chart should show 4 bars. South should typically be the tallest (most solar gain).
5. **INTERACT:** Hover on bars in both charts — tooltips should show element name and kWh value
6. **DATA CHECK:** Does the sort order make sense? The largest heat loss elements should be at the top. Is infiltration significant? How does glazing heat loss compare to wall heat loss?
7. **DATA CHECK:** DataCards should show total fabric loss, total solar gains, and the net balance. The worst-performing element should be plausible.
8. Open browser DevTools → Console — zero red errors
9. Report: "Fabric Analysis tab now shows per-facade breakdown. [X] elements displayed, sorted by magnitude. Largest heat loss: [element] at [X] kWh. Solar gains chart shows south facade highest at [X] kWh. Total fabric loss: [X] kWh, total solar gains: [X] kWh, net: [X] kWh. No console errors."

---

## PART 7: Sankey energy flow diagram

**File(s):** `frontend/src/components/modules/results/SankeyTab.jsx` or add to OverviewTab, `frontend/src/components/charts/EnergySankey.jsx`

This is the hero visualisation. Build a Sankey energy flow diagram using D3-sankey (install `d3-sankey` and `d3` if not already installed: `npm install d3 d3-sankey`).

Add a new tab to the Results Dashboard: insert "Energy Flows" as the second tab (after Overview, before Energy Balance).

**The Sankey diagram shows the full energy story of the building:**

**Left side — Energy inputs (sources):**
- Gas input (deep red: `#991B1B`) — if gas systems exist. For now with ideal loads, this may be electricity only.
- Electricity from grid (gold: `#ECB01F`)
- Solar gains — total through glazing (light warm yellow: `#FFF176`)
- Internal gains — combined occupancy + equipment + lighting heat (warm orange: `#FB923C`)

**Middle — Transformation/systems:**
- Heating system node (the heating demand is met by the input energy, with conversion efficiency visible from the width difference between input and output)
- Cooling system node
- Lighting node
- Equipment node

**Right side — Where energy goes (end uses and losses):**
- Useful heating delivered
- Useful cooling delivered
- Lighting (electricity consumed)
- Equipment (electricity consumed)
- Fabric losses — walls (combined or per-facade if space allows)
- Fabric losses — glazing
- Fabric losses — roof
- Fabric losses — floor
- Infiltration losses
- Ventilation losses

**Visual specification:**
- Nodes: rounded rectangles, coloured by category
- Links: smooth curved paths with width proportional to energy flow (kWh)
- Colours: links take the colour of their source node with reduced opacity (0.4)
- Layout: left-to-right flow, ~800px wide minimum
- Padding between nodes: enough to read labels

**Interaction:**
- Hover on any link: highlight the link, show a tooltip with "Source → Target: XX,XXX kWh (XX%)"
- Hover on any node: highlight all connected links, show node total
- The diagram should be responsive — resize with the container

**Data assembly:**
Build the Sankey data from the simulation results. You need:
- `energy_by_enduse` — for the end-use totals
- `envelope_heat_flow` — for the fabric losses
- The total energy input equals the sum of all end uses plus losses

The nodes and links should be computed from the results data, not hardcoded. If a value is zero (e.g. no gas if using ideal loads), omit that node.

**Commit message:** "Part 7: Sankey energy flow diagram with hover interaction"

**Verify:**
1. Ensure a simulation has been run
2. Navigate to /results → click the "Energy Flows" tab (should be the second tab)
3. **SCREENSHOT 1:** The full Sankey diagram should be visible, flowing left to right. Energy sources on the left, end uses and losses on the right. Links should have varying widths proportional to energy flow.
4. **VISUAL CHECK:** Does it look like a proper Sankey diagram? Are the link widths proportional? (The thickest link should be the largest energy flow.) Are the colours distinct and readable? Is it beautiful enough to show a client?
5. **INTERACT:** Hover on the largest link — tooltip should show source, target, kWh value, and percentage of total
6. **INTERACT:** Hover on a node — all connected links should highlight
7. **DATA CHECK:** Do the flows make physical sense? Energy in (left side) should approximately equal energy out (right side) — conservation of energy. The fabric losses should match what the Fabric Analysis tab shows. The end-use totals should match the Overview donut chart.
8. **EDGE CASE:** If any flow is zero or near-zero, it should either be hidden or shown as a very thin line — not break the layout.
9. Open browser DevTools → Console — zero red errors
10. Report: "Sankey diagram renders with [X] nodes and [X] links. Largest flow: [source] → [target] at [X] kWh. Energy balance: inputs [X] kWh, outputs [X] kWh, difference [X] kWh ([X]%). Hover interaction works — tooltips show values and percentages. Visual quality: [assessment]. No console errors."

---

## PART 8: Systems & Zones module — data model and backend

**File(s):** `nza_engine/library/systems.py`, `nza_engine/generators/epjson_assembler.py`, `api/routers/library.py`

Create the HVAC system template library and update the assembler to support real system definitions beyond IdealLoadsAirSystem.

**`nza_engine/library/systems.py`** — Define system templates:

**VRF System (for hotel bedrooms):**
```python
{
    "name": "vrf_standard",
    "display_name": "VRF System — Standard",
    "type": "vrf",
    "description": "Variable Refrigerant Flow split system",
    "heating_cop": 3.5,
    "cooling_eer": 3.2,
    "fan_power_w_per_m2": 3.0,
    "min_outdoor_temp_heating": -15.0,
    "defrost_strategy": "reverse_cycle",
}
```

**Air Source Heat Pump (for DHW preheat):**
```python
{
    "name": "ashp_dhw",
    "display_name": "ASHP — DHW Preheat",
    "type": "ashp",
    "description": "Air source heat pump for domestic hot water pre-heating",
    "heating_cop": 2.8,
    "hot_water_setpoint": 55.0,
    "preheat_setpoint": 45.0,
}
```

**Gas Boiler (for DHW backup):**
```python
{
    "name": "gas_boiler_standard",
    "display_name": "Gas Boiler — Standard",
    "type": "gas_boiler",
    "description": "Condensing gas boiler",
    "efficiency": 0.92,
}
```

**Mechanical Extract Ventilation:**
```python
{
    "name": "mev_standard",
    "display_name": "Mechanical Extract Ventilation",
    "type": "mev",
    "description": "Centralised extract with trickle vent supply",
    "specific_fan_power": 1.5,  # W/(l/s)
    "heat_recovery_efficiency": 0.0,  # No recovery on extract-only
}
```

**MVHR (for future comparison):**
```python
{
    "name": "mvhr_standard",
    "display_name": "MVHR System",
    "type": "mvhr",
    "description": "Mechanical ventilation with heat recovery",
    "specific_fan_power": 1.8,
    "heat_recovery_efficiency": 0.85,
}
```

**Natural Ventilation (window opening):**
```python
{
    "name": "natural_vent_windows",
    "display_name": "Natural Ventilation — Opening Windows",
    "type": "natural_ventilation",
    "description": "Openable windows with temperature-based control",
    "opening_threshold_temp": 22.0,  # degrees C indoor temp to start opening
    "max_opening_fraction": 0.5,
}
```

Update the epJSON assembler to accept a `systems` parameter that specifies which system template to use for each zone group. For V1, support two modes:
- `"ideal"` — keep using IdealLoadsAirSystem (quick, shows pure building demand)
- `"detailed"` — use the real system objects (VRF for bedrooms, gas boiler + ASHP for DHW, MEV for ventilation)

The detailed mode should generate the appropriate EnergyPlus HVAC objects. For VRF, use `AirConditioner:VariableRefrigerantFlow` and `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow`. For the gas boiler and ASHP, use `WaterHeater:Mixed` with a `HeatPump:WaterHeater` preheat. For ventilation, use `ZoneVentilation:DesignFlowRate` with appropriate schedules.

**Note:** Getting detailed HVAC right in EnergyPlus epJSON is complex. If the full detailed system objects prove too difficult to get running without errors in this part, implement a "simplified detailed" mode that uses `HVACTemplate:Zone:VRF` and `HVACTemplate:System:VRF` instead — these are less flexible but much easier to get working. Document which approach was used.

Add a new API endpoint: **GET /api/library/systems** — returns the list of available system templates.

**Commit message:** "Part 8: HVAC system template library and assembler integration"

**Verify:**
1. Run `python -c "from nza_engine.library.systems import list_systems; print(list_systems())"` — should print all system templates with names and types
2. Run a test simulation with `systems_mode="ideal"` — should still work exactly as before (regression check)
3. Run a test simulation with `systems_mode="detailed"` (or whatever the parameter is called) — this is the critical test:
   - If EnergyPlus completes without fatal errors: great, check the results make sense
   - If EnergyPlus fails: read the `.err` file, identify the issue, fix it. If after 3 attempts the detailed HVAC objects won't work, fall back to HVACTemplate approach and document why.
4. Compare ideal vs detailed results: EUI should be different (detailed systems have real efficiencies, ideal systems are 100% efficient). The detailed EUI should be HIGHER than ideal.
5. Start the API: `curl http://127.0.0.1:8002/api/library/systems` — should return all system templates
6. Report: "System library created with [X] templates. Ideal mode: EUI [X] kWh/m². Detailed mode: [working/fallback used], EUI [X] kWh/m². Difference: [X] kWh/m² ([X]%). HVAC approach used: [native objects / HVACTemplate / simplified]. No fatal errors."

---

## PART 9: Systems & Zones module — frontend

**File(s):** `frontend/src/components/modules/SystemsZones.jsx`, `frontend/src/components/modules/systems/HVACTab.jsx`, `frontend/src/components/modules/systems/VentilationTab.jsx`, `frontend/src/components/modules/systems/DHWTab.jsx`, `frontend/src/components/modules/systems/LightingTab.jsx`, update `frontend/src/context/BuildingContext.jsx`

Build the Systems & Zones module, replacing the placeholder empty state on the /systems route.

**SystemsZones.jsx** — Uses ExplorerLayout. Four tabs: HVAC, Ventilation, DHW, Lighting.

**Update BuildingContext** to include systems configuration:
```js
systems: {
  hvac_type: "vrf_standard",
  ventilation_type: "mev_standard",
  natural_ventilation: true,
  natural_vent_threshold: 22,
  dhw_primary: "gas_boiler_standard",
  dhw_preheat: "ashp_dhw",
  lighting_power_density: 8.0,  // W/m²
  lighting_control: "occupancy_sensing",
  pump_type: "variable_speed",
  pump_power: 0.5,  // kW
}
```

**HVACTab.jsx** — ExplorerLayout sidebar contains:
- **System type selector:** Dropdown populated from `/api/library/systems` (filtered to type "vrf", "ashp", "gas_boiler")
- When a system is selected, show its parameters:
  - COP / EER (display, and allow override via number input)
  - Fan power (W/m²)
  - Description text
- **Simulation mode toggle:** "Ideal Loads" vs "Detailed Systems" — this maps to the backend `systems_mode` parameter. Show a note: "Ideal Loads shows pure building demand. Detailed Systems includes real system efficiencies."

Main content area: show a system schematic or summary diagram. For now, a simple visual showing the system type name, COP, and a basic flow: "Electricity → VRF → Heated/Cooled air". Can be a simple styled HTML layout rather than a chart.

**VentilationTab.jsx** — sidebar:
- Mechanical ventilation type: dropdown (MEV, MVHR)
- Specific fan power (W/(l/s)) — number input
- Heat recovery efficiency (%) — slider, disabled for MEV (0%), enabled for MVHR
- Natural ventilation toggle: on/off
- If natural vent is on: window opening threshold temperature (°C) — slider (18-28°C)
- A note: "Natural ventilation interacts with cooling — open windows add ventilation heat loss but reduce mechanical cooling demand"

**DHWTab.jsx** — sidebar:
- Primary DHW system: dropdown (gas boiler)
- Preheat system: dropdown (ASHP, none)
- Hot water setpoint (°C) — number input
- Preheat setpoint (°C) — number input (only if ASHP preheat selected)
- Daily demand (litres/bedroom) — number input with default for hotel

**LightingTab.jsx** — sidebar:
- Lighting power density (W/m²) — number input or slider (range 4-15 W/m²)
- Control type: dropdown (Manual, Occupancy Sensing, Daylight Dimming, Occupancy + Daylight)
- A simple visual showing the estimated annual lighting energy based on LPD × GIA × operating hours

**Commit message:** "Part 9: Systems & Zones frontend module with HVAC, Ventilation, DHW, Lighting tabs"

**Verify:**
1. Open `http://127.0.0.1:5176` and click the Systems icon in the sidebar (previously showed empty state)
2. **SCREENSHOT 1:** The Systems module should render with 4 tabs. HVAC tab should be active, showing the system type dropdown and parameters.
3. **INTERACT — HVAC:** Select the VRF system from the dropdown. COP and EER values should display. Change the COP value — it should update in the context.
4. **INTERACT — Ventilation:** Click the Ventilation tab. Toggle natural ventilation on. The threshold temperature slider should appear. Toggle off — slider should hide.
5. **INTERACT — DHW:** Click the DHW tab. Select ASHP preheat. The preheat setpoint input should appear. Select "none" for preheat — it should hide.
6. **INTERACT — Lighting:** Click the Lighting tab. Change LPD from 8 to 12 W/m². The estimated annual energy should increase.
7. **SCREENSHOT 2:** The Ventilation tab with natural ventilation toggled on, showing the threshold slider.
8. Navigate to /building — confirm it still works (no regression). Navigate back to /systems — confirm it still shows the last state.
9. Open browser DevTools → Console — zero red errors
10. Report: "Systems module renders with 4 functional tabs. HVAC: system selection and COP override working. Ventilation: MEV/MVHR selection, natural vent toggle with threshold slider. DHW: primary + preheat selection with conditional inputs. Lighting: LPD input with estimated energy. All inputs update context. No console errors."

---

## PART 10: Wire systems to simulation

**File(s):** `frontend/src/context/SimulationContext.jsx`, `api/routers/simulate.py`

Update the simulation flow to include systems configuration:

1. When "Run Simulation" is clicked, the `SimulationContext` should now send BOTH building params AND systems params to the API
2. Update the POST `/api/simulate` endpoint to accept the systems configuration
3. The assembler should use the systems config to determine whether to use ideal loads or detailed systems

The API request body should now look like:
```json
{
  "building": { ... },
  "constructions": { ... },
  "systems": {
    "mode": "ideal",
    "hvac_type": "vrf_standard",
    "ventilation_type": "mev_standard",
    "natural_ventilation": true,
    "natural_vent_threshold": 22,
    "dhw_primary": "gas_boiler_standard",
    "dhw_preheat": "ashp_dhw",
    "lighting_power_density": 8.0,
    "lighting_control": "occupancy_sensing"
  },
  "weather_file": "USE_DEFAULT"
}
```

For now, even if detailed mode isn't fully working, the systems params should be stored and the relevant values (like lighting power density) should be reflected in the simulation. At minimum, changing LPD should change the lighting energy in the results.

**Commit message:** "Part 10: Systems configuration wired to simulation API"

**Verify:**
1. Open the browser, navigate to /systems → Lighting tab
2. Set LPD to 15 W/m² (higher than default 8)
3. Click "Run Simulation"
4. Navigate to Results → Overview — the annual lighting energy should be higher than with default LPD
5. Navigate to /systems → Lighting tab, set LPD to 4 W/m² (very low)
6. Run simulation again
7. Check Results → Overview — lighting energy should be noticeably lower
8. **DATA CHECK:** The lighting energy change should be roughly proportional to the LPD change (15/8 ≈ 1.9x increase, 4/8 ≈ 0.5x decrease)
9. **SCREENSHOT:** Results Overview after the high-LPD run, showing the different lighting energy value
10. Open browser DevTools → Console — zero red errors
11. Report: "Systems config now included in simulation request. Tested LPD impact: at 15 W/m², lighting energy = [X] kWh; at 4 W/m², lighting energy = [X] kWh. Ratio: [X] (expected ~3.75x). Systems mode sent as [ideal/detailed]. No console errors."

---

## PART 11: Natural ventilation impact on results

**File(s):** `nza_engine/generators/epjson_assembler.py`, potentially `nza_engine/library/schedules.py`

This is a key Bridgewater question: what happens when guests open windows while VRF cooling is running?

Update the assembler so that when `natural_ventilation: true`, it adds `ZoneVentilation:WindAndStackOpenArea` objects to bedroom zones. This EnergyPlus object models ventilation through openable windows based on indoor/outdoor temperature difference and wind conditions.

Parameters to use from the systems config:
- `natural_vent_threshold` → the indoor temperature above which windows open
- Opening area: derive from window area × max opening fraction (default 50%)
- Schedule: only during occupied hours (use the bedroom occupancy schedule)
- Wind coefficient and stack coefficient: use EnergyPlus defaults

This means:
- When indoor temp > threshold AND the zone is occupied → windows open → additional ventilation
- In winter: this increases heat loss (guests opening windows with heating on)
- In summer: this could reduce cooling demand OR increase it if outdoor temp is high
- The interaction with VRF cooling is automatically handled by EnergyPlus — if windows are open and cooling is on, the cooling system works harder

**Commit message:** "Part 11: Natural ventilation via openable windows in bedroom zones"

**Verify:**
1. Run TWO simulations:
   - Simulation A: natural_ventilation = false
   - Simulation B: natural_ventilation = true, threshold = 22°C
2. Compare the results:
   - Heating demand: should INCREASE with natural vent (more heat loss through open windows)
   - Cooling demand: could go either way depending on weather
   - Ventilation heat loss: should INCREASE with natural vent
   - EUI: should be different
3. Print both sets of results side by side
4. If the results are IDENTICAL, the natural ventilation objects aren't working — check the `.err` file and the epJSON to confirm the objects are present
5. Report: "Natural ventilation impact tested. Without nat vent: EUI [X] kWh/m², heating [X] kWh, cooling [X] kWh. With nat vent: EUI [X] kWh/m², heating [X] kWh, cooling [X] kWh. Heating increased by [X]% with windows open. Ventilation heat loss increased by [X] kWh. EnergyPlus handled window opening via ZoneVentilation:WindAndStackOpenArea."

---

## PART 12: Full integration test and polish

**File(s):** Various — fix any issues found during testing

Run a complete end-to-end test of the entire application:

1. Start fresh: both servers running, open browser
2. Navigate to /building → Geometry tab: set Bridgewater parameters (60×15, 4 floors, 3.2m height, 0° orientation, 25% WWR all facades)
3. Fabric tab: select cavity_wall_standard, flat_roof_standard, ground_floor_slab, double_low_e — confirm no crashes
4. Navigate to /systems → HVAC: select VRF. Ventilation: MEV with natural vent ON, threshold 22°C. DHW: gas boiler + ASHP preheat. Lighting: 8 W/m², occupancy sensing.
5. Click Run Simulation — wait for completion
6. Navigate to /results:
   - Overview: all metrics populated, donut chart renders, sanity checks show traffic lights
   - Energy Flows: Sankey diagram renders with correct flows
   - Energy Balance: monthly stacked bars render
   - Load Profiles: hourly data renders with day-type selector working
   - Fabric Analysis: per-facade heat loss and solar gains charts render

Fix any issues found. Then:

7. Change ONE parameter: set wall construction to cavity_wall_enhanced (better U-value)
8. Run simulation again
9. Check Results: heating demand should DECREASE compared to the first run. The Sankey diagram should show thinner wall heat loss flows. The Fabric Analysis should show lower wall heat loss.

If this parameter change doesn't produce a visible difference in results, something is wrong with how the construction choice feeds through to the simulation.

**Commit message:** "Part 12: Full integration test and polish — all modules verified end-to-end"

**Verify — FULL WALKTHROUGH:**
1. Sidebar: all 6 icons clickable, correct routes
2. Building Definition: all 3 tabs functional, 3D viewer interactive, summary cards update live
3. Systems: all 4 tabs functional, inputs save to context
4. Run Simulation: button state transitions work (idle → running → complete)
5. Results Overview: 5 DataCards, donut chart, sanity checks — all populated
6. Results Energy Flows: Sankey diagram with hover interaction
7. Results Energy Balance: 12-month stacked bar with tooltips
8. Results Load Profiles: hourly chart with day-type selector
9. Results Fabric Analysis: per-facade heat loss bars + solar gains bars
10. Placeholder pages (Profiles, Scenarios): show empty states, not crashes
11. **SCREENSHOT 1:** Building Definition with 3D viewer showing Bridgewater
12. **SCREENSHOT 2:** Systems HVAC tab with VRF selected
13. **SCREENSHOT 3:** Results Overview with all metrics
14. **SCREENSHOT 4:** Sankey energy flow diagram
15. **SCREENSHOT 5:** Fabric Analysis with per-facade breakdown
16. Browser DevTools → Console: zero red errors across entire walkthrough
17. Report the FULL set of Bridgewater simulation results: EUI, annual energy, heating demand, cooling demand, lighting, equipment, peak heating load, peak cooling load, unmet hours.

---

## After all 12 parts are complete

Update STATUS.md with:
- All 12 parts completed
- Bridgewater Hotel simulation results (full metrics)
- Comparison: ideal loads EUI vs detailed systems EUI (if both working)
- Comparison: with vs without natural ventilation
- The full list of working routes and features
- Visual quality assessment across all views
- Known issues
- Suggestions for Brief 04 (what's next: Profiles editor, Scenario manager, CRREM trajectory, carbon tracking, report export)

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 03 complete. Three bugs fixed, Sankey diagram built, Systems module working. Open http://127.0.0.1:5176 with both servers running. Key finding: natural ventilation [increases/decreases] heating demand by [X]% for Bridgewater. Full walkthrough screenshots taken."
