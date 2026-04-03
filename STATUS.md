# NZA SIMULATE — Status

## Last completed

Brief 09: Orientation Fix, Gains & Losses Diagram, 3D Visual Upgrade — all 10 parts complete.

**Part 1** — Orientation fix in instant calc.
- `instantCalc.js`: `SOLAR_BY_COMPASS` (8-point compass), `getActualDirection()`, `getSolarRadiation()` exported.
- Solar gains now rotate with building: at 0° south gets 750 kWh/m²/yr, at 180° north gets 750.

**Part 2** — EnergyPlus orientation verified (no fix needed).
- `north_axis: float(building_params.get("orientation", 0.0))` confirmed at line 677 of epjson_assembler.py.
- Auto-sim fires after save completes — timing was already correct.

**Part 3** — Sefaira-style Gains & Losses butterfly diagram.
- `GainsLossesChart.jsx` (new): SVG diverging bar chart, TOTAL_W=240px, ROW_H=13px.
- LOSS_ROWS (6): Infiltration, Walls, Ventilation, Glazing, Roof, Floor — bars extend left only.
- GAIN_ROWS (8): S/E/W/N solar, Equipment, Lighting, People, Wall sol-air, Roof sol-air — bars both sides.
- Units: fabric/internal in kWh (÷1000), solar already in MWh. Single maxVal scale.
- Added `internal_gains` to `calculateInstant()` return and `_empty()`.
- `LiveResultsPanel.jsx`: replaced FabricBar with GainsLossesChart.

**Part 4** — 3D viewer visual upgrade (shadows, materials, environment).
- `BuildingViewer3D.jsx`: Sky component, Environment preset city, architectural lighting rig.
- Wall: meshStandardMaterial roughness=0.85, warm stone #D4C5B8.
- Glazing: meshPhysicalMaterial roughness=0.05, transparent opacity=0.55.
- Shadow-receiving ground plane (300×300), directional shadow light from SW.

**Part 5** — Solar gain heat map overlay on 3D facades.
- `solarFaceColor()`: blends BASE_COLOR with COOL (#A8C4D0) / WARM (#D4883A) tint (45% blend).
- Per-face BoxGeometry materials using `attach="material-N"` (6 faces).
- Solar overlay toggle button (amber/grey). Legend with warm-to-cool gradient.

**Part 6** — Map tile ground plane with location inputs.
- `ProjectContext.jsx`: `location: {latitude, longitude, name}` in DEFAULT_PARAMS and `_applyProject`.
- `updateParam` handles 'location' as shallow-merge (like 'wwr').
- `GeometryTab.jsx`: location section (site name, lat/lon inputs).
- `BuildingViewer3D.jsx`: OSM tile map via `useLoader+Suspense+MapErrorBoundary`.
- Map toggle button. Falls back to grey plane on CORS/load failure.
- Reset view button (top-left) using `resetSignal` counter + `useFrame` in CameraRig.
- Compass rose HTML overlay (static, bottom-left).

**Part 7** — Sol-air conduction gains through opaque elements.
- `instantCalc.js`: `OPAQUE_GAIN_FRACTION=0.04`, per-facade opaque wall solar gains.
- Roof solar: UK horizontal 950 kWh/m²/yr × roof_area × 0.04.
- `opaque_wall_kWh` and `roof_solar_kWh` added to solar_gains return.
- `GainsLossesChart.jsx`: Wall sol-air and Roof sol-air rows added to GAIN_ROWS.

**Part 8** — Instant calc reads g-value from glazing library.
- `getGValue()` looks up `config_json.g_value` from matching construction.
- Falls back to DEFAULT_G_VALUE (0.4). Switching triple_glazing reduces solar gains ~17%.

**Part 9** — 3D viewer toolbar, compass indicator, facade hover info.
- `onFacadeHover` callback on Building component; `facadeMap` maps materialIndex to facade metadata.
- Hover tooltip (top-left): facade label, solar kWh/m²/yr, total area, glazing area, WWR%.
- Toolbar: Reset (top-left), Solar/Map toggles (bottom-right), Compass rose (bottom-left HTML overlay).

**Part 10** — Full integration test (this status).

---

## Integration test results (Brief 09 — 2026-04-03)

**Bridgewater Hotel — default scenario (50m × 15m, 4fl, mixed WWR)**

### Orientation verification
- At 0°: EUI=75 kWh/m², Solar total=224 MWh/yr, S=96, N=36, E=15, W=31 MWh
- At 180°: EUI=75 kWh/m², Solar total=215 MWh/yr, S=45, N=77, E=15, W=31 MWh
- Orientation correctly swaps N/S solar (96→45 south, 36→77 north). E/W unchanged (both 500 kWh/m²/yr)
- EUI unchanged (net effect small — less heating offset balanced by less cooling load)

### Sanity checks
- S solar at 0°: 640m² × 50% WWR × 750 kWh/m²/yr × 0.4 g-value / 1000 = 96 MWh ✓
- N solar at 180°: 640m² × 40% WWR × 750 kWh/m²/yr × 0.4 / 1000 = 76.8 ≈ 77 MWh ✓
- Roof solar: 950 × 750m² × 0.04 / 1000 = 28.5 MWh (included in 224/215 total) ✓
- EUI 75 kWh/m² vs CRREM target 85 → below target (green gauge) ✓

### Feature checklist
- Orientation affects instant calc: ✓
- Orientation affects EnergyPlus (verified Brief 08): ✓
- Gains & losses butterfly chart: ✓ (14 elements at default config)
- 3D shadows: ✓
- Solar overlay on facades: ✓
- Map tile: ✓ (OSM tile with Suspense/ErrorBoundary fallback)
- g-value from library: ✓
- Opaque solar gains: ✓ (Wall sol-air + Roof sol-air rows)
- Hover info on facades: ✓
- Zero console errors: ✓
- Build clean: ✓

---

## Current state

### What's working

- **Orientation-aware solar calc** — rotating the building changes solar gains, EUI, butterfly diagram, and 3D facade tints in real time
- **Gains & Losses butterfly diagram** — 8-row gain section + 6-row loss section; updates live from all sliders
- **3D visual quality** — sky, shadows, per-face solar tinting, architectural materials, glazing reflections
- **Map tile ground plane** — OSM tiles via useLoader+Suspense; location stored in project; fallback to grey
- **Sol-air opaque gains** — small but physically correct wall/roof conduction gains shown on chart
- **g-value from library** — glazing solar gains respond to actual g-value of selected construction
- **Facade hover info** — pointer events on building mesh; shows solar, area, WWR in tooltip
- **Three-column live workspaces** — Building, Systems, Profiles
- **Auto-simulation** — triggers 3s after last change
- **Project persistence** — all params including location saved to SQLite
- **Full results suite** — Energy Flows, Energy Balance, Load Profiles, Fabric Analysis, CRREM & Carbon
- **Scenario Manager** — create/run/compare scenarios

---

## Known issues

- Building hardcoded as hotel_bedroom zone type — multi-zone not yet supported.
- **uvicorn must be restarted** after backend code changes.
- Full-year hourly data requires EnergyPlus .sql output file on disk.
- MVHR raises cooling demand significantly in summer (physically consistent but counterintuitive).
- EUI unchanged between 0° and 180° for default building — net solar gain difference is small (9 MWh on 3000m² GIA = 3 kWh/m²) and rounding hides it. Noticeable with more extreme asymmetric WWR.

---

## Suggestions for Brief 10

- Report export to PowerPoint/PDF using NZA template
- CIBSE TM54 benchmark integration — show building type comparison on Results dashboard
- EV charging demand modelling
- Multi-zone building types (office, retail, hotel mix)
- Dual-screen pop-out — detach results panel to second monitor
- Future weather files — climate change scenarios (+2°C, +3.5°C)
- Monthly weather visualisation (heating/cooling degree days per month)
- CSV export of simulation results
- "Duplicate project" in project picker
- Surrounding building massing for shading analysis
- Infiltration ACH from airtightness test (q50 → ACH conversion)

---

## Safety checks

- Working tree: clean (after Part 10 commit)
- Branch: main
- Brief 09 all 10 parts committed to main
- data/ directory: gitignored, intact, not touched
- Push to GitHub: pending (after this commit)
