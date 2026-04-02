# Brief 04: Project Persistence, Library System & Profiles Editor

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read docs/briefs/00_project_brief.md — sections 3 (Architecture), 5.3 (Profiles & Schedules Editor)
4. Read docs/pablo_design_system_reference.md — sections 5 (Component Patterns), 6 (Data Flow — especially ProjectContext and library system)
5. Read this ENTIRE brief before writing a single line of code
6. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES — READ THIS BEFORE EVERY PART

**Browser verification is mandatory.** After completing each part, you MUST open the application in a real browser and visually confirm it works. Do not verify through code review, terminal output, or API calls alone.

**For every part:**
1. Ensure both servers are running (backend on 8002, frontend on 5176)
2. Open `http://127.0.0.1:5176` in the browser
3. Perform the specific checks listed in the Verify section
4. Take a screenshot of the working result
5. Report what you see — describe the actual visual state, not what you expect to see
6. If ANYTHING looks wrong — fix it before committing
7. Check browser DevTools → Console for red errors

---

## Context

We have a fully functional simulation tool: building definition, 3D viewer, systems module, Sankey diagram, and results dashboard. But there's no way to save a project, reload it later, switch between projects, or manage a library of reusable components. The tool currently loses all state on page refresh.

This brief builds the data persistence layer that makes NZA Sim a real working tool rather than a demo. It also adds the Profiles editor, which needs the library system to store custom schedules.

**Architecture decision: Two-tier library**

**Global Library** — reusable items that work across any project:
- Construction buildups (wall, roof, floor, glazing)
- System templates (VRF, ASHP, boiler, MVHR, etc.)
- Schedule templates (hotel bedroom occupancy, office lighting, etc.)
- Weather files
- Benchmark datasets (CRREM pathways — future brief)

**Project** — everything specific to one building:
- Building geometry parameters
- Library item assignments (which construction, which system)
- Parameter overrides (customised COP, adjusted LPD, etc.)
- Systems configuration
- Simulation runs and results
- Scenario variants (future brief)

**Auto-save behaviour:** Changes to project parameters auto-save as you work. No manual "Save" button for parameter changes. There IS a "Save to Library" action for promoting project-specific items (like a custom schedule) to the global library.

14 parts. Do them in order.

---

## PART 1: SQLite database schema

**File(s):** `api/db/__init__.py`, `api/db/database.py`, `api/db/schema.sql`

Create the SQLite database layer. Use `aiosqlite` for async access (matching Pablo's approach). No ORM — raw SQL queries.

Database file: `data/nza_sim.db` (gitignored, local only)

**Schema:**

```sql
-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    building_config JSON NOT NULL,    -- geometry params, orientation, WWR
    systems_config JSON NOT NULL,     -- HVAC, ventilation, DHW, lighting
    construction_choices JSON NOT NULL, -- which library constructions are assigned
    schedule_assignments JSON,        -- which library schedules are assigned per zone type
    weather_file TEXT,                -- filename of assigned weather file
    metadata JSON                     -- any extra project-level metadata
);

-- Library items (global, reusable across projects)
CREATE TABLE IF NOT EXISTS library_items (
    id TEXT PRIMARY KEY,
    library_type TEXT NOT NULL,       -- 'construction', 'system', 'schedule', 'weather', 'benchmark'
    name TEXT NOT NULL,
    description TEXT,
    config_json JSON NOT NULL,        -- the full item definition
    is_default BOOLEAN DEFAULT 0,     -- true for built-in items, false for user-created
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Simulation runs
CREATE TABLE IF NOT EXISTS simulation_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    scenario_name TEXT DEFAULT 'Baseline',
    status TEXT NOT NULL,             -- 'running', 'complete', 'error'
    input_snapshot JSON NOT NULL,     -- full snapshot of inputs at time of run
    results_summary JSON,            -- parsed summary results (EUI, peaks, etc.)
    results_monthly JSON,            -- monthly breakdown
    results_hourly_path TEXT,        -- file path to full hourly data (too large for DB)
    envelope_heat_flow JSON,         -- per-facade heat flow data
    sankey_data JSON,                -- pre-computed Sankey nodes and links
    energyplus_warnings INTEGER DEFAULT 0,
    energyplus_errors INTEGER DEFAULT 0,
    error_message TEXT,
    simulation_time_seconds REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Create `api/db/database.py` with:
- `init_db()` — creates tables if they don't exist, seeds default library items (constructions, systems, schedules from the existing Python library modules)
- `get_db()` — returns an async database connection
- Database file path from config, WAL mode enabled

The `init_db()` function should populate the library with all the existing constructions from `nza_engine/library/constructions.py` and system templates from `nza_engine/library/systems.py`, each marked as `is_default=True`. This ensures the tool works out of the box without manual setup.

**Commit message:** "Part 1: SQLite database schema with projects, library, and simulation runs"

**Verify:**
1. Run `python -c "import asyncio; from api.db.database import init_db; asyncio.run(init_db())"` — should create the database file at `data/nza_sim.db` without errors
2. Run `sqlite3 data/nza_sim.db ".tables"` — should show `projects`, `library_items`, `simulation_runs`
3. Run `sqlite3 data/nza_sim.db "SELECT COUNT(*) FROM library_items"` — should show the number of seeded items (all constructions + system templates)
4. Run `sqlite3 data/nza_sim.db "SELECT library_type, name FROM library_items LIMIT 10"` — should show construction and system names
5. Report: "Database created with 3 tables. [X] library items seeded ([Y] constructions, [Z] systems). WAL mode enabled. Database file at data/nza_sim.db."

---

## PART 2: Project CRUD API

**File(s):** `api/routers/projects.py`, update `api/main.py`

Create REST API endpoints for project management:

**POST /api/projects** — Create a new project
- Accepts: `{ name, description? }`
- Creates project with default building config (Bridgewater defaults), default systems, default construction assignments
- Returns: the full project object with ID

**GET /api/projects** — List all projects
- Returns: array of projects with id, name, description, updated_at
- Sorted by updated_at descending (most recent first)

**GET /api/projects/{id}** — Get full project details
- Returns: complete project including building_config, systems_config, construction_choices, schedule_assignments, and list of simulation runs

**PUT /api/projects/{id}** — Update project
- Accepts: partial update — any combination of building_config, systems_config, construction_choices, schedule_assignments, weather_file
- Updates `updated_at` timestamp
- Returns: updated project

**DELETE /api/projects/{id}** — Delete project and all associated simulation runs

**PUT /api/projects/{id}/building** — Quick-update building config only
- This is the endpoint the auto-save will hit when geometry/fabric changes

**PUT /api/projects/{id}/systems** — Quick-update systems config only

Update the simulate endpoint to associate runs with a project:
**POST /api/projects/{id}/simulate** — Run simulation for a specific project
- Reads current project config from DB
- Runs simulation
- Stores results in simulation_runs table
- Returns results

**GET /api/projects/{id}/simulations** — List all simulation runs for a project

**Commit message:** "Part 2: Project CRUD API endpoints"

**Verify:**
1. Start the backend API
2. Create a project: `curl -X POST http://127.0.0.1:8002/api/projects -H "Content-Type: application/json" -d '{"name": "Bridgewater Hotel"}'` — should return a project object with an ID
3. List projects: `curl http://127.0.0.1:8002/api/projects` — should show the created project
4. Get project: `curl http://127.0.0.1:8002/api/projects/{id}` — should return full details with default config
5. Update building config: `curl -X PUT http://127.0.0.1:8002/api/projects/{id}/building -H "Content-Type: application/json" -d '{"length": 80}'` — should return updated project with length=80
6. Get project again — length should now be 80
7. Report: "Project CRUD working. Created project [ID], listed, retrieved, updated building length to 80, confirmed persistence. All endpoints return correct data."

---

## PART 3: Library API

**File(s):** `api/routers/library.py` (update/replace existing)

Create REST API endpoints for the global library:

**GET /api/library** — List all library items
- Optional query params: `type` (filter by library_type), `search` (search name/description)
- Returns: array of items with id, type, name, description, is_default

**GET /api/library/{id}** — Get full library item details including config_json

**POST /api/library** — Create a new library item (user-created)
- Accepts: `{ library_type, name, description?, config_json }`
- Sets `is_default=false`
- Returns: created item

**PUT /api/library/{id}** — Update a library item
- Only allowed for non-default items (user-created). Default items are read-only.
- Returns: updated item

**DELETE /api/library/{id}** — Delete a library item
- Only allowed for non-default items

The existing `/api/library/constructions` and `/api/library/systems` endpoints should now read from the database instead of the Python modules directly. The Python modules become the seed data source (called by `init_db()`), not the runtime data source.

**Commit message:** "Part 3: Library CRUD API with database-backed storage"

**Verify:**
1. Start the API
2. List all library items: `curl http://127.0.0.1:8002/api/library` — should return all seeded items
3. Filter by type: `curl "http://127.0.0.1:8002/api/library?type=construction"` — should return only constructions
4. Get a specific item: `curl http://127.0.0.1:8002/api/library/{id}` — should return full config_json with material layers
5. Create a custom construction: `curl -X POST http://127.0.0.1:8002/api/library -H "Content-Type: application/json" -d '{"library_type": "construction", "name": "Custom Wall Test", "config_json": {"u_value": 0.15}}'` — should succeed
6. Try to delete a default item — should return 403 or error
7. Delete the custom item — should succeed
8. Verify the existing Fabric tab still works: `curl http://127.0.0.1:8002/api/library?type=construction` should return data the frontend can use
9. Report: "Library API working. [X] items in database. Filter by type working. CRUD for custom items working. Default items protected from deletion. Existing construction endpoint compatible."

---

## PART 4: Frontend project context overhaul

**File(s):** `frontend/src/context/ProjectContext.jsx` (new), update `frontend/src/context/BuildingContext.jsx`, update `frontend/src/context/SimulationContext.jsx`, update `frontend/src/App.jsx`

Create a `ProjectContext` that manages the current project state, auto-save, and data loading. This replaces the standalone BuildingContext and integrates with SimulationContext.

**ProjectContext provides:**
```js
{
  // Project state
  currentProject: { id, name, description, ... },
  projects: [],  // list of all projects for the picker
  isLoading: true/false,
  isSaving: true/false,
  lastSaved: timestamp,
  
  // Building config (was BuildingContext)
  building: { name, length, width, num_floors, floor_height, orientation, wwr },
  constructions: { external_wall, roof, ground_floor, glazing },
  
  // Systems config
  systems: { hvac_type, ventilation_type, natural_ventilation, ... },
  
  // Schedule assignments
  schedules: { bedroom_occupancy, corridor_occupancy, lighting, ... },
  
  // Simulation
  simulationRuns: [],
  latestResults: null,
  
  // Actions
  createProject: (name) => {},
  loadProject: (id) => {},
  updateBuilding: (changes) => {},     // auto-saves with debounce
  updateSystems: (changes) => {},      // auto-saves with debounce
  updateConstructions: (changes) => {}, // auto-saves with debounce
  runSimulation: () => {},
  deleteProject: (id) => {},
}
```

**Auto-save behaviour:**
- When `updateBuilding()`, `updateSystems()`, or `updateConstructions()` is called, debounce for 1 second, then PUT to the appropriate API endpoint
- Show a subtle save indicator in the top bar: "Saving..." → "Saved ✓" (auto-dismiss after 2 seconds)
- If save fails, show "Save failed" in coral with a retry option

**On app load:**
- Fetch the list of projects from the API
- If projects exist, load the most recently updated one
- If no projects exist, create a default "New Project" and load it

Update all existing components that use BuildingContext to use ProjectContext instead. This is a refactor — the component interfaces shouldn't change much, just the import source.

**Commit message:** "Part 4: ProjectContext with auto-save, project loading, and debounced persistence"

**Verify:**
1. Open `http://127.0.0.1:5176` in browser
2. The app should load and either create a default project or load the most recent one
3. **INTERACT:** Navigate to /building → Geometry tab. Change the building length from 60 to 75.
4. Watch the top bar — a "Saving..." indicator should appear briefly, then "Saved ✓"
5. **PERSISTENCE TEST:** Refresh the browser page (Cmd+R). Navigate back to /building → Geometry tab. The length should still be 75, NOT reset to 60. This is the critical test — if the value reverts, auto-save isn't working.
6. **INTERACT:** Change WWR north to 40%. Refresh. Check it's still 40%.
7. **INTERACT:** Navigate to /systems. Change LPD to 12. Refresh. Check it's still 12.
8. **SCREENSHOT:** The app loaded with persisted values after refresh, showing the save indicator
9. Open browser DevTools → Console — zero red errors. Check Network tab — PUT requests should fire ~1 second after each change (debounced).
10. Report: "Auto-save working. Tested: building length (60→75, persisted through refresh), WWR north (25→40, persisted), LPD (8→12, persisted). Save indicator shows 'Saving...' then 'Saved ✓'. Debounce working — single PUT per change cluster. No console errors."

---

## PART 5: Project picker and management UI

**File(s):** `frontend/src/components/layout/ProjectPicker.jsx`, `frontend/src/components/modules/Home.jsx`, update `frontend/src/components/layout/TopBar.jsx`

Build the project management interface.

**TopBar update:**
- The project name in the top bar should be clickable — clicking it opens the ProjectPicker
- Show the project name with a small dropdown chevron icon

**ProjectPicker.jsx** — A dropdown panel or modal that appears when clicking the project name:
- List of all projects, sorted by most recently updated
- Each row shows: project name, description (if any), last updated date, number of simulation runs
- Click a project to load it (closes the picker, loads the project into context)
- "New Project" button at the top — creates a new project with defaults and loads it
- Delete button (small, with confirmation) on each project row — but NOT on the currently loaded project
- Close button or click-outside-to-close

**Home page (/ route) update:**
- Show a project overview: name, description (editable), created date, last simulation date
- Quick links to each module: "Define Building →", "Configure Systems →", "View Results →"
- Recent simulation runs list with date, EUI, and key metrics
- If no simulations have been run: show a getting-started guide ("1. Define your building → 2. Configure systems → 3. Run simulation")

**Commit message:** "Part 5: Project picker dropdown and home page with project overview"

**Verify:**
1. Open `http://127.0.0.1:5176` in browser
2. **SCREENSHOT 1:** The home page showing the project overview with quick links
3. **INTERACT:** Click the project name in the top bar — the ProjectPicker should open
4. **SCREENSHOT 2:** The ProjectPicker showing the current project (and any others)
5. **INTERACT:** Click "New Project" — a new project should be created and loaded. The project name in the top bar should change.
6. **INTERACT:** Navigate to /building, change something (e.g. floors = 6), then click the project name and switch back to the first project. The first project should still have its original values (floors = 4). Switch to the new project — it should have floors = 6.
7. **CRITICAL TEST:** This confirms projects are truly independent and switching between them loads different data.
8. **INTERACT:** Delete the new test project (click delete, confirm). It should disappear from the list and the original project should load.
9. Open browser DevTools → Console — zero red errors
10. Report: "Project picker working. Created new project, modified it, switched between projects — each has independent data. Deleted test project successfully. Home page shows overview and quick links. No console errors."

---

## PART 6: Library browser UI

**File(s):** `frontend/src/components/modules/LibraryBrowser.jsx`, update sidebar and routing

Add a Library icon to the sidebar (use `Library` or `BookOpen` icon from lucide-react) — place it at the bottom of the sidebar, separated from the main modules by a divider.

**LibraryBrowser.jsx** — A full-page module for browsing and managing the global library.

**Layout:** ExplorerLayout with filter sidebar and item grid in the main area.

**Filter sidebar:**
- Type filter: checkboxes or buttons for Construction, System, Schedule, Weather
- Search box: filters by name
- "Show defaults" toggle (on by default) — hide/show built-in items
- "Add New Item" button (for creating custom items — future functionality, show as disabled for now)

**Main area — item grid:**
- Each item as a card showing:
  - Type badge (colour-coded: blue for construction, green for system, purple for schedule)
  - Name (bold)
  - Key info: U-value for constructions, COP for systems, type description for schedules
  - "Default" badge if it's a built-in item
  - Created/updated date for custom items
- Cards laid out in a responsive grid (3-4 columns)

**Click on an item card:** Opens a detail panel (slide-out from right or modal) showing:
- Full item details
- For constructions: layer-by-layer buildup with thicknesses, conductivities, and the resulting U-value
- For systems: all parameters (COP, EER, fan power, etc.)
- For schedules: a 24-hour profile preview chart
- "Use in Current Project" button (assigns this item to the current project)
- "Duplicate" button (creates an editable copy for customisation)

**Commit message:** "Part 6: Library browser with type filters, search, and item detail panel"

**Verify:**
1. Open `http://127.0.0.1:5176` and click the Library icon in the sidebar
2. **SCREENSHOT 1:** The Library browser showing a grid of items (constructions and systems seeded from init_db). Type badges should be colour-coded.
3. **INTERACT:** Click "Construction" type filter — only constructions should show. Click "System" — only systems. Click both — both show.
4. **INTERACT:** Type "enhanced" in the search box — only items with "enhanced" in the name should show (e.g. cavity_wall_enhanced, ground_floor_enhanced).
5. **INTERACT:** Click on a construction card — the detail panel should open showing the layer buildup with thicknesses, conductivities, and overall U-value.
6. **SCREENSHOT 2:** The detail panel for a wall construction showing its layers
7. **INTERACT:** Click on a system card — detail panel should show COP, EER, etc.
8. Close the detail panel — should return to the grid
9. Open browser DevTools → Console — zero red errors
10. Report: "Library browser renders with [X] items in grid. Type filtering working (tested construction + system filters). Search working (tested 'enhanced' — [X] results). Detail panel shows construction layers with U-value calculation and system parameters. No console errors."

---

## PART 7: Construction detail in Fabric tab

**File(s):** Update `frontend/src/components/modules/building/FabricTab.jsx`

Enhance the Fabric tab to show more detail about the selected constructions and connect to the library.

When a construction is selected in the dropdown:
- Show a **buildup diagram** below the dropdown: a vertical stack showing each layer with its name, thickness (mm), and a visual bar proportional to thickness. Colour-code: insulation in yellow, masonry in grey, plasterboard in light blue.
- Show the **overall U-value** prominently as a DataCard
- Show a **"View in Library"** link that opens the Library browser filtered to that item
- Show a **thermal mass indicator**: Heavy / Medium / Light based on the construction's density profile

For each of the four elements (wall, roof, floor, glazing), the Fabric tab sidebar should show:
1. Dropdown selector (populated from library, filtered by construction sub-type)
2. U-value DataCard
3. Mini buildup diagram (compact version, showing layers as coloured bars)

The main content area of the Fabric tab should show a **summary view**:
- Building cross-section or elevation diagram (simple SVG or styled HTML) with U-values annotated on each element
- Total heat loss coefficient (W/K) — sum of (U × A) for all elements
- Comparison bar: how does this total compare to a typical hotel? (show a benchmark range)

**Commit message:** "Part 7: Enhanced Fabric tab with construction buildup diagrams and thermal summary"

**Verify:**
1. Navigate to /building → Fabric tab
2. **SCREENSHOT 1:** The Fabric tab showing all four element dropdowns with U-values and mini buildup diagrams visible
3. **INTERACT:** Select "cavity_wall_enhanced" for the wall — the buildup diagram should change (thicker insulation layer visible), and the U-value should decrease
4. **INTERACT:** Select "triple_glazing" — U-value should drop and the display should update
5. **SCREENSHOT 2:** The main content area showing the summary view with annotated U-values and total heat loss coefficient
6. **DATA CHECK:** The total heat loss coefficient should change when you select different constructions. Better insulation = lower coefficient.
7. Open browser DevTools → Console — zero red errors
8. Report: "Fabric tab now shows construction buildups for all 4 elements. Tested wall change: cavity_wall_standard (U=[X]) → cavity_wall_enhanced (U=[X]) — buildup diagram updated, thicker insulation visible. Total heat loss coefficient: [X] W/K with standard, [X] W/K with enhanced. Summary view shows annotated U-values. No console errors."

---

## PART 8: Schedule library — backend

**File(s):** `nza_engine/library/schedules.py` (major update), `api/db/database.py` (seed schedules)

Restructure the schedule library so schedules are stored as library items with a standardised format that can be visualised and edited.

Each schedule library item should have this structure in `config_json`:
```json
{
  "schedule_type": "occupancy",
  "building_type": "hotel",
  "zone_type": "bedroom",
  "time_resolution": "hourly",
  "day_types": {
    "weekday": [0.9, 0.9, 0.9, 0.9, 0.9, 0.8, 0.6, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9, 0.9, 0.9],
    "saturday": [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.7, 0.4, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 0.8, 0.9, 0.9, 0.9],
    "sunday": [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8, 0.5, 0.4, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.9, 0.9]
  },
  "monthly_multipliers": [0.7, 0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7],
  "description": "Hotel bedroom occupancy — high at night, low during day, seasonal variation for UK tourism"
}
```

Create schedule templates for a hotel:
- `hotel_bedroom_occupancy` — high at night, low during day, seasonal variation
- `hotel_corridor_occupancy` — inverse of bedrooms
- `hotel_reception_occupancy` — daytime peaks
- `hotel_bedroom_lighting` — follows occupancy with offset (evening peak)
- `hotel_corridor_lighting` — near-constant
- `hotel_bedroom_equipment` — follows occupancy loosely
- `hotel_heating_setpoint` — 21°C occupied, 16°C setback (as 0/1 schedule, actual temps set elsewhere)
- `hotel_cooling_setpoint` — 24°C occupied, 28°C setback
- `hotel_dhw_demand` — morning and evening peaks

Also create basic templates for other building types (for future projects):
- `office_occupancy` — 9-5 weekday, empty weekend
- `office_lighting` — follows occupancy with daylight adjustment
- `retail_occupancy` — 10-6 pattern

Seed all of these into the library database via `init_db()`.

Update the assembler to read schedules from the library (via the project's schedule assignments) rather than hardcoded Python functions.

**Commit message:** "Part 8: Schedule library with standardised format and hotel/office templates"

**Verify:**
1. Run `init_db()` to seed the new schedules
2. `sqlite3 data/nza_sim.db "SELECT name FROM library_items WHERE library_type='schedule'"` — should list all schedule templates
3. `curl "http://127.0.0.1:8002/api/library?type=schedule"` — should return schedule items
4. Get a schedule detail: `curl http://127.0.0.1:8002/api/library/{schedule_id}` — should return the full day_types arrays and monthly_multipliers
5. Run a simulation — it should still work (the assembler now reads from library instead of hardcoded). Compare EUI with previous runs — it should be similar (same schedules, just different source).
6. Report: "Schedule library created with [X] templates ([Y] hotel, [Z] office/retail). All seeded to database. Assembler updated to read from library. Simulation still works — EUI [X] kWh/m² (was [Y] — [same/different because...]). API returns schedule data correctly."

---

## PART 9: Profiles editor — visual schedule display

**File(s):** `frontend/src/components/modules/ProfilesEditor.jsx`, `frontend/src/components/modules/profiles/ScheduleViewer.jsx`, `frontend/src/components/modules/profiles/DayProfileChart.jsx`, `frontend/src/components/modules/profiles/HeatmapView.jsx`

Build the Profiles module, replacing the placeholder on the /profiles route.

**ProfilesEditor.jsx** — Uses ExplorerLayout.

**Sidebar:**
- Schedule type filter: Occupancy, Lighting, Equipment, Heating Setpoint, Cooling Setpoint, DHW
- Zone type filter: Bedroom, Corridor, Reception, All
- List of matching schedules from the library — each as a selectable item with name and type badge
- "Currently assigned" section at the top showing which schedules are assigned to the current project
- "Create Custom Schedule" button

**Main content area — two views (toggle between them):**

**View 1: Day Profile Chart** (Recharts AreaChart)
- X axis: Hour (0-23)
- Y axis: Fraction (0-1) or actual value
- Three overlaid lines/areas: Weekday, Saturday, Sunday — each in a different shade
- Smooth curves
- Below the chart: Monthly multipliers shown as 12 small bars (mini bar chart)
- Title shows the schedule name

**View 2: Heatmap** (custom component or Recharts-based)
- X axis: Month (Jan-Dec)
- Y axis: Hour of day (0-23)
- Colour intensity: schedule value × monthly multiplier
- This shows the full annual pattern at a glance — when is this zone most occupied/lit/heated?
- Colour scale: light (low) to dark/saturated (high), using the module accent colour

**When a schedule is selected in the sidebar:**
- The day profile chart and heatmap update to show that schedule's data
- A "Assign to Project" button becomes available
- An "Edit Copy" button creates a duplicate for customisation (Part 10)

**Commit message:** "Part 9: Profiles editor with day profile chart and heatmap view"

**Verify:**
1. Open `http://127.0.0.1:5176` and click the Profiles icon in the sidebar
2. **SCREENSHOT 1:** The Profiles editor showing the sidebar with schedule list and the main area with a day profile chart for the selected schedule
3. **INTERACT:** Click on "hotel_bedroom_occupancy" in the sidebar — the chart should show high values at night (0.9), low during day (0.1-0.3), with three curves for weekday/saturday/sunday
4. **INTERACT:** Click on "hotel_corridor_lighting" — the chart should show a near-constant pattern (0.5-0.8)
5. **INTERACT:** Toggle to Heatmap view — the heatmap should show the annual pattern with colour intensity. For bedroom occupancy: dark bands at night hours, light during day, with seasonal variation (lighter in winter months due to monthly multipliers of 0.7)
6. **SCREENSHOT 2:** The heatmap view for hotel bedroom occupancy
7. **INTERACT:** Filter by "Lighting" type — only lighting schedules should show
8. **DATA CHECK:** Do the schedule patterns make intuitive sense? Hotel bedrooms occupied at night, corridors busy during day, equipment constant, heating setpoint following occupancy?
9. Open browser DevTools → Console — zero red errors
10. Report: "Profiles editor renders with [X] schedules in sidebar. Day profile chart shows 3 day types with correct patterns. Heatmap shows annual pattern — bedroom occupancy dark at night, light during day, seasonal variation visible. Type filtering works. All schedule patterns look plausible. No console errors."

---

## PART 10: Profiles editor — schedule editing

**File(s):** `frontend/src/components/modules/profiles/ScheduleEditor.jsx`, update `frontend/src/components/modules/ProfilesEditor.jsx`

Add the ability to create and edit custom schedules.

**"Create Custom Schedule" flow:**
1. Click "Create Custom Schedule" in the sidebar
2. A form appears: Name, Schedule Type (dropdown), Zone Type (dropdown), Base Template (optional — copy from an existing schedule)
3. Click "Create" — a new schedule appears in the sidebar in edit mode

**Edit mode:**
The day profile chart becomes interactive:
- Each hour is a draggable point (or clickable bar) that can be raised or lowered
- Click and drag to "paint" values across multiple hours
- Three separate editable profiles: Weekday, Saturday, Sunday (tab between them)
- A value input (0-1 for fractions, or actual values for setpoints) for precise entry
- Below: 12 monthly multiplier sliders (range 0.5-1.5)

**Quick-set tools:**
- "Flat" button — sets all hours to the same value
- "Copy Weekday to Weekend" — copies weekday profile to Saturday and Sunday
- "Invert" — flips the profile (useful for creating corridor occupancy from bedroom occupancy)
- "Shift" — moves the profile left/right by N hours (e.g. shift a 9-5 office pattern to a 10-6 retail pattern)

**Save flow:**
- "Save to Library" button — POST to `/api/library` to create the custom schedule
- "Assign to Project" button — assigns this schedule to the relevant zone type in the current project
- Auto-preview: as the user edits, the heatmap updates in real time

**Commit message:** "Part 10: Interactive schedule editor with drag-to-paint and quick-set tools"

**Verify:**
1. Navigate to /profiles
2. **INTERACT:** Click "Create Custom Schedule" — fill in name: "Test Custom", type: "Occupancy", base template: "hotel_bedroom_occupancy"
3. The editor should show the bedroom occupancy pattern, but now editable
4. **INTERACT:** Click on the 09:00 bar and drag it up to 0.8 — the chart should update in real time
5. **INTERACT:** Click "Copy Weekday to Weekend" — Saturday and Sunday tabs should now match weekday
6. **INTERACT:** Adjust the July monthly multiplier to 1.3 (peak summer) — the heatmap should show a brighter July column
7. **SCREENSHOT 1:** The editor with modified schedule and live-updating heatmap
8. **INTERACT:** Click "Save to Library" — the schedule should appear in the sidebar list with a "Custom" badge (not "Default")
9. **INTERACT:** Navigate to Library browser — the custom schedule should be visible there too
10. **INTERACT:** Delete the custom schedule from the Library browser — it should disappear from both Library and Profiles sidebar
11. Open browser DevTools → Console — zero red errors
12. Report: "Schedule editor working. Created custom schedule from template, edited hours via drag, used 'Copy to Weekend' tool, adjusted monthly multipliers. Saved to library successfully — visible in both Profiles sidebar and Library browser. Deleted custom schedule — removed from both locations. Real-time heatmap preview working. No console errors."

---

## PART 11: Wire schedules to simulation

**File(s):** Update `frontend/src/context/ProjectContext.jsx`, update `nza_engine/generators/epjson_assembler.py`, update `api/routers/projects.py`

Connect the schedule system to the simulation pipeline:

1. **Project schedule assignments:** The project's `schedule_assignments` field maps zone types to schedule library IDs:
   ```json
   {
     "bedroom_occupancy": "lib_id_123",
     "bedroom_lighting": "lib_id_456",
     "corridor_occupancy": "lib_id_789",
     ...
   }
   ```

2. **Assembler reads assigned schedules:** When assembling the epJSON, the assembler:
   - Reads the project's schedule assignments
   - Fetches the schedule data from the library
   - Converts the 24-hour arrays + day types into EnergyPlus `Schedule:Compact` objects
   - Applies monthly multipliers

3. **Frontend "Assign to Project" button:** In the Profiles editor, clicking "Assign to Project" updates the project's schedule_assignments for the relevant zone type.

4. **Fallback:** If a schedule isn't explicitly assigned, use the default for that zone type (the is_default=true schedule matching the type and zone).

**Commit message:** "Part 11: Schedule assignments wired from library through project to simulation"

**Verify:**
1. Navigate to /profiles, select "hotel_bedroom_occupancy"
2. Click "Assign to Project" — confirm it saves
3. Create a CUSTOM bedroom occupancy schedule with significantly different patterns (e.g. set all hours to 0.5 — uniform occupancy)
4. Assign the custom schedule to the project
5. Run a simulation
6. Check Results → Load Profiles — the hourly pattern should reflect the uniform occupancy (flatter profile than before)
7. Re-assign the default hotel bedroom occupancy schedule
8. Run simulation again
9. Check Results → Load Profiles — the hourly pattern should return to the normal night-heavy pattern
10. **CRITICAL CHECK:** The two simulations should produce DIFFERENT EUI values — the schedule change should affect the results. If EUI is identical, the schedule assignment isn't feeding through to the simulation.
11. Report: "Schedule assignments wired end-to-end. Custom uniform occupancy: EUI [X] kWh/m². Default hotel occupancy: EUI [X] kWh/m². Difference: [X] kWh/m² — confirms schedules affect simulation results. Load profile shapes visibly different between the two runs."

---

## PART 12: Simulation history and results persistence

**File(s):** Update `frontend/src/context/ProjectContext.jsx`, update `frontend/src/components/modules/results/` components

Currently, simulation results are lost on page refresh (stored only in React context). Fix this:

1. **Results stored in database:** Simulation results are already being stored in the `simulation_runs` table (Part 2). Ensure the full results set (summary, monthly, envelope, sankey data) is persisted.

2. **On project load:** Fetch the latest simulation run for the project and populate the results context. The Results Dashboard should show data immediately on load without needing to re-run a simulation.

3. **Simulation history list:** Add a "History" section to the Results Dashboard (or as a sub-tab) showing:
   - List of all simulation runs for this project
   - Each row: date/time, scenario name, EUI, key delta from previous run
   - Click a run to load its results into the dashboard
   - The currently viewed run should be highlighted

4. **Run comparison:** If the user loads a different historical run, all Results tabs update to show that run's data.

**Commit message:** "Part 12: Simulation results persist in database and survive page refresh"

**Verify:**
1. Open the app, navigate to /building, run a simulation
2. Note the EUI value
3. **PERSISTENCE TEST:** Refresh the browser (Cmd+R)
4. Navigate to Results → Overview — the EUI and all metrics should still be there (loaded from database), NOT empty state
5. **CRITICAL:** This is the most important test. If results disappear on refresh, persistence isn't working.
6. Run a second simulation (change something first, like wall construction)
7. Navigate to the History section — both runs should be listed with different EUI values
8. Click the first run — results should switch to the first run's data
9. Click the second run — results should switch back
10. **SCREENSHOT:** The History section showing two runs with different EUI values
11. Open browser DevTools → Console — zero red errors
12. Report: "Results now persist through page refresh. Tested: ran simulation (EUI [X]), refreshed page, results still showing (EUI [X] — matches). Second simulation stored independently. History shows [X] runs. Switching between runs updates all Results tabs. No console errors."

---

## PART 13: Polish — save indicators, loading states, error handling

**File(s):** Various — update across the app

Add consistent UX polish across the application:

**Save indicator (top bar):**
- Appears next to the project name
- States: idle (nothing shown), saving ("Saving..." in mid-grey with small spinner), saved ("Saved ✓" in green, auto-dismiss after 2 seconds), error ("Save failed" in coral with retry link)

**Loading states:**
- When a project is loading: full-page loading spinner with "Loading project..."
- When simulation results are loading from DB: skeleton placeholders in the Results Dashboard (grey pulsing bars where charts will be)
- When library items are loading: skeleton placeholders in the Library browser

**Error boundaries:**
- Wrap each module in an error boundary so a crash in one module doesn't white-screen the entire app
- Error boundary shows: module name, "Something went wrong" message, "Try Again" button, and the error details in a collapsible section
- The Fabric tab white screen from Brief 02 should never happen again

**Unsaved changes warning:**
- If the user has unsaved changes (auto-save is still debouncing) and tries to run a simulation, wait for the save to complete first, THEN run the simulation. Show "Saving changes..." briefly before "Simulating..."

**Commit message:** "Part 13: Save indicators, loading states, error boundaries, and polish"

**Verify:**
1. Open the app — if projects exist, it should show a loading state briefly then render
2. Navigate to /building — change a parameter. Watch the top bar for "Saving..." → "Saved ✓"
3. Quickly change multiple parameters in succession — the save indicator should debounce (not flash rapidly)
4. **ERROR TEST:** Stop the backend API. Change a parameter. The save indicator should show "Save failed" in coral. Restart the backend. Click retry — it should save.
5. Navigate to /results before running a simulation — should show appropriate empty/loading states, not crashes
6. **SCREENSHOT:** The save indicator showing "Saved ✓" after a change
7. Open browser DevTools → Console — zero red errors during normal operation
8. Report: "Save indicator working (Saving/Saved/Failed states all tested). Loading states render during project and results load. Error boundaries catch module crashes — tested by [describe test]. Unsaved changes gate works — simulation waits for save. No console errors."

---

## PART 14: Full integration test

Run a complete end-to-end test simulating a real workflow:

1. **Fresh start:** Delete all projects (or use a fresh database: `rm data/nza_sim.db` then restart backend)
2. Open the app — it should create a default project automatically
3. Rename the project to "Bridgewater Hotel" (from the home page or top bar)
4. Navigate to /building → Geometry: set 60×15, 4 floors, 3.2m, 0° orientation, 25% WWR all facades
5. Fabric: select cavity_wall_standard, flat_roof_standard, ground_floor_slab, double_low_e
6. Navigate to /systems → HVAC: VRF, Ventilation: MEV + natural vent on (22°C), DHW: gas boiler + ASHP, Lighting: 8 W/m²
7. Navigate to /profiles → verify hotel bedroom occupancy is assigned. If not, assign it.
8. Click Run Simulation → wait for complete
9. Check all Results tabs — every chart and metric should be populated
10. Refresh the browser — everything should persist
11. Create a SECOND project: "Bridgewater — Enhanced Fabric"
12. Load it, set same geometry but use cavity_wall_enhanced, flat_roof_enhanced, ground_floor_enhanced, triple_glazing
13. Run simulation
14. Switch between the two projects — each should have its own results
15. Navigate to Library browser — all constructions, systems, and schedules should be visible

**SCREENSHOTS (take all of these):**
1. Home page with project overview
2. Building Definition → Geometry tab with 3D viewer
3. Building Definition → Fabric tab with construction buildups
4. Systems → HVAC tab
5. Profiles editor with heatmap view
6. Results → Overview with all metrics
7. Results → Sankey energy flow
8. Results → Energy Balance monthly chart
9. Results → Load Profiles hourly chart
10. Results → Fabric Analysis
11. Library browser with item detail
12. Project picker showing both projects

**Commit message:** "Part 14: Full integration test — two projects, library, persistence verified"

**Verify:**
Report the following for BOTH projects:
- Project name
- EUI (kWh/m²)
- Annual heating demand (kWh)
- Annual cooling demand (kWh)
- Peak heating load (W/m²)
- The enhanced fabric project should have LOWER heating demand than the standard project
- Browser console: zero red errors across entire workflow

---

## After all 14 parts are complete

Update STATUS.md with:
- All 14 parts completed
- Both project simulation results (standard vs enhanced fabric)
- The full feature list: project persistence, library browser, schedule editor, auto-save
- Data persistence confirmed through refresh
- Known issues
- Suggestions for Brief 05 (Scenario manager, CRREM trajectory, carbon tracking, report export, detailed HVAC with COP curves)

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 04 complete. Projects save and reload, library browser working, schedule editor with heatmap, auto-save with indicators, results persist through refresh. Two test projects created — standard fabric EUI [X] kWh/m² vs enhanced fabric EUI [X] kWh/m². Full walkthrough screenshots taken."
