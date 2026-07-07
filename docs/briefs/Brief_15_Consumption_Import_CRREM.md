# Brief 15: Consumption Data Import, Real vs CRREM Visualisation & EUI Gauge Fix

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read this ENTIRE brief before writing a single line of code
4. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** Take screenshots, report actual numbers, check console for errors.

---

## Context

NZA Simulate needs to import real consumption data (half-hourly electricity, monthly gas) and visualise it against CRREM targets. This is the foundation for the performance gap analysis — comparing what the building actually uses against what the decarbonisation pathway requires.

For the Bridgewater Hotel, the real consumption will be dramatically higher than the model (~250+ kWh/m² actual vs ~80 kWh/m² modelled) because the building is operating as an immigrant hotel with much higher occupancy density than standard hotel assumptions.

**Key principle:** The CRREM comparison uses REAL metered data, not model output. The model is a separate tool for exploring "what if we changed X" — but the client's actual position on the CRREM pathway comes from their bills.

This brief also fixes the EUI gauge rendering issue (the horseshoe shape spinning/glitching).

**Pablo reference:** The CSV parser is adapted from Pablo's `ParserEngine.js` which auto-detects wide and long format HH data files. We borrow the parsing logic but simplify the pipeline — no gap-filling cascade, no donor year assembly, just clean import and visualisation.

10 parts. Do them in order.

---

## PART 1: Fix EUI gauge rendering

**File(s):** `frontend/src/components/modules/building/LiveResultsPanel.jsx`

The EUI horseshoe gauge is glitching/spinning. Likely causes:
- The SVG arc path is being recalculated on every render with slightly different float values, causing visual jitter
- The gauge might be animating between old and new values without proper transition damping
- The arc end point calculation might produce NaN or Infinity for edge cases (EUI = 0, or EUI > max)

**Fix:**
1. Round all SVG coordinate calculations to 2 decimal places to prevent sub-pixel jitter
2. Clamp the EUI value: `Math.max(0, Math.min(eui, EUI_MAX))` before computing the arc
3. If using CSS transitions on the arc, ensure the transition property is `d` (path data) not causing reflow
4. Alternatively, simplify to a linear gauge bar instead of an arc if the SVG arc continues to cause issues — a horizontal bar with coloured segments (green/amber/red) is just as effective and easier to render stably

If the arc gauge can be fixed cleanly, keep it. If it remains jittery after the fix attempt, replace with a horizontal bar gauge.

**Also in SystemsLiveResults.jsx** — apply the same fix if the systems EUI gauge has the same issue.

**Commit message:** "Part 1: Fix EUI gauge rendering — stabilise SVG arc or replace with bar gauge"

**Verify:**
1. Navigate to /building
2. The EUI gauge should render cleanly — no spinning, no jittering, no flickering
3. Drag a slider rapidly — the gauge should update smoothly without visual artifacts
4. Check at EUI = 0 (edge case) and EUI > 200 (above max) — should display gracefully
5. Report: "EUI gauge [fixed/replaced with bar]. No jitter. Updates smoothly on slider drag. Edge cases handled."

---

## PART 2: Consumption data model and storage

**File(s):** `api/db/schema.sql`, `api/db/database.py`, `api/routers/consumption.py` (new), `api/main.py`

Create the database schema and API endpoints for storing real consumption data.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS consumption_data (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    fuel_type TEXT NOT NULL,           -- 'electricity' or 'gas'
    meter_id TEXT,                     -- MPAN or MPRN
    interval_minutes INTEGER DEFAULT 30,
    data_start DATE,
    data_end DATE,
    total_kwh REAL,
    record_count INTEGER,
    source_filename TEXT,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS consumption_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consumption_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,           -- ISO format
    kwh REAL,
    quality TEXT DEFAULT 'actual',     -- 'actual', 'estimated', 'missing'
    FOREIGN KEY (consumption_id) REFERENCES consumption_data(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_consumption_project ON consumption_data(project_id);
CREATE INDEX IF NOT EXISTS idx_records_consumption ON consumption_records(consumption_id, timestamp);
```

**API endpoints:**

```
POST /api/projects/{project_id}/consumption/upload
  — Accepts multipart file upload (CSV or Excel)
  — Parses using the adapted ParserEngine
  — Stores records in consumption_records
  — Returns: { id, fuel_type, record_count, total_kwh, date_range }

GET /api/projects/{project_id}/consumption
  — List all consumption datasets for the project
  — Returns: array of consumption_data records with summary stats

GET /api/projects/{project_id}/consumption/{id}/records
  — Returns the actual HH records for a dataset
  — Query params: start_date, end_date (optional filtering)
  — Returns: { records: [{ timestamp, kwh, quality }], summary: { total_kwh, avg_daily } }

GET /api/projects/{project_id}/consumption/{id}/monthly
  — Returns monthly aggregated totals
  — Returns: { monthly: [{ month: '2024-01', kwh: 12345 }, ...] }

GET /api/projects/{project_id}/consumption/{id}/daily
  — Returns daily aggregated totals

DELETE /api/projects/{project_id}/consumption/{id}
  — Delete a consumption dataset
```

**Commit message:** "Part 2: Consumption data schema, storage, and CRUD API endpoints"

**Verify:**
1. Restart backend — tables should be created
2. `sqlite3 data/nza_sim.db ".tables"` — should include `consumption_data` and `consumption_records`
3. Report: "Schema created. API endpoints registered at /api/projects/{pid}/consumption/*."

---

## PART 3: CSV/Excel parser AND gap-filling assembly — adapted from Pablo

**File(s):** `api/parsers/consumption_parser.py` (new), `api/parsers/assembly_engine.py` (new)

Adapt Pablo's full data pipeline into Python server-side modules. This includes BOTH parsing AND gap-filling — a partial year of data with gaps is useless for annual comparison against the model. We need a complete 8,760-hour (or 17,520 half-hour) year.

### 3a — Parser (`consumption_parser.py`)

Port Pablo's `ParserEngine.js` logic:

**Auto-detection:**
- **Wide format:** Date in first column, then 48 time columns (`00:00`, `00:30`, ..., `23:30`). Each row = one day.
- **Long format:** Timestamp column + value column. Each row = one interval.
- Score column headers to find date, energy, and type columns (same scoring logic as Pablo)

**Date parsing:**
- DD/MM/YYYY, YYYY-MM-DD, and ISO formats
- Handle Excel serial date numbers
- Midnight rollover fix

**Output:** Normalised records: `[{ timestamp: ISO, kwh: float, quality: str, source: 'original' }]`

Use `pandas` for the heavy lifting. For CSV: `pd.read_csv()`. For Excel: `pd.read_excel()`.

**Fuel type detection:**
- If filename contains 'elec', 'electric', 'mpan', 'import': → electricity
- If filename contains 'gas', 'mprn': → gas
- If column headers contain 'kWh' with no gas indicators: → electricity
- Otherwise: → 'unknown' (user can override)

### 3b — Assembly engine (`assembly_engine.py`)

Port Pablo's `AssemblyEngine.js` gap-filling cascade. This takes the raw parsed records (which may have gaps, missing days, partial months) and produces a COMPLETE target year of data.

**The cascade — try each method in order for every missing slot:**

1. **Original data** — if we have actual data for this timestamp in the target year, use it
2. **Donor year** — if we have data for the same month/day/time from a different year, use it (with scaling if the target year's month has some data to calibrate against)
3. **Weekday profile average** — if we have data for the same day-of-week and time-of-day in this month from any year, use the average
4. **Interpolation** — if adjacent slots have data, interpolate linearly
5. **Monthly average** — last resort, use the average kWh for this month

**Scaling:** When using donor year data, scale it if the target month has partial real data — calculate the ratio of target month's actual average to donor month's average and apply as a multiplier (clamped 0.5 to 2.0 to prevent wild scaling).

**Provenance tracking:** Every filled record tracks HOW it was filled:
```python
{
    'timestamp': '2024-03-15T14:30:00',
    'kwh': 2.34,
    'quality': 'filled',
    'source': 'filled',
    'fill_method': 'donor-year:2023:scaled:1.12'  # or 'weekday-avg:Wed:n=8' or 'interpolated'
}
```

**Assembly output:**
```python
{
    'records': [...17520 records...],  # complete year, no gaps
    'provenance': {
        'original': 14200,      # actual data points
        'donor_year': 2800,     # filled from other years
        'weekday_fill': 400,    # filled from weekday averages
        'interpolated': 120,    # interpolated across gaps
        'total': 17520,
        'coverage_pct': 81.1    # % original data
    },
    'target_year': 2024,
    'interval_minutes': 30,
    'total_kwh': 891234,
    'annual_eui': 247.6   # if GIA is known
}
```

**This is non-negotiable:** The output MUST be a complete year. If the input data has 60% coverage, we fill the other 40% using the cascade. The provenance tracking tells the user how much is real vs estimated — but they get a usable annual profile regardless.

```python
def parse_consumption_file(file_bytes: bytes, filename: str) -> dict:
    """Parse CSV/Excel → normalised records with auto-detection."""
    
def assemble_complete_year(records: list, target_year: int, interval_minutes: int = 30) -> dict:
    """Gap-fill using donor year / weekday / interpolation cascade → complete year."""
```

**Commit message:** "Part 3: Consumption parser + gap-filling assembly engine — produces complete annual profile"

**Verify:**
1. Create a test CSV with 80% coverage (some missing days, one missing month)
2. Parse and assemble → should produce 17,520 records (complete year at HH)
3. Provenance should show ~80% original, ~20% filled
4. The filled month should have plausible values (scaled from donor data or weekday averages)
5. Total kWh should be reasonable (not wildly different from the partial data extrapolated)
6. Report: "Parser + assembly working. Input: [X] records ([X]% coverage). Output: 17,520 records (complete year). Provenance: [X]% original, [X]% donor, [X]% weekday, [X]% interpolated. Total: [X] MWh."

---

## PART 4: Upload UI component

**File(s):** `frontend/src/components/modules/consumption/ConsumptionUpload.jsx` (new), `frontend/src/components/modules/consumption/ConsumptionManager.jsx` (new)

Create the consumption data upload interface.

**ConsumptionUpload.jsx:**
- Drag-and-drop zone or file picker button
- Accepts .csv, .xlsx, .xls files
- On file select: uploads to `POST /api/projects/{pid}/consumption/upload`
- Shows a progress indicator during upload and parsing
- On success: displays summary (record count, date range, total kWh, detected fuel type)
- Fuel type override dropdown if auto-detection was wrong
- "Confirm Import" button to finalise

**ConsumptionManager.jsx:**
- Lists all imported consumption datasets for the project
- Each dataset shown as a card: fuel type (icon: ⚡ or 🔥), date range, total kWh, record count
- "Upload New" button opens the upload flow
- Delete button per dataset
- Click a dataset to view its details (daily/monthly charts)

**Add to the sidebar navigation:** New icon for "Consumption" or "Metered Data" — positioned between Profiles and Results. Use the module theme colour for this: maybe a data-focused colour like dark cyan or the warm earth from Building (since it's building-specific data).

**Commit message:** "Part 4: Consumption upload UI with drag-drop, auto-detection, and dataset management"

**Verify:**
1. Navigate to the new Consumption page
2. **INTERACT:** Drag a test CSV file onto the drop zone — it should upload, parse, and show summary
3. **SCREENSHOT:** Upload success showing record count, date range, total kWh
4. The dataset should appear in the list below
5. Report: "Upload working. Test file: [X] records, [date range], [X] MWh total. Fuel type detected: [type]. Dataset appears in list."

---

## PART 5: Monthly consumption chart — actual vs CRREM

**File(s):** `frontend/src/components/modules/consumption/MonthlyComparisonChart.jsx` (new)

The primary visualisation: monthly actual consumption plotted against CRREM targets.

**Chart layout** (Recharts ComposedChart):
- X axis: months (Jan 2023 — Dec 2024, or whatever the data covers)
- Y axis: Energy (kWh) on the left, EUI (kWh/m²) on the right
- **Actual consumption bars:** Stacked if both electricity and gas are imported. Electricity in gold, gas in red-orange.
- **CRREM target line:** Monthly CRREM EUI target for the building type × GIA, drawn as a dashed line
- **Annual EUI annotation:** Show the actual annual EUI prominently: "Actual EUI: 247 kWh/m²"
- **CRREM target annotation:** "CRREM 2026 target: 215 kWh/m²"
- **Gap indicator:** The difference between actual and target, shown as a highlighted area or annotation: "Performance gap: 32 kWh/m² (15% above target)"

**Data flow:**
1. Fetch monthly aggregates from `/api/projects/{pid}/consumption/{id}/monthly`
2. Fetch CRREM targets from the library (already available)
3. Calculate: `actual_eui = total_actual_kwh / GIA`
4. Calculate: `crrem_target_eui = CRREM pathway value for the current year`
5. Gap = actual_eui - crrem_target_eui

**Colour coding the gap:**
- If actual < CRREM target: green background/annotation — "Compliant"
- If actual is 0-20% above: amber — "At risk"
- If actual is >20% above: red — "Non-compliant, stranding risk"

**Commit message:** "Part 5: Monthly consumption chart with actual bars and CRREM target line"

**Verify:**
1. Import a consumption dataset (use test data or real data if available)
2. Navigate to the consumption view
3. **SCREENSHOT:** Monthly bars showing consumption, CRREM line, gap annotation
4. **DATA CHECK:** Annual EUI should = total kWh / GIA. CRREM target should match the pathway for the building type and year.
5. Report: "Monthly chart rendering. Actual EUI: [X] kWh/m². CRREM target: [X] kWh/m². Gap: [X] kWh/m² ([X]%). Status: [compliant/at risk/non-compliant]."

---

## PART 6: Daily and half-hourly profile views

**File(s):** `frontend/src/components/modules/consumption/DailyProfileChart.jsx` (new), `frontend/src/components/modules/consumption/HalfHourlyHeatmap.jsx` (new)

Add detailed profile visualisations for the imported consumption data.

**DailyProfileChart.jsx:**
- Recharts AreaChart showing daily total kWh over the full date range
- Colour: gold for electricity, red for gas
- A brush/zoom component (same pattern as the Full Year load profiles view) to zoom into specific weeks/months
- When zoomed to a single week: switch to half-hourly resolution showing the actual HH data
- This lets the user see: weekend vs weekday patterns, seasonal variation, any anomalies

**HalfHourlyHeatmap.jsx:**
- A carpet plot / heatmap showing time-of-day (Y axis, 00:00-23:30) vs date (X axis)
- Cell colour: intensity mapped to kWh (light = low, dark = high)
- This immediately reveals: operating hours, overnight baseload, seasonal changes, any gap periods
- Same format as Pablo's calendar view but focused on the energy profile

**Commit message:** "Part 6: Daily profile chart with zoom and half-hourly heatmap"

**Verify:**
1. Navigate to consumption view with imported data
2. **SCREENSHOT 1:** Daily profile showing the full year of consumption with seasonal patterns
3. **INTERACT:** Zoom into one week — should show HH resolution
4. **SCREENSHOT 2:** Heatmap showing time-of-day vs date — overnight baseload should be visible as a consistent dark band
5. Report: "Daily profile: [X] days of data, peak [X] kWh/day, seasonal pattern [visible/not visible]. Heatmap: baseload [visible/not] at [X] kW overnight. Weekend pattern: [different/same as weekday]."

---

## PART 7: Model vs Actual comparison overlay

**File(s):** `frontend/src/components/modules/consumption/ModelComparisonChart.jsx` (new)

Add a chart that overlays the modelled energy profile (from the instant calc or EnergyPlus) against the actual metered data.

**Chart layout:**
- X axis: months (or days if zoomed)
- Two series:
  - **Actual:** Solid bars from imported consumption data
  - **Modelled:** Transparent/outlined bars from the latest simulation results (monthly energy from instant calc)
- The gap between them is the performance gap

**Performance gap breakdown panel:**
Below the chart, show:
- **Total gap:** Actual [X] MWh - Modelled [X] MWh = [X] MWh ([X]%)
- **Possible explanations** (informational, not calculated):
  - Higher occupancy than modelled: "Model assumes [X]% occupancy — actual may be higher"
  - System degradation: "Model assumes SCOP [X] — real COP may be lower"
  - Unmetered loads: "Model excludes lifts, kitchens, laundry, vending"
  - Controls issues: "Simultaneous heating and cooling, extended operating hours"

This panel is informational for now — Brief 16 will make it interactive (adjustable reality factors that close the gap).

**Note:** The modelled data comes from the INSTANT CALC monthly totals (available immediately) or from EnergyPlus simulation results (if a simulation has been run). Use whichever is available, preferring EnergyPlus if both exist.

**Commit message:** "Part 7: Model vs Actual comparison chart with performance gap breakdown"

**Verify:**
1. Import consumption data AND have simulation results available
2. **SCREENSHOT:** Overlay chart showing actual bars (solid) vs modelled bars (outline). The gap should be visible.
3. **DATA CHECK:** Performance gap = (actual - modelled) / modelled × 100. For Bridgewater this should be very large (>100%) given the immigrant hotel usage.
4. Report: "Model vs Actual overlay working. Actual: [X] MWh ([X] kWh/m²). Modelled: [X] MWh ([X] kWh/m²). Performance gap: [X]%. Gap panel shows [X] possible explanations."

---

## PART 8: CRREM trajectory with actual data point

**File(s):** Update `frontend/src/components/modules/results/CRREMTab.jsx`

Update the existing CRREM trajectory chart to plot the ACTUAL EUI from imported consumption data alongside the modelled trajectory.

**Add to the EUI trajectory chart:**
- A large red dot at the current year showing the actual EUI (from imported data)
- Label: "Actual 2024: 247 kWh/m²" (or whatever the real number is)
- The modelled EUI line continues as before
- The gap between the red dot and the CRREM pathway shows how far the building is from compliance

**Add to the carbon trajectory chart:**
- Same red dot for actual carbon (electricity kWh × grid factor + gas kWh × 0.183) / GIA
- This requires knowing the actual fuel split from imported data

**Stranding assessment update:**
- Use the ACTUAL EUI (not modelled) to determine stranding year
- "Based on actual consumption: stranding in [YEAR]"
- "Based on modelled consumption: stranding in [YEAR]"
- Show both — the gap between them is the performance gap risk

**Commit message:** "Part 8: CRREM trajectory with actual consumption data point"

**Verify:**
1. Import consumption data, navigate to Results → CRREM & Carbon
2. **SCREENSHOT:** The EUI trajectory chart should now show a red dot for the actual EUI at the current year, above the modelled line
3. The actual dot should be above the CRREM pathway (non-compliant) if the building has high consumption
4. Stranding year from actual data should be earlier than from model data
5. Report: "CRREM chart updated. Actual EUI: [X] kWh/m² (red dot). Modelled EUI: [X] kWh/m². CRREM target: [X] kWh/m². Actual stranding: [year]. Modelled stranding: [year]."

---

## PART 9: Consumption module navigation and layout

**File(s):** Update `frontend/src/App.jsx`, add sidebar entry, create route

Wire the consumption module into the main app navigation.

**Sidebar:** Add a new icon between Profiles and Results. Icon suggestion: `BarChart3` or `FileSpreadsheet` from lucide-react. Module colour: a data-focused colour — dark teal or slate (`#2D6A7A`).

**Route:** `/consumption` → ConsumptionManager

**Layout:** Three-column (matching other modules):
- Left: Dataset list + upload controls
- Centre: Currently selected visualisation (monthly chart, daily profile, heatmap, or model comparison — selectable via tabs)
- Right: Summary metrics — actual EUI, CRREM gap, data quality stats (coverage %, gaps, anomalies)

**Commit message:** "Part 9: Consumption module added to navigation with three-column layout"

**Verify:**
1. The consumption icon should appear in the sidebar
2. Click it — the consumption page should load with the three-column layout
3. Upload data — it should populate the left panel list and the centre visualisation
4. Tabs should switch between monthly, daily, heatmap, and model comparison views
5. Report: "Consumption module integrated. Sidebar icon at [position]. Three-column layout. [X] visualisation tabs."

---

## PART 10: Integration test with test data

Create a test consumption CSV and run the full workflow:

1. Generate a test CSV representing 12 months of half-hourly electricity data for a hotel (~250 kWh/m² annual EUI). Use a realistic hotel profile: baseload ~40kW overnight, daytime peak ~80kW, seasonal variation.
2. Navigate to /consumption
3. Upload the test CSV
4. Verify: record count, date range, total kWh, detected fuel type
5. Monthly chart: bars should show seasonal pattern with CRREM line
6. Daily profile: weekday/weekend pattern visible
7. Heatmap: overnight baseload visible
8. Model comparison: actual >> modelled (large performance gap expected)
9. Navigate to Results → CRREM: actual data point should appear as red dot above modelled line
10. EUI gauge on Building module should render cleanly (Part 1 fix)

**SCREENSHOTS:**
1. Upload success with summary
2. Monthly actual vs CRREM
3. Daily profile zoomed to one week
4. Heatmap showing baseload
5. Model vs Actual comparison with gap
6. CRREM trajectory with actual data point
7. Fixed EUI gauge

**Commit message:** "Part 10: Integration test with synthetic hotel consumption data"

**Verify — report:**
- Upload and parsing: ✓/✗
- Auto-detection (format, fuel, interval): ✓/✗
- Monthly chart with CRREM: ✓/✗
- Daily profile with zoom: ✓/✗
- Heatmap: ✓/✗
- Model comparison: ✓/✗ — gap: [X]%
- CRREM actual data point: ✓/✗
- EUI gauge fixed: ✓/✗
- Zero console errors

---

## After all 10 parts are complete

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 15 complete. Consumption data import working — auto-detects CSV/Excel wide and long formats. Monthly chart shows actual [X] kWh/m² against CRREM target [X] kWh/m² — [compliant/gap of X%]. Daily profile and heatmap reveal [baseload/patterns]. Model comparison shows performance gap of [X]% (actual vs modelled). CRREM trajectory now plots the actual EUI as a red dot — stranding year from actual data: [year]. EUI gauge fixed."
