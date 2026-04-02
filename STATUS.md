# NZA SIMULATE — Status

## Last completed

Brief 01 Part 7 — FastAPI endpoints for simulation and library.
All 7 parts of Brief 01: Phase 1 Foundation complete.

## Current state

Backend fully operational:
- EnergyPlus 25.2.0 confirmed installed at `/Applications/EnergyPlus-25-2-0/`
- `nza_engine/` contains complete geometry generator, construction/schedule/loads library, epJSON assembler, simulation runner, and SQLite results parser
- FastAPI app runs on port 8002
- All endpoints tested and returning correct responses

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
| Unmet heating hours | 0 |
| Unmet cooling hours | 0 |
| Simulation runtime | ~1.5s |

Note: EUI of 67 kWh/m² is lower than a typical UK hotel (120–250 kWh/m²). This reflects Colorado's dry climate (less humidification load), that DHW is not modelled in the ideal loads system, and that all zones are treated as hotel bedrooms rather than having a mix of zone types. These will be addressed in later phases.

### API endpoints (port 8002)

| Method | Endpoint | Status |
|---|---|---|
| GET | `/api/health` | ✓ Returns EnergyPlus 25.2.0 status |
| POST | `/api/simulate` | ✓ Runs simulation, returns full results |
| GET | `/api/simulate/{run_id}` | ✓ Returns cached results |
| GET | `/api/library/constructions` | ✓ Lists 11 constructions |
| GET | `/api/library/constructions/{name}` | ✓ Returns construction detail |
| GET | `/api/library/schedules` | ✓ Lists 9 schedule templates |

## Next task

Brief 02: React frontend foundation — sidebar navigation, project context, and basic UI shell.

## Known issues

* Solar gain variable (`Zone Windows Total Transmitted Solar Radiation Rate`) returns 0 in parser — may be a variable name issue or the output variable may not be reporting as expected. Not blocking for Phase 1.
* EUI lower than expected for UK hotel — partly weather file (Colorado), partly no DHW in ideal loads, partly all-bedroom zone type. Real Bridgewater analysis will need UK EPW file.
* No UK weather files in the default EnergyPlus installation. Will need to source GBR EPW file separately (e.g. from EnergyPlus Weather Data website or CIBSE).
* `go.bat` not yet created — Chris to create locally once ports 8002/5176 confirmed.
* Git author name/email not configured — commits showing machine hostname. Non-critical.

## Suggestions

* Add async simulation endpoint with job polling (POST returns run_id immediately, GET polls status) for longer simulations
* Add DHW load to the ideal loads system to capture the significant hotel DHW demand
* Source Manchester/Bristol UK EPW file to calibrate against UK typical EUI benchmarks
* Add zone type assignment (bedroom vs corridor vs reception) in the parametric model for more realistic internal loads
* Consider adding `Output:Diagnostics,DisplayUnusedSchedules` to identify unused schedules (currently 4 flagged)
* Add `/api/library/weather` endpoint listing available EPW files

## Safety checks

* Worktrees: none open
* Branch: main
* Last push: confirmed (Part 7 — all 7 parts of Brief 01)
* GitHub: https://github.com/chrisscott06/nza-sim
* `data/` directory: local only, gitignored, intact
