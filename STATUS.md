# NZA SIMULATE — Status

## Last completed

Brief 11: Fix Solar Gains Units Mismatch & Calculation Verification — all 4 parts complete.

**Part 1** — Fixed solar gains units mismatch in `instantCalc.js`.
- Removed `/1000` from `solar_gains`, `opaque_wall_solar`, and `roof_solar_kWh` so all values are in kWh throughout the heat balance calculation.
- `gains_losses` display output now correctly divides by 1000 when populating butterfly chart MWh values.
- `heat_gains = total_solar(kWh) + total_internal(kWh)` — units now consistent.

**Part 2** — Orientation now drives EUI (verified).
- Asymmetric glazing test (F3=80%, others=5%): EUI 70.7 at 0° vs 73.9 at 180° — **3.2 kWh/m² swing** (brief required >2).
- Symmetric 25% WWR: EUI 72.9 at both 0° and 180° — physically correct.
- Full 0-360° sweep: smooth EUI curve, min at 0° (big window south), max at 180°.
- Solar totals: 255,460 kWh at 0° vs 169,060 kWh at 180° — correctly in kWh range.

**Part 3** — Display consistency verified.
- All `gains_losses` values correctly in MWh: solar 108.7 MWh + internal 74.4 MWh vs losses 232.3 MWh.
- EUI gauge: 79.2 = total_kWh(237,585) / GIA(3,000) ✓
- Sankey reads `gains_losses.heating_side` (MWh) — consistent ✓
- `SolarBars` component in LiveResultsPanel is dead code (not rendered) — not a bug.
- No mixed-unit display issues found.

**Part 4** — Full regression test (verified).
- All 5 modules load without error.
- Occupancy drives EUI: 50%→69.3, 75%→79.2, 95%→87.1 kWh/m² ✓
- Fabric (U-value) changes affect heating demand ✓
- Orientation drives EUI with asymmetric glazing ✓
- Symmetric orientation gives equal EUI ✓

---

## Integration test results (Brief 11 — 2026-04-03)

**Bridgewater Hotel — asymmetric glazing test (F3=80% WWR, others=5%)**

- EUI at 0° (big window south): **70.7 kWh/m²**
- EUI at 180° (big window north): **73.9 kWh/m²**
- Swing: **3.2 kWh/m²** ✓ (>2 required)
- Solar total at 0°: 255,460 kWh; at 180°: 169,060 kWh

**All modules verified:**
- Building module: ✓
- Orientation drives EUI: ✓ (3.2 kWh/m² swing on asymmetric test)
- Fabric changes affect results: ✓
- Occupancy changes affect results: ✓
- Systems module: ✓
- Profiles module: ✓
- Results dashboard: ✓
- Scenarios: ✓
- Console errors: 0

---

## Current state

### What's working

- **Solar units fixed** — solar gains now in kWh throughout heat balance; EUI responds to orientation
- **Orientation-sensitive EUI** — asymmetric glazing gives 3.2 kWh/m² swing 0°↔180°
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

- Building hardcoded as hotel_bedroom zone type — multi-zone not yet supported.
- **uvicorn must be restarted** after backend code changes.
- Full-year hourly data requires EnergyPlus .sql output file on disk.
- MVHR raises cooling demand significantly in summer (physically consistent but counterintuitive).
- `SolarBars` component in `LiveResultsPanel.jsx` is dead code (function defined but never rendered) — harmless but could be cleaned up.

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
- Infiltration ACH from airtightness test (q50 → ACH conversion)
- EV charging demand modelling
- Clean up dead `SolarBars` function in LiveResultsPanel.jsx

---

## Safety checks

- Working tree: clean (after Part 4 commit)
- Branch: main
- Brief 11 all 4 parts committed to main
- data/ directory: gitignored, intact, not touched
- Push to GitHub: pending
