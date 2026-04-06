# Brief 19: Auto-Download Nearest UK Weather Station

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. This brief can run independently of Brief 18b.

---

## Context

NZA Simulate needs automatic weather file selection for UK projects. The user enters a postcode (or lat/long), the tool finds the nearest weather station from climate.onebuilding.org's UK dataset, downloads the most recent TMYx EPW file, and makes it available for simulation.

**Weather file selection logic:**
- Dataset: TMYx.2011-2025 (most recent 15-year window, best represents current climate)
- File type: TRY only (not DSY — DSY is for overheating analysis, TRY is for annual energy)
- Source: climate.onebuilding.org, WMO Region 6 Europe, GBR_United_Kingdom
- URL pattern: `https://climate.onebuilding.org/WMO_Region_6_Europe/GBR_United_Kingdom/ENG_England/GBR_ENG_[Location].[Type].[WMO]_TMYx.2011-2025.zip`

**The UK has ~50-80 weather stations on climate.onebuilding.org.** We'll build a static index of all UK stations with their lat/long, then find the nearest one to the project's location using haversine distance.

5 parts.

---

## PART 1: Build UK weather station index

**File(s):** `data/weather/uk_stations.json` (new), `scripts/build_station_index.py` (new)

Create a static JSON index of all UK weather stations available on climate.onebuilding.org.

**Format:**
```json
{
  "source": "climate.onebuilding.org",
  "dataset": "TMYx",
  "last_updated": "2026-04-06",
  "stations": [
    {
      "name": "Yeovilton",
      "region": "ENG",
      "wmo_id": "038530",
      "station_type": "AF",
      "latitude": 51.00,
      "longitude": -2.64,
      "elevation_m": 20,
      "datasets": ["TMYx", "TMYx.2004-2018", "TMYx.2007-2021", "TMYx.2009-2023", "TMYx.2011-2025"],
      "recommended": "TMYx.2011-2025",
      "filename_pattern": "GBR_ENG_Yeovilton.AF.038530_TMYx.{period}.zip",
      "download_url": "https://climate.onebuilding.org/WMO_Region_6_Europe/GBR_United_Kingdom/ENG_England/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.zip"
    },
    {
      "name": "Bristol.Weather.Ctr",
      "region": "ENG",
      "wmo_id": "037260",
      ...
    },
    {
      "name": "London.Heathrow",
      "region": "ENG",
      "wmo_id": "037720",
      ...
    }
    // ... all UK stations
  ]
}
```

**To build this index**, create `scripts/build_station_index.py` that:
1. Downloads the TMYx spreadsheet/KML for WMO Region 6 from climate.onebuilding.org (they provide xlsx files listing all stations with coordinates)
2. Filters to GBR_ entries only
3. Extracts name, WMO ID, lat/long, available datasets
4. Saves as `data/weather/uk_stations.json`

**If downloading the station list programmatically is too complex**, manually compile the index from the website. The UK has approximately 60-80 stations. Key ones to include at minimum:

| Station | Region | WMO | Lat | Long | Notes |
|---------|--------|-----|-----|------|-------|
| Yeovilton | ENG | 038530 | 51.00 | -2.64 | Nearest to Bridgwater |
| Bristol.Weather.Ctr | ENG | 037260 | 51.47 | -2.59 | Major city |
| London.Heathrow | ENG | 037720 | 51.48 | -0.45 | Major hub |
| Birmingham | ENG | 035340 | 52.45 | -1.75 | Midlands |
| Manchester | ENG | 033340 | 53.35 | -2.28 | North West |
| Edinburgh | SCT | 031600 | 55.95 | -3.35 | Scotland |
| Cardiff | WLS | 037150 | 51.40 | -3.34 | Wales |
| Belfast | NIR | 039170 | 54.66 | -6.22 | N. Ireland |
| ... | | | | | |

Include ALL available UK stations — the more stations, the better the nearest-match will be.

**Commit message:** (combined)

---

## PART 2: Nearest station finder API

**File(s):** `api/routers/weather.py` (update)

Add API endpoints for finding and downloading the nearest weather station.

**Haversine distance function:**
```python
import math

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
```

**Postcode to lat/long:**
Use the postcodes.io free API (no key needed, UK postcodes only):
```
GET https://api.postcodes.io/postcodes/{postcode}
Returns: { result: { latitude, longitude, admin_district, ... } }
```

**Endpoints:**

```
GET /api/weather/nearest?postcode=TA6+6DF
  — Converts postcode to lat/long via postcodes.io
  — Finds nearest station from uk_stations.json
  — Returns: { station: { name, distance_km, lat, long, download_url }, alternatives: [...top 3] }

GET /api/weather/nearest?lat=51.087&lon=-2.985
  — Same but from coordinates directly

POST /api/weather/download
  Body: { station_name: "Yeovilton", dataset: "TMYx.2011-2025" }
  — Downloads the zip from climate.onebuilding.org
  — Extracts the EPW file
  — Saves to data/weather/current/
  — Returns: { filename, location, saved_path }
```

**Caching:** Once a station's EPW is downloaded, don't re-download it. Check if the file already exists in `data/weather/current/` before fetching.

---

## PART 3: Weather selection UI in Building module

**File(s):** `frontend/src/components/modules/building/WeatherSelector.jsx` (new), update `frontend/src/components/modules/building/BuildingDefinition.jsx`

Add a "Location & Climate" section to the Building module left panel (between Geometry and Glazing).

**Layout:**
```
LOCATION & CLIMATE
─────────────────────
Postcode: [TA6 6DF     ] [Find ▸]

Nearest station: Yeovilton (12 km)
  Lat 51.00°N, Long 2.64°W
  Dataset: TMYx 2011-2025

[Download & Use]  ← downloads EPW, sets as project weather file

Alternatives:
  Bristol Weather Centre (38 km)
  Exeter Airport (62 km)

Current weather file: cntr_Bristol_TRY.epw ▾
  ├── Yeovilton TMYx 2011-2025
  ├── Bristol Control TRY (PROMETHEUS)
  └── Colorado (EnergyPlus bundled)

Future climate: [None ▾]
  ├── Bristol 2030 Medium (50th percentile)
  ├── Bristol 2050 Medium
  └── Bristol 2080 Medium
```

**Flow:**
1. User enters postcode → clicks "Find"
2. API calls postcodes.io → finds lat/long → finds nearest station
3. Shows station name, distance, and alternatives
4. User clicks "Download & Use" → API downloads EPW from climate.onebuilding.org → saves locally → sets as project weather file
5. The instant calc and EnergyPlus simulation now use this weather file
6. A green tick appears: "✅ Using local weather data (Yeovilton, 12 km from site)"

**If already downloaded:** The "Download & Use" button changes to "✅ Already downloaded — Use this" and just sets the selection without re-downloading.

---

## PART 4: Auto-suggest on project creation

**File(s):** Update project creation flow

When a new project is created and the user enters a location (postcode or coordinates), automatically:
1. Find the nearest weather station
2. Show a suggestion: "Nearest weather station: Yeovilton (12 km). Download weather data?"
3. If the user confirms, download and set the weather file

This ensures new projects start with the right weather data instead of defaulting to Colorado.

For existing projects without a UK weather file, show a warning on the project dashboard:
"⚠ Using non-UK weather file — enter your postcode to download local weather data"

---

## PART 5: Combined verification

1. Enter postcode "TA6 6DF" → should find Yeovilton as nearest station (~12 km)
2. Click "Download & Use" → EPW should download and save to `data/weather/current/`
3. The weather dropdown should now show the Yeovilton file
4. The project should use Yeovilton for simulation
5. The instant calc should reload with the new weather data (temperatures should be UK, not Colorado)
6. Enter "SW1A 1AA" (Westminster) → should find London Heathrow or London City as nearest
7. Enter "EH1 1JF" (Edinburgh) → should find Edinburgh as nearest
8. Check: if the station is already downloaded, no re-download occurs

**Commit message:** "Brief 19: Auto-download nearest UK weather station from climate.onebuilding.org via postcode lookup"

---

## After verification

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 19 complete. Enter a postcode, the tool finds the nearest UK weather station (from ~60+ stations on climate.onebuilding.org), downloads the most recent TMYx EPW (2011-2025), and sets it as the project weather file. Bridgwater TA6 6DF → Yeovilton (12 km). No more Colorado weather for UK buildings."
