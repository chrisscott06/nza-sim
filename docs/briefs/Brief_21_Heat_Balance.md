# Brief 21 — Heat Balance view (live vs EnergyPlus, with drill-down)

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read this brief in full
4. Confirm port 8002 (backend) and 5176 (frontend) are free or kill stale processes

---

## Context

Today the Building module's "Energy Flow" toggle shows a Sankey driven by
`instantCalc.js` — a frontend-only PHPP-style monthly steady-state calc
with a hardcoded utilisation factor (η_g = 0.60). EnergyPlus is only
invoked when the user clicks Run Simulation. The two engines produce
different numbers (e.g. 71 vs 82 kWh/m² for the Bridgewater test case)
and there is currently no way to compare them, no per-element drill-down,
and no first-principles sanity check on what's being fed into the model.

This brief delivers a single **Heat Balance** view that:

1. Reads from either engine via a top-of-panel toggle (live instantCalc /
   last EnergyPlus run) with an animated transition between them
2. Presents a PHPP-style balance: gains on the left (solar by orientation,
   internal gains, mechanical heating), losses on the right (fabric,
   ventilation, infiltration, mechanical cooling). The bars must balance.
3. Lets the user click any element to see a drill-down with
   first-principles (A·U·HDH or A·g·G_solar) alongside the engine outputs
4. Plugs into the existing pop-out window architecture as a new panel
   type, plus appears as a tab inside `/results`
5. Drops the now-redundant "3D Model | Energy Flow" toggle in Building
   module — that centre panel becomes 3D Model only

The aim is **confidence**, not novelty: when the three numbers
(first-principles, instantCalc, EnergyPlus) for a given element agree
within a few percent, the user trusts the model. When they diverge,
the page makes the gap obvious so it can be investigated.

Mechanical heating is presented as a **gain** (on the IN side); mechanical
cooling is presented as a **loss** (on the OUT side). They are not flows
the user designs — they are the system response that fills the natural
imbalance. Bars must balance.

---

## Colour palette (used throughout)

| Source                   | Hex      | Notes                              |
|---|---|---|
| Solar gains              | `#F59E0B` (south), `#F97316` (east), `#FBBF24` (north), `#FB923C` (west) | yellow/orange family — south is brightest |
| Internal — people        | `#8B5CF6`                                                                 | matches Profiles theme |
| Internal — equipment     | `#A78BFA`                                                                 | lighter purple |
| Internal — lighting      | `#C4B5FD`                                                                 | lightest purple |
| Heating (gain)           | `#DC2626`                                                                 | red |
| Cooling (loss)           | `#00AEEF`                                                                 | matches Systems theme |
| Fabric losses (any)      | `#6B7280`                                                                 | mid-grey |
| Ventilation              | `#9CA3AF`                                                                 | lighter grey |
| Infiltration             | `#4B5563`                                                                 | darker grey |

Element colours match between the bars, the Sankey ribbons, and the
drill-down icons so the eye can track an element across all views.

---

## Part 1 — Backend: per-surface heat balance parser

**Goal:** EnergyPlus already exports per-surface conduction and
fenestration solar gains via SQL output. Extend the parser to return a
balance-shaped object per simulation run.

**Files:**
- `nza_engine/parsers/sql_parser.py` — add `get_heat_balance(sql_path)`
- `api/routers/projects.py` — new endpoint
  `GET /api/projects/{id}/simulations/{run_id}/balance` returns the
  balance dict
- `api/routers/projects.py` — also include the balance object inline in
  `_row_to_sim_run` for the simulation list response if cheap to produce

**Output shape (consumed by frontend):**
```json
{
  "annual": {
    "losses": {
      "external_wall":    { "kwh": 12480, "kwh_per_m2": 3.5, "area_m2": 720, "u_value": 0.28 },
      "roof":             { "kwh":  3960, "kwh_per_m2": 1.1, "area_m2": 900, "u_value": 0.18 },
      "ground_floor":     { "kwh":  3240, "kwh_per_m2": 0.9, "area_m2": 900, "u_value": 0.22 },
      "glazing":          { "kwh":  9720, "kwh_per_m2": 2.7, "area_m2": 200, "u_value": 1.40 },
      "infiltration":     { "kwh":  6480, "kwh_per_m2": 1.8, "ach": 0.5 },
      "ventilation":      { "kwh":  9000, "kwh_per_m2": 2.5, "hre": 0.85 },
      "cooling":          { "kwh":  4320, "kwh_per_m2": 1.2 }
    },
    "gains": {
      "solar": {
        "north":     { "kwh": 1500, "kwh_per_m2": 0.42, "area_m2": 50, "shgc": 0.42 },
        "east":      { "kwh": 4200, "kwh_per_m2": 1.17, "area_m2": 50, "shgc": 0.42 },
        "south":     { "kwh": 9800, "kwh_per_m2": 2.72, "area_m2": 50, "shgc": 0.42 },
        "west":      { "kwh": 4100, "kwh_per_m2": 1.14, "area_m2": 50, "shgc": 0.42 }
      },
      "internal": {
        "people":    { "kwh": 5400, "kwh_per_m2": 1.5 },
        "equipment": { "kwh": 7200, "kwh_per_m2": 2.0 },
        "lighting":  { "kwh": 3600, "kwh_per_m2": 1.0 }
      },
      "heating":     { "kwh": 14160, "kwh_per_m2": 3.93 }
    }
  },
  "monthly": [ /* same structure × 12 */ ],
  "metadata": {
    "gia_m2": 3600,
    "hdd_18C": 2480,
    "cdd_22C": 130,
    "weather_file": "GBR_ENG_London..."
  }
}
```

EnergyPlus output variables to use (already collected by current runs):
- `Surface Outside Face Conduction Heat Transfer Energy` (per surface)
- `Zone Windows Total Transmitted Solar Radiation Energy` (per zone)
- `Surface Window Transmitted Solar Radiation Energy` (per fenestration)
- `Zone People Total Heating Rate` × hours, similar for Equipment, Lights
- `Zone Air System Sensible Heating Energy`
- `Zone Air System Sensible Cooling Energy`
- `Zone Infiltration Sensible Heat Loss Energy`
- `Zone Mechanical Ventilation Heat Loss Energy`

Group surfaces by construction key (external_wall / roof / etc.) — the
existing `building_config.construction_choices` keys are the canonical names.
Group fenestration by orientation using the surface azimuth (N: 315–45°,
E: 45–135°, S: 135–225°, W: 225–315°).

HDD/CDD calculation: derive from the project's EPW file. Base 18°C
heating, 22°C cooling. Cache per weather file in `data/weather_cache/`
to avoid re-reading the EPW on every request.

**Verify:**
- Run a simulation on Bridgewater. Hit the new endpoint. Confirm:
  - Sum of all losses ≈ sum of all gains within ±2%
  - Heating gain matches what `results_summary.eui_kWh_per_m2 × gia` shows
    when scaled by the heating-only end-use share
  - Solar South > Solar North (sanity)
  - Per-surface kwh_per_m2 plus internal gains plus heating ≈ EUI

**Commit:** `Brief 21 Part 1: Per-surface heat balance parser + endpoint`

---

## Part 2 — Frontend: instantCalc heat-balance shape

**Goal:** Make instantCalc emit the same shape Part 1 produces, so the
Heat Balance component can switch sources transparently.

**Files:**
- `frontend/src/utils/instantCalc.js` — add a `heat_balance` field on the
  returned `result` object, populated with the same JSON shape as Part 1.
- The existing `gains_losses` field can stay for backward compat with
  the FabricSankey, but new code should read `heat_balance`.

The numbers come from the existing internal calc — this is mostly a
restructure of what's already computed.

**Verify:**
- Open a console on the Building page; inspect
  `window.__instantCalc?.heat_balance` (expose for debugging during dev).
- Confirm same elements as Part 1 are present and numbers are sane.
- The heating element should be `Math.max(0, total_losses − useful_gains)`,
  matching what's already shown.

**Commit:** `Brief 21 Part 2: instantCalc emits heat_balance shape`

---

## Part 3 — Frontend: HeatBalance component (bars + arrows + colours)

**Goal:** Build the core component that renders gains-in / losses-out
balance bars. No engine toggle yet — just static rendering from a
`{ source, data }` prop.

**File:** `frontend/src/components/modules/balance/HeatBalance.jsx` (new)

**Behaviour:**
- Two columns: IN (left) and OUT (right). Each column has a label header
  with an arrow:
  - Left header: `← IN — Gains` with right-pointing arrow into the bars
  - Right header: `OUT — Losses →` with right-pointing arrow out
- Each column is a stack of horizontal bars, scaled to the same kWh
  axis (so the columns visually balance when the building is in
  steady state — net should be ~0).
- Solar gains: four separate segments (N/E/S/W), in the colour palette
  above. Order: South, East, West, North (largest at top by convention).
- Internal gains: people, equipment, lighting separately (purple shades).
- Heating: red segment at the bottom of the gains stack.
- Fabric losses: walls, roof, floor, glazing as separate grey-family
  segments. (Glazing is one segment regardless of facade — windows are
  simpler symmetrically.)
- Infiltration: lighter grey.
- Ventilation: mid grey.
- Cooling: blue segment at the bottom of the losses stack.
- Hover any segment shows a tooltip with absolute kWh, kWh/m²·a, and
  share-of-side percentage.
- Numeric totals at the foot of each column. Net delta shown between
  the two columns; should round to 0 ± a few kWh/m²·a.

**Layout:**
- Component takes the full container width.
- Bars are horizontal, scaled to the *larger* of the two column totals
  so both fit on screen.
- Default 12-month annual view. Future iteration could add a monthly
  toggle but not in this part.

**Use:** mounted on a test route `/balance-test` for now (we wire it
into pop-out and /results in later parts).

**Verify:**
- Open `/balance-test`. Bars render with the colour palette. Hovering
  a segment shows the tooltip. Sum of gains ≈ sum of losses for a
  Bridgewater-shaped test fixture.
- Resize to 1440×900 — bars adjust, no overflow.

**Commit:** `Brief 21 Part 3: HeatBalance bars component`

---

## Part 4 — Engine toggle + animated transition

**Goal:** Add the `[Live estimate] [Last simulation]` toggle at the top
of HeatBalance and animate between the two data sets.

**Behaviour:**
- Toggle is a small segmented control. Two pills.
- Live estimate (default): reads `heat_balance` from the latest
  instantCalc result via context.
- Last simulation: reads from `/api/projects/{id}/simulations/{last_run_id}/balance`.
  Cached per run id. Show timestamp ("ran 12 min ago") next to the pill.
- If the user has changed inputs since the last simulation, show a
  subtle amber dot on the Last simulation pill ("results may be stale —
  re-run to refresh").
- Switching engines: animate each bar segment's width via Framer Motion
  or a manual CSS transition (300ms cubic-bezier). The eye should
  follow segment widths growing/shrinking, making the divergence
  visceral.

**Files:**
- `HeatBalance.jsx` — add `engineMode` state, segmented toggle, animation
- New context hook `useSimulationBalance(projectId, runId)` for fetching
  and caching the last-simulation balance

**Verify:**
- Open `/balance-test`. Toggle from Live to Last Simulation — bars
  smoothly resize. Colours stay stable. Tooltips update.
- Edit a WWR slider in another tab/window (via BroadcastChannel) — the
  Live bars react in real time; Last Simulation bars don't move and the
  amber stale-dot appears.

**Commit:** `Brief 21 Part 4: HeatBalance engine toggle with animated transition`

---

## Part 5 — Drill-down per element

**Goal:** Click any segment → side panel showing first-principles
calculation, instantCalc number, EnergyPlus number, and the spread.

**File:** `frontend/src/components/modules/balance/BalanceDrillDown.jsx`

**Behaviour:**
- Side panel slides in from the right (350px wide). Click outside or
  press Esc to close.
- Three rows of numbers per element:
  ```
  First-principles    A · U · HDH               → 16.9 kWh/m²·a
  instantCalc         (live model)              → 16.8 kWh/m²·a   −1%
  EnergyPlus          (last simulation)         → 17.2 kWh/m²·a   +2%
  Spread              ±1.5%   ✓ within tolerance
  ```
- For solar: `A · g · G_solar_orientation × shading_factor`
- For internal: derived from occupancy / power density × hours × util
- For heating/cooling: shows the system's COP/EER and annual delivered
  → final-energy conversion
- Tolerance threshold: 10%. Above 10%, the row goes amber and the
  panel shows a "Why might this differ?" expandable note tailored to
  the element (e.g. for walls: "EnergyPlus result includes thermal
  bridges via construction layers; first-principles assumes 1D
  heat flow"; for solar: "First-principles uses annual irradiance
  totals; EnergyPlus simulates per-timestep with correct sun angle
  and weather variability").

**Verify:**
- Click each element type — drill-down opens, three rows present, all
  three numbers populated when both engines have run.
- Edit fabric in Building → drill-down updates the instantCalc and
  first-principles rows live; EnergyPlus row stays stale.
- Spread > 10% on at least one fabric element: amber state shows up
  with the explanation.

**Commit:** `Brief 21 Part 5: HeatBalance drill-down with first-principles`

---

## Part 6 — Pop-out integration: new panel type

**Goal:** Add `heat-balance` as a panel type in `PopOutResults.jsx`.

**Files:**
- `frontend/src/pages/PopOutResults.jsx` — add to `PANEL_OPTIONS` and the
  panel-type registry. Default layout updated to include heat-balance
  as the first panel.

**Verify:**
- From main app, click Pop Out in TopBar → pop-out window opens with
  Heat Balance in one of the 4 panels by default. Other 3 panels still
  work.
- Configure layout via the gear icon — heat-balance can be selected
  for any of the 4 slots.
- Live updates flow through BroadcastChannel as before.

**Commit:** `Brief 21 Part 6: heat-balance pop-out panel type`

---

## Part 7 — Results dashboard tab + Building module simplification

**Goal:** Add a Heat Balance tab inside `/results` and remove the
now-redundant Energy Flow toggle from Building module.

**Files:**
- `frontend/src/components/modules/results/ResultsDashboard.jsx` — add
  Heat Balance to the tabs list, between Energy Flows and Fabric Analysis.
- `frontend/src/components/modules/building/BuildingDefinition.jsx` —
  remove the `[3D Model | Energy Flow]` toggle in the centre panel;
  centre panel is now always the 3D viewer.
- `frontend/src/components/modules/building/FabricSankey.jsx` and
  `frontend/src/components/modules/building/FabricTab.jsx` — only
  delete if confirmed unused after the toggle removal. Otherwise leave
  in place; the pop-out's `fabric-sankey` panel may still reference
  them.

**Verify:**
- `/results` has a Heat Balance tab. Renders the same component as the
  pop-out panel.
- `/building` no longer has the Energy Flow toggle. Centre panel is 3D
  Model only. Live results panel on the right is unchanged.
- Pop-out still works (the `fabric-sankey` panel type is independent).

**Commit:** `Brief 21 Part 7: Heat Balance in /results; simplify Building`

---

## Part 8 — End-to-end verification + STATUS update

**Verify checklist:**
- Bridgewater test case at 1440×900:
  - First-principles wall loss within 5% of EnergyPlus
  - First-principles glazing loss within 10% of EnergyPlus
  - Solar South > Solar West > Solar East > Solar North (Northern hemisphere)
  - Sum of all gains − sum of all losses < 5% of either total
  - Engine toggle animates smoothly
  - Drill-down opens for all elements
  - Pop-out window receives live updates
- Run `npm run build` — zero errors
- No console errors when navigating Building → Results → Heat Balance →
  Pop Out
- All previous tabs still load (Energy Flows, Fabric Analysis, CRREM,
  Scenarios)

**Files:** `STATUS.md` — append Brief 21 completion summary

**Commit:** `Brief 21 Part 8: End-to-end verification`

---

## Out of scope (do NOT do in this brief)

- Adding solar shading inputs (overhang/fin) — that is Brief 22
- Changing instantCalc's utilisation factor formula — leave at 0.60
  for now; a follow-up brief can replace it with a calculated value
- Multi-zone support for the balance — single-zone whole-building only
- Monthly/seasonal toggle inside the bars — annual only for v1
- Replacing the Sankey entirely — the existing fabric-sankey and
  systems-sankey stay where they are

---

## Notes for the implementer

- The colour palette is canonical for this project going forward — write
  a `frontend/src/data/balanceColours.js` shared file rather than
  hard-coding hex values in each component.
- The HeatBalance component must work with both data shapes (live and
  simulation) without conditional logic at the rendering site — that's
  why Part 2 normalises instantCalc's output.
- Drill-down is the highest-value piece for confidence-building. If
  time is tight, prioritise Parts 1 → 3 → 5 over the engine toggle and
  pop-out integration.
