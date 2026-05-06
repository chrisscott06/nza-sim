# Brief 22 — Solar shading inputs, balance polish, label consistency

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read this brief in full
4. Confirm Brief 21's Heat Balance is intact end-to-end (Building toggle,
   Results tab, pop-out panel) before adding solar shading on top.

---

## Context

Brief 21 delivered the canonical Heat Balance view with three layouts
(rows / stacked / sankey) and an engine toggle (live / simulation).
Two small annoyances surfaced during use plus the substantive shading
work we'd parked. This brief picks up all three:

1. **Tooltips on Stacked and Sankey layouts** — hover/click currently
   doesn't reveal the underlying number on those two layouts (Rows
   already shows it inline). Easy fix.
2. **Solar facade label consistency** — the Glazing input panel uses
   `F1 (N)`, `F2 (E)`, `F3 (S)`, `F4 (W)` where the compass letter is
   dynamic with building orientation. The Heat Balance view says
   `Solar — South`, `Solar — East` etc., which decouples the two and
   confuses people when orientation rotates.
3. **Solar shading inputs** (the main piece) — add per-facade
   overhang and vertical-fin depth/offset inputs, write them into the
   epJSON as `Shading:Overhang:Projection` / `Shading:Fin:Projection`
   objects so EnergyPlus computes the per-timestep solar reduction
   automatically, and render slabs in the 3D viewer for visual
   confirmation. Heat Balance picks it up for free because it reads
   from `heat_balance` regardless of how the simulation got there.

---

## Part 1 — Tooltips on Stacked and Sankey layouts

**Goal:** hover any segment in Stacked or Sankey shows a small label
with the figure in the currently-selected unit. Click stays as the
drill-down trigger.

**Files:**
- `frontend/src/components/modules/balance/HeatBalance.jsx` — the
  `StackedColumns` component already passes the value through `title`
  attribute on each segment but the tooltip is the browser default.
  Replace with a small floating tooltip div positioned to the cursor.
- `frontend/src/components/modules/balance/BalanceSankey.jsx` —
  same: replace the `<title>` SVG fallback with a positioned div.

**Behaviour:**
- Hover: show a small white pill (`bg-white border border-light-grey
  rounded shadow-sm px-2 py-1 text-xxs`) anchored 12px below the cursor
  with `Element label · 14.2 kWh/m²·a` (or `· 51,120 kWh` depending on
  the unit toggle).
- For Stacked, the segment is a button — use `onMouseMove` so the
  tooltip tracks. Hide on `onMouseLeave`.
- For Sankey, attach mouse handlers to the node `<g>` and link `<path>`
  elements. Link tooltip reads `Source → Target · value`.
- Click is unchanged — drill-down opens.

**Verify:**
- Hover any Stacked segment → tooltip appears with element name + value
  in current unit. Toggle kWh/m²·a → kWh and the tooltip updates.
- Hover any Sankey node and any Sankey link → tooltip appears.
- Click still opens the drill-down side panel.

**Commit:** `Brief 22 Part 1: Hover tooltips on Stacked + Sankey layouts`

---

## Part 2 — Solar facade label consistency

**Goal:** Heat Balance's solar elements use the same `F# (compass)`
label as the Building's Glazing input panel. Compass letter rotates
with building orientation.

**Files:**
- `frontend/src/data/balanceColours.js` — `LABELS` is currently a flat
  map. Add a helper `solarLabel(face, orientationDeg)` that returns
  `Solar — F3 (S)` style strings.
- `frontend/src/components/modules/balance/HeatBalance.jsx` —
  `flattenGains` builds solar items with `LABELS['solar_south']` etc.
  Switch to using `solarLabel(face, orientationDeg)` so labels follow
  orientation. Pass `orientationDeg` through the component prop tree
  from the page wrapper (`HeatBalanceTab`, `BalanceTestPage`,
  `BuildingDefinition` centre, pop-out).
- `frontend/src/components/modules/balance/BalanceSankey.jsx` — same
  treatment in `buildGraph`.
- `frontend/src/components/modules/balance/DrillDown.jsx` — the
  drill-down header reads from `LABELS`; switch to `solarLabel` for
  solar elements.

**Building module (existing) — facade label helper:**
```js
function facadeLabel(num, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle  = (baseAngles[num] + orientationDeg) % 360
  const dirs = ['N','NE','E','SE','S','SW','W','NW']
  return `F${num} (${dirs[Math.round(trueAngle / 45) % 8]})`
}
```
Same convention used in `FabricSankey.jsx:55`. Lift to a shared util
(`frontend/src/utils/facadeLabel.js`) so all three layouts read the
same source.

**Verify:**
- With orientation = 0°: solar labels read `Solar — F1 (N)`,
  `F2 (E)`, `F3 (S)`, `F4 (W)`.
- Rotate orientation to 45°: labels become `F1 (NE)`, `F2 (SE)`,
  `F3 (SW)`, `F4 (NW)`. They update live as the slider moves.
- Building's Glazing input panel and Heat Balance now agree.
- Tooltip from Part 1 also picks up the new label.

**Commit:** `Brief 22 Part 2: Facade-label consistency across Heat Balance`

---

## Part 3 — Building schema: per-facade shading inputs

**Goal:** persist per-facade overhang and fin parameters on
`building_config` so subsequent parts can read them.

**Schema additions (defaults all 0 = no shading):**
```json
{
  "shading_overhang": {
    "north": { "depth_m": 0, "offset_m": 0 },
    "south": { "depth_m": 0, "offset_m": 0 },
    "east":  { "depth_m": 0, "offset_m": 0 },
    "west":  { "depth_m": 0, "offset_m": 0 }
  },
  "shading_fin": {
    "north": { "left_depth_m": 0, "right_depth_m": 0 },
    "south": { "left_depth_m": 0, "right_depth_m": 0 },
    "east":  { "left_depth_m": 0, "right_depth_m": 0 },
    "west":  { "left_depth_m": 0, "right_depth_m": 0 }
  }
}
```
- `depth_m` is the projection out from the facade.
- `offset_m` is the vertical gap between the top of the window and the
  bottom of the overhang (0 means flush against the window head).
- Fins use `left_depth_m` / `right_depth_m` (looking at the facade
  from outside; left = west side of a north-facing window, etc.).

**Files:**
- `api/db/database.py` — add the two objects to
  `DEFAULT_BUILDING_CONFIG`.
- `frontend/src/context/ProjectContext.jsx` — extend `DEFAULT_PARAMS`
  and the `_applyProject` deconstruction so the new keys round-trip.
- `frontend/src/utils/instantCalc.js` — read but don't yet act on
  these values; just thread them through into the calc inputs so
  Part 5 can consume them.

**Verify:**
- New project has `shading_overhang` and `shading_fin` populated with
  zeros on the project record.
- Existing projects auto-migrate (read with `??` fallback to defaults).
- Hitting `/api/projects/{id}/building` with a partial update
  containing only an overhang depth merges correctly (existing
  `update_building` does deep-merge for the wwr dict — extend to
  shading_overhang + shading_fin if needed).

**Commit:** `Brief 22 Part 3: building_config schema for shading`

---

## Part 4 — Building UI: shading inputs

**Goal:** new collapsible section in the Building module's left
input panel, between Glazing and Fabric, titled "Shading".

**Files:**
- `frontend/src/components/modules/building/BuildingDefinition.jsx`
  (or wherever the Glazing + Fabric input panel lives — likely a child
  component) — add a "Shading" `CollapsibleSection`.

**UI:**
- One row per facade (using the same `F# (compass)` label as Glazing):

  ```
  F1 (N)  Overhang  [____] m   Offset  [____] m
          Fins L    [____] m   R       [____] m
  ```

- Numeric inputs accept 0–3 m, step 0.05.
- Save via the existing `updateParam('shading_overhang', { north: {...} })`
  pattern (deep-merge).
- Section header shows a small badge if any shading > 0
  (e.g. "Shading · F2 1.2m") so the user knows it's active without
  opening the panel.

**Verify:**
- Enter 1m overhang on F3 (S). Value persists, ProjectContext updates,
  `instantResult` re-computes (no visual change yet — Part 5 wires it).

**Commit:** `Brief 22 Part 4: Building shading input panel`

---

## Part 5 — epJSON: emit Shading:Overhang / Shading:Fin objects

**Goal:** EnergyPlus reduces solar through windows on shaded facades
during simulation runs.

**Files:**
- `nza_engine/generators/geometry.py` — for each fenestration, look
  up `building_config.shading_overhang[face]` and
  `building_config.shading_fin[face]` and emit the matching object:
  - `Shading:Overhang:Projection` (depth + offset relative to the
    window's top edge — projection_factor based)
  - `Shading:Fin:Projection` (left/right projection on the window's
    sides)
  Skip emission when depth = 0.
- `nza_engine/generators/epjson_assembler.py` — include the new
  shading dicts in the output epJSON.

**Behaviour:**
- Only fenestrations with non-zero shading get an associated
  `Shading:*` object.
- Use **EnergyPlus's projection-factor variant** rather than absolute
  vertices — it's defined relative to the window so we don't re-derive
  vertices.

**Verify:**
- Set 1.0 m overhang on south facade in Building, run simulation,
  check the generated epJSON contains `Shading:Overhang:Projection`
  for each F3 window. Inspect with EnergyPlus log to confirm shading
  is being applied.
- Run baseline (no shading) vs 1.0 m overhang on south. Heat Balance
  Simulation engine should show:
  - Solar South gain: lower (typically ~25-40% reduction for 1m
    overhang on a 1.5m-tall window)
  - Cooling demand: lower
  - Heating demand: very slightly higher (winter solar partially
    blocked)

**Commit:** `Brief 22 Part 5: emit Shading:Overhang/Fin in epJSON`

---

## Part 6 — instantCalc: shading factor for live preview

**Goal:** the Live engine reflects shading too, otherwise the user
adjusts shading in Building and sees nothing happen until the next
sim run.

**Files:**
- `frontend/src/utils/instantCalc.js` — add a simple
  `shadingFactor(face, depth_m, offset_m, fin_l, fin_r, glazing_height)`
  helper. Return a multiplier in [0, 1] applied to the per-orientation
  solar irradiance. Empirical model:

  ```
  P_overhang = depth_m / max(glazing_height + offset_m, 0.1)
  factor    = 1 − f(orientation, P_overhang)   for the seasonal average
  ```

  with `f` a simple lookup based on the IES ASHRAE projection-factor
  shading curves. Acceptable accuracy for live preview is ±10% of EP.

- Apply the factor to each facade's solar gain before summing into
  `solar_gains.{face}`.

**Verify:**
- Set a 1m overhang on south facade. Live `Solar — F3 (S)` segment in
  the Heat Balance shrinks. Run a real simulation and confirm the
  Simulation engine shows a similar drop (within ±10%).
- Drill-down on Solar — F3 (S) shows the new term in the
  first-principles formula, e.g. `A × g × G × frame × shading_factor`.

**Commit:** `Brief 22 Part 6: instantCalc shading factor for live preview`

---

## Part 7 — 3D viewer: render the shading

**Goal:** see the overhangs and fins in the building viewer as
slabs in the right colour, so changes are visually obvious.

**Files:**
- `frontend/src/components/modules/building/BuildingViewer3D.jsx` —
  for each facade with non-zero overhang / fin, add a thin
  `<mesh>` slab. Use a neutral grey material distinct from walls
  (`#9CA3AF` ~ same as fabric losses palette).
- Position based on facade geometry already computed in the viewer
  (length × height × num_floors). Overhang sits at the top of the
  glazing band, projecting outward. Fin sits at the side(s).

**Verify:**
- Enter 1m overhang on south. The 3D viewer renders a horizontal slab
  on the south facade, ~1m projection. Rotate the building (orientation
  slider) — the slab follows the right facade.
- Enter 0.5m fins on F2 (E). Two thin vertical slabs on either side
  of each east window.

**Commit:** `Brief 22 Part 7: 3D viewer renders shading geometry`

---

## Part 8 — Verification + STATUS

**Verify checklist (Bridgewater test case at 1440×900):**
- Tooltips show on Stacked + Sankey for all elements
- Solar labels read `Solar — F# (compass)` and rotate live with
  orientation
- 1m overhang on south reduces sim Solar South gain by 25-40%
  (within ±5% tolerance for the projection-factor approx)
- 3D viewer shows the shading slabs in the right place
- `npm run build` clean
- All previous tabs / pop-out panels still load

**Files:** `STATUS.md`

**Commit:** `Brief 22 Part 8: End-to-end verification`

---

## Out of scope (do NOT do in this brief)

- Movable shades / blinds with control schedules — separate brief
- Surrounding-building shading — separate brief
- Per-window shading overrides (current scope is per-facade)
- Custom (non-rectangular) shading geometry
- Shading factor modulation by season (live engine uses an annual
  average; EnergyPlus does it per timestep already)

---

## Notes for the implementer

- The Sankey data shape stays the same; shading just modifies the
  source values via the engine — no schema change in `heat_balance`.
- Drill-down's first-principles formula needs an extra term for
  solar (Part 6); copy the live engine's calc so the two stay aligned.
- The orphan `FabricSankey.jsx` from Brief 21 can be deleted in this
  brief if you're confident — it's no longer imported anywhere.
