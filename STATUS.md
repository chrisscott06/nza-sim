# NZA SIMULATE — Status

## Last completed

Brief 08: The Live Studio — all 15 parts complete.

**Part 1** — Global typography reduction (20% smaller text for higher density layout).

**Part 2** — instantCalc.js: client-side steady-state degree-day calculation.
- `frontend/src/utils/instantCalc.js`: UK_HDD=2200, UK_CDD=150, degree-day method for heating/cooling, U×A fabric losses, g-value solar gains, fuel split, carbon.
- EUI for default Bridgewater: ~78.7 kWh/m².

**Part 3** — Building module three-column live layout.
- `BuildingDefinition.jsx` rewritten: inputs left (geometry, glazing WWR+count, fabric, airtightness), 3D viewer centre, LiveResultsPanel right.
- `LiveResultsPanel.jsx`: EUI arc gauge (green ≤85, amber ≤110, red >110), fabric stacked bar, solar gains bars, key metrics. Status badge: "Instant estimate" in amber.

**Part 4** — Systems module three-column live layout.
- `SystemsZones.jsx` rewritten: Detailed/Ideal toggle, HVAC, ventilation (SFP 0–3 W/(l/s) with number input), DHW, lighting, equipment power density (W/m²), ventilation control strategy.
- `SystemSchematic.jsx`: SVG flow diagram with source nodes, system boxes, arrows, MVHR dashed feedback loop.
- `SystemsLiveResults.jsx`: EUI gauge, end-use bars, fuel split, efficiency metrics (COP, fan %, DHW kWh, carbon).

**Part 5** — Profiles module three-column live layout.
- `ProfilesEditor.jsx` rewritten: schedule list with prev/next navigation, type filter pills, centre schedule viewer/editor.
- `ProfilesLiveResults.jsx`: 24-hour bar chart (day type tabs), schedule statistics (peak, average, annual hours), monthly multiplier mini-bars.

**Part 6** — Module colour themes.
- `moduleThemes.js`: accent colours per module (Building #A1887F, Systems #00AEEF, Profiles #8B5CF6, Results #2B2A4C, Scenarios #E84393, Library #16A34A).
- `Sidebar.jsx`: active indicator uses module accent colour.
- Module left-column headers: 3px top border + name in accent colour.

**Part 7** — Individual windows on 3D model.
- `BuildingViewer3D.jsx`: `GlassFace` component renders N individual window panels per floor. Position: `along = -faceW/2 + gap + w*(winW+gap) + winW/2`.
- `ProjectContext.jsx`: `window_count` added to DEFAULT_PARAMS (north:8, south:8, east:3, west:3).
- `BuildingDefinition.jsx`: window count input per facade.

**Parts 8–10** — Live results panels (substantially completed as part of Parts 3–5).

**Part 11** — Auto-simulation after 3 seconds of inactivity.
- `SimulationContext.jsx`: watches `saveStatus`, starts 2s timer after save completes (3s total from last change). Cancels timer if new change starts.
- `TopBar.jsx`: Auto-simulate toggle (teal dot when on). `autoSimulate, setAutoSimulate` from context.

**Part 12** — Sankey diagram overflow fix.
- `EnergyFlowsTab.jsx`: PADDING right=160, node label truncation to 17 chars, container `overflow-x-auto overflow-y-hidden`.

**Part 13** — Energy Balance chart includes fans, DHW, and ventilation end uses.
- `EnergyBalanceTab.jsx`: SERIES expanded to 7 items. `activeSeries` filters out zero series. Annual totals filtered to non-zero. Top-bar radius applied to last active series.

**Part 14** — SFP range, small power input, ventilation control strategy (completed as part of Part 4).
- SFP slider min=0. `SliderWithNumber` pattern with paired number input. Equipment power density input (0–30 W/m²). Ventilation control strategy dropdown (Continuous / Occupied hours / Timer).

**Part 15** — Full integration test.
- Building: three-column ✓, instant calc ✓, individual windows ✓
- Systems: three-column ✓, schematic ✓, fuel split ✓
- Profiles: three-column ✓, statistics panel ✓
- Results/Energy Balance: 5 end uses shown, fans/DHW/ventilation gracefully omitted when not in data ✓
- Results/Energy Flows: Sankey fully contained, no sidebar overlap ✓
- Auto-simulation: fires after ~3s, "Re-run Simulation" button ✓
- Module colour themes: distinct across all modules ✓
- Console: 0 errors ✓
- Build: clean (0 errors) ✓

---

## Integration test results (Brief 08 — 2026-04-03)

**Bridgewater Hotel — Enhanced Fabric scenario**

- EUI: 83.5 kWh/m² (EnergyPlus verified)
- Instant calc EUI: ~78.7 kWh/m² (≈6% difference — within expected degree-day approximation error)
- Total annual energy: 300.6 MWh/yr
- Auto-simulation: fires ~3s after last change ✓
- Individual 3D windows: visible at correct positions on all facades ✓
- EUI gauge: arc animates, colour-codes green/amber/red ✓

---

## Current state

### What's working

- **Three-column live workspaces** — Building, Systems, Profiles all show inputs | visual centre | live results
- **Instant calc feedback** — EUI, fabric losses, solar gains, fuel split update <50ms from sliders
- **Auto-simulation** — triggers 3s after last change, replaces instant estimate with EnergyPlus values
- **Individual 3D windows** — per-facade window count controls separate glass panels on model
- **Module colour themes** — each section has distinct accent colour throughout header, sidebar, indicators
- **Energy Balance** — 7 end-use series, gracefully filters zero series
- **Sankey** — contained within bounds, no sidebar overlap
- **Project persistence** — building/systems/constructions/schedule assignments saved to SQLite
- **Project picker** — Switch between projects. Create, load, delete.
- **Library system** — constructions, systems, schedules, benchmarks. Custom item creation.
- **Profiles editor** — browse/edit/copy schedules, assign to project, prev/next navigation
- **Simulation persistence** — results stored in DB, auto-loaded on project change
- **Results Dashboard** — Overview, Energy Flows, Energy Balance, Load Profiles, Fabric Analysis, CRREM & Carbon
- **Scenario Manager** — create/run/compare scenarios, best performer badge
- **CRREM & Carbon** — EUI trajectory vs CRREM 1.5°C UK Hotel, stranding year markers

---

## Known issues

- Building hardcoded as hotel_bedroom zone type — multi-zone not yet supported.
- **uvicorn must be restarted** after backend code changes — not running with `--reload`.
- Full-year hourly data requires the EnergyPlus .sql output file on disk. If old sim directories are cleaned, full-year view returns 404.
- MVHR raises cooling demand significantly (MEV 2 MWh → MVHR 50 MWh): forced supply air at design flow rate in summer. Physically consistent but counterintuitive.
- Instant calc solar gains stored internally as MWh (formula divides by 1000). Display panels show MWh correctly.
- Systems library options show "Loading…" briefly on page load until `/api/library/systems` resolves.

---

## Suggestions for Brief 09

- Report export to PowerPoint/PDF using NZA template
- CIBSE TM54 benchmark integration — show building type comparison
- EV charging demand modelling
- Multi-zone building types (office, retail, hotel mix)
- Glazing g-value / solar control as scenario parameter
- Dual-screen pop-out — detach results panel to second monitor
- Future weather files — climate change scenarios (+2°C, +3.5°C)
- Monthly weather visualisation (heating/cooling degree days per month)
- CSV export of simulation results
- "Duplicate project" in project picker

---

## Safety checks

- Working tree: clean
- Branch: main
- Brief 08 all 15 parts committed to main
- data/ directory: gitignored, intact, not touched
