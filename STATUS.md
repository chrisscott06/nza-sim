# NZA SIMULATE — Status

## Last completed

**Brief 18b** — Font fix, Bridgewater corrections, weather file management, PROMETHEUS setup, manual multi-fuel consumption, multi-year CRREM trajectory (2026-04-06). Committed (30bfb9d) and pushed to GitHub.

**Brief 18b parts completed:**
- Part 1: Body font-weight 300→400 (Regular) in index.css
- Part 2: Bridgewater DEFAULT_PARAMS corrected: 63×13.4×5fl = 4,221m² GIA, 134 rooms, Bridgwater Somerset location (lat 51.087, lon -2.985)
- Part 3: Weather multi-directory resolver (current/ → future/ → EnergyPlus fallback); GET /api/weather list endpoint with PROMETHEUS metadata parsing; BuildingDefinition Location & Climate section with current + future weather dropdowns and location mismatch warning; WeatherContext future_weather_file support
- Part 4: scripts/setup_weather.py — unpacks PROMETHEUS nested city.zip → scenario.zip → .epw into current/ and future/{period}_{scenario}/ structure
- Part 5: POST /api/projects/{id}/consumption/manual (ManualFuelEntry, ManualConsumptionRequest models); ManualConsumptionInput.jsx (multi-fuel annual form, live EUI/carbon metrics, CRREM V2.07 status badge); ConsumptionManager Upload File / Manual toggle; fix stale setShowUpload reference
- Part 7: CRREMTab multi-year actual data — group actualDatasets by year, compute EUI + carbon per year; EuiTrajectoryChart shows red Line with dots for actual trend; CarbonTrajectoryChart shows actual carbon dots; inline year-by-year mini-table; methodology note updated to CRREM V2.07

**Parts 6, 8, 9, 10 (Brief 18b):** Part 6 = data entry (manual — done via UI); Parts 8–10 = dashboard/weather auto-select/future weather (deferred — Brief 18b Part 3 covers the dropdowns)

**Brief 18 Parts 1–7** committed (c3109b9) — ProjectDashboard, ProfilesEditor zone filter, SchedulePreview, instantCalc schedules, BroadcastChannel, PopOutResults, TopBar Pop Out button.

Brief 17 all parts complete (2026-04-04). Committed and pushed to GitHub.

**Brief 17 progress (all committed — single combined commit):**
- Part 1: HomePage rewritten — project cards (name, GIA, EUI badge, last modified, run count); New Project card; N logo links home; magenta border on current project
- Part 2: projects.py list_projects — json_extract for bc_length/width/num_floors/floor_height/latest_eui; requires backend restart to activate (building_config keys confirmed correct)
- Part 3: index.css — mid-grey darkened to #6B7280, dark-grey to #4B5563; panel font-size token (9px) added
- Part 4: BuildingDefinition — CollapsibleSection replaces SectionHeader; #A1887F accent background, ▾/▸ chevron, defaultOpen=true for all 5 sections
- Part 5: SystemsZones — AccordionSection header uses solid accentColor background with white text (teal #00AEEF for Systems module)
- Part 6: FabricSankey — facade nodes renamed Glazing F1(N)/F2(E)/F3(S)/F4(W); Roof Solar split from Wall Solar; accepts orientation prop
- Part 7: BuildingViewer3D — WWR-proportional window height (linear scale 80–100%: 60%→95% height, near-zero sill at 100%); camera presets Iso+F1–F4 with smooth lerp (factor 0.12/frame); active preset highlighted navy
- Part 8: BuildingViewer3D — auto-rotate defaults to false

**Action required:** Restart backend to activate project list dimensions/EUI (`python -m uvicorn api.main:app --host 127.0.0.1 --port 8002`)

Brief 16 all parts complete (2026-04-04).

**Brief 16 progress (all committed):**
- Part 1: window_count merge fix in ProjectContext.updateParam — changing one facade no longer resets others. Left panel widened to w-72.
- Part 2: Parser — _is_meta_sheet() skips Instructions/README sheets in multi-sheet Excel; boosted column scoring for "Interval start datetime" and "Import from grid (kWh)"; has_time long-format detection already in place from Brief 15.
- Part 3: Removed ↗ expand button from butterfly chart (was redundant with centre-column Energy Flow toggle). Increased FabricSankey left extent from 32→90px — all left-side labels now fully visible.
- Part 4: Regression test ✓ — window counts, Sankey labels, no expand button, consumption, systems Sankey, auto-sim, zero console errors.

Brief 15 all parts complete (2026-04-04).

**Brief 15 progress (all committed):**
- Part 1: EUI gauge fix — replaced SVG arc with horizontal bar gauge (no jitter)
- Part 2: Consumption schema (`consumption_data`, `consumption_records`), CRUD API
- Part 3: CSV/Excel parser (`consumption_parser.py`) + gap-filling assembly engine (`assembly_engine.py`)
- Part 4: ConsumptionUpload.jsx (drag-drop, parse summary, fuel type override, provenance bar), ConsumptionManager.jsx (three-column layout, dataset cards, delete), Sidebar icon (FileSpreadsheet, #2D6A7A), moduleThemes, App.jsx route
- Part 5: MonthlyComparisonChart.jsx (actual bars + CRREM reference line, status banner, EUI gap %)
- Part 6: DailyProfileChart.jsx (AreaChart with Brush zoom), HalfHourlyHeatmap.jsx (canvas carpet plot, HSL ramp, tooltip)
- Part 7: ModelComparisonChart.jsx (actual solid bars + modelled outline bars, gap cards, explanation panel)
- Part 8: CRREMTab updated — red ReferenceDot at actual year, actual EUI panel with performance gap and actual stranding year
- Part 9: Navigation wiring — /consumption route, sidebar, moduleThemes, App.jsx
- Part 10: Integration test ✓ — synthetic hotel HH CSV (17,568 records, 1,124,814 kWh, 312 kWh/m² EUI, 30-min, 99.7% coverage). All tabs verified. CRREM red dot visible. Zero console errors.

**Brief 14 progress (all committed):**
- Parts 1–9 complete. Part 10 browser integration test TO DO.

**Brief 13 progress (all committed):**
- Parts 1–12 complete. Part 12 browser test TO DO.

---

## Integration test results (Brief 12 — 2026-04-03)

**Bridgewater Hotel — Systems module full walkthrough**

### Part 1: 3D fixes ✓
- Z-fighting fixed: ContactShadows moved to y=0.02 (was -0.01, same level as ground plane)
- Walls: `#EBEBEB` clean light grey, roughness 0.9, matte finish ✓
- Glass: `#A8C8E0` consistent blue tint, opacity 0.35, visible from all angles ✓

### Part 2: System dropdowns ✓
- Fixed `l.type` → `l.category` for all three dropdown filters
- HVAC: 4 options, Ventilation: 3 options, DHW: 2 options — all populated ✓

### Part 3: Heating demand ✓
- Reduced `util_factor` from 0.75 → 0.60 (hotel 24-hour occupancy — less gains coincident with heating)
- Heating now shows 2 MWh (genuinely small for this cooling-dominated building with MVHR)
- Display shows "< 1 MWh" for very small non-zero values, "0" → "< 1" fix applied ✓

### Part 4: Accordion inputs ✓
- 5 collapsible sections: HVAC, Ventilation, DHW, Lighting, Small Power
- Single-expand mode with smooth CSS max-height transition
- One-line summaries update in real time (COP, MVHR HR%, setpoints)
- Teal left border + background tint on expanded section ✓

### Part 5: Systems flow data model ✓
- `systems_flow` in instantCalc returns nodes[] and links[] for Sankey
- 14 nodes, 11 links for VRF + MVHR + Gas Boiler config
- Conditional: MVHR recovery node/link, gas node, ASHP cascade link all conditional on config
- All links filtered to value > 0 ✓

### Part 6: Systems Sankey ✓
- d3-sankey (sankeyLeft) with string-based nodeId — critical: links reference string IDs not indices
- 11 links, 14 nodes rendered correctly at 1440×900
- Link colours: electricity=gold, gas=red, heating=red, cooling=blue, recovered=green dashed, waste=grey dashed
- MVHR recovery link visible (Recovered Heat node, green dashed path) ✓
- Footer: "Total site energy: 232.2 MWh/yr — Electricity 67% · 156 MWh / Gas 33% · 76 MWh" ✓
- ResizeObserver for responsive SVG ✓
- Badges: Detailed, MVHR (updates when mode/vent type changes) ✓

### Part 7: Node hover and click-to-expand ✓
- Hover: connected links brighten (+0.35 opacity), unconnected links dim to 0.08 opacity
- Unconnected nodes dim to 0.3 opacity — 300ms CSS transition
- Tooltip: node label, metric, in/out flows, COP multiplier, "click to edit" hint
- Click system node → expands corresponding accordion section ✓

### Part 8: Animations and badges ✓
- CSS `transition: 'stroke-width 300ms ease, stroke-opacity 300ms ease'` on all links
- Node dim/highlight: `opacity` with 300ms transition
- Mode badges: Detailed/Ideal Loads, MVHR/MEV, ASHP Preheat (when enabled)
- ASHP badge appeared instantly when preheat enabled — confirmed ✓

### Part 9: Systems live results ✓
- System efficiency section (only in Detailed mode): VRF COP 3.2×, MVHR 95% net HR, Boiler 92% eff
- FlowRow format: "X MWh in → Y MWh out" with colour-coded detail
- MVHR Heat Recovery callout: 71 MWh recovered, £3,550/yr gas saving @ 5p/kWh, ~17 tCO₂/yr avoided
- ASHP preheat callout appears when enabled; boiler label changes to "DHW System (Gas + ASHP)" with COP display
- Fuel split bar consistent with Sankey totals ✓

### Part 10: Integration test ✓
All checklist items:
- Z-fighting fixed: ✓
- Grey walls: ✓ (#EBEBEB)
- Blue glass: ✓ (#A8C8E0)
- Dropdowns populated: ✓ (4+3+2 options)
- Heating display: ✓ (shows 2 MWh, not "0 MWh")
- Accordion sections: ✓ (5 collapsible, summaries update live)
- Sankey rendering: ✓ (14 nodes, 11 links)
- MVHR recovery link: ✓ (71 MWh, green dashed)
- ASHP cascade link: ✓ (appeared when preheat enabled, EUI dropped 77→66)
- Animated transitions: ✓ (300ms on hover, link width, opacity)
- Click-to-expand: ✓ (Sankey node click opens accordion)
- System efficiency callouts: ✓ (VRF COP, MVHR recovery, boiler eff)
- Zero console errors: ✓

---

## Current state

### What's working

- **Consumption module** — `/consumption` route with FileSpreadsheet sidebar icon (#2D6A7A). Three-column layout: dataset list + upload (left), visualisation tabs (centre), metrics panel (right).
- **Consumption upload** — Drag-and-drop or file picker. Accepts CSV/XLSX. Uploads to API, shows parse summary with provenance stacked bar. Fuel type override (electricity/gas). Confirm import button.
- **Monthly comparison chart** — Recharts ComposedChart with monthly kWh bars and CRREM average monthly reference line. Status banner (compliant/at-risk/non-compliant) with actual EUI vs target.
- **Daily profile chart** — AreaChart with Brush zoom. Summary stats. Hint when zoomed to ≤14 days.
- **Half-hourly heatmap** — Canvas carpet plot. Time-of-day (Y) vs date (X). HSL colour ramp by kWh intensity. Crosshair tooltip. Colour legend.
- **Model vs Actual chart** — Solid actual bars + outline modelled bars. Gap summary cards. 5-item performance gap explanation panel.
- **CRREM trajectory updated** — Red ReferenceDot at actual year shows actual EUI above modelled line. Actual EUI panel below chart shows performance gap and actual stranding year (vs modelled).
- **Gap-filling assembly engine** — donor year (scaled 0.5–2.0) → weekday average → interpolation → monthly average cascade. Provenance tracking per slot. Complete annual profile guaranteed.
- **Hourly instant calc** — 8760-iteration loop using real EPW weather data. Non-zero heating demand in winter. Monthly breakdown arrays for seasonal display.
- **WeatherContext** — loads and caches EPW hourly data from backend API on app start.
- **useHourlySolar hook** — memoised solar precomputation. Recomputes only on orientation change.
- **Live Fabric Sankey** — in Building module centre column. Toggle: "3D Model | Energy Flow".
- **Monthly heating/cooling chart** — 12-bar chart in LiveResultsPanel.
- **Space heating in Systems Sankey** — now non-zero from hourly calc.
- **Systems Sankey** — all panels wired to hourly calc.
- **Full results suite** — Energy Flows, Energy Balance, Load Profiles, Fabric Analysis, CRREM & Carbon
- **Scenario Manager** — create/run/compare scenarios

---

## Known issues

- Building hardcoded as hotel_bedroom zone type — multi-zone not yet supported
- **uvicorn must be restarted** after backend code changes
- Full-year hourly data requires EnergyPlus .sql output file on disk
- MVHR raises cooling demand significantly in summer (physically consistent but counterintuitive)
- `SolarBars` component in `LiveResultsPanel.jsx` is dead code — harmless
- Heatmap fetches all records at once (no pagination) — could be slow for large datasets with full year HH data

---

## Suggestions

- Report export to PowerPoint/PDF using NZA template
- CIBSE TM54 benchmark integration — show building type comparison on Results dashboard
- Multi-zone building types (office, retail, hotel mix)
- Future weather files — climate change scenarios (+2°C, +3.5°C)
- Monthly weather visualisation (heating/cooling degree days per month)
- CSV export of simulation results
- "Duplicate project" in project picker
- Surrounding building massing for shading analysis
- Brief 16: Reality factors — adjust occupancy, system efficiency, unmetered loads to close model vs actual gap
- Pagination for heatmap records API call (e.g. ?limit=17520 or stream)
- Clean up dead `SolarBars` function in LiveResultsPanel.jsx
- Node hover link labels (show kWh value on hovered links)

---

## Safety checks

- Working tree: clean (after Brief 18b commit)
- Branch: main
- Brief 18b committed to main; pushed to GitHub ✓ (30bfb9d)
- data/ directory: gitignored, intact, not touched
