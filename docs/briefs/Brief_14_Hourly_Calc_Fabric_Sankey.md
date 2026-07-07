# Brief 14: Hourly Instant Calc, Live Fabric Sankey & Heating Fix

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

The instant calc currently uses an annual steady-state degree-day method that produces zero heating demand because summer gains swamp winter losses in the annual sum. In reality, the building needs heating in winter and cooling in summer — but the annual method can't distinguish seasons.

This brief replaces the degree-day method with an **hourly calculation using real weather data from the EPW file**. For each of the 8,760 hours in a year, it computes losses, gains, heating, and cooling separately. This runs in <5ms in the browser and produces dramatically more accurate results — including non-zero heating demand in winter.

Additionally, this brief builds a **live fabric Sankey diagram** for the Building module centre column (alongside or toggled with the 3D viewer), matching the dynamic Sankey experience in the Systems module.

10 parts. Do them in order.

---

## PART 1: EPW weather file parser

**File(s):** `frontend/src/utils/epwParser.js` (new)

Create a client-side EPW file parser that extracts the hourly data needed for the instant calc.

**EPW format:** The file has 8 header lines, then 8,760 data rows (one per hour). Each row is comma-separated. The key fields by column index:
- Column 0: Year
- Column 1: Month (1-12)
- Column 2: Day (1-31)
- Column 3: Hour (1-24, where 1 = midnight to 1am)
- Column 6: Dry Bulb Temperature (°C) — **this is the main one**
- Column 13: Direct Normal Radiation (Wh/m²)
- Column 14: Diffuse Horizontal Radiation (Wh/m²)

```js
/**
 * Parse an EPW weather file and return hourly data arrays.
 * @param {string} epwText — raw text content of the EPW file
 * @returns {{ 
 *   temperature: Float32Array(8760),
 *   direct_normal: Float32Array(8760),
 *   diffuse_horizontal: Float32Array(8760),
 *   month: Uint8Array(8760),
 *   hour: Uint8Array(8760),
 *   location: { city, latitude, longitude }
 * }}
 */
export function parseEPW(epwText) { ... }
```

Use `Float32Array` for memory efficiency — we're holding 8,760 × 3 floats.

Parse the header to extract location info (line 1 of the EPW has city name, latitude, longitude, timezone, elevation).

**Loading the EPW:** The EPW file is stored on the backend (already used by EnergyPlus). Add an API endpoint:
```
GET /api/weather/{filename}/hourly → returns the parsed hourly arrays as JSON
```

Or, more efficiently, serve the raw EPW file and parse it client-side:
```
GET /api/weather/{filename}/raw → returns the EPW text
```

The frontend fetches this once on project load and caches it in a React context or module-level variable. The weather file name is already stored in the project config.

**Commit message:** "Part 1: EPW parser — extracts hourly temperature and solar radiation from weather file"

**Verify:**
1. Load the EPW file via the API
2. Check: 8,760 temperature values, ranging roughly from -5°C to 30°C for a UK climate
3. Check: month array — January values (month=1) should have lower temperatures than July (month=7)
4. Check: solar radiation — should be zero at night hours, positive during day, higher in summer
5. Report: "EPW parsed. [X] hourly records. Temperature range: [min]°C to [max]°C. Location: [city]. Jan avg: [X]°C, Jul avg: [X]°C. Solar: max direct normal [X] Wh/m²."

---

## PART 2: Solar decomposition onto building facades

**File(s):** `frontend/src/utils/solarCalc.js` (new)

Calculate the hourly solar radiation incident on each building facade, given the direct normal and diffuse horizontal radiation from the EPW, the building orientation, and the facade directions.

**Solar geometry (simplified for feasibility accuracy):**

For each hour, calculate the sun position:
```js
function sunPosition(latitude, dayOfYear, hourOfDay) {
  // Declination angle
  const decl = 23.45 * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365)
  // Hour angle (degrees, solar noon = 0, morning negative, afternoon positive)
  const hourAngle = (hourOfDay - 12) * 15
  // Solar altitude (elevation above horizon)
  const sinAlt = Math.sin(lat_rad) * Math.sin(decl_rad) + 
                 Math.cos(lat_rad) * Math.cos(decl_rad) * Math.cos(hourAngle_rad)
  const altitude = Math.asin(sinAlt)
  // Solar azimuth (compass bearing, 0=N, 90=E, 180=S, 270=W)
  const cosAz = (Math.sin(decl_rad) - Math.sin(lat_rad) * sinAlt) / 
                (Math.cos(lat_rad) * Math.cos(Math.asin(sinAlt)))
  const azimuth = /* resolve quadrant based on hour angle */
  return { altitude, azimuth }
}
```

For each facade, calculate the incident radiation:
```js
function facadeRadiation(directNormal, diffuseHorizontal, sunAltitude, sunAzimuth, facadeAzimuth) {
  // Angle of incidence on the vertical facade
  const cosIncidence = Math.cos(sunAltitude) * Math.cos(sunAzimuth - facadeAzimuth)
  // Direct component (only if sun is in front of the facade and above horizon)
  const direct = (cosIncidence > 0 && sunAltitude > 0) ? directNormal * cosIncidence : 0
  // Diffuse component (isotropic sky model — half the sky dome visible to a vertical surface)
  const diffuse = diffuseHorizontal * 0.5
  // Ground reflected (assume 0.2 albedo)
  const globalHorizontal = directNormal * Math.sin(sunAltitude) + diffuseHorizontal
  const reflected = globalHorizontal * 0.2 * 0.5
  return direct + diffuse + reflected  // Wh/m² for this hour
}
```

**Precompute for all 8,760 hours × 4 facades:**
```js
export function computeHourlySolarByFacade(weather, latitude, orientationDeg) {
  // Returns: { f1: Float32Array(8760), f2: Float32Array(8760), f3: Float32Array(8760), f4: Float32Array(8760), roof: Float32Array(8760) }
  // Facade azimuths based on building orientation:
  // F1 = orientationDeg (faces the orientation direction)
  // F2 = orientationDeg + 90
  // F3 = orientationDeg + 180
  // F4 = orientationDeg + 270
  // Roof = horizontal (receives global horizontal radiation)
}
```

This computation takes maybe 5-10ms for 8,760 × 5 calculations — run it once when orientation changes, cache the result.

**Commit message:** "Part 2: Hourly solar decomposition onto building facades from EPW data"

**Verify:**
1. Compute hourly solar for Bridgewater at 0° orientation
2. **DATA CHECK:** South-facing facade (F3 at 0°) should get more annual radiation than north (F1). Annual total: south ~700-800 kWh/m², north ~300-400 kWh/m². These should be close to the fixed values we used before (750/350).
3. **HOURLY CHECK:** Night hours should be zero. Summer midday should be highest. South facade should peak around solar noon.
4. Change orientation to 180° — the facade that was getting south radiation should now get north radiation.
5. Report: "Hourly solar computed. Annual totals: F1(N) [X] kWh/m², F2(E) [X] kWh/m², F3(S) [X] kWh/m², F4(W) [X] kWh/m². Roof: [X] kWh/m². Night hours: 0 ✓. Peak: [X] Wh/m² on F3 at [hour] in [month]."

---

## PART 3: Hourly instant calc replacing degree-day method

**File(s):** `frontend/src/utils/instantCalc.js`

Replace the annual degree-day calculation with an hourly loop using the EPW data and solar decomposition.

```js
export function calculateInstant(building, constructions, systems, libraryData, weatherData, hourlySolar) {
  // If no weather data available, fall back to the existing degree-day method
  if (!weatherData || !hourlySolar) return calculateInstantDegreeDay(building, constructions, systems, libraryData)
  
  const geo = computeGeometry(building)
  const { gia, volume, ... } = geo
  
  // Pre-compute static values
  const u_wall = getUValue(constructions, 'external_wall', libraryData)
  // ... etc for all U-values
  const UA_total = u_wall * wall_area + u_roof * roof_area + ... // total fabric UA (W/K)
  const UA_infiltration = 0.33 * ach * volume  // W/K equivalent
  const UA_ventilation = 0.33 * vent_ach * volume * (1 - heat_recovery)  // W/K, reduced by HR
  
  const T_heat_setpoint = 21  // °C
  const T_cool_setpoint = 24  // °C
  
  // Internal gains schedule (hourly, simplified)
  const lpd_W = lpd * gia
  const epd_W = epd * gia
  const occ_W = 60 * avg_occupants  // Watts from people
  
  // Hourly loop
  let total_heating = 0, total_cooling = 0
  let total_solar_by_facade = { f1: 0, f2: 0, f3: 0, f4: 0, roof: 0 }
  const monthly_heating = new Float32Array(12)
  const monthly_cooling = new Float32Array(12)
  
  for (let h = 0; h < 8760; h++) {
    const T_out = weatherData.temperature[h]
    const month = weatherData.month[h] - 1  // 0-indexed
    const hourOfDay = weatherData.hour[h] - 1  // 0-23
    
    // Occupancy schedule (simplified: hotel pattern)
    const occ_frac = hotelOccupancyFraction(hourOfDay)
    const light_frac = hotelLightingFraction(hourOfDay)
    const equip_frac = hotelEquipmentFraction(hourOfDay)
    
    // Fabric heat loss this hour (W → kWh by /1000)
    const dT_heat = Math.max(0, T_heat_setpoint - T_out)
    const fabric_loss_kWh = (UA_total + UA_infiltration + UA_ventilation) * dT_heat / 1000
    
    // Solar gains this hour (Wh/m² from solar calc × glazing area × g-value → kWh)
    const solar_kWh = (
      hourlySolar.f1[h] * glazing.f1 * g_value +
      hourlySolar.f2[h] * glazing.f2 * g_value +
      hourlySolar.f3[h] * glazing.f3 * g_value +
      hourlySolar.f4[h] * glazing.f4 * g_value
    ) / 1000
    
    // Internal gains this hour (kWh)
    const internal_kWh = (
      lpd_W * light_frac +
      epd_W * equip_frac +
      occ_W * occ_frac
    ) / 1000
    
    // Heat balance
    const net_loss = fabric_loss_kWh - solar_kWh - internal_kWh
    
    if (net_loss > 0) {
      total_heating += net_loss
      monthly_heating[month] += net_loss
    } else {
      // Excess gains → cooling needed (only if T_out + excess would push above cooling setpoint)
      const dT_cool = Math.max(0, T_out - T_cool_setpoint)
      const excess_gain = -net_loss
      // Simplified: cooling = excess gains + fabric gain when T_out > T_cool_setpoint
      const cooling_kWh = excess_gain + (UA_total + UA_infiltration) * dT_cool / 1000
      total_cooling += cooling_kWh
      monthly_cooling[month] += cooling_kWh
    }
    
    // Accumulate solar by facade for display
    total_solar_by_facade.f1 += hourlySolar.f1[h] * glazing.f1 * g_value / 1000
    total_solar_by_facade.f2 += hourlySolar.f2[h] * glazing.f2 * g_value / 1000
    total_solar_by_facade.f3 += hourlySolar.f3[h] * glazing.f3 * g_value / 1000
    total_solar_by_facade.f4 += hourlySolar.f4[h] * glazing.f4 * g_value / 1000
    total_solar_by_facade.roof += hourlySolar.roof[h] * roof_area * 0.04 / 1000  // opaque gain
  }
  
  // Now total_heating and total_cooling are annual kWh thermal demands
  // Apply system efficiencies from demand-based assignments...
  // ... rest of calculation as before
}
```

**Simplified hotel schedule functions** (built-in, no library lookup needed for instant calc):
```js
function hotelOccupancyFraction(hour) {
  // Hotel bedroom: high overnight, low midday
  if (hour >= 22 || hour < 7) return 0.85
  if (hour >= 10 && hour < 16) return 0.15
  return 0.45  // morning/evening transition
}
```

**Performance:** The loop is 8,760 iterations of ~10 multiplications each. This should run in <3ms. The solar precomputation (Part 2) adds ~5ms but is cached when orientation doesn't change. Total: <10ms, well within the <50ms target.

**Keep the old degree-day method as fallback** for when weather data isn't loaded yet (first render before EPW fetch completes).

**Commit message:** "Part 3: Hourly instant calc with 8760 iterations — replaces degree-day method"

**Verify:**
1. Open /building — the instant calc should now use hourly data (check console log or add a debug indicator)
2. **CRITICAL CHECK:** Heating demand should be NON-ZERO. For Bridgewater with standard fabric: expect 50-200 MWh heating (EnergyPlus gives ~131 MWh).
3. **ACCURACY CHECK:** Compare instant calc EUI with EnergyPlus EUI. The gap should be smaller than before (~6% was degree-day, aim for <20% with hourly).
4. **SEASONAL CHECK:** Monthly heating should peak in January/December, be zero or near-zero in June-August. Monthly cooling should peak in July/August.
5. **SPEED CHECK:** Drag a slider rapidly — results should update without perceptible lag. Check with performance profiler if concerned.
6. **ORIENTATION CHECK:** Change orientation with asymmetric glazing — EUI should change (more than before, since hourly solar decomposition is more sensitive to orientation than annual averages).
7. Report: "Hourly instant calc working. Heating: [X] MWh (was 0 with degree-day). Cooling: [X] MWh. EUI: [X] kWh/m² (EnergyPlus: [X], gap: [X]%). Calc time: [X]ms. Monthly heating peaks in [month] at [X] MWh. Orientation swing: [X] kWh/m²."

---

## PART 4: Weather data context and caching

**File(s):** `frontend/src/context/WeatherContext.jsx` (new), update `frontend/src/App.jsx`, update API if needed

Create a WeatherContext that loads the EPW data once and provides it to all components.

```jsx
export function WeatherProvider({ children }) {
  const [weatherData, setWeatherData] = useState(null)
  const [loading, setLoading] = useState(true)
  const { params } = useContext(ProjectContext)
  const weatherFile = params?.weather_file ?? 'default'
  
  useEffect(() => {
    setLoading(true)
    fetch(`/api/weather/${encodeURIComponent(weatherFile)}/hourly`)
      .then(r => r.json())
      .then(data => setWeatherData(data))
      .catch(err => console.warn('Weather data not available:', err))
      .finally(() => setLoading(false))
  }, [weatherFile])
  
  return (
    <WeatherContext.Provider value={{ weatherData, loading }}>
      {children}
    </WeatherContext.Provider>
  )
}
```

**Backend endpoint:** Add `GET /api/weather/{filename}/hourly` that:
1. Reads the EPW file from the weather directory
2. Parses it (using a Python EPW parser — simple line-by-line CSV)
3. Returns JSON: `{ temperature: [...8760], direct_normal: [...8760], diffuse_horizontal: [...8760], month: [...8760], hour: [...8760], location: {...} }`
4. Caches the parsed result in memory (EPW files don't change)

The frontend caches via the context — only fetches when the weather file changes.

**Commit message:** "Part 4: WeatherContext — loads and caches EPW hourly data for instant calc"

**Verify:**
1. Open the app — WeatherContext should load the EPW data
2. Check network tab: one request to `/api/weather/.../hourly`, not repeated on navigation
3. The hourly instant calc should receive the weather data and use it (verify via heating being non-zero)
4. Report: "WeatherContext loading [X] hourly records. Cached — no repeat fetches. Instant calc receiving weather data. Heating: [X] MWh (non-zero confirmed)."

---

## PART 5: Precomputed solar — cache on orientation change

**File(s):** `frontend/src/utils/instantCalc.js` or new `frontend/src/hooks/useHourlySolar.js`

The solar decomposition (Part 2) depends on building orientation and latitude. It should be computed once when these change, then cached for the 8,760-iteration loop.

Create a custom hook or memoised computation:
```js
const hourlySolar = useMemo(() => {
  if (!weatherData) return null
  return computeHourlySolarByFacade(weatherData, latitude, orientation)
}, [weatherData, latitude, orientation])
```

This ensures:
- Solar is recomputed when orientation changes (slider drag) — ~5ms
- Solar is NOT recomputed when other parameters change (U-value, occupancy) — uses cached result
- The 8,760-iteration calc only does the simple heat balance loop — solar values come from the cache

**Commit message:** "Part 5: Memoised solar precomputation — recomputes only on orientation change"

**Verify:**
1. Drag the orientation slider rapidly — instant calc should still feel responsive
2. Change a U-value — instant calc should update even faster (no solar recomputation)
3. Performance profiler: solar computation should show ~5ms, heat balance loop ~2ms
4. Report: "Solar cached on orientation change. Orientation drag: [X]ms total. U-value change: [X]ms (no solar recompute). Smooth interaction confirmed."

---

## PART 6: Live fabric Sankey in Building module

**File(s):** `frontend/src/components/modules/building/FabricSankey.jsx` (new), update `frontend/src/components/modules/building/BuildingDefinition.jsx`

Build a live Sankey diagram for the Building module that shows the thermal energy balance through the fabric, updating in real time as inputs change. This sits in the centre column alongside or toggled with the 3D viewer.

**Add a view toggle** at the top of the centre column: **"3D Model" | "Energy Flow"**

When "Energy Flow" is selected, show the FabricSankey instead of the 3D viewer.

**FabricSankey layout:**

Left side (gains — energy entering the building):
- Solar F1 (with compass direction)
- Solar F2
- Solar F3
- Solar F4
- Solar Roof (opaque gains)
- People
- Lighting (waste heat)
- Equipment (waste heat)

Centre node:
- "Building Thermal Balance"

Right side (losses + demands — energy leaving the building):
- Walls (per facade or total — total is cleaner)
- Glazing conduction
- Roof
- Floor
- Infiltration
- Ventilation
- **Space Heating demand** (red) — what the HVAC system needs to provide
- **Space Cooling demand** (blue) — what the cooling system needs to remove

**The key visual:**
- Gains flow IN from the left
- Losses flow OUT to the right
- If total gains > total losses at any given moment: excess becomes cooling demand (blue, right side)
- If total losses > total gains: deficit becomes heating demand (red, right side)
- The relative thickness of heating vs cooling shows the heating/cooling balance

**Link colours:**
- Solar: warm amber/yellow graduated by facade (south = darkest)
- Internal gains: purple/orange tones
- Fabric losses: brown/grey tones per element
- Heating demand: red
- Cooling demand: blue
- Waste (rejected heat, if shown): light grey

**Dynamic updates:**
- Change orientation → solar gains links shift width
- Change WWR → glazing solar increases, glazing conduction loss increases
- Change wall U-value → walls loss link width changes
- Change infiltration → infiltration link changes
- All updates in <10ms (data comes from the hourly instant calc)

**Commit message:** "Part 6: Live fabric Sankey in Building module centre column"

**Verify:**
1. Navigate to /building, toggle to "Energy Flow" view
2. **SCREENSHOT 1:** The fabric Sankey showing gains on left, building in centre, losses + demands on right
3. **INTERACT:** Change orientation — solar gain links should shift
4. **INTERACT:** Change wall U-value — wall loss link should change
5. **INTERACT:** Increase south WWR — south solar gain grows, glazing loss grows
6. **INTERACT:** Increase infiltration — infiltration loss grows, heating demand grows
7. Toggle back to "3D Model" — 3D viewer should appear
8. **DATA CHECK:** Heating demand link should be non-zero (>0 kWh) thanks to the hourly calc
9. Report: "Fabric Sankey working. [X] gain links, [X] loss links. Heating demand: [X] MWh (non-zero ✓). Cooling demand: [X] MWh. Responds to orientation, WWR, U-value, infiltration. View toggle 3D/Energy Flow works."

---

## PART 7: Fabric Sankey — smooth transitions and hover

**File(s):** `frontend/src/components/modules/building/FabricSankey.jsx`

Add the same interaction polish as the Systems Sankey:

**Animated transitions:**
- Link widths animate over 300ms when values change
- Smooth response when dragging orientation slider

**Hover interaction:**
- Hover a gain link: highlight it and its source node, dim everything else
- Hover a loss link: highlight it and its end-use node
- Tooltip: "[Element]: [X] MWh/yr — [X]% of total [gains/losses]"

**Hover on the building node:**
- Show total gains, total losses, net balance
- "Gains: 210 MWh — Losses: 180 MWh — Net cooling load: 30 MWh"

**Commit message:** "Part 7: Fabric Sankey transitions and hover interaction"

**Verify:**
1. Drag orientation slider — Sankey links should animate smoothly
2. Hover on south solar link — highlights with tooltip showing MWh and percentage
3. Hover on building node — shows total balance
4. Report: "Transitions smooth. Hover working with tooltips. [X]ms animation."

---

## PART 8: Monthly breakdown from hourly calc

**File(s):** `frontend/src/utils/instantCalc.js`, update `frontend/src/components/modules/building/LiveResultsPanel.jsx`

The hourly calc already accumulates monthly totals. Expose these for display.

Add to the instant calc return:
```js
monthly: {
  heating_kWh: [jan, feb, ..., dec],  // 12 monthly heating demand values
  cooling_kWh: [jan, feb, ..., dec],
  solar_kWh:   [jan, feb, ..., dec],  // total solar gains per month
}
```

Add a small monthly bar chart to the LiveResultsPanel (below the butterfly chart):
- 12 mini bars showing heating (red, downward) and cooling (blue, upward) by month
- This gives a quick seasonal view: "heavy heating Nov-Mar, cooling Jun-Aug"
- Updates in real time

**Commit message:** "Part 8: Monthly heating/cooling breakdown from hourly calc displayed in live results"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT:** Monthly mini-chart showing seasonal heating and cooling pattern
3. Heating should be concentrated in winter months (Nov-Mar)
4. Cooling should be concentrated in summer months (Jun-Aug)
5. Spring/autumn should have low/zero for both
6. Report: "Monthly breakdown working. Peak heating: [month] at [X] MWh. Peak cooling: [month] at [X] MWh. Clear seasonal pattern visible."

---

## PART 9: Fix heating in Systems Sankey

**File(s):** `frontend/src/utils/instantCalc.js` — the `systems_flow` generation

Now that the hourly calc produces non-zero heating, the Systems Sankey should automatically show space heating links. Verify this works and fix any issues.

**Check:**
1. With gas boiler for heating: gas → boiler → space heating link should appear with non-zero width
2. With VRF for heating: grid → VRF → space heating link should appear
3. The heating delivered value should match the `total_heating` from the hourly calc (after dividing by system efficiency)

If heating was zero before and is now non-zero, the Systems Sankey links that were previously filtered out (value ≤ 0) should now appear. If there are any hardcoded zero-checks or conditions that prevent the heating link from showing, remove them.

**Commit message:** "Part 9: Verify space heating appears in Systems Sankey with hourly calc"

**Verify:**
1. Navigate to /systems with gas boiler heating
2. **SCREENSHOT:** The Sankey should now show a gas → boiler → space heating link
3. The space heating node should have a non-zero value
4. With VRF heating: grid → VRF → space heating link visible
5. Report: "Space heating now visible in Systems Sankey. Gas boiler: [X] MWh gas → [X] MWh heating. VRF: [X] MWh elec → [X] MWh heating. Heating node no longer zero."

---

## PART 10: Full integration test

Complete walkthrough:

1. Open /building — hourly instant calc active (verify heating non-zero)
2. Check EUI against EnergyPlus: instant calc [X], EnergyPlus [X], gap [X]%
3. Toggle to Energy Flow view — fabric Sankey shows gains and losses
4. Change orientation 0° → 180° with asymmetric glazing — EUI changes, Sankey responds
5. Monthly chart shows seasonal pattern
6. Navigate to /systems — space heating link visible in Sankey
7. Switch heating from gas boiler to VRF — gas link disappears, electricity grows
8. Switch MVHR to MEV — exhaust waste appears
9. Auto-simulation triggers and refines estimates
10. Navigate to /results — all tabs still working

**SCREENSHOTS:**
1. Building fabric Sankey showing gains/losses with heating demand
2. Monthly heating/cooling pattern
3. Systems Sankey with space heating link visible
4. 3D view / Energy Flow toggle

**Commit message:** "Part 10: Full integration test — hourly calc, fabric Sankey, heating fixed"

**Verify — report:**
- Hourly calc running: ✓/✗ in [X]ms
- Heating demand non-zero: ✓/✗ at [X] MWh
- EUI accuracy vs EnergyPlus: instant [X] vs EP [X] = [X]% gap
- Fabric Sankey: ✓/✗ with [X] links
- Monthly seasonal pattern: ✓/✗
- Systems Sankey heating link: ✓/✗
- Orientation swing (asymmetric): [X] kWh/m²
- View toggle 3D/Energy Flow: ✓/✗
- Zero console errors

---

## After all 10 parts are complete

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 14 complete. Hourly instant calc running 8,760 iterations in [X]ms using real EPW weather data. Heating demand now [X] MWh (was 0 with degree-day method). EUI gap vs EnergyPlus: [X]%. Live fabric Sankey in Building module shows energy flowing through every element — updates as you drag sliders. Monthly heating peaks in [month]. Space heating now visible in Systems Sankey. Ready for Brief 15 — performance gap calibration."
