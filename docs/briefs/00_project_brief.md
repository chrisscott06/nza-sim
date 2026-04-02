# NZA Building Energy Simulation Tool — Project Brief

**Project codename:** TBC (working title: "NZA Simulate")
**Author:** NZA / Chris Scott
**Date:** April 2026
**Status:** Draft for review
**Reference project:** Bridgewater Hotel (Holiday Inn Express, Zeal Hotels)

---

## 1. Purpose & Vision

### What this tool is

A web-based building energy simulation and analytics platform, powered by EnergyPlus, that allows NZA to quickly model building energy performance, test fabric and systems interventions, and present results to clients through a stunning, clear visual interface.

### What this tool is not

- Not a full dynamic simulation modelling service (we are not replacing IES or DesignBuilder)
- Not a geometry-first tool (geometry is a means to an end — the analytics are the hero)
- Not a one-off project tool (it must be reusable across future feasibility projects)

### The core proposition

Trust the engine. Simplify the inputs. Make the outputs beautiful.

EnergyPlus handles the physics. We handle the user experience. The tool should let an energy consultant define a building in minutes, run credible simulations, and walk a client through the results with confidence — showing where energy goes, what matters most, and what happens when you change things.

### Design family

This tool is a sibling to Pablo (NZA's electricity cost analytics platform). It inherits Pablo's design system, architectural patterns, and development philosophy. A client seeing both tools should recognise them as part of the same family.

---

## 2. V1 Scope — Bridgewater as the Test Case

### Building context

The Bridgewater Hotel is a 138-bedroom Holiday Inn Express, approximately six years old, operated by Zeal Hotels. It is a simple rectangular building — the ideal first test case for this tool.

### Systems to model

| System | Description | Modelling approach |
|--------|-------------|-------------------|
| Fabric envelope | Walls, roof, floor, glazing — rectangular footprint, uniform fenestration pattern, front entrance | Parametric geometry with per-facade WWR control |
| Extract ventilation | Centralised extract in common areas, trickle vents in bedrooms | EnergyPlus zone ventilation objects with scheduled flow rates |
| Natural ventilation | Openable windows in bedrooms contributing to heat demand and interacting with cooling | EnergyPlus airflow network or scheduled natural ventilation with window opening controls |
| DHW | Gas-fired water heaters pre-heated by ASHP | EnergyPlus WaterHeater:Mixed with heat pump preheat loop |
| VRF | Variable refrigerant flow systems in bedrooms (heating and cooling) | EnergyPlus VRF system template |
| Lighting | Internal lighting across all zones | EnergyPlus Lights objects with scheduled profiles |
| Auxiliary systems | Pumps (fixed/variable speed), fans | EnergyPlus pump and fan objects — type and speed control as variables |

### Key analytical questions for Bridgewater

1. What is the current energy balance — where does energy come from and where does it go?
2. What happens to cooling demand when guests open windows with the VRF running?
3. How much does ventilation strategy contribute to heating demand?
4. What is the impact of pump type (constant vs variable speed) on auxiliary energy?
5. How sensitive is the EUI to occupancy profile assumptions?
6. What fabric improvements would shift the CRREM trajectory?
7. How do different lighting strategies affect internal gains and therefore cooling load?

---

## 3. Architecture

### Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React + Vite | Matches Pablo exactly |
| Charting | Recharts (D3 wrapper) | Matches Pablo — same library, same chart tokens |
| 3D viewer | Three.js | Lightweight browser-native 3D for geometry verification |
| Sankey diagrams | D3-sankey | Energy flow visualisation (not available in Recharts) |
| Backend | FastAPI + Uvicorn | Matches Pablo exactly |
| Database | SQLite (WAL mode) | Project and library storage — matches Pablo pattern |
| Simulation engine | EnergyPlus (latest stable) | Called via Python subprocess or Python API bindings |
| Input format | epJSON | Native JSON format — direct mapping to/from React state |
| Output parsing | EnergyPlus SQLite output | Structured query of simulation results |
| Weather data | EPW files | Standard EnergyPlus weather files (UK TMY data) |

### Three-layer separation

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (React)                  │
│  Geometry editor │ Input forms │ Results dashboard   │
│  Three.js viewer │ Profile editor │ Sankey / charts  │
└────────────────────────┬────────────────────────────┘
                         │ JSON API
┌────────────────────────┴────────────────────────────┐
│                  BACKEND (FastAPI)                    │
│  epJSON generator │ EnergyPlus runner │ SQL parser   │
│  Project/library CRUD │ Scenario manager             │
└────────────────────────┬────────────────────────────┘
                         │ subprocess / Python API
┌────────────────────────┴────────────────────────────┐
│               ENERGYPLUS ENGINE                      │
│  IDF/epJSON in → SQLite + CSV + HTML out             │
└─────────────────────────────────────────────────────┘
```

### Data model — the geometry contract

The tool defines its own JSON schema for building geometry that sits between the UI and EnergyPlus. This is the key extensibility point. Any input method (parametric form, Three.js editor, Rhino plugin, gbXML import) produces geometry in this schema; the epJSON generator consumes it without caring about the source.

```json
{
  "building": {
    "name": "Bridgewater Hotel",
    "location": { "latitude": 53.47, "longitude": -2.25, "epw_file": "GBR_Manchester.epw" },
    "orientation": 15,
    "floors": [
      {
        "level": 0,
        "height": 3.2,
        "footprint": { "type": "rectangle", "length": 60, "width": 15 },
        "zones": [
          {
            "name": "Ground Floor Bedrooms",
            "type": "hotel_bedroom",
            "area_fraction": 0.75,
            "facades": {
              "north": { "wwr": 0.25, "glazing_type": "double_low_e" },
              "south": { "wwr": 0.25, "glazing_type": "double_low_e" },
              "east": { "wwr": 0.15, "glazing_type": "double_low_e" },
              "west": { "wwr": 0.15, "glazing_type": "double_low_e" }
            }
          }
        ]
      }
    ]
  }
}
```

This schema is deliberately simple for V1 (rectangular footprints only) but extensible — `footprint.type` can later accept `"L-shape"`, `"courtyard"`, `"polygon"`, or `"custom_vertices"` without breaking the translation layer.

### Calculation engine philosophy (inherited from Pablo)

1. **Engines are the single source of truth.** The backend Python engines generate epJSON, run EnergyPlus, and parse results. The frontend never calculates independently — it displays what the engine returns.
2. **No synthetic data.** If a simulation hasn't been run, show an empty state. Never generate fake profiles, placeholder curves, or demo results.
3. **Library-driven inputs.** Fabric constructions, system templates, occupancy profiles, and weather files are all library items. Projects reference them by ID. This enables reuse across projects.

---

## 4. Geometry & 3D Viewer

### V1 geometry approach — parametric rectangles

For V1, geometry is defined parametrically: the user enters dimensions, floor count, floor-to-floor height, orientation, and per-facade window-to-wall ratios. The tool generates zone geometry, surface vertices, and fenestration automatically.

No drawing, no drag-and-drop, no SketchUp. The user fills in a form, and the 3D viewer shows what they've described.

### Three.js viewer specification

The 3D viewer serves as a **sanity check**, not a design tool. It shows:

- Building massing as a solid with translucent faces
- Surfaces colour-coded by type (walls: light grey, glazing: blue-tint, roof: darker grey, floor: brown-tint)
- Facade labels (N/S/E/W) and orientation arrow
- Surface areas displayed on hover (wall area, glazing area, WWR)
- Floor plate outlines visible through the massing
- Camera: orbit controls, zoom, reset-to-default view button

This allows the user to visually confirm that the geometry, areas, and glazing ratios match their expectations before running a simulation. If the areas look wrong here, the numbers will be wrong everywhere.

### Future geometry extensibility

The geometry JSON schema and Three.js viewer are designed to support future upgrades without rearchitecting:

- **L-shaped and courtyard plans:** Additional footprint types in the schema, more complex vertex generation
- **Interactive 3D editing:** Click-to-select surfaces, drag handles to resize, real-time parameter updates
- **Import from external tools:** gbXML or IFC import that populates the same geometry schema
- **Grasshopper/Rhino integration:** Export from Rhino to the geometry JSON schema via a custom plugin

None of these require changes to the epJSON generator or the results layer — they only change how the geometry schema gets populated.

---

## 5. Input Modules

### 5.1 Building Definition

**Purpose:** Define the physical building — geometry, fabric, and envelope.

**Inputs:**
- Building name and location (weather file selection)
- Orientation (degrees from north, with compass rose visual)
- Floor plate dimensions (length × width for V1)
- Number of floors and floor-to-floor height
- Per-facade window-to-wall ratio (sliders, 0–100%)
- Glazing type (library item: U-value, g-value, visible transmittance)
- Wall construction (library item: U-value, thermal mass, layers)
- Roof construction (library item)
- Floor construction (library item)
- Infiltration rate (m³/h/m² or ACH, with typical ranges shown)

**Layout:** ExplorerLayout with 3D viewer in the main area (top half) and a summary data card strip (bottom) showing calculated GIA, envelope area, glazing area, volume, and surface-to-volume ratio. Sidebar contains all input controls.

### 5.2 Zone & Systems Setup

**Purpose:** Define what happens inside the building — zone types, HVAC, DHW, lighting, and auxiliary systems.

**Inputs — Zone types:**
- Zone type templates from library (hotel bedroom, corridor, reception, restaurant, back-of-house, plant room)
- Each template defines: occupancy density, equipment loads, lighting density, ventilation requirements, heating/cooling setpoints, schedule reference
- User can override any template value per zone

**Inputs — HVAC systems:**
- System type selection per zone group (VRF, split DX, ASHP, gas boiler, MVHR, natural ventilation)
- System parameters: COP/EER, capacity, fan power, ductwork pressure drop
- Ventilation strategy: mechanical extract, balanced with heat recovery, natural ventilation, mixed-mode
- Natural ventilation controls: window opening schedule, temperature threshold, wind speed limit

**Inputs — DHW:**
- Generation type (gas boiler, ASHP, hybrid with preheat)
- Demand profile (litres/person/day by zone type)
- Storage volume and losses

**Inputs — Lighting:**
- Installed power density (W/m²) by zone
- Control type (manual, occupancy sensing, daylight dimming)
- Schedule reference from profiles

**Inputs — Auxiliary:**
- Pump type (constant speed, variable speed) and rated power
- Fan type and rated power
- Operating schedule

### 5.3 Profiles & Schedules Editor

**Purpose:** Define time-varying patterns for occupancy, equipment, lighting, heating setpoints, and ventilation.

This is a key differentiator. The tool should make profiles tangible and editable, not hidden in a spreadsheet.

**Features:**
- Template library: pre-built profiles for hotel, office, retail, school, residential (based on NCM/CIBSE Guide A patterns)
- Visual profile editor: 24-hour bar chart for weekday, Saturday, Sunday, and holiday patterns
- Seasonal variation: monthly multipliers overlaid on the daily pattern
- Profile comparison: overlay two profiles to see differences (e.g. "what if reception runs 24 hours vs 16 hours?")
- Profile export: save custom profiles to library for reuse

**Display:** Heatmap view (hour of day × month of year) and line chart view (24-hour overlay for each day type). Both update live as the user edits.

### 5.4 Scenario Manager

**Purpose:** Define and compare multiple simulation runs with different parameters.

**Features:**
- Baseline scenario created automatically from current inputs
- "Duplicate and modify" to create variants (e.g. "Improved fabric", "ASHP only", "MVHR added")
- Scenario comparison table showing key parameter differences
- Batch run: queue multiple scenarios and run sequentially
- Results comparison across scenarios in the analytics views

---

## 6. Results & Visualisation

This is the client-facing layer. Everything here must be presentation-quality.

### 6.1 Energy Flow Sankey Diagram

**The hero visualisation.** A Sankey diagram showing:

**Left side (inputs):**
- Gas (amber/gold)
- Electricity from grid (grey)
- Solar gains through glazing — split by facade orientation (warm yellow, with N/S/E/W labels)
- Internal gains (occupancy, equipment, lighting — shown separately)

**Middle (transformation):**
- Boiler/ASHP (conversion efficiency visible from width change)
- VRF system (showing COP amplification)
- DHW system

**Right side (outputs / end uses):**
- Space heating demand
- Space cooling demand
- DHW demand
- Lighting
- Fan and pump energy
- Equipment/small power
- Heat losses — split by element:
  - Walls (by facade: N/S/E/W)
  - Glazing (by facade: N/S/E/W)
  - Roof
  - Floor
  - Infiltration
  - Ventilation (mechanical and natural)

**Interaction:** Hover on any flow to highlight the path and show kWh/yr and percentage of total. Click on a node to filter the diagram to flows through that node only.

**Colour scheme:** Consistent with Pablo's energy flow palette. Heating-related flows in warm tones (red/amber/gold), cooling in cool tones (blue/cyan), electrical in purple/grey, losses in muted grey with red tint.

### 6.2 Load Profiles Dashboard

**Purpose:** Dig into the hourly and monthly patterns of energy demand.

**Views:**

**Monthly stacked bar chart** — Energy demand by end use (heating, cooling, DHW, lighting, fans, pumps, equipment) for each month. With a BAU total demand line overlay if comparing scenarios.

**Hourly load profile** — Stacked area chart showing a typical day or specific date, with end-use breakdown. Day-type selector: peak heating day, peak cooling day, typical summer/winter/shoulder day, or custom date.

**Duration curve** — Sorted hourly demand curve showing how many hours the building operates at each load level. Overlay multiple scenarios.

**Heatmap** — Hour-of-day × day-of-year heatmap for any single variable (total demand, heating, cooling, solar gains). Colour intensity shows magnitude. This makes seasonal patterns and operational schedules immediately visible.

**Carpet plot** — Similar to heatmap but with finer resolution, showing each half-hour across the year.

### 6.3 Fabric & Envelope Analysis

**Purpose:** Understand heat flows through the building envelope.

**Views:**

**Heat loss breakdown** — Horizontal stacked bar showing annual heat loss through each element (walls by facade, glazing by facade, roof, floor, infiltration, ventilation). Sorted by magnitude.

**Fabric heat loss Sankey** — A focused Sankey showing only the envelope heat flows: internal temperature → fabric elements → external environment. Split by facade and element type.

**Solar gains analysis** — Monthly stacked bar of solar gains by facade orientation (N/S/E/W) and roof. Shows which facades are contributing most to cooling load in summer and useful gains in winter.

**U-value sensitivity** — Tornado chart showing the impact of ±10% change in each fabric parameter on annual heating demand. Identifies which element improvements would have the most effect.

### 6.4 Systems Performance

**Purpose:** Understand how HVAC and auxiliary systems are performing.

**Views:**

**System energy consumption** — Stacked bar by system type (VRF compressor, VRF fans, extract fans, pumps, lighting controls, DHW). Monthly and annual views.

**COP/EER tracking** — Monthly average COP for heating and EER for cooling, showing seasonal performance variation.

**Ventilation impact analysis** — Side-by-side comparison: "windows closed" vs "windows open at threshold" showing impact on heating demand, cooling demand, and ventilation heat loss. This directly answers the Bridgewater question about guests opening windows with VRF running.

**Pump and fan energy** — Breakdown of auxiliary energy by component, with running hours displayed. Shows impact of constant vs variable speed.

### 6.5 Benchmarking & Targets

**Purpose:** Put results in context against standards and targets.

**Views:**

**EUI gauge** — Large circular gauge showing modelled EUI (kWh/m²/yr) against CRREM target (~95 kWh/m² for hotels), CIBSE TM54 typical/good practice, and DEC benchmarks. Traffic light colouring.

**CRREM trajectory** — Line chart showing year-by-year EUI trajectory against the CRREM decarbonisation pathway, with the modelled building plotted. If the building exceeds the pathway, show the stranding year.

**Scenario comparison summary** — Table and grouped bar chart comparing EUI, carbon intensity, annual energy cost, and heating/cooling demand across all scenarios. Highlight best performer.

### 6.6 Sensitivity Analysis Dashboard

**Purpose:** Understand which parameters matter most and test "what if" questions.

**Features:**

**Parameter sliders** — A panel of key input sliders (infiltration rate, glazing U-value, wall U-value, occupancy density, heating setpoint, cooling setpoint, ventilation rate, lighting power density) that modify parameters and show the impact on key metrics in real time (or near-real-time if re-running EnergyPlus is needed — see section 7 on sanity checks).

**Tornado chart** — One-at-a-time sensitivity analysis showing which parameters have the greatest impact on total energy demand. Each bar shows the range of demand when that parameter varies ±20% from baseline.

**Spider diagram** — Multi-parameter sensitivity showing how 3–5 key metrics (heating demand, cooling demand, EUI, peak load, carbon) respond to changes in a selected parameter.

---

## 7. Sanity Checks & Validation

### Philosophy

The tool must earn trust. Every simulation result should come with enough context for the user to judge whether the numbers are credible. This is not optional polish — it is core functionality.

### Built-in checks (always visible)

**Health check panel** — A persistent side panel or footer strip showing:

| Check | What it shows | Red flag if... |
|-------|---------------|----------------|
| Annual EUI | kWh/m²/yr | Outside CIBSE TM54 range for building type |
| Heating vs cooling balance | Heating/cooling demand ratio | Cooling > heating for a UK hotel |
| Unmet hours | Hours where setpoint not met | > 1% of occupied hours |
| Solar gains fraction | Solar gains as % of total gains | Unrealistically high (>40%) or zero |
| Infiltration contribution | Infiltration heat loss as % of total | > 30% or < 5% |
| Pump/fan running hours | Total hours per year | > 8,760 (impossible) or significantly below expected |
| Peak heating load | W/m² | Outside 30–80 W/m² range for UK hotel |
| Peak cooling load | W/m² | Outside 20–60 W/m² range for UK hotel |
| Simultaneous heating/cooling | Hours where both occur | > 10% of occupied hours (suggests controls issue in model) |
| Energy balance closure | Sum of inputs vs sum of outputs | Mismatch > 2% |

**Traffic light system:** Each check shows green (within expected range), amber (borderline — investigate), or red (outside expected range — likely modelling error). Ranges are configurable per building type from the library.

### Input validation

Before simulation runs, validate:
- All surfaces form a closed volume (no gaps in geometry)
- U-values are within physically realistic ranges (0.1–5.0 W/m²K for opaque, 0.5–6.0 for glazing)
- Schedules sum to sensible annual totals (e.g. occupancy doesn't exceed zone capacity)
- HVAC capacity is sufficient for the zone it serves (basic sizing check)
- Weather file location is within reasonable distance of building location

### Output benchmarking

After simulation completes, automatically compare results against:
- CIBSE TM54 benchmarks for the building type
- CRREM target pathway
- CIBSE Guide A internal gains benchmarks
- Previous scenarios in the same project (regression check)

---

## 8. Design System — Pablo Alignment

### Colour palette

Inherit Pablo's full palette. Extend with building simulation-specific colours:

| Token | Hex | Usage in this tool |
|-------|-----|--------------------|
| `navy` | `#2B2A4C` | Sidebar bg, text primary, demand lines |
| `magenta` | `#E84393` | Save buttons, accent highlights |
| `coral` | `#F48379` | Heat losses, warnings |
| `teal` | `#00AEEF` | Cooling-related flows, links |
| `gold` | `#ECB01F` | Solar gains, gas energy input |
| `off-white` | `#F8F9FA` | Page background |
| `light-grey` | `#E6E6E6` | Borders, grid lines |
| `mid-grey` | `#95A5A6` | Secondary text, labels |
| `dark-grey` | `#58595B` | Body text |

**New tokens for building simulation:**

| Token | Hex | Usage |
|-------|-----|-------|
| `heating-red` | `#DC2626` | Heating demand, heat losses |
| `cooling-blue` | `#3B82F6` | Cooling demand |
| `dhw-orange` | `#F97316` | DHW demand |
| `lighting-amber` | `#F59E0B` | Lighting energy |
| `fan-purple` | `#8B5CF6` | Fan and pump energy |
| `equipment-slate` | `#64748B` | Equipment/small power |
| `fabric-wall` | `#A1887F` | Wall elements in fabric breakdown |
| `fabric-glazing` | `#4FC3F7` | Glazing elements |
| `fabric-roof` | `#78909C` | Roof elements |
| `ventilation-cyan` | `#06B6D4` | Ventilation heat loss/gain |
| `infiltration-grey` | `#9E9E9E` | Infiltration |
| `solar-gain-n` | `#FFF176` | Solar gains — north (lightest) |
| `solar-gain-e` | `#FFD54F` | Solar gains — east |
| `solar-gain-s` | `#FFB74D` | Solar gains — south (warmest) |
| `solar-gain-w` | `#FFCC80` | Solar gains — west |

### Typography

Inherit Pablo exactly:
- **Font:** Stolzl, weights 100–700
- **Size scale:** text-xxs through text-page-title, text-metric for data displays
- **Rule:** Five content sizes only (xxs, caption, body, section, page-title)

### Component reuse

The following Pablo components should be shared or replicated identically:

| Component | Reuse approach |
|-----------|---------------|
| `ChartContainer` | Copy directly — same white card, title, export button |
| `DataCard` | Copy directly — same KPI tile with coloured border |
| `TabBar` | Copy directly — same horizontal tab navigation |
| `ExplorerLayout` | Copy directly — same sidebar + main area shell |
| `ModuleEmptyState` | Copy directly — same empty state pattern |
| `SmartScaleSlider` | Copy directly — use for building parameter inputs |
| `Sidebar` | Adapt — same 56px navy sidebar, different icons and module groupings |

### Chart styling

Inherit Pablo's chart tokens exactly:
```js
TICK_STYLE   = { fontSize: 9, fontFamily: "'Stolzl'", fill: '#95A5A6' }
TOOLTIP_STYLE = { backgroundColor: '#fff', border: '1px solid #E6E6E6', borderRadius: '4px', fontSize: '10px', fontFamily: "'Stolzl'" }
LEGEND_STYLE  = { fontSize: '9px', fontFamily: "'Stolzl'" }
GRID_STYLE    = { strokeDasharray: '3 3', stroke: '#E6E6E6' }
```

### Layout

Same shell structure as Pablo:
- 56px navy sidebar (left) with icon navigation
- Top bar with project name and global controls
- Main content area using ExplorerLayout pattern
- Module sidebar (256–288px) for input controls
- Tab bar for switching between views within a module

---

## 9. Development Phases

### Phase 1 — Foundation (Days 1–2)

**Goal:** Backend can generate valid epJSON from parametric inputs, run EnergyPlus, and return parsed results.

**Deliverables:**
- Python geometry generator: rectangular building → zone vertices → surface definitions → epJSON
- Fabric construction library: default UK construction types with U-values and layer definitions
- HVAC system templates: VRF, gas boiler, ASHP — as reusable epJSON fragments
- Schedule/profile generator: NCM-style hotel profiles → epJSON Schedule:Compact objects
- EnergyPlus runner: subprocess call with epJSON input, EPW weather file, returns SQLite output path
- Results parser: SQL queries against EnergyPlus SQLite for zone loads, system energy, surface heat flows, unmet hours
- FastAPI endpoints: POST /simulate (run), GET /results/{id} (fetch parsed results), GET /library (construction/system/profile library)

**Verification:** Generate a Bridgewater Hotel epJSON, run EnergyPlus manually, confirm simulation completes and produces sensible EUI (compare against CIBSE TM54 hotel benchmark of 200–420 kWh/m²).

### Phase 2 — Core UI (Days 2–4)

**Goal:** Functional React frontend with building definition, 3D viewer, and results dashboard.

**Deliverables:**
- Project shell: sidebar, routing, top bar, ExplorerLayout — matching Pablo's layout
- Building Definition module: input form → API call → 3D viewer updates → summary data cards
- Three.js viewer: parametric building rendered with surface colours, area labels, orientation
- Simulation trigger: "Run Simulation" button → loading state → results appear
- Results dashboard: Monthly energy bar chart, EUI gauge, basic Sankey diagram, load profile chart
- Sanity check panel: health check indicators with traffic light status

**Verification:** Define Bridgewater Hotel through the UI, run simulation, see results in the dashboard. EUI and energy balance should match Phase 1 manual verification.

### Phase 3 — Analytics Deep Dive (Days 4–6)

**Goal:** Full results visualisation suite and scenario comparison.

**Deliverables:**
- Energy Flow Sankey: full input → transformation → output diagram with hover interaction
- Fabric analysis views: heat loss breakdown, solar gains by facade, U-value sensitivity tornado chart
- Systems performance: system energy breakdown, COP tracking, ventilation impact analysis
- Load profiles: hourly stacked area, duration curve, heatmap, day-type selector
- Profile editor: visual schedule editor with template library
- Scenario manager: duplicate, modify, batch run, compare results
- Sensitivity dashboard: parameter sliders with tornado chart

**Verification:** Create three Bridgewater scenarios (baseline, improved fabric, ASHP-only DHW), run all three, compare results in scenario comparison view. Sanity checks should show green for all scenarios.

### Phase 4 — Polish & Bridgewater Delivery (Days 6–7)

**Goal:** Production-quality visuals, Bridgewater-specific refinements, client-ready output.

**Deliverables:**
- Visual polish: animations, transitions, responsive layout, print/export for all charts
- Bridgewater-specific: calibrate model inputs against 505 Group site survey data
- CRREM trajectory overlay on EUI gauge
- Report export: summary PDF or slide deck with key charts and findings
- Documentation: user guide for NZA internal use

---

## 10. Technical Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Input format | epJSON (not IDF) | Maps directly to JSON — React state → API → EnergyPlus with no parsing library needed |
| Geometry generation | Custom Python (not geomeppy/eppy) | Cleaner data model, no third-party dependency, easier to extend. geomeppy is tightly coupled to eppy's IDF data structures |
| 3D viewer | Three.js in browser | Free, no plugin, lightweight. Only needs to show coloured surfaces and labels for sanity checking |
| Charting | Recharts | Matches Pablo. Covers all standard chart types. D3-sankey added for Sankey diagrams only |
| Results parsing | EnergyPlus SQLite output | Most stable and structured output format. Direct SQL queries — no CSV parsing needed |
| HVAC modelling | Template-based (not detailed plant) | Feasibility-stage tool — we need system-level comparisons, not plant-room design. Templates map to EnergyPlus HVACTemplate objects |
| Weather data | EPW files from EnergyPlus repository | Standard format, free, covers all UK locations. Store as library items |
| Profiles | Template-based with overrides | Start from NCM/CIBSE patterns, allow user customisation. Stored as library items for reuse |
| Sensitivity analysis | One-at-a-time with tornado chart | Good enough for feasibility stage. Morris method or Sobol indices are future options if needed |

---

## 11. Non-Negotiable Rules (Inherited from Pablo)

1. **Engines are the single source of truth.** EnergyPlus does the physics. The backend parses results. The frontend displays them. No inline calculations in JSX.
2. **Never generate synthetic data.** No fake profiles, no demo results, no placeholder curves. If the simulation hasn't run, show an empty state.
3. **Library is the single source of truth for inputs.** Every construction, system template, profile, and weather file is a library item. Projects reference them by ID.
4. **Sanity check your work.** After making changes, open the tool in the browser and verify. Do the numbers make sense? Does the EUI fall within benchmarks? Do the areas in the 3D viewer match expectations?
5. **One chunk at a time.** Complete, verify, commit. Do not start the next piece until the current one is confirmed working.

---

## 12. Open Questions for Review

1. **Tool name:** "NZA Simulate"? "NZA Building Physics"? Something else?
2. **Deployment:** Local only for V1 (like Pablo), or cloud-hosted for client access? Cloud would need EnergyPlus installed on a server.
3. **Weather file library:** How many UK locations do we want from day one? Manchester + London covers Bridgewater and most projects, but a fuller set is easy to add.
4. **HVAC template depth:** Are HVACTemplate objects sufficient for feasibility, or do we need detailed system modelling for any of the Bridgewater scenarios?
5. **Report format:** PDF, PowerPoint, or both? What branding/layout does Zeal Hotels expect?
6. **Profile data source:** For Bridgewater calibration, will 505 Group provide measured half-hourly data, or are we working from operational assumptions?
7. **Shared codebase or separate repo?** Should this tool live alongside Pablo in a monorepo, or in its own repository with shared design system components extracted to a package?

---

*Brief prepared for Chris Scott / NZA. Based on research into the EnergyPlus ecosystem, Sefaira/OpenStudio/Honeybee approaches, Pablo 2.0 design system documentation, and Bridgewater Hotel project context.*
