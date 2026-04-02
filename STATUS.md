# NZA SIMULATE — Status

## Last completed

Brief 07 Part 4 — Gas boiler DHW with ASHP preheat option.
- `nza_engine/generators/hvac_ventilation.py` (new): `generate_ventilation_system()` — MEV via `ZoneVentilation:DesignFlowRate` (exhaust), MVHR via `ZoneHVAC:EnergyRecoveryVentilator` + `HeatExchanger:AirToAir:SensibleAndLatent` + 2×`Fan:SystemModel` per zone with NodeList-based zone connections.
- Assembler updated: detailed mode now calls ventilation generator after VRF, merging with `setdefault().update()` to preserve VRF fan objects alongside ERV fans.
- `api/routers/simulate.py`: added `mvhr_efficiency: float = 0.85` to `SystemsConfig`.
- Verified: MEV heating 29.4 MWh → MVHR 2.0 MWh (93% reduction). Zero fatal/severe errors both modes.

---

## Current state

### What's working

- **Project persistence** — ProjectContext auto-saves building/systems/constructions/schedule assignments to SQLite via debounced PUT. Projects survive server restart and page refresh.
- **Project picker** — Switch between projects from the TopBar dropdown. Create, load, delete projects.
- **Library system** — 11 constructions, 12+ schedules (incl. ventilation), 10+ system templates, 3 benchmark pathways. All browsable at /library. Custom constructions and system templates can be created/duplicated/deleted.
- **Profiles editor** — /profiles: browse/edit/copy schedules, assign to project.
- **Schedule wiring** — Assignments used at simulation time via library_schedule_to_compact().
- **Simulation persistence** — Results stored in simulation_runs table. Latest complete simulation auto-loaded on project change.
- **Error boundaries** — Each module wrapped in ErrorBoundary.
- **Building Definition** — Geometry, Fabric tabs. 3D viewer, construction picker, infiltration slider (0.1–2.0 ACH), fabric summary card.
- **Systems & Zones** — HVAC, Ventilation, DHW, Lighting tabs. Heat recovery hidden for MEV, editable for MVHR. LPD range 0–20 W/m² with LED/Fluorescent/Incandescent presets.
- **Results Dashboard** — Overview (with building summary strip + Compare link), Energy Flows (Sankey with scenario title), Energy Balance, Load Profiles (typical day + full year with brush zoom + fuel toggle), Fabric Analysis, CRREM & Carbon. Scenario selector updates ALL tabs.
- **Scenario Manager** — /scenarios with ExplorerLayout sidebar. Baseline auto-created. Create/run/compare scenarios. Compare view has best performer badge (trophy).
- **CRREM & Carbon tab** — EUI trajectory vs CRREM 1.5°C UK Hotel pathway, carbon trajectory (grid decarbonisation), stranding year markers. Multi-scenario overlay.
- **Library browser** — /library with type filters, search, item detail panel. Custom item creation for constructions (layer editor + quick U-value) and systems (parameter editor). Duplicate/delete items.
- **Home page** — 5-step getting started guide when no simulation has been run.

---

## Brief 06 — Bug fixes and improvements summary

### Bugs fixed
- ✅ **Part 1**: Sankey diagram layout error — defensive data handling, filters zero/NaN links
- ✅ **Part 2**: Carbon trajectory showing zero — reads `annual_energy.total_kWh` (always present) instead of `results_summary.total_energy_kWh` (null in DB)
- ✅ **Part 3**: Envelope persistence — `normalizeDbResult` reconstructs basic `envelope` from `envelope_detailed` so Fabric Analysis works after page refresh
- ✅ **Part 4**: Scenario selector now updates ALL Results tabs (Overview, Energy Balance, Load Profiles, Fabric Analysis, CRREM) not just CRREM

### UI gaps closed
- ✅ **Part 5**: Infiltration rate input on Fabric tab (slider 0.1–2.0 ACH, airtightness guidance)
- ✅ **Part 6**: Heat recovery hidden for MEV, editable for MVHR. LPD range 0–20 W/m² with 4 presets.
- ✅ **Part 7**: Ventilation schedules (continuous, occupied, timer) added to library and assembler
- ✅ **Part 8**: Expanded load profile end uses (fans, DHW, ventilation loss) + fuel type toggle (All / Electricity / Gas)

### New features
- ✅ **Part 9**: Custom construction creation — quick U-value method + layer editor. Duplicate existing constructions.
- ✅ **Part 10**: Custom system template creation — parameter editor for VRF/ASHP/Gas Boiler/MEV/MVHR/Natural Ventilation. Duplicate existing systems.
- ✅ **Part 11**: Full-year zoomable load profile — 8760h data via `/api/simulate/{run_id}/hourly`, daily aggregates + navigator brush, auto-switches to hourly when ≤13 days selected
- ✅ **Part 12**: Centralised colour constants — `SCENARIO_COLORS`, `ENDUSE_COLORS`, `FABRIC_COLORS` in `chartTokens.js`
- ✅ **Part 13**: UI polish — Fabric summary card, building summary on Overview, Sankey title with scenario+MWh, best performer badge in Comparison, 5-step getting started guide
- ✅ **Part 14**: Integration test verified — clean build (zero errors). All 13 prior parts compile and cross-reference correctly.

---

## Integration test results (Brief 05 — 2026-04-02)

### Bridgewater Hotel — 4-scenario comparison

Building: 60×15m, 4 floors, 3.2m height, 25% WWR all façades, 0° orientation.

| Scenario | EUI (kWh/m²) | Heating (MWh) | Cooling (MWh) | Total (MWh) |
|----------|-------------|---------------|----------------|-------------|
| Baseline | 56.1 | 0.5 | 59.2 | 201.9 |
| Enhanced Fabric | 59.8 | 0.0 | 73.0 | 215.3 |
| MVHR Upgrade | 56.1 | 0.5 | 59.2 | 201.9 |
| Fabric + MVHR | 59.8 | 0.0 | 73.0 | 215.3 |

---

## Brief 07 progress

- ✅ Part 1: HVAC implementation research — `docs/hvac_implementation_notes.md`
- ✅ Part 2: VRF system generator — native AirConditioner:VariableRefrigerantFlow with full performance curves
- ✅ Part 3: MEV and MVHR ventilation generators
- ✅ Part 4: Gas boiler DHW — WaterHeater:Mixed standalone mode, ASHP two-tank cascade. Gas Only 12,308 kWh → ASHP preheat 3,515 kWh gas (71% reduction)
- ✅ Part 5: Fuel-split results — get_energy_by_fuel() in sql_parser; fuel_split key in API response; CRREM carbon uses real electricity+gas formula (gas constant 0.183 kgCO₂/kWh)
- ⬜ Part 5: Fuel-split results and carbon calculation
- ⬜ Part 6: Frontend system mode toggle
- ⬜ Parts 7–10: Scenario comparison, performance curves, Bridgewater test, integration

---

## Next task (Brief 07, Part 4)

- Detailed HVAC modelling with COP curves (so MVHR, ASHP show real benefit vs ideal loads)
- Report export to PowerPoint/PDF using NZA template
- Carbon overlay with actual fuel splits (electricity vs gas DHW)
- CIBSE TM54 benchmark integration
- EV charging demand modelling
- Multi-zone building types (office, retail, hotel mix)

---

## Known issues

- MVHR shows no EUI benefit in ideal loads mode — expected. Real effect requires detailed HVAC mode (Brief 07).
- Building hardcoded as hotel_bedroom zone type — multi-zone not yet supported.
- Enhanced fabric raises EUI due to increased cooling demand — physically correct but counterintuitive. Note in CRREM tab explains this.
- Full-year hourly data requires the EnergyPlus .sql output file to still exist on disk (`data/simulations/{run_id}/eplusout.sql`). If old simulation directories are cleaned, full-year view returns a 404.

---

## Suggestions for Brief 07

- Detailed HVAC mode: real system objects (ZoneHVAC:IdealLoadsAirSystem → real fan coil / DX coil with COP curves)
- Wire MVHR efficiency into epJSON so ideal loads mode reflects heat recovery
- Show which schedule is currently assigned in the Profiles sidebar
- Add "Duplicate project" to project picker
- Add CSV export of simulation results
- Add glazing g-value / solar control as scenario parameter in ScenarioEditor
- Monthly weather visualisation (heating/cooling degree days per month)

---

## Safety checks

- Working tree: clean (git status)
- Branch: main
- Ahead of origin/main: 0 commits (push confirmed 2026-04-02)
- data/ directory: gitignored, intact, not touched
