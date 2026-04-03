# Brief 08: The Live Studio — Integrated Three-Column Workspace with Instant Feedback

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read docs/briefs/00_project_brief.md — sections 4 (Geometry & 3D), 6 (Results & Visualisation), 8 (Design System)
4. Read docs/pablo_design_system_reference.md — typography, spacing, component patterns
5. Read this ENTIRE brief before writing a single line of code
6. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** After completing each part, open the application in a real browser, take screenshots, report what you see, check console for errors. If anything is broken, fix it before committing.

---

## Context & Vision

The tool currently works as "inputs here, results there" — fill in forms on Building/Systems/Profiles pages, run a simulation, go to Results to see what happened. This brief transforms each module into an **integrated live workspace** where inputs, visualisation, and results live together on one screen.

**The Sefaira principle:** No waiting, no switching tabs to see impact. Change a wall U-value and immediately see the fabric heat loss change. Switch from MEV to MVHR and immediately see heating demand drop. Adjust an occupancy profile and immediately see the load shape shift.

**The three-column layout:**

```
┌──────────┬─────────────────────┬──────────────────┐
│  INPUTS  │   VISUAL CENTRE     │  LIVE RESULTS    │
│          │                     │                  │
│ Compact  │  3D viewer (build)  │  Sankey / bars   │
│ controls │  Schematic (sys)    │  Key metrics     │
│ sliders  │  Profile chart      │  EUI gauge       │
│ dropdowns│  (profiles)         │  Warnings        │
│          │                     │                  │
│  w-64    │     flex-1          │    w-80          │
└──────────┴─────────────────────┴──────────────────┘
```

**Two-speed feedback:**
1. **Instant** — Simplified steady-state calculations that update in <50ms as you drag sliders. Uses degree-day method for heating/cooling, U×A×ΔT for fabric losses, simple COP division for systems. Good enough for comparative feedback ("this is getting better/worse").
2. **Full simulation** — EnergyPlus runs in background (2-5 seconds) triggered either by clicking "Run Simulation" or automatically after 3 seconds of inactivity. Results replace the instant estimates with accurate values.

**Module colour themes:**
Each module has a subtle accent colour that carries through the left-column header, the sidebar icon active state, and any module-specific UI elements:

| Module | Accent | Hex | Rationale |
|--------|--------|-----|-----------|
| Building/Fabric | Warm earth | `#A1887F` | Building materials, masonry |
| Systems | Teal | `#00AEEF` | Technical, mechanical |
| Profiles | Purple | `#8B5CF6` | Time, schedules |
| Results | Navy | `#2B2A4C` | Authoritative, final |
| Scenarios | Magenta | `#E84393` | Comparison, options |
| Library | Green | `#16A34A` | Collection, storage |

**Global typography fix:** All text sizes should be reduced by approximately 20% from current. Stolzl runs tall. Specific adjustments noted per part.

15 parts. Do them in order.

---

## PART 1: Global typography and spacing reduction

**File(s):** `frontend/src/index.css`, `frontend/src/data/chartTokens.js`, various component files

Reduce all text sizes across the application. The current text is too large for the information density we need in the three-column layout.

**New size scale** (replacing current):

| Token | Old size | New size | Usage |
|-------|----------|----------|-------|
| `text-xxs` | 0.6rem | 0.55rem | Micro labels, axis text |
| `text-xs` | 0.65rem | 0.6rem | Compact controls, badges |
| `text-caption` | 0.6875rem | 0.625rem (10px) | Card labels, sidebar items |
| `text-body` | 0.8125rem | 0.725rem (11.5px) | Base body text |
| `text-subsection` | 0.875rem | 0.8rem (12.8px) | Subsection headings |
| `text-section` | 1rem | 0.875rem (14px) | Section headings |
| `text-page-title` | 1.25rem | 1.05rem (16.8px) | Page titles |
| `text-metric` | 1.25rem | 1.1rem (17.6px) | Data card values |
| `text-metric-lg` | 1.5rem | 1.3rem (20.8px) | Hero metrics |

Update the Tailwind config (or CSS custom properties if using Tailwind v4's CSS-based config) with these new sizes.

Update `chartTokens.js`:
```js
TICK_STYLE.fontSize = 8  // was 9
LEGEND_STYLE.fontSize = '8px'  // was 9px
TOOLTIP_STYLE.fontSize = '9px'  // was 10px
```

Also reduce spacing: where components use `p-4` or `p-6`, consider `p-3`. Where `gap-4` is used, consider `gap-2` or `gap-3`. The goal is higher information density without feeling cramped.

**Commit message:** "Part 1: Global typography reduction — 20% smaller text for higher density layout"

**Verify:**
1. Open the app and navigate through every page
2. **SCREENSHOT 1:** Any page showing the reduced text — it should feel more compact but still readable
3. Check that no text is clipped, truncated, or overlapping after the size reduction
4. Charts should have smaller axis labels and legends — still readable at 1440×900
5. The overall feel should be "professional and information-dense" not "everything is tiny"
6. Report: "Typography reduced across all components. Body text now [X]px. Chart labels now [X]px. No clipping or overflow issues. Density improved — more content visible without scrolling."

---

## PART 2: Simplified instant calculation engine

**File(s):** `frontend/src/utils/instantCalc.js` (new)

Create a client-side simplified calculation engine that runs entirely in the browser and returns instant results for the live feedback panels. This does NOT replace EnergyPlus — it provides approximate results for visual feedback while the user is adjusting parameters.

```js
/**
 * instantCalc.js
 * 
 * Simplified steady-state energy calculations for instant UI feedback.
 * NOT a replacement for EnergyPlus — used only for the live results
 * panels while the user is dragging sliders.
 *
 * Accuracy target: within ±30% of EnergyPlus for comparative purposes.
 * The important thing is that "better" inputs produce "better" results.
 */

export function calculateInstant(building, constructions, systems, libraryData) {
  // Returns:
  // {
  //   eui_kWh_m2: number,
  //   annual_heating_kWh: number,
  //   annual_cooling_kWh: number,
  //   annual_lighting_kWh: number,
  //   annual_equipment_kWh: number,
  //   annual_dhw_kWh: number,
  //   annual_fan_kWh: number,
  //   fabric_losses: { walls_kWh, roof_kWh, floor_kWh, glazing_kWh, infiltration_kWh, ventilation_kWh },
  //   solar_gains: { north_kWh, south_kWh, east_kWh, west_kWh },
  //   fuel_split: { electricity_kWh, gas_kWh },
  //   carbon_kgCO2_m2: number,
  // }
}
```

**Calculation method:**

1. **Fabric heat loss** — For each element: Q = U × A × HDD × 24 / 1000 (kWh)
   - HDD (heating degree days): use 2,200 for UK (Bristol-ish). This can be refined per weather file later.
   - A = area from geometry (length, width, floors, WWR)
   - U = from construction library lookup

2. **Infiltration heat loss** — Q = 0.33 × ACH × Volume × HDD × 24 / 1000

3. **Ventilation heat loss** — Q = 0.33 × ventilation_rate × Volume × HDD × 24 / 1000
   - Reduced by heat recovery efficiency if MVHR

4. **Solar gains** — Approximate annual solar radiation per facade orientation for UK:
   - South: 750 kWh/m² glazing, North: 350, East/West: 500
   - Multiply by glazing area × g-value

5. **Internal gains** — From lighting + equipment + occupancy × area × hours

6. **Heating demand** = MAX(0, fabric_losses + infiltration + ventilation - solar_gains - internal_gains)

7. **Cooling demand** — Simplified: a fraction of the excess gains in summer months. Use: cooling = MAX(0, (solar_gains + internal_gains) × 0.3 - heating_benefit)

8. **Lighting** = LPD × GIA × operating_hours (≈3,500 for hotel)

9. **Equipment** = equipment_power_density × GIA × operating_hours

10. **DHW** = 120 litres/bedroom/day × 365 × 4.18 × (setpoint - 10) / 3600 (kWh thermal), divided by boiler efficiency or ASHP COP

11. **Fan energy** = SFP × ventilation_flow_rate × operating_hours / 1000

12. **EUI** = sum of all / GIA

13. **Carbon** = electricity × grid_factor + gas × 0.183 / GIA

The U-values and system parameters should be looked up from the library data passed in. If a library item isn't loaded yet, use reasonable defaults.

**Commit message:** "Part 2: Client-side instant calculation engine for live feedback"

**Verify:**
1. Run in browser console: import and call `calculateInstant()` with Bridgewater defaults
2. Check the EUI result — it should be in the rough range of 50-150 kWh/m² (it won't match EnergyPlus exactly, but it should be the right order of magnitude)
3. Change the wall U-value from 0.28 to 0.18 — heating demand should decrease
4. Change infiltration from 0.5 to 1.5 — heating demand should increase
5. Report: "Instant calc working. Default EUI: [X] kWh/m². Wall U 0.28→0.18: heating [before]→[after] kWh. Infiltration 0.5→1.5: heating [before]→[after] kWh. Directionally correct — better inputs produce better results."

---

## PART 3: Building module — three-column live layout

**File(s):** `frontend/src/components/modules/building/BuildingDefinition.jsx` (major rewrite), `frontend/src/components/modules/building/LiveResultsPanel.jsx` (new)

Rebuild the Building Definition module into a three-column workspace. Remove the tab-based layout (Geometry / Fabric / Summary tabs). Replace with a single integrated view.

**Left column (`w-64`)** — All inputs stacked vertically in a scrollable sidebar:

Module header: "Building" with warm earth accent bar (`#A1887F`)

Sections (collapsible):
1. **Geometry** — name, length, width, floors, floor height, orientation (with mini compass)
2. **Glazing** — WWR sliders per facade (N/S/E/W), window count per facade (new input — integer, e.g. "12 windows" which divides the glazing area into that many openings on the 3D model)
3. **Fabric** — dropdown for each construction element (wall, roof, floor, glazing) with U-value shown inline. "Customise →" link opens the Library browser.
4. **Airtightness** — infiltration slider with guidance text
5. **Summary metrics** — GIA, volume, envelope area, glazing area (read-only, calculated live)

All inputs are compact — use `text-caption` for labels, small sliders, narrow number inputs. Every input updates the BuildingContext and triggers the instant calculation.

**Centre column (`flex-1`)** — The 3D building viewer, taking as much space as possible. 

Update the 3D viewer:
- **Individual windows:** Instead of one strip window per facade, render individual window openings evenly spaced. The number of windows comes from the new "window count" input per facade. Each window's area = total facade glazing area / window count. This looks much more realistic.
- **Facade colour hints:** Subtly colour-code facades by their heat loss contribution — warmer red-tint for facades with highest heat loss, cooler blue-tint for lowest. This updates live from the instant calc.
- **Solar gains arrows:** Show small directional arrows on each facade indicating relative solar gain magnitude (thicker arrow = more gain). South should have the biggest arrow.

**Right column (`w-80`)** — Live results panel:

**LiveResultsPanel.jsx:**
- **EUI gauge** — circular gauge at the top showing the instant-calc EUI, with a CRREM target ring for context. Updates live as inputs change.
- **Fabric heat loss Sankey** — a mini Sankey showing energy flowing through each envelope element. Widths proportional to heat loss. Updates live.
- **Solar gains bar chart** — 4 small horizontal bars showing N/S/E/W solar gains
- **Key metrics stack:**
  - Annual heating demand (kWh)
  - Annual cooling demand (kWh)
  - Total fabric heat loss (kWh)
  - Net solar gain (kWh)
  - Heating/cooling ratio
- **Simulation status:** "Estimated (instant calc)" in amber when showing instant results, "EnergyPlus verified" in green when full simulation results are available. A small "Run Full Simulation" link.

When the user stops changing inputs for 3 seconds, auto-trigger a full EnergyPlus simulation in the background. When results arrive, smoothly transition the live results panel from instant-calc values to EnergyPlus values (with a brief green flash to indicate "verified").

**Commit message:** "Part 3: Building module three-column live layout with instant feedback"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT 1:** The three-column layout — inputs left, 3D centre, results right. All visible on one screen without scrolling at 1440×900.
3. **INTERACT — Live feedback:** Change the wall U-value from standard to enhanced. The right panel should update instantly — heating demand should decrease, EUI should drop. The 3D viewer should subtly shift colour on the walls.
4. **INTERACT — Window count:** Set north windows to 8. The 3D viewer should show 8 individual window openings on the north facade instead of one strip.
5. **INTERACT — Orientation:** Drag the orientation slider. The 3D viewer rotates. The solar gains bars on the right should shift (south gains decrease as the building rotates away from south).
6. **INTERACT — Infiltration:** Drag from 0.5 to 1.5 ACH. Heating demand should increase noticeably in the right panel.
7. The right panel should show "Estimated" status. Wait 3 seconds — a simulation should auto-trigger. After 2-5 seconds, the values should update to EnergyPlus results and the status should change to "Verified".
8. **SCREENSHOT 2:** The right panel showing verified EnergyPlus results after auto-simulation
9. All three columns should feel balanced — not cramped, not wasted space
10. Report: "Three-column layout working. Instant calc updates in <100ms on slider drag. Tested wall U-value change: heating [X]→[X] kWh (instant). Auto-simulation triggered after 3s pause — EnergyPlus results replaced instant estimates after [X]s. Individual windows rendering on 3D. Solar gain arrows showing. No console errors."

---

## PART 4: Systems module — three-column live layout

**File(s):** `frontend/src/components/modules/SystemsZones.jsx` (major rewrite), `frontend/src/components/modules/systems/SystemSchematic.jsx` (new), `frontend/src/components/modules/systems/SystemsLiveResults.jsx` (new)

Rebuild the Systems module into the same three-column pattern.

**Left column (`w-64`)** — All system inputs in a single scrollable sidebar:

Module header: "Systems" with teal accent (`#00AEEF`)

Sections (collapsible):
1. **Simulation Mode** — Detailed / Ideal Loads toggle (prominent, at the top)
2. **HVAC** — System type dropdown, COP/EER inputs (number input, not just display), fan power
3. **Ventilation** — Type (MEV/MVHR), SFP (number input AND slider, min 0), heat recovery efficiency (only visible for MVHR), natural vent toggle + threshold
4. **Ventilation Control** — new: dropdown for control strategy (Continuous / Occupied Hours / Timer / CO₂-based). Links to the ventilation schedule in profiles.
5. **DHW** — Primary system, preheat option, setpoints
6. **Lighting** — LPD (slider + number input, range 0-20), presets (LED/Fluorescent/etc.), control strategy
7. **Small Power** — new: equipment power density (W/m²), number input, default 15 for hotel. This feeds the equipment load.

**Centre column (`flex-1`)** — System schematic:

**SystemSchematic.jsx:**
A visual diagram showing the building's energy systems as a flow diagram:
- Energy inputs (electricity, gas) on the left
- System boxes in the middle (VRF, ventilation unit, DHW tank, lighting)
- Delivered energy on the right
- Lines connecting them with widths proportional to energy flow (from instant calc)
- Each system box shows its key parameter (COP, recovery %, efficiency)

This isn't a Sankey — it's more of a technical schematic. Think of it as a simplified MEP diagram rendered in SVG. As you change system selections on the left, the schematic updates: switch from MEV to MVHR and a heat recovery unit appears in the diagram with a feedback loop arrow.

If a full schematic is too complex for this part, a simplified version is fine: system cards arranged in a flow layout with connecting arrows showing energy flow direction and magnitude.

**Right column (`w-80`)** — SystemsLiveResults:
- EUI gauge (same as building module)
- Energy by end use — stacked bar or donut showing heating, cooling, fans, lighting, equipment, DHW
- Fuel split — simple pie showing electricity vs gas
- Key metrics: total electricity (kWh), total gas (kWh), carbon intensity (kgCO₂/m²)
- System efficiency metrics: average COP, fan energy as % of total, DHW gas cost estimate

Updates live from instant calc, with EnergyPlus verification after 3s pause.

**Commit message:** "Part 4: Systems module three-column live layout with schematic and live results"

**Verify:**
1. Navigate to /systems
2. **SCREENSHOT 1:** Three-column layout — system inputs left, schematic centre, results right
3. **INTERACT:** Switch HVAC from VRF to "Ideal Loads" mode — the EUI in the right panel should change
4. **INTERACT:** Switch ventilation from MEV to MVHR — heating demand should drop in the right panel. The schematic should show a heat recovery element.
5. **INTERACT:** Change LPD from 8 to 4 — lighting energy should halve in the results
6. **INTERACT:** Toggle natural ventilation on — cooling should change
7. The fuel split pie should show gas if a gas boiler is selected for DHW
8. Report: "Systems three-column working. Tested HVAC mode switch, MEV→MVHR, LPD change, natural vent toggle. All produce visible changes in live results. Schematic updates when systems change. Fuel split shows gas for gas boiler DHW."

---

## PART 5: Profiles module — three-column live layout

**File(s):** `frontend/src/components/modules/ProfilesEditor.jsx` (major rewrite), `frontend/src/components/modules/profiles/ProfilesLiveResults.jsx` (new)

Rebuild the Profiles module into three columns.

**Left column (`w-64`)** — Schedule selector and editor controls:

Module header: "Profiles" with purple accent (`#8B5CF6`)

- Schedule type filter (Occupancy, Lighting, Equipment, Heating, Cooling, DHW, Ventilation) — as compact pill buttons
- Remove the "Zone" filter (Bedroom, Corridor, etc.) — we're using blended averages, zone types are misleading. Instead, label schedules by building type (Hotel, Office, etc.)
- Scrollable list of schedules with the selected one highlighted
- Quick-set tools below the list (Flat, Copy to Weekend, Invert, Shift)
- Monthly multiplier mini-bars at the bottom
- "Create Custom" button
- **Navigation between schedules while editing:** Add Previous/Next arrows at the top of the editor to scroll through schedules without closing the editor. This lets you compare patterns quickly.

**Centre column (`flex-1`)** — The schedule visualisation:
- Top: Day profile chart (the existing 24-hour bar chart) — editable by clicking/dragging
- Bottom: Heatmap (existing annual pattern view)
- Day type tabs (Weekday / Saturday / Sunday) above the chart

**Right column (`w-80`)** — ProfilesLiveResults:
- Demand profile preview — a 24-hour line chart showing what the building demand looks like with this schedule applied (using instant calc)
- Annual energy impact — how does this schedule affect total heating, cooling, lighting?
- Schedule statistics: peak occupancy fraction, average daily occupancy, total occupied hours per year
- If the user changes the schedule, the demand preview updates instantly

**Save/Override flow:** When editing a default schedule:
- Changes are temporary until explicitly saved
- "Save as New" button — creates a custom copy in the library
- "Revert" button — discards changes and returns to the library version
- If editing a custom schedule, changes save directly (with undo option)

**Commit message:** "Part 5: Profiles module three-column layout with live demand preview"

**Verify:**
1. Navigate to /profiles
2. **SCREENSHOT 1:** Three-column layout — schedule list left, chart centre, demand preview right
3. **INTERACT:** Select hotel bedroom occupancy. Edit the 9am hour to 0.8 (higher than default). The demand preview on the right should shift — more occupied hours means more internal gains, potentially less heating.
4. **INTERACT:** Click Next arrow to scroll to the next schedule without closing the editor
5. **INTERACT:** Click "Revert" — changes should undo
6. **INTERACT:** Make an edit, click "Save as New" — a custom schedule should appear in the library
7. Zone type filters should be gone — replaced by building type labels
8. Report: "Profiles three-column working. Schedule editing updates demand preview instantly. Previous/Next navigation works. Save as New creates custom library item. Revert discards changes. Zone filters removed."

---

## PART 6: Module colour themes

**File(s):** `frontend/src/components/layout/Sidebar.jsx`, `frontend/src/data/moduleThemes.js` (new), update all module headers

Create a module theme system:

**`moduleThemes.js`:**
```js
export const MODULE_THEMES = {
  building:  { accent: '#A1887F', bg: 'bg-amber-50/30',  border: 'border-amber-200/50',  label: 'Building' },
  systems:   { accent: '#00AEEF', bg: 'bg-cyan-50/30',   border: 'border-cyan-200/50',   label: 'Systems' },
  profiles:  { accent: '#8B5CF6', bg: 'bg-purple-50/30', border: 'border-purple-200/50', label: 'Profiles' },
  results:   { accent: '#2B2A4C', bg: 'bg-slate-50/30',  border: 'border-slate-200/50',  label: 'Results' },
  scenarios: { accent: '#E84393', bg: 'bg-pink-50/30',   border: 'border-pink-200/50',   label: 'Scenarios' },
  library:   { accent: '#16A34A', bg: 'bg-green-50/30',  border: 'border-green-200/50',  label: 'Library' },
}
```

**Sidebar update:**
- Active icon's left border uses the module's accent colour (not always teal)
- Active icon background subtly tinted with the module colour

**Module headers:**
- Each module's left column header has a thin top border or left accent bar in the module colour
- The module name is displayed in the accent colour

**Subtle background tinting:**
- The left column of each module has a very faint background tint matching the module theme
- This helps the user orient themselves — "I'm in the warm brown area, so I'm editing fabric" vs "I'm in the teal area, so I'm editing systems"

Keep it subtle — the colour theme should be a gentle signal, not overwhelming.

**Commit message:** "Part 6: Module colour themes with accent colours and subtle background tinting"

**Verify:**
1. Navigate through each module
2. **SCREENSHOT 1:** Building module showing warm earth accent
3. **SCREENSHOT 2:** Systems module showing teal accent
4. **SCREENSHOT 3:** Profiles module showing purple accent
5. The sidebar active state should change colour per module
6. The difference should be noticeable but not jarring
7. Report: "Module themes applied. Building: warm earth, Systems: teal, Profiles: purple. Sidebar active state changes per module. Subtle background tinting in left columns. Colour shifts are noticeable without being distracting."

---

## PART 7: Individual windows on 3D model

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`, update `frontend/src/context/ProjectContext.jsx`

Add a "window count" input per facade and render individual window openings on the 3D model.

Add to ProjectContext building params:
```js
window_count: { north: 8, south: 8, east: 3, west: 3 }  // default for a 60m hotel
```

Add to the Building module left column (in the Glazing section): a number input for window count per facade, next to each WWR slider. Label: "Count" with a small "windows" suffix.

**3D viewer update:**
Instead of rendering one strip window per facade:
1. Calculate each window's width: `(facade_length × WWR) / window_count`
2. Calculate window height: fixed at 1.5m (or derived from floor height)
3. Space windows evenly across the facade with equal gaps
4. Each window is a separate blue-tinted rectangle on the facade

This makes the building look much more like a real hotel — rows of regularly-spaced bedroom windows.

**Commit message:** "Part 7: Individual window openings on 3D model based on window count per facade"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT 1:** The 3D model showing individual windows (not strips) on all facades
3. **INTERACT:** Change north window count from 8 to 12 — more windows should appear, each slightly narrower
4. **INTERACT:** Change north WWR to 40% — each window should get wider
5. **INTERACT:** Change north WWR to 5% — windows should become very small but still visible as individual openings
6. The building should look noticeably more realistic than before
7. Report: "Individual windows rendering. North: [X] windows × [X]m wide. Tested count change (8→12) and WWR change (25%→40%→5%). Visual improvement significant — looks like a real hotel now."

---

## PART 8: Sankey/bar chart in Building live results panel

**File(s):** `frontend/src/components/modules/building/LiveResultsPanel.jsx`

Build the live results panel for the Building module right column. This is the instant-feedback panel that shows where energy goes through the fabric.

**EUI gauge** at the top:
- Circular arc gauge, 180° sweep
- Current EUI value in the centre (large text)
- Arc colour: green (below CRREM target), amber (approaching), red (above)
- CRREM target value marked on the arc
- Updates instantly from `calculateInstant()`

**Fabric heat loss mini-chart** below the gauge:
- Horizontal stacked bar showing proportion of heat loss through each element
- Segments: Walls (brown), Glazing (light blue), Roof (grey), Floor (dark brown), Infiltration (grey), Ventilation (cyan)
- Total kWh value below
- Updates instantly

**Solar gains by facade:**
- 4 small horizontal bars (N/S/E/W) showing annual solar gains
- Bars use graduated warm yellows (light for north, warm for south)
- Updates when orientation or WWR changes

**Key metrics** at the bottom:
- Annual heating (kWh) with ▲/▼ indicator showing direction of last change
- Annual cooling (kWh)
- Heating/Cooling ratio
- Carbon (kgCO₂/m²)

**Status indicator:**
- "⚡ Instant estimate" in amber when showing simplified calc results
- "✓ EnergyPlus verified" in green after full simulation completes
- "⟳ Simulating..." with spinner during background simulation

**Commit message:** "Part 8: Building live results panel with EUI gauge, fabric breakdown, and solar gains"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT 1:** The right column showing EUI gauge, fabric breakdown bar, solar gains bars, and key metrics
3. **INTERACT:** Change wall U-value — EUI gauge should animate, heating demand should change, fabric bar proportions should shift
4. **INTERACT:** Change orientation — solar gain bars should change (south-facing gains shift)
5. **INTERACT:** Change infiltration to 1.5 — infiltration segment in the fabric bar should grow
6. Wait for auto-simulation — status should change from "Instant estimate" to "EnergyPlus verified" and values should refine
7. Report: "Live results panel working. EUI gauge: [X] kWh/m² (instant). Fabric breakdown shows [X] segments. Solar gains respond to orientation changes. Auto-simulation verified values after [X]s. Status indicator transitions correctly."

---

## PART 9: Live results panel for Systems module

**File(s):** `frontend/src/components/modules/systems/SystemsLiveResults.jsx`

Build the live results panel for the Systems module right column.

**Energy by end use** — donut or stacked bar:
- Segments: Heating, Cooling, Fans, Lighting, Equipment, DHW
- Colours from `ENDUSE_COLORS` in chartTokens
- Centre value: total annual energy (MWh)
- Updates instantly

**Fuel split** — simple two-segment bar or pie:
- Electricity (gold) vs Gas (deep red)
- Percentage labels
- If ideal loads mode: all electricity, show a note

**System efficiency metrics:**
- Average COP (for VRF)
- Fan energy as % of total
- DHW energy (kWh)
- Carbon intensity (kgCO₂/m²)

**Comparison callout:** If the user just changed a system parameter, show a quick comparison:
"Switching to MVHR: heating -45%, fan energy +20%, net EUI -12%"
This auto-dismisses after 10 seconds or when the next change is made.

**Commit message:** "Part 9: Systems live results panel with energy breakdown and fuel split"

**Verify:**
1. Navigate to /systems
2. **SCREENSHOT:** Right column showing energy donut, fuel split, and system metrics
3. **INTERACT:** Switch MEV → MVHR — energy donut should show less heating, more fan energy. Comparison callout should appear.
4. **INTERACT:** Enable ASHP preheat — gas fraction should decrease
5. Report: "Systems live results working. Energy donut, fuel split, and metrics update on system changes. Comparison callout shows impact of MEV→MVHR switch."

---

## PART 10: Live results panel for Profiles module

**File(s):** `frontend/src/components/modules/profiles/ProfilesLiveResults.jsx`

Build the live results panel for the Profiles module right column.

**Demand preview chart:**
- 24-hour line chart showing the expected demand profile shape
- Two lines: heating demand (red) and total electrical demand (gold)
- Updates when the schedule is edited
- X axis: hours (0-23), Y axis: kW

**Schedule statistics:**
- Peak occupancy fraction
- Average daily occupancy
- Total occupied hours per year
- Annual operating hours for this schedule type

**Impact preview:**
- "This schedule affects annual heating by approximately [X] kWh"
- Based on instant calc comparison between the current schedule and a flat baseline

**Commit message:** "Part 10: Profiles live results panel with demand preview and schedule statistics"

**Verify:**
1. Navigate to /profiles, select a schedule
2. **SCREENSHOT:** Right column showing demand preview chart and statistics
3. **INTERACT:** Edit the occupancy schedule — increase evening hours. Demand preview should shift.
4. Report: "Profiles live results working. Demand preview updates on schedule edit. Statistics show peak, average, and total hours."

---

## PART 11: Auto-simulation trigger

**File(s):** `frontend/src/context/SimulationContext.jsx`, update `frontend/src/context/ProjectContext.jsx`

Implement the auto-simulation behaviour: after 3 seconds of inactivity (no parameter changes), automatically trigger a full EnergyPlus simulation in the background.

**Logic:**
1. ProjectContext already debounces saves at 1 second
2. After the save completes, start a 2-second additional timer
3. When the timer fires (3 seconds total after last change), call `runSimulation()` from SimulationContext
4. The simulation runs in the background — the UI stays interactive
5. When results arrive, update the live results panels from "Instant estimate" to "EnergyPlus verified"
6. If the user makes another change during the simulation, cancel the pending result (it's stale) and restart the timer

**Add a toggle** in the TopBar or Settings: "Auto-simulate: On/Off" — some users may want manual control only. Default: On.

The "Run Simulation" button in the top bar should still work for manual triggers. When auto-simulate is on, the button label changes to "Re-run Simulation" (since simulations happen automatically).

**Commit message:** "Part 11: Auto-simulation trigger after 3 seconds of inactivity"

**Verify:**
1. Open the app, ensure auto-simulate is on
2. Navigate to /building, change a parameter
3. Wait 3 seconds — the simulation status should change to "Simulating..."
4. After 2-5 more seconds — results should update to "EnergyPlus verified"
5. Rapidly change multiple parameters (drag a slider back and forth) — simulation should NOT trigger during dragging, only after you stop
6. Make a change, then immediately make another change within 3 seconds — only one simulation should run (the second change resets the timer)
7. Toggle auto-simulate off — changes should no longer trigger automatic simulations
8. Report: "Auto-simulation working. 3-second inactivity trigger confirmed. Rapid slider dragging doesn't flood simulations. Timer resets on new changes. Auto-simulate toggle works."

---

## PART 12: Sankey diagram overflow fix

**File(s):** `frontend/src/components/modules/results/EnergyFlowsTab.jsx`

Fix the Sankey diagram overlapping with the sidebar.

The issue: the SVG renders node labels that extend beyond the calculated container width, overlapping the sidebar.

Fix:
- Add more left/right padding to the Sankey layout (increase nodeAlign padding)
- Truncate long node labels with ellipsis if they exceed available space
- Ensure the container has `overflow-x: auto` so that if the diagram is wider than the container, it scrolls rather than overlaps
- Consider reducing the Sankey node label font size to `9px` (matching the chart token reduction)

**Commit message:** "Part 12: Fix Sankey diagram sidebar overflow"

**Verify:**
1. Navigate to Results → Energy Flows
2. **SCREENSHOT:** The Sankey diagram should be fully contained within its area — no overlap with the sidebar
3. All node labels should be visible and readable
4. If the diagram is wider than the container, horizontal scroll should work
5. Report: "Sankey overflow fixed. Diagram contained within bounds. Labels readable. No sidebar overlap."

---

## PART 13: Energy Balance — add missing end uses

**File(s):** `frontend/src/components/modules/results/EnergyBalanceTab.jsx`

Add the missing end uses to the monthly stacked bar chart.

Update the `SERIES` array to include fans, DHW, and ventilation (when available in the results):

```js
const SERIES = [
  { key: 'heating_kWh',      label: 'Heating',      color: '#DC2626' },
  { key: 'cooling_kWh',      label: 'Cooling',      color: '#3B82F6' },
  { key: 'fans_kWh',         label: 'Fans',         color: '#8B5CF6' },
  { key: 'lighting_kWh',     label: 'Lighting',     color: '#F59E0B' },
  { key: 'equipment_kWh',    label: 'Equipment',    color: '#64748B' },
  { key: 'dhw_kWh',          label: 'DHW',          color: '#F97316' },
  { key: 'ventilation_kWh',  label: 'Ventilation',  color: '#06B6D4' },
]
```

Handle gracefully: if a key is missing from the monthly data (e.g. `fans_kWh` not present in ideal loads results), skip it — don't show a zero series.

Also update the Annual Totals cards to include the new end uses.

**Commit message:** "Part 13: Energy Balance chart includes fans, DHW, and ventilation end uses"

**Verify:**
1. Run a simulation in detailed mode
2. Navigate to Results → Energy Balance
3. **SCREENSHOT:** Monthly stacked bars should show more colours than before — fans (purple), DHW (orange) should be visible
4. Hover on a bar — tooltip should list all end uses including new ones
5. Annual totals should include cards for fans and DHW
6. Run in ideal loads mode — the chart should gracefully omit series that aren't in the data
7. Report: "Energy Balance now shows [X] end uses in detailed mode (was 4). Fans: [X] kWh/yr, DHW: [X] kWh/yr visible. Ideal loads mode gracefully shows 4 series. Annual totals updated."

---

## PART 14: SFP and small power input fixes

**File(s):** `frontend/src/components/modules/systems/VentilationTab.jsx` (or the new left-column equivalent), `frontend/src/components/modules/systems/LightingTab.jsx`

Small UI fixes for inputs:

**14a — SFP range and manual input:**
- Specific fan power slider minimum: change to 0 (from whatever it is currently)
- Add a number input field NEXT TO the slider showing the exact value, editable. Typing a number updates the slider and vice versa. This is the same pattern Pablo uses for SmartScaleSlider.

**14b — Small power / equipment density:**
- If not already present, add an equipment power density input (W/m²) to the Systems module
- Default: 15 W/m² for hotel (CIBSE Guide A)
- Range: 0-30 W/m²
- This feeds the equipment load in the simulation (currently hardcoded in the schedules)

**14c — Ventilation control strategy:**
- Add a control strategy dropdown to the ventilation section: Continuous / Occupied Hours / Timer
- This should map to the ventilation schedule assignment — selecting "Occupied Hours" assigns the `hotel_ventilation_occupied` schedule, etc.

**Commit message:** "Part 14: SFP range fix, small power input, ventilation control strategy"

**Verify:**
1. Navigate to Systems → Ventilation: SFP slider should go to 0, number input should be editable
2. Check small power input is visible and editable
3. Change ventilation control to "Occupied Hours" — this should assign the appropriate schedule
4. Report: "SFP range 0-[max] with editable number input. Small power input at [X] W/m². Ventilation control strategy dropdown with 3 options."

---

## PART 15: Full integration test

Complete walkthrough of the redesigned tool:

1. Open the app at /building — three-column layout visible
2. Adjust geometry: change length to 50m — instant calc updates, 3D resizes, live results shift
3. Change wall construction — heating demand changes instantly
4. Wait for auto-simulation — results verify
5. Navigate to /systems — three-column layout with system schematic
6. Switch MEV → MVHR — live results show heating drop
7. Enable ASHP preheat — gas fraction decreases
8. Navigate to /profiles — three-column layout with schedule editor
9. Edit bedroom occupancy — demand preview updates
10. Navigate to /results — all tabs working with full simulation data
11. Energy Balance shows fans and DHW
12. Sankey not overlapping
13. Navigate to /scenarios — run comparison with multiple scenarios
14. Check module colour themes are distinct across all modules

**SCREENSHOTS:**
1. Building module three-column layout
2. Systems module three-column layout
3. Profiles module three-column layout
4. EUI gauge showing instant estimate
5. EUI gauge showing EnergyPlus verified
6. Energy Balance with all end uses
7. Sankey diagram properly contained

**Commit message:** "Part 15: Full integration test — Live Studio layout verified end-to-end"

**Verify — report:**
- Three-column layout working on: Building ✓/✗, Systems ✓/✗, Profiles ✓/✗
- Instant calc response time: <[X]ms
- Auto-simulation trigger: fires after [X]s of inactivity
- EnergyPlus simulation time: [X]s
- Module colour themes: [distinct/subtle/invisible]
- Typography: [improved density / still too large / too small]
- Individual windows on 3D: [realistic / needs work]
- Zero console errors across walkthrough

---

## After all 15 parts are complete

Update STATUS.md with:
- All 15 parts completed
- The Live Studio layout description
- Instant calc accuracy comparison: instant EUI [X] vs EnergyPlus EUI [X] (% difference)
- Auto-simulation behaviour confirmed
- Module themes applied
- Known issues
- Suggestions for Brief 09 (report export, dual-screen pop-out, EV charging, future weather files)

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 08 complete. The Live Studio is working — three-column layout on Building, Systems, and Profiles with instant feedback and auto-simulation. Change a U-value and see the EUI update in <100ms. Individual windows on the 3D model. Module colour themes. Typography reduced for density. EnergyPlus auto-triggers after 3 seconds and refines the instant estimates."
