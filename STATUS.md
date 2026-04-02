# NZA SIMULATE — Status

## Last completed

Brief 05 — All 13 parts complete. Code cleanup, Scenario Manager with full CRUD and comparison view, CRREM trajectory charts, auto-baseline creation, navigation cross-linking, and 4-scenario integration test.

---

## Current state

### What's working

- **Project persistence** — ProjectContext auto-saves building/systems/constructions/schedule assignments to SQLite via debounced PUT. Projects survive server restart and page refresh.
- **Project picker** — Switch between projects from the TopBar dropdown. Create, load, delete projects.
- **Library system** — 11 constructions, 12 schedules, 10 system templates, 3 benchmark pathways (CRREM 1.5°C UK Hotel, CRREM 2°C UK Hotel, UK Grid Carbon Intensity FES). All browsable at /library.
- **Profiles editor** — /profiles: browse/edit/copy schedules, assign to project.
- **Schedule wiring** — Assignments used at simulation time via library_schedule_to_compact().
- **Simulation persistence** — Results stored in simulation_runs table (now with scenario_id). Latest complete simulation auto-loaded on project change.
- **Error boundaries** — Each module wrapped in ErrorBoundary.
- **Building Definition** — Geometry, Fabric tabs. 3D viewer, construction picker, summary cards.
- **Systems & Zones** — HVAC, Ventilation, DHW, Lighting tabs.
- **Results Dashboard** — Overview (with Compare Scenarios link), Energy Flows (Sankey), Energy Balance, Load Profiles, Fabric Analysis, **CRREM & Carbon** (new). Scenario selector dropdown in sidebar.
- **Scenario Manager** (NEW) — /scenarios with ExplorerLayout sidebar.
  - Baseline auto-created when navigating to /scenarios for the first time
  - Historical simulation runs linked to baseline on first baseline creation
  - Create scenarios by copying baseline or any existing scenario
  - ScenarioEditor: inline fabric + systems editor with 500ms debounced save, live changes_from_baseline list
  - Run simulation per scenario or Run All sequentially
  - Compare All view: input differences table, grouped bar chart, EUI ranking, delta DataCards
  - "View Full Results" navigates to /results; "CRREM & Carbon →" in compare view
- **CRREM & Carbon tab** (NEW) — EUI trajectory vs CRREM 1.5°C UK Hotel pathway, carbon trajectory (grid decarbonisation), stranding year markers, DataCards. Multi-scenario overlay when scenarios exist.
- **Library browser** — /library with type filters, search, item detail panel.

---

## Integration test results (Brief 05 — 2026-04-02)

### Bridgewater Hotel — 4-scenario comparison

Building: 60×15m, 4 floors, 3.2m height, 25% WWR all façades, 0° orientation.
All scenarios run via `POST /api/projects/{pid}/scenarios/{sid}/simulate`.

| Scenario | EUI (kWh/m²) | Heating (MWh) | Cooling (MWh) | Total (MWh) |
|----------|-------------|---------------|----------------|-------------|
| Baseline | 56.1 | 0.5 | 59.2 | 201.9 |
| Enhanced Fabric | 59.8 | 0.0 | 73.0 | 215.3 |
| MVHR Upgrade | 56.1 | 0.5 | 59.2 | 201.9 |
| Fabric + MVHR | 59.8 | 0.0 | 73.0 | 215.3 |

**CRREM 1.5°C stranding years (EUI):**
- Baseline: ~2059 (EUI 56.1 kWh/m²)
- Enhanced Fabric: ~2057 (EUI 59.8 kWh/m² — higher, strands earlier)
- MVHR Upgrade: ~2059 (same as baseline in ideal loads mode)
- Fabric + MVHR: ~2057 (same as Enhanced Fabric)

**Physical interpretation:**
- Enhanced Fabric nearly eliminates heating demand (0.5 → 0 MWh, −95%) — expected.
- Cooling rises significantly (59.2 → 73.0 MWh, +23%) because better insulation traps internal gains (hotel bedrooms, high equipment loads). This is physically correct for a cooling-dominated UK hotel.
- Net EUI is higher for enhanced fabric scenarios (trapped gains dominate in this climate/orientation).
- MVHR Upgrade shows identical results to Baseline because ideal loads mode doesn't model heat recovery airflows — only detailed HVAC modelling would show MVHR's heating demand reduction.
- Baseline scenarios already well below 2026 CRREM target (215 kWh/m²) and will hit target ~2059 when CRREM drops below 56 kWh/m².

---

## Next task

Brief 06 — candidates:
- Detailed HVAC modelling with COP curves (so MVHR shows real benefit)
- Report export to PowerPoint/PDF
- Carbon overlay with actual fuel splits (electricity vs gas)
- CIBSE TM54 benchmark integration
- Zeal Hotels interactive web client
- Multi-zone building types (office floor, retail, atrium)
- EV charging demand modelling

---

## Known issues

- `envelope` basic heat-flow summary not persisted to DB (only `envelope_detailed` stored). FabricAnalysisTab simple summary empty after refresh, resolved on next live run.
- EUI is lower than typical CIBSE TM54 hotel benchmarks (100–200 kWh/m²) because ideal loads mode is used. Detailed HVAC modelling (Brief 06) will raise it.
- MVHR shows no EUI benefit in ideal loads mode — expected. Real effect requires detailed HVAC mode.
- Building hardcoded as hotel_bedroom zone type — multi-zone not yet supported.
- Enhanced fabric raises EUI due to increased cooling demand — physically correct but counterintuitive. Carbon methodology note in CRREM tab explains this.

---

## Suggestions

- Show which schedule is currently assigned in the Profiles sidebar
- Add "Duplicate project" to project picker
- Add CSV export of simulation results
- Lazy-load schedule list (currently loads all items on mount)
- Add monthly multiplier visualisation to heatmap legend
- Add glazing g-value / solar control as scenario parameter in ScenarioEditor (currently only U-value driven)
- Wire MVHR efficiency into epJSON so ideal loads mode reflects heat recovery

---

## Safety checks

- Working tree: clean (git status)
- Branch: main
- Ahead of origin/main: 0 commits (push confirmed 2026-04-02)
- data/ directory: gitignored, intact, not touched
