# NZA SIMULATE — Status

## Last completed

Brief 10: Butterfly Fix, 3D Architectural Upgrade, Facade Renaming & Expandable Sankey — all 10 parts complete.

**Part 1** — Fixed butterfly chart double-counting.
- `instantCalc.js`: returns `gains_losses.heating_side` / `cooling_side` with separate contributions.
- Internal gains on heating side = gain × util_factor (0.75); on cooling side = gain × cooling_fraction (0.25).
- Removed redundant Solar Gains by Facade bar chart from LiveResultsPanel.

**Part 2** — Numbered facades with dynamic compass annotations.
- F1=north (0°), F2=east (90°), F3=south (180°), F4=west (270°) — fixed physical labels.
- `facadeLabel(num, orientationDeg)` returns "F3 (S)" at 0°, "F3 (N)" at 180°, etc.
- Labels update live in WWR sliders, butterfly chart solar rows, 3D hover tooltip.

**Part 3** — Recessed windows with shadow reveals.
- Frame boxes (80mm depth) + glass panels set behind wall surface.
- Shadow from directional light creates visible depth.

**Part 4** — Edge lines, white massing materials, base plate, contact shadows.
- Wall #F5F3F0, Roof #E8E5E0, Glass subtle blue tint, Frame #C0C0C0.
- `<Edges>` component on building and roof. Base plate 4m beyond footprint.
- `<ContactShadows>` soft contact shadow.

**Part 5** — Improved camera and environment.
- Default camera: 45° elevation from front-right corner, fov=42.
- `<Environment preset="city" background={false}>` for glass reflections.
- OrbitControls: damping, polar limit (no upside-down), auto-rotate after 5s idle.
- Auto-rotate toggle button in toolbar.

**Part 6** — Expandable Sankey overlay.
- `ExpandedSankeyOverlay.jsx`: d3-sankey diagram covering centre+right columns.
- ↗ expand button on butterfly chart. Live-updates with input changes. ✕ Close button.
- Left input column stays accessible while overlay is open.

**Part 7** — Solar gains consolidated in butterfly chart.
- Single "Solar Gains" row replacing 6 individual solar rows (per-facade + wall/roof).
- Hover tooltip shows per-facade breakdown (MWh on heating and cooling sides).
- Chart rows reduced from ~14 to ~8.

**Part 8** — Occupancy inputs: bedrooms, occupancy rate, people per room.
- New Occupancy section in Building left column (between Glazing and Fabric).
- Inputs: num_bedrooms (138), occupancy_rate (75%), people_per_room (1.5).
- Derived: avg occupants = 155 people, density = 0.041 p/m².
- Instant calc uses actual occupants for people gains; equipment scales with occupancy_rate; DHW scales with avg_occupants (~26.6 L/person/day, CIBSE-calibrated).

**Part 9** — Occupancy wired to EnergyPlus assembler.
- `_build_people_objects()` accepts `density_override` from building params.
- `generate_dhw_system()` accepts `num_bedrooms` + `occupancy_rate` — DHW peak flow scales with actual occupied rooms.
- New fields persist automatically via existing deep-merge PUT /building endpoint.

**Part 10** — Full integration test.

---

## Integration test results (Brief 10 — 2026-04-03)

**Bridgewater Hotel — default scenario (50m × 15m × 5fl, 25% WWR all round, 75% occupancy)**

### Verified features
- **Facade naming**: At 45° → F1 (NE), F2 (SE), F3 (SW), F4 (NW) ✓
- **Butterfly asymmetry**: Heating-side bars differ from cooling-side bars ✓
- **Solar gains consolidated**: Single "Solar Gains" bar with hover tooltip breakdown ✓
- **Sankey overlay**: Heating 144.8 MWh, Solar 130.6 MWh, Internal 110.4 MWh → fabric + cooling ✓
- **White massing 3D**: Edge lines, base plate, contact shadows, subtle glass tint ✓
- **Occupancy section**: 138 bedrooms × 75% × 1.5 = 155 avg occupants shown ✓
- **Occupancy drives EUI**: At 50% → EUI 76 kWh/m², At 75% → EUI 83 kWh/m² ✓
- **Zero console errors**: ✓
- **Clean build**: ✓

### EUI at default settings
- EUI: 83 kWh/m² (just below CRREM target 85) — green gauge ✓
- Annual heating: 148 MWh, cooling: 36 MWh, DHW: 88 MWh

### Known issue discovered in Part 10
- **Solar unit mismatch in instant calc**: `solar_gains` dict values are in MWh (after /1000 division) but `total_internal` is in kWh. When added together for the heating balance, solar is effectively 1000x underweighted. This means EUI doesn't respond to orientation changes (solar contribution to heating balance is negligible). The butterfly chart and Sankey show CORRECT solar MWh values — only the EUI calc is affected. Needs fix in Brief 11.

---

## Current state

### What's working

- **Architectural 3D model** — white massing style, edge lines, recessed windows with shadow reveals, base plate, contact shadows, auto-rotate, environment reflections
- **Butterfly chart** — asymmetric heating/cooling gains, consolidated solar with hover tooltip, ↗ expand to Sankey
- **Expandable Sankey** — full d3-sankey energy balance overlay, live-updating
- **Numbered facades F1-F4** — dynamic compass annotations throughout (WWR sliders, butterfly, 3D hover)
- **Occupancy inputs** — bedrooms, occupancy rate, people per room; drives internal gains and DHW
- **EnergyPlus occupancy** — People density and DHW peak flow scale from actual occupant count
- **Three-column live workspaces** — Building, Systems, Profiles
- **Auto-simulation** — triggers 3s after last change
- **Project persistence** — all params saved to SQLite
- **Full results suite** — Energy Flows, Energy Balance, Load Profiles, Fabric Analysis, CRREM & Carbon
- **Scenario Manager** — create/run/compare scenarios

---

## Known issues

- **Solar unit mismatch** — `solar_gains` in MWh but `total_internal` in kWh; heating balance underweights solar by 1000x; EUI doesn't respond to orientation. Fix: convert total_internal to MWh before heat_gains calculation. Brief 11 priority.
- Building hardcoded as hotel_bedroom zone type — multi-zone not yet supported.
- **uvicorn must be restarted** after backend code changes.
- Full-year hourly data requires EnergyPlus .sql output file on disk.
- MVHR raises cooling demand significantly in summer (physically consistent but counterintuitive).

---

## Suggestions

- Report export to PowerPoint/PDF using NZA template
- CIBSE TM54 benchmark integration — show building type comparison on Results dashboard
- Fix solar unit mismatch (see Known Issues) — high priority for accurate orientation-sensitivity
- Multi-zone building types (office, retail, hotel mix)
- Future weather files — climate change scenarios (+2°C, +3.5°C)
- Monthly weather visualisation (heating/cooling degree days per month)
- CSV export of simulation results
- "Duplicate project" in project picker
- Surrounding building massing for shading analysis
- Infiltration ACH from airtightness test (q50 → ACH conversion)
- EV charging demand modelling

---

## Safety checks

- Working tree: clean (after Part 10 commit)
- Branch: main
- Brief 10 all 10 parts committed to main
- data/ directory: gitignored, intact, not touched
- Push to GitHub: pending
