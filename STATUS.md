# NZA SIMULATE — Status

## Last completed

Brief 04 — All 14 parts complete. Project persistence, library system, profiles editor, schedule wiring, results persistence, error boundaries, and full integration test.

---

## Current state

### What's working

- **Project persistence** — ProjectContext auto-saves building/systems/constructions/schedule assignments to SQLite via debounced PUT. Projects survive server restart and page refresh.
- **Project picker** — Switch between projects from the TopBar dropdown. Create, load, delete projects.
- **Library system** — 11 constructions, 12 schedules (hotel + office + retail templates), 10 system templates. All browsable at /library with type filters, search, and item detail.
- **Profiles editor** — /profiles: browse schedules with type/zone filters, view day profile chart and annual heatmap, edit/copy custom schedules with drag-to-paint bar chart and monthly multiplier sliders, save to library, assign to project.
- **Schedule wiring** — Assignments stored in project, fetched from library at simulation time, converted from day_types/monthly_multipliers to EnergyPlus Schedule:Compact via library_schedule_to_compact().
- **Simulation persistence** — Results stored in simulation_runs table. Latest complete simulation auto-loaded on project change / page refresh.
- **Error boundaries** — Each module wrapped in ErrorBoundary. Catches crashes with Try Again card.
- **Loading states** — Full-page spinner during project bootstrap. Skeleton placeholders in Results Dashboard while DB results load.
- **Save indicator** — TopBar shows Saving… / Saved ✓ / Save failed. Run Simulation gates on save completion.
- **Building Definition** — Geometry, Fabric tabs. 3D viewer, construction picker, summary cards.
- **Systems & Zones** — HVAC, Ventilation, DHW, Lighting tabs. All settings saved to project.
- **Results Dashboard** — Overview, Energy Flows (Sankey), Energy Balance, Load Profiles, Fabric Analysis. All tabs wrapped in ErrorBoundary.
- **Library browser** — /library with type filters, search, item detail panel.

---

## Integration test results (2026-04-02)

### Project 1: Bridgewater Hotel (standard fabric)
Building: 60×15m, 4 floors, 3.2m height, 25% WWR all façades, 0° orientation
Constructions: cavity_wall_standard, flat_roof_standard, ground_floor_slab, double_low_e

| Metric | Value |
|--------|-------|
| EUI | 56.1 kWh/m² |
| GIA | 3,600 m² |
| Annual heating | 548 kWh |
| Annual cooling | 59,160 kWh |
| Annual lighting | 67,118 kWh |
| Annual equipment | 75,071 kWh |
| Peak heating | 5.9 W/m² |
| Peak cooling | 13.1 W/m² |
| Unmet hours | 0 h / 0 h |

### Project 2: Bridgewater — Enhanced Fabric
Constructions: cavity_wall_enhanced, flat_roof_enhanced, ground_floor_enhanced, triple_glazing

| Metric | Value | vs Standard |
|--------|-------|-------------|
| EUI | 60.7 kWh/m² | +8% |
| Annual heating | 30 kWh | -95% |
| Annual cooling | 76,258 kWh | +29% |
| Peak heating | 1.7 W/m² | -71% |

Note: Enhanced fabric nearly eliminates heating demand (expected). Cooling rises because higher thermal mass retains internal gains — physically correct for this cooling-dominated hotel building.

---

## Next task

Brief 05 — to be defined. Candidate topics:
- CRREM trajectory / carbon intensity tracking
- Scenario comparison (side-by-side EUI across multiple runs)
- PDF report export
- DHW simulation wired to EnergyPlus output
- Multi-zone building types (office floor, retail, mixed-use)

---

## Known issues

- `envelope` basic heat-flow summary is not persisted to DB (only `envelope_detailed` is stored). After page refresh the FabricAnalysisTab simple summary is empty but per-façade charts still render. Resolved on next live run.
- EUI is lower than typical CIBSE TM54 hotel benchmarks (~100–200 kWh/m²) because the model uses ideal loads. Detailed HVAC modelling will raise it.
- Building is hardcoded as hotel_bedroom zone type — multi-zone types not yet supported.
- HMR errors in dev console (from editing session) are stale — not runtime errors. Full build is clean.

---

## Suggestions

- Show which schedule is currently assigned in the Profiles sidebar
- Add "Duplicate project" to project picker
- Add CSV export of simulation results
- Lazy-load schedule list (currently loads all items on mount)
- Add monthly multiplier visualisation to heatmap legend

---

## Safety checks

- Working tree: clean (git status)
- Branch: main
- Ahead of origin/main: 0 commits (push confirmed 2026-04-02)
- data/ directory: gitignored, intact, not touched
