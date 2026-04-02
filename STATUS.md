# NZA SIMULATE — Status

## Last completed

Brief 02 — All 10 parts complete. Full React frontend built, verified, and pushed to GitHub.

## Current state

### Frontend (port 5176)

Full UI operational — all modules built:

| Module | Route | Status |
|---|---|---|
| App shell | All routes | ✓ Navy sidebar, TopBar, routing |
| Building Definition | `/building` | ✓ Geometry + Fabric + Summary tabs, live 3D viewer |
| Results Dashboard | `/results` | ✓ Overview, Energy Balance, Load Profiles, Fabric Analysis |
| Home | `/` | ✓ Landing page |
| Systems / Profiles / Scenarios | `/systems` etc. | Placeholder — Brief 03+ |

### Building Definition module

- **Geometry tab**: Name, length/width/floors/floor height inputs, orientation slider with rotating CompassRose SVG, N/S/E/W WWR sliders, 4 live DataCards (GIA, Volume, Envelope, Glazing)
- **Fabric tab**: Construction picker for external wall, roof, ground floor, glazing — fetches from `/api/library/constructions`, shows U-value (colour-coded) and thermal mass badges
- **Summary tab**: All params in section rows + 6 derived DataCards including compactness ratio
- **3D viewer**: @react-three/fiber canvas — orbital camera, building mass with floor lines, translucent glazing scaled by WWR per facade, orientation indicator, live-updating from context

### Results Dashboard

- **Overview**: EUI/heating/cooling/peak DataCards, end-use donut (Recharts PieChart), 7-item sanity check panel
- **Energy Balance**: Monthly stacked bar chart with annual totals
- **Load Profiles**: Hourly stacked area chart with month filter, downsampled for performance
- **Fabric Analysis**: Horizontal diverging bar chart by surface (gains red, losses blue)
- Status banner in sidebar reflects idle/running/complete/error states
- TopBar reads building name dynamically from BuildingContext

### Backend (port 8002)

Unchanged from Brief 01 — fully operational. See simulation results below.

### Bridgewater Hotel test simulation results (USA_CO_Golden weather)

| Metric | Value |
|---|---|
| GIA | 3,600 m² |
| Annual heating | 44,868 kWh (12.5 kWh/m²) |
| Annual cooling | 63,725 kWh (17.7 kWh/m²) |
| Annual lighting | 58,729 kWh (16.3 kWh/m²) |
| Annual equipment | 75,071 kWh (20.9 kWh/m²) |
| **Total EUI** | **67.3 kWh/m²** |
| Peak heating | 74,859 W (20.8 W/m²) |
| Peak cooling | 68,204 W (18.9 W/m²) |
| Unmet hours | 0 / 0 |

## Next task

Brief 03 (not yet received) — likely: UK weather file, zone type assignment, or systems/profiles module.

## Known issues

* Solar gain variable (`Zone Windows Total Transmitted Solar Radiation Rate`) returns 0 in parser — variable name may differ across EP versions. Non-blocking.
* EUI lower than expected for a UK hotel — Colorado weather, no DHW, all-bedroom zone type. Will improve in later phases.
* No UK EPW files in default EnergyPlus installation — need to source separately.
* `go.bat` not yet created on Mac equivalent — Chris to set up launch scripts locally.
* Git author name/email not configured — commits showing machine hostname. Non-blocking.
* `hourly_profiles` not yet returned by API — Load Profiles tab shows empty state until API is extended.

## Suggestions

* Add `hourly_profiles` to `/api/simulate` response (hourly heating/cooling W/m² per zone) to populate Load Profiles tab
* Add async simulation endpoint with job polling for longer simulations
* Add DHW load to ideal loads system
* Source Manchester/Bristol UK EPW file
* Add zone type assignment (bedroom/corridor/reception/restaurant) for realistic internal loads
* Add `/api/library/weather` endpoint listing available EPW files
* `FabricAnalysisTab` depends on `envelope_heat_flow` from API — verify field names match parser output

## Safety checks

* Worktrees: none open
* Branch: main
* Last push: confirmed — all Brief 02 commits pushed (60374ab)
* GitHub: https://github.com/chrisscott06/nza-sim
* `data/` directory: local only, gitignored, intact
