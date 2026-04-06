# Brief 18b: Font Fix, Weather Files, Manual Consumption, Bridgewater Data Corrections

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Combined verification allowed.

---

## Context

Critical data corrections and infrastructure updates identified from testing and from the real Bridgewater CRREM analysis spreadsheet (`CRREM_HIX_Analysis_v2.xlsx`):

**Bridgewater data corrections (from 505 Design / Zeal Hotels data):**
- GIA: **4,215 m²** (was 3,000 — a 40% error)
- Rooms: **134** (was 138)
- Floors: **5** (GF + 4 upper, was 4)
- Building dimensions: needs recalculating to produce 4,215 m² GIA across 5 floors
- 2025 consumption: Elec 572,447 kWh + Gas 207,686 kWh = 780,133 kWh total
- **Corrected EUI: 185.1 kWh/m²** — currently BELOW the 2025 CRREM target of 195.5 kWh/m² (ALIGNED)
- But will strand ~2027-2028 as the pathway drops below 185
- Must reach 95 kWh/m² for permanent compliance (post-2037 plateau)

**Other fixes:**
- Body font weight 300 (Light) → 400 (Regular) — too thin to read
- Pop-out window missing Stolzl fonts
- Need weather file management for UK EPW files
- Need PROMETHEUS future weather files unpacked and organised
- Need manual consumption input (annual kWh by fuel) for when HH data isn't available

11 parts.

---

## PART 1: Fix body font weight — 300 → 400

**File(s):** `frontend/src/index.css`

Change body default from `font-weight: 300` (Light) to `font-weight: 400` (Regular).

Search entire frontend for explicit `font-light` or `font-weight: 300` on body text — change to `font-normal` / `font-weight: 400`. Keep 300 ONLY for large decorative display text.

Also fix pop-out window: ensure `/popout` route loads Stolzl font-face CSS and uses `font-weight: 400` base.

**Commit message:** (combined)

---

## PART 2: Correct Bridgewater project defaults

**File(s):** `frontend/src/context/ProjectContext.jsx` (default params), potentially seed data

Update the default building parameters to match the real Bridgewater Hotel data:

```js
// Corrected from 505 Design / Zeal Hotels data
const DEFAULT_PARAMS = {
  name: 'Bridgewater Hotel',
  length: 63,        // was 50/60 — adjusted to produce ~4,215 m² GIA at 5 floors
  width: 13.4,       // 63 × 13.4 × 5 = 4,221 m² ≈ 4,215 m²
  num_floors: 5,     // was 4 — GF + 4 upper floors (from fire alarm drawings)
  floor_height: 3.0, // typical for Holiday Inn Express
  orientation: 0,
  // ... rest unchanged
  num_bedrooms: 134,    // was 138 — confirmed from water consumption data
  occupancy_rate: 0.75,
  people_per_room: 1.5,
  location: {
    latitude: 51.087,   // North Petherton / Bridgwater
    longitude: -2.985,
    name: 'Bridgwater, Somerset'
  },
}
```

**Note on dimensions:** The real GIA is 4,215 m². With 5 floors, the footprint is 4,215 / 5 = 843 m². This could be approximately 63m × 13.4m, or another combination. If the actual footprint dimensions are known from drawings, use those instead. The key constraint is: `length × width × num_floors = 4,215 m² (±5%)`.

**Also update any existing Bridgewater project in the database:** If the user already has a Bridgewater project, the dimensions won't auto-update (they're saved in the DB). Add a note in the project dashboard checklist: "⚠ GIA 3,000 m² does not match 505 Design data (4,215 m²) — update geometry".

---

## PART 3: Weather file directory and management

**File(s):** `api/routers/weather.py` (update), `nza_engine/config.py`

**3a — Create project weather directory:**

Add to config:
```python
PROJECT_WEATHER_DIR = Path("data/weather")
```

Update the weather file resolver to search:
1. `data/weather/current/` — current climate EPW files
2. `data/weather/future/` — PROMETHEUS future weather files
3. EnergyPlus WeatherData directory — bundled files (fallback)

**3b — Weather file list API:**
```
GET /api/weather — List all available EPW files
Returns: [{
  filename: "cntr_Bristol_TRY.epw",
  location: "Bristol",
  category: "current",      // or "future_2030", "future_2050", "future_2080"
  scenario: null,            // or "medium", "high"
  percentile: null,          // or "50th"
  type: "TRY",              // or "DSY"
  latitude: 51.449,
  longitude: -2.612,
  source: "PROMETHEUS"       // or "climate.onebuilding.org", "EnergyPlus bundled"
}]
```

Parse EPW header line 1 for location data. Parse filename for PROMETHEUS metadata (year, scenario, percentile, TRY/DSY).

**3c — Weather file selection in Building module:**

Add to the Building module left panel, in a "Location & Climate" section (after Geometry, before Glazing):
- **Current weather:** Dropdown of available current-climate EPW files
- **Future weather (optional):** Dropdown of PROMETHEUS future files, grouped by period (2030/2050/2080) and scenario (medium/high)
- Show selected file name, location, and a warning if it doesn't match the project location

When the weather file changes, the hourly instant calc should reload the EPW data (via WeatherContext).

---

## PART 4: Unpack and organise PROMETHEUS weather files

**File(s):** `scripts/setup_weather.py` (new)

Create a script that unpacks the PROMETHEUS zip files from `data/weather/29812739/` (or wherever Chris has placed them) into an organised directory structure.

**Target structure:**
```
data/weather/
├── current/
│   ├── cntr_Bristol_TRY.epw
│   └── cntr_Bristol_DSY.epw
├── future/
│   ├── 2030_medium/
│   │   ├── Bristol_2030_a1b_50_percentile_TRY.epw
│   │   └── Bristol_2030_a1b_50_percentile_DSY.epw
│   ├── 2030_high/
│   │   └── ...
│   ├── 2050_medium/
│   │   └── ...
│   ├── 2050_high/
│   │   └── ...
│   ├── 2080_medium/
│   │   └── ...
│   └── 2080_high/
│       └── ...
└── yeovilton/
    └── (Yeovilton TMYx files if downloaded)
```

**The script should:**
1. Find all `.zip` files in the PROMETHEUS data directory
2. For each city zip (e.g. `Bristol.zip`):
   - Extract the nested zips (e.g. `Bristol_control.zip`, `Bristol_2030_med.zip`)
   - Unpack each nested zip
   - Copy EPW files to the appropriate directory
   - Use the 50th percentile TRY as the default for each period (it's the median projection)
3. For the control file: copy TRY to `current/`, DSY to `current/`
4. Clean up temporary extracted files

**Run instruction:** `python scripts/setup_weather.py` from the project root.

Also check if Yeovilton files are present and organise them similarly.

**Commit message:** (combined)

---

## PART 5: Manual consumption input with multi-fuel support

**File(s):** `frontend/src/components/modules/consumption/ManualConsumptionInput.jsx` (new), update `frontend/src/components/modules/consumption/ConsumptionManager.jsx`, update `api/routers/consumption.py`

Add a manual input form for annual consumption by fuel type, supporting multiple fuels.

**Manual input form:**

```
Annual Consumption Data
Year: [2025 ▾]

┌─ Fuel ──────────────────────────────────────────┐
│ Electricity:    [572,447] kWh    [Invoice ▾]    │
│ Natural Gas:    [207,686] kWh    [Invoice ▾]    │
│ + Add fuel                                       │
└─────────────────────────────────────────────────┘

Additional fuel options (from "+ Add fuel"):
  - District Heating: [    ] kWh    [Invoice ▾]
  - Oil:              [    ] kWh    [Invoice ▾]
  - LPG:              [    ] kWh    [Invoice ▾]
  - Biomass:          [    ] kWh    [Invoice ▾]

GIA for EUI:  [4,215] m²  (auto-filled from project)

[Calculate & Save]
──────────────────────────────────────────────────
Total:       780,133 kWh
EUI:         185.1 kWh/m²
Carbon:      XX.X kgCO₂e/m²
Elec:        73.4%  |  Gas: 26.6%
CRREM 2025:  195.5 kWh/m²
Status:      ✅ ALIGNED (10.4 kWh/m² headroom)
```

**Source dropdown options:** Invoice / Estimate / DEC / Utility Bill / Sub-metered

**Carbon calculation per fuel:**
```python
carbon_factors = {
    'electricity': grid_factor_for_year,  # from National Grid FES
    'gas': 0.18316,           # kgCO₂e/kWh — from UK GHG Conversion Factors
    'oil': 0.24680,           # kgCO₂e/kWh
    'lpg': 0.21445,           # kgCO₂e/kWh
    'biomass': 0.01538,       # kgCO₂e/kWh (scope 1 only)
    'district_heating': 0.168, # kgCO₂e/kWh (varies by network)
}
```

**API endpoint:**
```
POST /api/projects/{project_id}/consumption/manual
Body: {
  year: 2025,
  fuels: [
    { type: "electricity", kwh: 572447, source: "invoice" },
    { type: "gas", kwh: 207686, source: "invoice" },
  ],
  gia_m2: 4215
}
```

**Multi-year support:** The form should allow entering data for multiple years (2022, 2023, 2024, 2025). Each year saved separately. This enables the CRREM trajectory to show a TREND of actual performance, not just a single point.

---

## PART 6: Pre-populate Bridgewater multi-year consumption

**File(s):** No code change — data entry after Part 5 is built, OR seed via API.

From the CRREM_HIX_Analysis spreadsheet, the actual annual data is:

| Year | Electricity (kWh) | Gas (kWh) | Total (kWh) | EUI (kWh/m²) | Source |
|------|-------------------|-----------|-------------|-------------|--------|
| 2022 | 600,700 | 129,391 | 730,091 | 173.2 | 505 spreadsheet |
| 2023 | 578,585 | 262,155 | 840,740 | 199.5 | Utility bills |
| 2024 | 546,128 | 202,801 | 748,929 | 177.7 | Utility bills |
| 2025 | 572,447 | 207,686 | 780,133 | 185.1 | Utility bills |

GIA: 4,215 m² for all years.

Either enter these manually through the UI or create a seed script that populates them via the API.

**Note:** The 2023 gas consumption (262,155 kWh) is anomalously high compared to other years (~130-208k). This could be a billing adjustment, meter read correction, or genuine spike. Flag it in the data quality notes.

---

## PART 7: CRREM trajectory with multi-year actual data

**File(s):** Update `frontend/src/components/modules/results/CRREMTab.jsx`

The CRREM trajectory currently shows a single red dot for actual data. With multi-year data, show multiple dots connected by a line — showing the building's actual performance TREND.

**EUI trajectory:**
- CRREM pathway: dashed declining line (as before, now with corrected values)
- Actual performance: red dots at 2022, 2023, 2024, 2025 connected by a solid red line
- Modelled EUI: navy line (as before)

This shows the client: "Your building has been hovering around 175-200 kWh/m² for four years. The CRREM target is dropping toward 95. You need to act before the lines cross."

**Carbon trajectory:**
- Same multi-year actual dots for carbon (computed from fuel split × carbon factors per year)
- The carbon dots should show a declining trend even without intervention (grid decarbonisation reducing the electricity carbon component)

**Project dashboard mini CRREM:** Should also show the multi-year trend (compact version).

---

## PART 8: Update project dashboard with corrected data

**File(s):** Update project dashboard

The summary cards should reflect the corrected Bridgewater data:
- GIA: 4,215 m²
- Rooms: 134
- Floors: 5
- Actual EUI (2025): 185.1 kWh/m²
- CRREM Target (2025): 195.5 kWh/m²
- Status: ✅ ALIGNED (headroom: 10.4 kWh/m²)
- ⚠ Warning: "Stranding projected ~2027 at current trajectory — target drops to 184 kWh/m² in 2026"

The checklist should update:
- ✅ Electricity data: 4 years (2022-2025)
- ✅ Gas data: 4 years (2022-2025)
- ⚠ Weather file: needs Bristol/Yeovilton TRY (currently Colorado)
- ✅ CRREM pathway: V2.07 1.5°C UK Hotel (corrected)

---

## PART 9: Weather file for Bridgewater — auto-select

**File(s):** Update `frontend/src/context/ProjectContext.jsx` or weather selection logic

After the PROMETHEUS files are unpacked (Part 4), the Bridgewater project should automatically use the Bristol control TRY as its weather file:
- Filename: `cntr_Bristol_TRY.epw`
- Location: Bristol, 51.449°N, 2.612°W
- This is the closest PROMETHEUS location to Bridgwater (51.087°N, 2.985°W — about 40km away)

If auto-selection by nearest location is too complex for now, just default the weather dropdown to Bristol TRY when it's available.

---

## PART 10: Future weather file selection

**File(s):** Update Building module weather selector

In the Building module "Location & Climate" section, add a second dropdown for future weather:

```
Current climate: [Bristol Control TRY ▾]
Future climate (optional): [None ▾]
  ├── 2030 Medium (50th percentile TRY)
  ├── 2030 High (50th percentile TRY)
  ├── 2050 Medium (50th percentile TRY)
  ├── 2050 High (50th percentile TRY)
  ├── 2080 Medium (50th percentile TRY)
  └── 2080 High (50th percentile TRY)
```

When a future weather file is selected:
- The instant calc uses the future weather data instead of current
- A note appears: "Modelling with 2050 Medium climate scenario — results show projected future performance"
- The EUI and heating/cooling balance will change (warmer future = less heating, more cooling)

This doesn't need to work perfectly in this brief — just wire up the dropdown and weather file switching. The instant calc already supports different weather data via WeatherContext.

---

## PART 11: Combined verification

1. **Font:** Body text Regular (400) throughout. Pop-out uses Stolzl.
2. **Bridgewater params:** 5 floors, 134 rooms, GIA ≈ 4,215 m² (check `length × width × floors`)
3. **Weather:** Bristol TRY available in dropdown. PROMETHEUS files unpacked.
4. **Manual input:** Enter 2025 data: elec 572,447 + gas 207,686. EUI shows 185.1 kWh/m².
5. **Multi-year:** Enter 2022-2024 data. CRREM chart shows 4 red dots with trend line.
6. **CRREM:** Pathway uses corrected values (264→95 plateau). 2025 actual below target = ALIGNED.
7. **Dashboard:** Summary cards show corrected data. Checklist accurate.
8. **Zero console errors.**

**Commit message:** "Brief 18b: Font fix, Bridgewater corrections (4,215m² GIA, 5fl, 134 rooms), weather file management, PROMETHEUS setup, manual multi-fuel consumption input, multi-year CRREM trajectory"

---

## After verification

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 18b complete. Critical correction: Bridgewater GIA is 4,215 m² (was 3,000) — actual EUI is 185 kWh/m², not 260. Building is currently CRREM ALIGNED for 2025 (target 195.5) but will strand ~2027. Font fixed to Regular weight. Bristol PROMETHEUS weather files unpacked (control + 2030/2050/2080). Manual multi-fuel consumption input working. Multi-year CRREM trajectory shows 2022-2025 actual trend. 95 kWh/m² permanent compliance target from corrected CRREM V2 data."
