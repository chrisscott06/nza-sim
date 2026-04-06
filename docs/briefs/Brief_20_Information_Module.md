# Brief 20: Navigation Restructure — Information Module, Weather Fixes, Executive Summary

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Combined verification allowed.

---

## Context

The navigation needs restructuring. Currently occupancy, location, and climate data are on the Building page alongside fabric and geometry. These are project-level metadata, not building fabric inputs. They should live in a dedicated "Information" module that acts as the project's executive summary.

Also: the postcode weather resolver returns 404 because `data/weather/uk_stations.json` doesn't exist (script was created but never run), and no UK EPW files are in `data/weather/` yet.

**New navigation order:**
1. **Home** — project selector (existing landing page)
2. **Information** (new) — project overview, location, occupancy, energy data, CRREM summary
3. **Building** — geometry and fabric only (occupancy and location removed)
4. **Systems** — as is
5. **Profiles** — as is
6. **Consumption** — as is
7. **Results** — as is
8. **Scenarios** — as is

8 parts.

---

## PART 1: Create Information module — project overview page

**File(s):** `frontend/src/components/modules/InformationModule.jsx` (new), update `frontend/src/App.jsx`, update `frontend/src/components/layout/Sidebar.jsx`

Create a new `/information` route that serves as the project's executive summary and metadata hub.

**Sidebar:** Add an "Info" icon (lucide `Info` or `ClipboardList`) between Home and Building. Module accent colour: navy (`#2B2A4C`) or a warm charcoal.

**Layout:** Single-column scrollable page (NOT three-column — this is a read/edit overview, not a workspace).

**Sections:**

**1. Project Header:**
- Project name (large, editable)
- Building type badge: "Hotel"
- Address: "Market Way, North Petherton, TA6 6DF" (editable)
- Operator: "Zeal Hotels" (editable)

**2. Location & Climate** (moved from Building module):
- Postcode input with "Find nearest station" button
- Map showing building location (small inline map if available)
- Current weather file: dropdown selector (current climate files)
- Future weather file: dropdown (PROMETHEUS files)
- Weather station distance: "Yeovilton — 12 km from site"
- Location mismatch warning if applicable

**3. Building Summary** (read-only, calculated from Building module):
- GIA: 4,221 m²
- Floors: 5
- Dimensions: 63m × 13.4m
- Rooms: 134
- Envelope area, glazing area, volume

**4. Occupancy:**
- Number of rooms: 134 (editable)
- People per room: 1.5 (default, shown as read-only here with note: "Adjust in Profiles module")
- Occupancy rate: 75% (editable slider)
- Derived: average occupants (134 × 0.75 × 1.5 = 150.75), occupancy density (150.75 / 4,221 = 0.036 p/m²)
- Note: "Number of rooms" and "occupancy rate" are editable here. "People per room" defaults to 1.5 and is adjustable in the Profiles module (where the user can explore how different occupancy densities affect schedules and energy demand).
- These inputs feed into the instant calc and EnergyPlus — changing them here updates the energy model

**5. Energy Data — Annual Consumption Input:**

A simple inline form for entering annual consumption by fuel type. No HH uploader here — just totals.

```
ENERGY DATA
─────────────────────────────────────────────
Year: [2025 ▾]  [Add Year]

Electricity:  [572,447 ] kWh    
Gas:          [207,686 ] kWh    
+ Add fuel (Oil / LPG / Biomass / District Heat)

GIA:          4,221 m² (from geometry)
─────────────────────────────────────────────
Total:        780,133 kWh
EUI:          185.1 kWh/m²
Status:       ✅ ALIGNED (10.4 kWh/m² headroom)
─────────────────────────────────────────────
```

**Multi-year:** Click "Add Year" to add another row. Each year is saved independently. The CRREM trajectory plots all years.

**Pre-populated from Bridgewater data:**
| Year | Electricity | Gas | Total | EUI |
|------|------------|-----|-------|-----|
| 2022 | 600,700 | 129,391 | 730,091 | 173.2 |
| 2023 | 578,585 | 262,155 | 840,740 | 199.5 |
| 2024 | 546,128 | 202,801 | 748,929 | 177.7 |
| 2025 | 572,447 | 207,686 | 780,133 | 185.1 |

**Additional fuel types:** Clicking "+ Add fuel" shows a dropdown (Oil, LPG, Biomass, District Heating) and an input field. The carbon calculation uses the appropriate factor per fuel.

**Note:** The HH data uploader in the Consumption module stays as-is but is NOT linked from here. When monthly or HH data is ready, that will be a separate workflow. For now, annual totals are sufficient for CRREM tracking and performance gap analysis.

**6. CRREM Executive Summary:**
Two charts stacked vertically:

**EUI Trajectory:**
- CRREM 1.5°C pathway (green shaded area below = compliant zone)
- Actual EUI dots (2022-2025) connected by red line
- Modelled EUI line (from latest simulation)
- **Stranding indicator:** Where the actual trend line crosses the CRREM pathway. Mark with a red vertical line and label: "Projected stranding: 2027" (extrapolate from the actual data trend)
- If already stranded: red banner "STRANDED since [year]"
- If compliant: green banner "ALIGNED — [X] kWh/m² headroom"

**Carbon Trajectory:**
- Same layout but for kgCO₂e/m²
- Actual carbon dots
- CRREM carbon pathway

**7. Data Completeness Checklist** (moved from project dashboard):
- ✅ / ⬜ for each data item with links to the relevant module

**8. Quick Actions:**
- "Edit Fabric →" → /building
- "Edit Systems →" → /systems
- "Upload Energy Data →" → /consumption
- "Run Simulation →" triggers simulation
- "Compare Scenarios →" → /scenarios
- "Export Report →" (future — disabled for now)

---

## PART 2: Remove occupancy and location from Building module

**File(s):** `frontend/src/components/modules/building/BuildingDefinition.jsx`

Remove these sections from the Building module left panel:
- **Location & Climate** section (postcode, weather file dropdowns) — moved to Information
- **Occupancy** section (bedrooms, occupancy rate, people per room) — moved to Information

The Building module left panel should now contain ONLY:
1. Geometry (name, length, width, floors, floor height, orientation)
2. Glazing (WWR per facade, window count per facade)
3. Fabric (construction selections, U-values)
4. Airtightness (infiltration rate)

This makes the Building module purely about the physical building envelope — geometry and thermal properties. Occupancy and climate are project-level settings that belong in Information.

**The data still lives in ProjectContext** — the inputs just move to a different page. The instant calc and EnergyPlus still read from the same `params.num_bedrooms`, `params.occupancy_rate`, `params.location`, etc.

---

## PART 3: Fix weather file resolver — run station index builder

**File(s):** `scripts/build_station_index.py`, `data/weather/uk_stations.json`

The postcode resolver fails because `uk_stations.json` doesn't exist. Fix:

1. Run `python scripts/build_station_index.py` to generate the index
2. If the script fails (e.g. can't download station data from climate.onebuilding.org), check the error and fix
3. The index must be committed to the repo (it's static data, not generated at runtime)
4. After the index exists, the `/api/weather/nearest?postcode=TA6+6DF` endpoint should work

**Also check:** The `postcodes.io` URL format. The 404 might be because the postcode needs to be URL-encoded differently. The current code uses `clean = postcode.strip().replace(" ", "+")` but postcodes.io expects the format `https://api.postcodes.io/postcodes/TA6 6DF` (with space) or `https://api.postcodes.io/postcodes/TA66DF` (no space). Test with curl first:
```bash
curl "https://api.postcodes.io/postcodes/TA6+6DF"
curl "https://api.postcodes.io/postcodes/TA6%206DF"
```

Fix the URL encoding if needed.

---

## PART 4: Fix weather file list — include project weather directory

**File(s):** `api/routers/weather.py`

The weather file list endpoint only shows EnergyPlus bundled files. It needs to also scan:
1. `data/weather/current/` — PROMETHEUS control files and any downloaded TMYx files
2. `data/weather/future/` — PROMETHEUS future files
3. Any EPW files placed directly in `data/weather/`

Check the endpoint implementation and ensure it scans ALL weather directories, not just the EnergyPlus bundled path.

If PROMETHEUS files have been unpacked by `setup_weather.py`, they should appear in the dropdown. If they haven't been unpacked yet, run the setup script:
```bash
python scripts/setup_weather.py
```

**Verify:** After fix, the weather dropdown should show Bristol PROMETHEUS files (if unpacked) alongside the EnergyPlus bundled files.

---

## PART 5: CRREM stranding year calculation

**File(s):** `frontend/src/components/modules/InformationModule.jsx`

For the CRREM Executive Summary, calculate the projected stranding year from the actual consumption trend.

**Method:**
1. Take the actual EUI data points (2022-2025)
2. Fit a simple linear trend (least-squares regression)
3. Find where the trend line intersects the CRREM pathway
4. That intersection year is the "projected stranding year"

```js
function projectStrandingYear(actualData, crremPathway) {
  // actualData: [{ year, eui }, ...]
  // crremPathway: { 2020: 264, 2021: 248.6, ..., 2037: 95, ... }
  
  // Linear regression on actual data
  const n = actualData.length
  const sumX = actualData.reduce((s, d) => s + d.year, 0)
  const sumY = actualData.reduce((s, d) => s + d.eui, 0)
  const sumXY = actualData.reduce((s, d) => s + d.year * d.eui, 0)
  const sumX2 = actualData.reduce((s, d) => s + d.year * d.year, 0)
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n
  
  // Project forward and find where trend crosses CRREM
  for (let year = 2025; year <= 2050; year++) {
    const projected_eui = slope * year + intercept
    const crrem_target = crremPathway[year] ?? 95  // plateau at 95
    if (projected_eui > crrem_target) {
      return year
    }
  }
  return null  // never strands (or already stranded)
}
```

**Display:**
- "Projected stranding: **2027**" (large, red if <3 years away, amber if 3-10, green if >10)
- "At current trajectory, the building will exceed the CRREM 1.5°C pathway in 2027"
- "To avoid stranding, EUI must reduce from 185 to below 184 kWh/m² by 2026, and to 95 kWh/m² by 2037"

If the building is ALREADY stranded (current EUI > current year's target):
- "**STRANDED** — current EUI of [X] exceeds the [year] target of [X] kWh/m²"

---

## PART 6: Profiles module — remove zone type references

**File(s):** `frontend/src/components/modules/ProfilesEditor.jsx`

Clean up the Profiles module:
- Remove zone-type filter buttons (Bedroom, Corridor, Reception, Office, Retail) if still present
- Keep schedule-type filters (Occupancy, Lighting, Equipment, Heating, Cooling, DHW, Ventilation)
- Relabel schedules: "Hotel Bedroom — Occupancy" → "Hotel — Occupancy"
- The editor functionality (curve editing, heatmap, save/revert) stays exactly as is

---

## PART 7: Update Home page → Information link

**File(s):** Update `frontend/src/pages/HomePage.jsx`

When the user clicks a project card on the Home page, navigate to `/information` (the new project overview) instead of `/building`.

The N icon in the sidebar navigates to the Home page (project selector). Clicking a project then takes you to Information as the first view.

**Also:** In the sidebar, ensure clicking the Home icon returns to `/` (project selector), NOT to `/information`. The Information module is project-specific — you need to have a project loaded first.

---

## PART 8: Combined verification

1. **Home → click Bridgewater → lands on /information** (not /building)
2. **Information module:** Shows project name, address, location, occupancy, energy data table, CRREM charts (EUI + carbon), stranding year, data checklist
3. **Building module:** NO occupancy section, NO location/climate section. Only geometry, glazing, fabric, airtightness.
4. **Weather:** Postcode resolver works (TA6 6DF → Yeovilton). Weather dropdown shows PROMETHEUS files if unpacked.
5. **CRREM:** Both EUI and carbon trajectories shown. Multi-year actual dots. Stranding year calculated and displayed.
6. **Profiles:** No zone-type filters. Schedule labels cleaned up.
7. **Navigation:** Home → project selector. Info icon → project overview. Building icon → fabric/geometry. All other modules unchanged.
8. **Zero console errors.**

**Commit message:** "Brief 20: Information module with CRREM executive summary, navigation restructure, weather fixes, profiles cleanup"

---

## After verification

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 20 complete. New Information module at /information — project overview with location, occupancy, energy data table, and CRREM executive summary (EUI + carbon trajectories with stranding year projection). Building module now purely fabric and geometry (occupancy and location moved to Information). Weather postcode resolver fixed. Profiles zone filters removed. Home → project selector → Information as the entry point."
