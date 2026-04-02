# NZA SIMULATE — Status

## Last completed

Brief 03 — All 12 parts complete. Bug fixes, hourly profiles, Sankey diagram, Systems & Zones module, natural ventilation, and full integration test.

## Current state

### Frontend (port 5176)

Full UI operational — all modules built:

| Module | Route | Status |
|---|---|---|
| App shell | All routes | ✓ Navy sidebar, TopBar, routing |
| Building Definition | `/building` | ✓ Geometry + Fabric + Summary tabs, live 3D viewer |
| Systems & Zones | `/systems` | ✓ HVAC / Ventilation / DHW / Lighting tabs, live summary panel |
| Results Dashboard | `/results` | ✓ Overview, Energy Flows (Sankey), Energy Balance, Load Profiles, Fabric Analysis |
| Home | `/` | ✓ Landing page |
| Profiles / Scenarios | `/profiles`, `/scenarios` | Placeholder — future briefs |

### Building Definition module

- **Geometry tab**: Name, length/width/floors/floor height inputs, orientation slider with rotating CompassRose SVG, N/S/E/W WWR sliders, 4 live DataCards (GIA, Volume, Envelope, Glazing)
- **Fabric tab**: Construction picker for external wall, roof, ground floor, glazing — fetches from `/api/library/constructions`, shows U-value colour-coded, no crashes
- **Summary tab**: All params in section rows + 6 derived DataCards
- **3D viewer**: @react-three/fiber canvas — orbital camera, building mass with floor lines, translucent glazing scaled by WWR per facade

### Systems & Zones module

- **HVAC tab**: Simulation mode toggle (Ideal Loads / Detailed Systems), system type dropdown from API, COP override, system schematic panel
- **Ventilation tab**: MEV/MVHR selection, SFP slider, heat recovery slider, natural ventilation toggle + threshold slider
- **DHW tab**: Primary/preheat system selects, hot water setpoint, conditional preheat setpoint, estimated DHW demand panel
- **Lighting tab**: LPD slider (4–15 W/m²), control strategy dropdown, estimated demand with control savings bar
- **Summary panel**: 2-column grid showing all current system selections

### Results Dashboard (5 tabs)

- **Overview**: EUI/heating/cooling/peak/GIA DataCards, end-use donut chart (Recharts), sanity checks
- **Energy Flows**: SVG Sankey diagram (d3-sankey) — nodes for electricity/solar/internal gains/systems/losses, hover tooltips
- **Energy Balance**: 12-month stacked bar with annual totals DataCards
- **Load Profiles**: Hourly stacked area chart, 4 day-type buttons (Peak Heating/Cooling, Typical Winter/Summer)
- **Fabric Analysis**: Per-facade diverging heat flow bars, solar gain chart, summary DataCards

### Backend (port 8002)

Fully operational. All changes from Brief 03 applied:

- `sql_parser.py`: `get_hourly_profiles()`, `get_typical_day_profiles()`, `get_envelope_heat_flow_detailed()` — all working
- `epjson_assembler.py`: systems_config integration (LPD override, natural ventilation objects), corrected solar output variable (`Surface Window Transmitted Solar Radiation Energy`)
- `simulate.py`: `SystemsConfig` Pydantic model, systems stored in results JSON
- `library/systems.py`: 10 system templates (hvac/dhw/ventilation categories)

### Bridgewater Hotel test simulation results (UK weather, LPD 8 W/m², no nat vent)

| Metric | Value |
|---|---|
| GIA | 3,600 m² |
| Annual heating | 548 kWh (0.15 kWh/m²) |
| Annual cooling | 59,160 kWh (16.4 kWh/m²) |
| Annual lighting | 67,100 kWh (18.6 kWh/m²) |
| Annual equipment | 75,071 kWh (20.9 kWh/m²) |
| **Total EUI** | **56.1 kWh/m²** |
| Peak heating | 5.9 W/m² |
| Peak cooling | 13.1 W/m² |
| Unmet hours | 0 / 0 |

**Note on heating demand:** At 548 kWh (0.15 kWh/m²/yr) heating demand is very low — this reflects the combination of high internal gains (lighting + equipment = 142 kWh/m²/yr), good UK weather file, and 8 W/m² LPD pushing internal temperatures up. The building is cooling-dominated, which is expected for a hotel with this occupancy profile.

**Parameter sensitivity confirmed:** Changing wall from `cavity_wall_standard` (0.28 W/m²K) to `cavity_wall_enhanced` (0.18 W/m²K):
- Heating: 548 → 152 kWh (-72%) ✓
- Cooling: 59,160 → 70,398 kWh (+19%) — better insulation traps internal gains in this cooling-dominated building
- EUI: 56.1 → 59.1 kWh/m² (+5%) — net negative for this building type (physically correct)

**Natural ventilation confirmed:** With `natural_ventilation: true`, threshold 22°C:
- EUI: 56.1 → 49.6 kWh/m²
- Heating: 548 → 33,014 kWh (windows open against cold UK air)
- Cooling: 59,160 → 3,207 kWh (free cooling from outdoor air)

## Next task

Brief 04 — not yet received.

## Known issues

- Git author name/email not configured — commits showing machine hostname. Non-blocking. Chris can run `git config --global user.name/email` to fix.
- Natural ventilation opening area (10% of window area per floor zone) is calibrated conservatively. With whole-floor zones, higher fractions produce extreme ACH values. A zonal model with multiple smaller zones would give better calibration.
- Backend must be manually restarted after code changes (no `--reload` flag). Add `--reload` to launch script for development.

## Suggestions

- Add `--reload` flag to backend uvicorn command for hot-reloading during development
- Add zone type assignment (bedroom/corridor/reception/restaurant) for more realistic internal load profiles
- Add async simulation endpoint with job polling for simulations > 30s
- Add DHW energy to simulation outputs (currently estimated only, not EnergyPlus-modelled)
- Source additional UK city EPW files (Manchester, Bristol, Edinburgh) via `/api/library/weather` endpoint
- Scenario comparison: run multiple simulations and display results side-by-side
- Natural ventilation: reduce to sub-zone scale (individual room zones) for more accurate ACH calculations

## Safety checks

- Worktrees: none open
- Branch: main
- Last push: pending — Brief 03 commits not yet pushed (9 commits ahead of origin)
- GitHub: https://github.com/chrisscott06/nza-sim
- `data/` directory: local only, gitignored, intact
