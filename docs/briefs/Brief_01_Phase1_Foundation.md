# Brief 01: Phase 1 Foundation — EnergyPlus Engine Integration

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read docs/briefs/00_project_brief.md (the full project brief — skim sections 1-4 and read section 3 carefully)
4. Read docs/pablo_design_system_reference.md (skim — you'll need this in later briefs)
5. Read this ENTIRE brief before writing a single line of code
6. One part at a time. Verify. Commit. Push.

---

## Context

NZA Simulate is a brand new project. The repo has been scaffolded with folder structure, CLAUDE.md, and STATUS.md but contains zero code. This brief builds the backend foundation: a Python engine that can take parametric building inputs, generate valid EnergyPlus epJSON, run a simulation, and parse the results into structured data.

No frontend in this brief. No UI. Backend only. We need to prove the engine works before we build anything on top of it.

**EnergyPlus installation:** `/Applications/EnergyPlus-25-2-0/`
**EnergyPlus binary:** `/Applications/EnergyPlus-25-2-0/energyplus`
**Python API:** `/Applications/EnergyPlus-25-2-0/pyenergyplus/`
**Example weather files:** `/Applications/EnergyPlus-25-2-0/WeatherData/`
**Test weather file:** Use any `.epw` file from the WeatherData folder that covers a UK or similar temperate climate. If there's a `GBR_*.epw` file, use that. Otherwise use `USA_CO_Golden-NREL.724666_TMY3.epw` (ships with EnergyPlus) — the exact location doesn't matter for testing the engine works.

**Target building for testing:** The Bridgewater Hotel — a rectangular Holiday Inn Express in Somerset. Use these approximate parameters:
- 60m long × 15m wide
- 4 floors, 3.2m floor-to-floor height
- Orientation: 0° (north-south aligned — we'll adjust later with real data)
- WWR: 25% all facades
- 138 bedrooms

7 parts. Do them in order.

---

## PART 1: Project Python environment and EnergyPlus connection test

**File(s):** `requirements.txt`, `nza_engine/__init__.py`, `nza_engine/config.py`, `scripts/test_energyplus.py`

Create a `requirements.txt` with the minimum dependencies:
```
fastapi
uvicorn[standard]
aiosqlite
```

Create `nza_engine/config.py` with:
- `ENERGYPLUS_DIR` — reads from environment variable, falls back to `/Applications/EnergyPlus-25-2-0/`
- `ENERGYPLUS_BIN` — path to the `energyplus` executable
- `ENERGYPLUS_IDD` — path to `Energy+.idd`
- `ENERGYPLUS_SCHEMA` — path to `Energy+.schema.epJSON`
- `DEFAULT_WEATHER_DIR` — path to `WeatherData/` folder
- `DATA_DIR` — `data/` in the project root
- `SIMULATIONS_DIR` — `data/simulations/`

Create `scripts/test_energyplus.py` — a simple script that:
1. Picks an EPW file from the WeatherData folder
2. Takes the simplest EnergyPlus example file from `/Applications/EnergyPlus-25-2-0/ExampleFiles/` (use `1ZoneUncontrolled.idf`)
3. Runs EnergyPlus via subprocess: `energyplus -w weather.epw -d output_dir input.idf`
4. Checks the return code and prints whether the simulation succeeded
5. Lists the output files produced

Run the script and confirm EnergyPlus executes successfully.

**Commit message:** "Part 1: Python environment setup and EnergyPlus connection test"

**Verify:** Run `python scripts/test_energyplus.py` from the project root. It should print a success message and list output files including `.sql`, `.csv`, `.htm`, `.err` files. Check the `.err` file has no fatal errors.

---

## PART 2: Geometry generator — rectangular building to EnergyPlus surfaces

**File(s):** `nza_engine/generators/__init__.py`, `nza_engine/generators/geometry.py`, `scripts/test_geometry.py`

Create `nza_engine/generators/geometry.py` with a function `generate_building_geometry(params)` that takes a dictionary of building parameters and returns a dictionary of EnergyPlus zone and surface definitions.

Input parameters:
```python
params = {
    "name": "Bridgewater Hotel",
    "length": 60.0,        # metres, along x-axis
    "width": 15.0,         # metres, along y-axis
    "num_floors": 4,
    "floor_height": 3.2,   # metres, floor-to-floor
    "orientation": 0.0,    # degrees from north (clockwise)
    "wwr": {               # window-to-wall ratio per facade
        "north": 0.25,
        "south": 0.25,
        "east": 0.25,
        "west": 0.25
    }
}
```

The function should generate:
- One thermal zone per floor (e.g. "Floor_1", "Floor_2", etc.)
- For each zone: 4 wall surfaces with correct vertices (respecting orientation), a floor surface, and a ceiling/roof surface
- The ground floor's floor has `Outside Boundary Condition: Ground`
- The top floor's ceiling is the roof with `Outside Boundary Condition: Outdoors`
- Intermediate floors/ceilings have `Outside Boundary Condition: Surface` pointing to the adjacent zone
- Window (sub-surface) on each external wall, sized to match the WWR for that facade
- All vertex coordinates in EnergyPlus convention (counter-clockwise when viewed from outside for walls, from above for floors)

The output should be a Python dictionary structured to map directly to epJSON format — i.e. ready to be serialised to JSON with the correct EnergyPlus object keys.

Create `scripts/test_geometry.py` that:
1. Calls `generate_building_geometry()` with the Bridgewater parameters
2. Prints a summary: number of zones, number of surfaces, total wall area, total glazing area, total floor area (GIA)
3. Validates: GIA should be approximately 60 × 15 × 4 = 3,600 m². Total wall area should be approximately 2 × (60 + 15) × 3.2 × 4 = 3,840 m². Glazing area should be approximately 25% of wall area = 960 m².

**Commit message:** "Part 2: Geometry generator for rectangular buildings"

**Verify:** Run `python scripts/test_geometry.py`. Check the printed areas are within 1% of the expected values. Any significant deviation means the vertex calculations are wrong.

---

## PART 3: Fabric construction library

**File(s):** `nza_engine/library/__init__.py`, `nza_engine/library/constructions.py`

Create `nza_engine/library/constructions.py` with pre-defined construction buildups for EnergyPlus. Each construction is a dictionary containing the full layer-by-layer definition (material name, thickness, conductivity, density, specific heat) plus a summary U-value and thermal mass category.

Include at minimum these constructions:

**Walls:**
- `cavity_wall_standard` — Brick outer leaf, 100mm mineral wool cavity insulation, dense concrete block inner leaf, plasterboard. U ≈ 0.28 W/m²K
- `cavity_wall_enhanced` — As above but 150mm PIR cavity insulation. U ≈ 0.18 W/m²K
- `timber_frame_standard` — Brick outer leaf, cavity, OSB sheathing, 140mm mineral wool between studs, plasterboard. U ≈ 0.22 W/m²K

**Roof:**
- `flat_roof_standard` — Concrete deck, vapour barrier, 120mm PIR insulation, waterproofing. U ≈ 0.18 W/m²K
- `flat_roof_enhanced` — As above with 200mm PIR. U ≈ 0.11 W/m²K
- `pitched_roof_standard` — Tiles, battens, membrane, 200mm mineral wool between rafters, plasterboard. U ≈ 0.16 W/m²K

**Floor:**
- `ground_floor_slab` — Carpet, screed, 100mm concrete slab, 100mm XPS insulation, hardcore. U ≈ 0.22 W/m²K
- `ground_floor_enhanced` — As above with 150mm XPS. U ≈ 0.15 W/m²K

**Glazing:**
- `double_low_e` — Double glazing, low-e coating, argon filled. U ≈ 1.4 W/m²K, g-value ≈ 0.42
- `triple_glazing` — Triple glazing, double low-e, argon filled. U ≈ 0.8 W/m²K, g-value ≈ 0.35

Each construction should output the EnergyPlus `Material`, `Material:NoMass`, `WindowMaterial:SimpleGlazingSystem`, and `Construction` objects needed in the epJSON.

Include a function `get_construction(name)` that returns the full epJSON-ready definition, and `list_constructions()` that returns names with summary U-values.

**Commit message:** "Part 3: Fabric construction library with UK typical buildups"

**Verify:** Run a quick script or Python REPL to call `list_constructions()` and confirm all constructions are listed with sensible U-values. Spot-check one wall construction's layers — do the thicknesses, conductivities, and densities look physically reasonable?

---

## PART 4: Schedules and internal loads library

**File(s):** `nza_engine/library/schedules.py`, `nza_engine/library/loads.py`

Create `nza_engine/library/schedules.py` with pre-defined occupancy, lighting, and equipment schedules for a hotel building. Use EnergyPlus `Schedule:Compact` format.

Hotel schedules should include:
- **Occupancy — bedrooms:** Low during day (0.1), high at night (0.9), with weekend variation
- **Occupancy — reception/corridors:** Inverse of bedrooms — higher during day, lower at night
- **Lighting — bedrooms:** Linked to occupancy with a slight offset (lights on before bed, off during sleep)
- **Lighting — corridors:** Near-constant (0.8 day, 0.5 night)
- **Equipment — bedrooms:** TV, charging, hairdryer — follows occupancy loosely
- **Equipment — corridors/common areas:** Lifts, vending machines — relatively constant
- **Heating setpoint:** 21°C occupied, 16°C setback
- **Cooling setpoint:** 24°C occupied, 28°C setback
- **DHW demand:** Morning and evening peaks

Create `nza_engine/library/loads.py` with internal load definitions for hotel zone types:
- `hotel_bedroom` — occupancy density (people/m²), lighting power density (W/m²), equipment power density (W/m²), ventilation requirement (l/s/person), DHW demand (litres/person/day)
- `hotel_corridor` — as above with appropriate values
- `hotel_reception` — as above
- `hotel_restaurant` — as above (if useful for later, otherwise skip)

Use CIBSE Guide A and NCM values as the basis. These don't need to be perfect — they need to be credible starting points.

**Commit message:** "Part 4: Hotel schedules and internal loads library"

**Verify:** Print a summary of each schedule showing the peak and minimum values and total annual hours at each level. Do the patterns make intuitive sense for a hotel? (Bedrooms occupied at night, corridors busy during day, etc.)

---

## PART 5: Full epJSON assembler

**File(s):** `nza_engine/generators/epjson_assembler.py`, `scripts/test_assemble.py`

Create `nza_engine/generators/epjson_assembler.py` with a function `assemble_epjson(building_params, construction_choices, weather_file_path)` that combines all the pieces into a complete, valid epJSON file.

The assembler should:
1. Call the geometry generator (Part 2) to get zones and surfaces
2. Pull construction definitions from the library (Part 3) based on `construction_choices` dict:
   ```python
   construction_choices = {
       "external_wall": "cavity_wall_standard",
       "roof": "flat_roof_standard",
       "ground_floor": "ground_floor_slab",
       "glazing": "double_low_e"
   }
   ```
3. Pull schedules and loads from the library (Part 4) for the zone types
4. Add the `Building` object (name, orientation, terrain)
5. Add `SimulationControl` (run for full year, zone sizing)
6. Add `Timestep` (4 per hour = 15-minute intervals)
7. Add `RunPeriod` (full calendar year)
8. Add `Site:Location` (from EPW file header or hardcoded for now)
9. Add `GlobalGeometryRules` (upper-left-corner, counterclockwise, relative coordinates)
10. Add `Output:Variable` requests for the key outputs we need:
    - Zone Ideal Loads Supply Air Total Heating Energy
    - Zone Ideal Loads Supply Air Total Cooling Energy
    - Zone People Occupant Count
    - Zone Lights Electricity Energy
    - Zone Electric Equipment Electricity Energy
    - Zone Infiltration Sensible Heat Loss Energy
    - Zone Infiltration Sensible Heat Gain Energy
    - Surface Inside Face Conduction Heat Transfer Energy (for fabric analysis)
    - Zone Windows Total Transmitted Solar Radiation Rate
11. Add `Output:Meter` for facility-level totals
12. Add `OutputControl:Table:Style` set to HTML and SQLite
13. Add `Output:SQLite` with `SimpleAndTabular` option
14. For HVAC: use `HVACTemplate:Zone:IdealLoadsAirSystem` for every zone — this is EnergyPlus's "perfect system" that meets any load. It lets us see the true building demand without HVAC system effects. We'll replace this with real HVAC systems in a later brief.
15. Add `ZoneInfiltration:DesignFlowRate` for each zone (default 0.5 ACH, adjustable)

Create `scripts/test_assemble.py` that:
1. Calls `assemble_epjson()` with Bridgewater parameters, standard constructions, and a test weather file
2. Writes the output to `data/simulations/test_bridgewater/input.epJSON`
3. Prints the file size and number of EnergyPlus objects created
4. Validates the JSON is valid (can be parsed back)

**Commit message:** "Part 5: Full epJSON assembler combining geometry, fabric, schedules, and outputs"

**Verify:** Run `python scripts/test_assemble.py`. The output file should be valid JSON. Open it and spot-check: are there 4 zones? Do the construction names match? Are the output variables present? Is the run period a full year?

---

## PART 6: Run simulation and parse results

**File(s):** `nza_engine/runner.py`, `nza_engine/parsers/__init__.py`, `nza_engine/parsers/sql_parser.py`, `scripts/test_simulate.py`

Create `nza_engine/runner.py` with a function `run_simulation(epjson_path, weather_file_path, output_dir)` that:
1. Creates the output directory if it doesn't exist
2. Runs EnergyPlus via subprocess: `energyplus -w {weather} -d {output_dir} {epjson}`
3. Monitors the process and captures stdout/stderr
4. Checks the return code
5. Checks the `.err` file for fatal errors, severe errors, and warnings
6. Returns a result object with: success/fail, error count, warning count, path to SQLite output, path to HTML output, simulation runtime

Create `nza_engine/parsers/sql_parser.py` with functions that query the EnergyPlus SQLite output:

- `get_annual_energy_by_enduse(sql_path)` — Returns a dict of annual energy by end use (heating, cooling, lighting, equipment, fans, pumps, DHW) in kWh
- `get_monthly_energy_by_enduse(sql_path)` — Returns monthly breakdown (12 months × N end uses) in kWh
- `get_zone_summary(sql_path)` — Returns per-zone floor area, volume, and annual heating/cooling demand
- `get_building_summary(sql_path)` — Returns total GIA, total energy, EUI (kWh/m²), peak heating load (W), peak cooling load (W), unmet heating hours, unmet cooling hours
- `get_envelope_heat_flow(sql_path)` — Returns annual heat loss/gain through each surface type (walls, glazing, roof, floor, infiltration) in kWh — this feeds the Sankey diagram later

Create `scripts/test_simulate.py` that:
1. Assembles the Bridgewater epJSON (reuses Part 5)
2. Runs the simulation
3. Parses the results
4. Prints a formatted summary:
   - Building: name, GIA, volume
   - Annual EUI (kWh/m²)
   - Annual energy by end use (kWh and %)
   - Peak heating load (W/m²)
   - Peak cooling load (W/m²)
   - Unmet hours
   - Monthly heating and cooling demand

**Commit message:** "Part 6: Simulation runner and SQLite results parser"

**Verify:** Run `python scripts/test_simulate.py`. The simulation should complete without fatal errors. Check the results:
- GIA should be approximately 3,600 m²
- EUI should be in a plausible range for a hotel (100-400 kWh/m² depending on weather file used). If it's outside this range, check the .err file for clues.
- Heating demand should be > 0
- There should be non-zero values for lighting and equipment (confirms schedules are working)
- Peak heating load should be roughly 30-80 W/m²

**If the EUI is wildly wrong:** Check the `.err` file first. Common issues: missing weather file, construction errors, schedule errors. The IdealLoadsAirSystem approach means HVAC shouldn't be the problem — it's always the fabric, loads, or schedules.

---

## PART 7: FastAPI endpoints

**File(s):** `api/__init__.py`, `api/main.py`, `api/routers/__init__.py`, `api/routers/simulate.py`, `api/routers/library.py`

Create a minimal FastAPI application with these endpoints:

**POST /api/simulate**
- Accepts a JSON body with building parameters, construction choices, and weather file name
- Calls the assembler, runs the simulation, parses results
- Returns the parsed results as JSON
- Stores the simulation run in `data/simulations/{run_id}/`

**GET /api/simulate/{run_id}**
- Returns the parsed results for a previous simulation run

**GET /api/library/constructions**
- Returns the list of available constructions with names and U-values

**GET /api/library/schedules**
- Returns the list of available schedule templates

**GET /api/health**
- Returns EnergyPlus version, installation status, available weather files

The API should run on port 8002: `uvicorn api.main:app --host 127.0.0.1 --port 8002`

**Commit message:** "Part 7: FastAPI endpoints for simulation and library"

**Verify:**
1. Start the API: `cd ~/Dev/nza-sim && python -m uvicorn api.main:app --host 127.0.0.1 --port 8002`
2. Hit the health endpoint: `curl http://127.0.0.1:8002/api/health` — should return EnergyPlus version and status
3. Hit the constructions endpoint: `curl http://127.0.0.1:8002/api/library/constructions` — should list all constructions
4. Trigger a simulation: `curl -X POST http://127.0.0.1:8002/api/simulate -H "Content-Type: application/json" -d '{"building": {"name": "Bridgewater", "length": 60, "width": 15, "num_floors": 4, "floor_height": 3.2, "orientation": 0, "wwr": {"north": 0.25, "south": 0.25, "east": 0.25, "west": 0.25}}, "constructions": {"external_wall": "cavity_wall_standard", "roof": "flat_roof_standard", "ground_floor": "ground_floor_slab", "glazing": "double_low_e"}, "weather_file": "USE_DEFAULT"}'`
5. The simulation response should include EUI, energy by end use, and peak loads — same numbers as Part 6.

---

## After all 7 parts are complete

Update STATUS.md with:
- What was completed
- The EUI and key metrics from the Bridgewater test simulation
- Any EnergyPlus warnings or issues encountered
- The API endpoints and how to test them
- Known issues
- Suggestions for Phase 2

Push to GitHub. Confirm push succeeded.
