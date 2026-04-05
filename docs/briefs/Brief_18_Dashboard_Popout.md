# Brief 18: Project Dashboard, Schedule Preview in Systems & Pop-Out Results Window

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read this ENTIRE brief before writing a single line of code
4. Combined verification and commit allowed for small related changes.

---

## VERIFICATION RULES

**Browser verification is mandatory.** Screenshots, console check. Combined verification allowed for closely related parts.

---

## Context

The tool's individual modules (Building, Systems, Profiles) work well independently, but the real insight comes from seeing how they interact. Chris wants:

1. A **project dashboard** when you click into a project — an overview before diving into detail
2. **Schedule preview inside the Systems module** — see and edit profiles without navigating away
3. A **pop-out results window** for a second screen — configurable dashboard showing Sankeys, CRREM, profiles, all updating live as you edit in the main window

This brief delivers all three. The pop-out window uses the `BroadcastChannel` API for cross-window communication — the main window publishes state changes, the pop-out receives them and re-runs the instant calc.

12 parts.

---

## PART 1: Project dashboard — overview page

**File(s):** `frontend/src/pages/ProjectDashboard.jsx` (new), update `frontend/src/App.jsx`

When the user clicks a project from the landing page, instead of going straight to /building, they land on `/project` — a dashboard overview.

**Route:** `/project` (or `/project/:id`)

**Layout:** Full-width, no three-column — this is a read-only overview, not an editing workspace.

**Content sections:**

**Top bar:** Project name (large, bold), building type badge ("Hotel"), location if set.

**Summary strip** — 4-5 key cards in a row:
- GIA: "3,000 m²"
- Modelled EUI: "83 kWh/m²" (from latest simulation, or instant calc)
- Actual EUI: "312 kWh/m²" (from uploaded consumption data, if available)
- CRREM Target: "215 kWh/m²" (for current year)
- Performance Gap: "229 kWh/m² (275%)" — red if large, green if small

**Data completeness checklist:**
A visual checklist showing what data is available for this project:
- ✅ Building geometry defined (50m × 15m × 4fl)
- ✅ Fabric constructions assigned
- ✅ Systems configured (Detailed mode — VRF + MVHR + Gas Boiler)
- ✅ Occupancy set (138 rooms, 75% rate)
- ✅ HH Electricity data uploaded (17,520 records, Jan-Dec 2024)
- ⬜ Gas consumption data (not uploaded)
- ✅ Simulation run (EUI: 83 kWh/m²)
- ✅ Weather file: Colorado (⚠ should be Bristol — highlight as warning)
- ⬜ PROMETHEUS future weather files (not available)

Each item links to the relevant module for editing.

**Mini CRREM chart:**
A small version of the CRREM trajectory showing actual EUI (red dot), modelled EUI (line), and the CRREM pathway. Not interactive — just a quick visual. Click to go to full Results → CRREM.

**Scenario summary** (if scenarios exist):
Table showing each scenario's name and EUI, sorted best to worst.

**Quick actions:**
- "Edit Building →" → /building
- "Edit Systems →" → /systems
- "Upload Data →" → /consumption
- "Run Simulation →" triggers simulation
- "Compare Scenarios →" → /scenarios

**Navigation:** The sidebar Building icon goes to /building (as before). The project name in the TopBar or the N icon's project card links to /project. Add a small "Overview" link at the top of each module's sidebar that returns to /project.

**Commit message:** (combined)

---

## PART 2: Profiles module — remove zone-type filters

**File(s):** `frontend/src/components/modules/ProfilesEditor.jsx`

Before integrating profiles into the Systems module, clean up the Profiles module:

- **Remove zone-type filters** (Bedroom, Corridor, Reception, Office, Retail) — we're using single-zone blended averages, these are misleading
- **Keep schedule-type filters** (Occupancy, Lighting, Equipment, Heating, Cooling, DHW, Ventilation) — these are useful
- Relabel any schedules that say "Hotel Bedroom — Occupancy" to just "Hotel — Occupancy" (drop the zone prefix)
- The editor, heatmap, and save/revert functionality stay exactly as they are

---

## PART 3: Schedule preview panel in Systems module

**File(s):** `frontend/src/components/modules/systems/SchedulePreview.jsx` (new), update `frontend/src/components/modules/SystemsZones.jsx`

Add a **schedule preview** accessible from within the Systems module.

**How it works:**

In the Systems right panel, add a tab toggle at the top: **"Live Results" | "Schedule"**

When "Schedule" is selected, the right panel shows:
- A dropdown: "Preview schedule for: [Space Heating / Space Cooling / DHW / Ventilation / Lighting / Equipment]"
- Below: the 24-hour day profile chart for the selected schedule type
- Day type tabs (Weekday / Saturday / Sunday)
- Monthly multiplier mini-bars
- An "Edit Schedule →" link that navigates to /profiles with that schedule pre-selected

**Additionally, inside each accordion section**, add a small inline schedule preview:
When you expand "Space Heating", below the system parameters, show:
- A mini 24-hour sparkline (tiny, ~40px tall) showing the heating schedule shape
- "Schedule: Hotel — Heating (Weekday)" label
- Click to switch the right panel to "Schedule" view with this schedule loaded

This means: you're editing the SCOP slider for space heating, glance right and see the energy impact in "Live Results", glance at the sparkline and see when the heating runs, or toggle to "Schedule" to see the full profile with editing capability.

**The schedule affects the instant calc:** When the user changes which schedule is assigned (via the dropdown in the schedule preview), it should update the instant calc. The hourly calc already uses hotel schedule fractions — these should come from the actual assigned schedule, not hardcoded defaults.

---

## PART 4: Wire actual schedules into the hourly instant calc

**File(s):** `frontend/src/utils/instantCalc.js`

Currently the hourly calc uses hardcoded `hotelOccupancyFraction(hour)`, `hotelLightingFraction(hour)` etc. These should read from the actual assigned schedules in the project.

**Update `calculateInstant` to accept schedule data:**
```js
export function calculateInstant(building, constructions, systems, libraryData, weatherData, hourlySolar, schedules) {
  // schedules = { occupancy: [24 values], lighting: [24 values], equipment: [24 values], heating: [24 values], ... }
  // Each array has 24 hourly fractions (0-1) for a typical day
  // If schedules not provided, fall back to built-in hotel defaults
}
```

In the hourly loop:
```js
const occ_frac = schedules?.occupancy?.[hourOfDay] ?? hotelOccupancyFraction(hourOfDay)
const light_frac = schedules?.lighting?.[hourOfDay] ?? hotelLightingFraction(hourOfDay)
const equip_frac = schedules?.equipment?.[hourOfDay] ?? hotelEquipmentFraction(hourOfDay)
```

This means changing a schedule in the preview panel immediately affects the live results — the Sankey, the EUI gauge, and the monthly profile all respond.

---

## PART 5: Pop-out window — cross-window communication

**File(s):** `frontend/src/utils/broadcastChannel.js` (new)

Set up the `BroadcastChannel` API for cross-window state sharing.

```js
// broadcastChannel.js

const CHANNEL_NAME = 'nza-simulate-live'

let channel = null

export function getChannel() {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME)
  }
  return channel
}

/**
 * Publish the current project state to any listening windows.
 * Called by ProjectContext whenever state changes.
 */
export function publishState(state) {
  try {
    getChannel().postMessage({
      type: 'STATE_UPDATE',
      timestamp: Date.now(),
      payload: state,
    })
  } catch (e) {
    // BroadcastChannel not supported or error — fail silently
  }
}

/**
 * Subscribe to state updates from the main window.
 * Used by the pop-out results window.
 */
export function subscribeToState(callback) {
  const ch = getChannel()
  const handler = (event) => {
    if (event.data?.type === 'STATE_UPDATE') {
      callback(event.data.payload)
    }
  }
  ch.addEventListener('message', handler)
  return () => ch.removeEventListener('message', handler)
}
```

**Update ProjectContext:** After every state change (params, constructions, systems, schedules), call `publishState()` with the full project state. Debounce to avoid flooding — publish at most every 200ms.

The state payload includes everything the instant calc needs:
```js
{
  building: params,
  constructions,
  systems,
  schedules: currentScheduleAssignments,
  libraryData,
  simulationResults: latestResults,  // for EnergyPlus verified values
  consumptionData: { actual_eui, monthly_totals },  // from uploaded data
}
```

---

## PART 6: Pop-out results window — the page

**File(s):** `frontend/src/pages/PopOutResults.jsx` (new), update `frontend/src/App.jsx`

Create a new route `/popout` that renders the pop-out results dashboard.

**This page:**
- Has NO sidebar, NO top bar — it's a clean full-screen dashboard
- Subscribes to state updates via `subscribeToState()`
- Runs its own instance of the instant calc from the received state
- Renders configurable panels

**Header:** A thin bar at the top: "NZA Simulate — Live Results" + project name + "Connected ●" indicator (green when receiving updates, grey when stale)

**Default panel layout** (2×2 grid, resizable):

```
┌─────────────────────┬─────────────────────┐
│                     │                     │
│   Systems Sankey    │   Fabric Sankey     │
│   (live updating)   │   (live updating)   │
│                     │                     │
├─────────────────────┼─────────────────────┤
│                     │                     │
│   Monthly Profile   │   CRREM Trajectory  │
│   (actual + model)  │   (with actual dot) │
│                     │                     │
└─────────────────────┴─────────────────────┘
```

Each panel can be swapped for a different view:
- Systems Sankey
- Fabric Sankey
- Monthly energy comparison (actual vs modelled)
- CRREM trajectory
- Schedule preview (24-hour profiles)
- Performance gap summary
- EUI gauge (large version)
- Key metrics (heating, cooling, carbon)

**Panel selector:** Click a small ⚙ icon in any panel's corner to swap it for a different view from a dropdown menu.

**Live updating:** When the user changes anything in the main window (drags a slider, changes a system), the pop-out receives the state update via BroadcastChannel, re-runs the instant calc, and all panels update. This should feel near-instant (<100ms latency).

---

## PART 7: Pop-out launcher button

**File(s):** Update `frontend/src/components/layout/TopBar.jsx`

Add a button in the TopBar to open the pop-out window:

```jsx
function openPopOut() {
  const width = 1200
  const height = 800
  const left = window.screenX + window.outerWidth
  const top = window.screenY
  window.open(
    '/popout',
    'nza-simulate-popout',
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
  )
}
```

**Button:** "📊 Pop Out Results" — small, in the TopBar near the "Re-run Simulation" button. Or an icon-only button with a tooltip.

The window opens to the RIGHT of the main window (using `left = window.screenX + window.outerWidth`), so on a dual-monitor setup it naturally appears on the second screen.

**Connection indicator:** After opening, the main window shows a small green dot or "Pop-out connected" indicator in the TopBar, confirming the second window is receiving updates.

---

## PART 8: Pop-out panels — Systems Sankey

**File(s):** `frontend/src/pages/PopOutResults.jsx`

Implement the Systems Sankey panel for the pop-out window.

This reuses the `SystemSankey` component but feeds it data from the BroadcastChannel state instead of from React context. 

```jsx
function SystemsSankeyPanel({ state }) {
  const instantResult = useMemo(() => {
    if (!state) return null
    return calculateInstant(
      state.building, state.constructions, state.systems,
      state.libraryData, state.weatherData, state.hourlySolar, state.schedules
    )
  }, [state])
  
  if (!instantResult) return <PanelPlaceholder label="Waiting for data..." />
  
  return <SystemSankey systemsFlow={instantResult.systems_flow} systems={state.systems} />
}
```

The Sankey should have all the same features as in the main window: proportional links, hover highlighting, waste streams, recovery opportunities.

---

## PART 9: Pop-out panels — Fabric Sankey, CRREM, Monthly

**File(s):** `frontend/src/pages/PopOutResults.jsx`

Implement the remaining panel types:

**Fabric Sankey panel:** Same as the Building module's FabricSankey but fed from BroadcastChannel state.

**CRREM panel:** Shows the EUI trajectory with:
- CRREM pathway line
- Modelled EUI line (from instant calc)
- Actual EUI dot (from consumption data in the state)
- Updates when building/systems changes shift the modelled EUI

**Monthly comparison panel:** Shows monthly bars:
- Actual consumption (solid, if uploaded data exists)
- Modelled consumption (outline, from instant calc monthly breakdown)
- CRREM monthly target (dashed line)

**Schedule preview panel:** Shows the 24-hour profile for a selectable schedule type. Dropdown to switch between occupancy/lighting/equipment/heating/cooling.

**EUI gauge panel:** Large version of the EUI horseshoe/bar gauge, with both modelled and actual values shown.

**Performance gap panel:** Text summary:
- Modelled: X kWh/m²
- Actual: X kWh/m²
- Gap: X kWh/m² (X%)
- Status: Compliant / At Risk / Non-compliant

---

## PART 10: Panel layout persistence

**File(s):** `frontend/src/pages/PopOutResults.jsx`

The user's panel layout (which panel is in which slot) should persist in `localStorage` so they don't have to reconfigure it every time they open the pop-out.

```js
const DEFAULT_LAYOUT = [
  { id: 'systems-sankey', slot: 0 },
  { id: 'fabric-sankey',  slot: 1 },
  { id: 'monthly',        slot: 2 },
  { id: 'crrem',          slot: 3 },
]

// Save to localStorage on change
function saveLayout(layout) {
  localStorage.setItem('nza-popout-layout', JSON.stringify(layout))
}

// Load on mount
function loadLayout() {
  try {
    return JSON.parse(localStorage.getItem('nza-popout-layout')) ?? DEFAULT_LAYOUT
  } catch { return DEFAULT_LAYOUT }
}
```

Note: localStorage is allowed in the pop-out window (it's a normal browser window at `/popout`, not an artifact).

---

## PART 11: Integration — state publishing from all modules

**File(s):** Update `frontend/src/context/ProjectContext.jsx`, `frontend/src/context/SimulationContext.jsx`

Ensure state is published to the BroadcastChannel whenever anything changes:

**ProjectContext:** After any `setParams`, `setConstructions`, `setSystems`, `setScheduleAssignments` — debounce and publish the full state.

**SimulationContext:** After simulation completes — publish the results so the pop-out can show "EnergyPlus verified" values.

**WeatherContext:** Publish weather data once loaded (the pop-out needs it for its own instant calc).

**Consumption data:** When consumption datasets are loaded — publish the actual EUI and monthly totals.

The publish should be debounced at 200ms to avoid flooding the channel during rapid slider drags.

---

## PART 12: Full integration test

**Test workflow:**

1. Open NZA Simulate, click Bridgewater Hotel
2. **Project Dashboard:** Should show summary cards (GIA, modelled EUI, actual EUI, CRREM target, performance gap), data checklist, mini CRREM chart
3. Click "Edit Building →" → navigates to /building
4. Click "Pop Out Results" in the TopBar → second window opens showing 2×2 panel grid
5. **In the main window:** Change wall U-value → **in the pop-out:** Systems Sankey and Fabric Sankey should update
6. **In the main window:** Change orientation → **in the pop-out:** Fabric Sankey solar gains shift
7. **In the main window:** Navigate to /systems, switch MEV → MVHR → **in the pop-out:** Systems Sankey shows recovery link appear
8. **In the main window:** Navigate to /systems, toggle "Schedule" in right panel → heating schedule visible alongside system controls
9. **In the pop-out:** Click ⚙ on a panel → swap it for a different view (e.g. swap CRREM for Schedule preview)
10. Close and reopen the pop-out → layout should persist from step 9

**SCREENSHOTS:**
1. Project dashboard with summary cards and checklist
2. Pop-out window showing 2×2 panel grid
3. Main window editing building + pop-out updating simultaneously
4. Systems module with schedule preview in right panel
5. Pop-out panel swap dropdown

**Commit message:** "Brief 18: Project dashboard, schedule preview in systems, pop-out results window with BroadcastChannel"

**Verify — report:**
- Project dashboard: ✓/✗
- Data completeness checklist: ✓/✗
- Schedule preview in Systems: ✓/✗
- Schedule wired to instant calc: ✓/✗
- Pop-out window opens: ✓/✗
- BroadcastChannel state sync: ✓/✗ (latency: [X]ms)
- Pop-out panels update on main window changes: ✓/✗
- Panel swapping: ✓/✗
- Layout persistence: ✓/✗
- Zero console errors in both windows

---

## After all 12 parts verified

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 18 complete. Project dashboard shows building summary, actual EUI, CRREM gap, and data checklist when you open a project. Schedule preview in Systems module — see and edit profiles alongside system controls with live energy impact. Pop-out results window opens to second screen with configurable 2×2 panel grid (Systems Sankey, Fabric Sankey, CRREM, Monthly). All panels update live via BroadcastChannel as you edit in the main window. [X]ms latency. Panel layout persists."
