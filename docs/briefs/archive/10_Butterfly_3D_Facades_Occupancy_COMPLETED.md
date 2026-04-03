# Brief 10: Butterfly Fix, 3D Architectural Upgrade, Facade Renaming & Expandable Sankey

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read this ENTIRE brief before writing a single line of code
4. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** After completing each part, open the application in a real browser, take screenshots, report what you see, check console for errors. If anything is broken, fix it before committing.

---

## Context

The Building module Live Studio is working well — orientation affects solar gains, the butterfly chart updates in real time, the 3D has shadows and solar overlay. Chris has identified several issues and improvements:

1. **Butterfly chart double-counting:** Equipment, lighting, and people show identical bars on BOTH sides of the butterfly. They should be gains only — shown as heating offsets on the left and cooling drivers on the right, but with DIFFERENT magnitudes (they offset heating differently from how they drive cooling). The double-counting may be masking the EUI response to orientation changes.

2. **Solar gains bar chart redundancy:** The separate "Solar Gains by Facade" bar chart below the butterfly is redundant — the butterfly already shows solar per facade. Consolidate.

3. **Facade naming:** "North/South/East/West" becomes wrong when the building rotates. Switch to numbered facades (1-4) with dynamic compass annotations that update with orientation.

4. **3D visual quality:** The model looks like an engineering box. Upgrade to a clean white architectural massing model style — recessed windows, edge lines, subtle glass material, elevated base plate. Reference: clean isometric massing models with shadow depth on window reveals.

5. **Expandable Sankey:** The right panel is too compact for a full Sankey. Add an "Expand" button that opens a full-width Sankey as an overlay.

10 parts. Do them in order.

---

## PART 1: Fix butterfly chart double-counting

**File(s):** `frontend/src/components/modules/building/GainsLossesChart.jsx`, `frontend/src/utils/instantCalc.js`

**The problem:** Internal gains (equipment, lighting, people) appear with the SAME magnitude on both the heating and cooling sides of the butterfly. This is wrong because:
- On the **heating side**: internal gains OFFSET heat losses. Their contribution depends on the utilisation factor — not all internal heat is useful for heating (summer gains don't help winter heating). The useful portion is approximately `gain × utilisation_factor` (0.75 in the instant calc).
- On the **cooling side**: internal gains DRIVE cooling demand. But not all internal heat becomes a cooling load — some is lost through the fabric. The cooling contribution is approximately `gain × (1 - utilisation_factor) × cooling_fraction`.

**The fix:**

Update the instant calc to return separate heating-side and cooling-side contributions for each element:

```js
return {
  // ... existing fields ...
  gains_losses: {
    heating_side: {
      // Losses (extend LEFT — these INCREASE heating demand)
      wall_conduction:   walls_kWh,
      roof_conduction:   roof_kWh,
      floor_conduction:  floor_kWh,
      glazing_conduction: glazing_kWh,
      infiltration:      infiltration_kWh,
      ventilation:       vent_kWh,
      // Gains/offsets (extend RIGHT — these REDUCE heating demand)
      solar_south:       solar_gains.south * util_factor,
      solar_east:        solar_gains.east  * util_factor,
      solar_west:        solar_gains.west  * util_factor,
      solar_north:       solar_gains.north * util_factor,
      wall_solar:        opaque_solar_total * util_factor,
      equipment:         equip_internal * util_factor,
      lighting:          lighting_internal * util_factor,
      people:            people_internal * util_factor,
    },
    cooling_side: {
      // Gains (extend RIGHT — these INCREASE cooling demand)
      solar_south:       solar_gains.south * cooling_gain_fraction,
      solar_east:        solar_gains.east  * cooling_gain_fraction,
      solar_west:        solar_gains.west  * cooling_gain_fraction,
      solar_north:       solar_gains.north * cooling_gain_fraction,
      equipment:         equip_internal * cooling_gain_fraction,
      lighting:          lighting_internal * cooling_gain_fraction,
      people:            people_internal * cooling_gain_fraction,
      // Offsets (extend LEFT — these REDUCE cooling demand, i.e. help cool)
      infiltration_cooling: infiltration_kWh * 0.15,  // some free cooling from air leakage
      ventilation_cooling:  vent_kWh * 0.1,           // some free cooling from ventilation
    }
  }
}
```

Where `cooling_gain_fraction ≈ 0.25` (approximately 25% of gains become cooling load — the rest is lost through fabric or occurs outside cooling season).

The key point: the equipment bar on the heating side should be SMALLER than on the cooling side (only the utilised portion offsets heating), and both should be SMALLER than the raw internal gain value.

Update the `GainsLossesChart` to read from `gains_losses.heating_side` and `gains_losses.cooling_side` instead of computing its own values.

**Also remove the separate "Solar Gains by Facade" bar chart** from the LiveResultsPanel — the butterfly now shows solar per facade on both sides, making the separate chart redundant. This frees up space in the right panel.

**Commit message:** "Part 1: Fix butterfly double-counting — separate heating/cooling gain contributions, remove redundant solar chart"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT 1:** The butterfly chart should now show DIFFERENT bar lengths for equipment/lighting/people on the heating vs cooling sides
3. **DATA CHECK:** On the heating side, equipment offset should be roughly 75% of raw equipment energy. On the cooling side, equipment contribution should be roughly 25%.
4. **INTERACT:** Set south WWR to 80%, all others to 5%. Change orientation from 0° to 180°.
5. **CRITICAL:** The EUI should now change noticeably between 0° and 180° (because the double-counting is fixed and solar orientation actually drives the balance)
6. The separate solar gains bar chart should be gone — more space in the panel
7. Report: "Butterfly fixed. Equipment on heating side: [X] kWh (offset). Equipment on cooling side: [X] kWh (driver). Different magnitudes confirmed. EUI at 0° with south-heavy glazing: [X]. EUI at 180°: [X]. Difference: [X] kWh/m² — orientation now visibly impacts EUI. Solar bar chart removed."

---

## PART 2: Facade renaming — numbered with dynamic compass

**File(s):** `frontend/src/utils/instantCalc.js`, `frontend/src/components/modules/building/BuildingDefinition.jsx`, `frontend/src/components/modules/building/GainsLossesChart.jsx`, `frontend/src/components/modules/building/LiveResultsPanel.jsx`, `frontend/src/components/modules/building/BuildingViewer3D.jsx`

Replace "North/South/East/West" facade labels throughout the Building module with numbered facades that show their actual compass direction.

**Naming convention:**
- Facade 1: the long side originally at +Y in the geometry (was "north")
- Facade 2: the short side originally at +X (was "east")
- Facade 3: the long side originally at -Y (was "south")
- Facade 4: the short side originally at -X (was "west")

**Dynamic compass annotation:**
Create a helper function:
```js
function facadeLabel(facadeNumber, orientationDeg) {
  const baseAngles = { 1: 0, 2: 90, 3: 180, 4: 270 }
  const trueAngle = (baseAngles[facadeNumber] + orientationDeg) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const compass = directions[Math.round(trueAngle / 45) % 8]
  return `F${facadeNumber} (${compass})`
}
```

At 0° orientation: "F1 (N)", "F2 (E)", "F3 (S)", "F4 (W)"
At 90° orientation: "F1 (E)", "F2 (S)", "F3 (W)", "F4 (N)"
At 45° orientation: "F1 (NE)", "F2 (SE)", "F3 (SW)", "F4 (NW)"

**Update everywhere:**
- WWR sliders: currently labelled N/S/E/W → change to "F1 (N) 25%" etc., updating the compass part live as orientation changes
- Butterfly chart: solar bars labelled "F3 Solar (S)" instead of "South Solar"
- 3D viewer: facade labels on the model should show "F1", "F2", etc. with compass direction
- Hover tooltips on 3D: "Facade 1 (N) — 288 m², 46% WWR, 350 kWh/m²/yr"

**The key interaction:** As the user drags the orientation slider, the compass annotations update everywhere simultaneously — WWR labels, butterfly bars, 3D labels, hover info. The facade NUMBERS stay fixed (F1 is always the same physical wall), but the compass direction rotates.

**Commit message:** "Part 2: Numbered facades with dynamic compass annotations"

**Verify:**
1. Navigate to /building at 0° orientation
2. WWR sliders should show "F1 (N)", "F2 (E)", "F3 (S)", "F4 (W)"
3. **INTERACT:** Change orientation to 90° — labels should update to "F1 (E)", "F2 (S)", "F3 (W)", "F4 (N)"
4. **INTERACT:** Change orientation to 45° — labels should show "F1 (NE)", "F2 (SE)", "F3 (SW)", "F4 (NW)"
5. The 3D viewer facade labels should match
6. The butterfly chart solar bars should use the new naming
7. **SCREENSHOT:** WWR sliders at 45° showing "F1 (NE)" etc.
8. Report: "Facade renaming complete. F1-F4 with dynamic compass. Tested at 0°, 45°, 90° — all labels update correctly across WWR sliders, butterfly, 3D viewer, and hover tooltips."

---

## PART 3: 3D upgrade — recessed windows

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

The most impactful visual change: make windows recessed into the wall rather than flat rectangles on the surface.

**Implementation:**
For each window opening:
1. Create a rectangular hole in the wall geometry (or simulate it by placing a thin box behind the glass)
2. The glass panel sits 80-100mm behind the outer wall face
3. The recess creates a shadow reveal around the window — this is what makes it look architectural
4. The reveal has four surfaces: top, bottom, left, right — all in a slightly darker shade than the main wall

**Approach A — Simple (recommended):**
Don't actually cut holes in the wall mesh (that's complex CSG geometry). Instead:
- Keep the wall as a solid box
- For each window, place a dark thin frame mesh (4 narrow rectangles forming the reveal edges) at the wall surface
- Place the glass panel 80mm behind the wall surface
- The shadow from the directional light will naturally create depth between the frame and the glass

**Approach B — More realistic but complex:**
Use `@react-three/csg` or manual vertex manipulation to cut actual openings in the wall mesh. This gives proper see-through windows but is significantly more complex.

Go with Approach A unless it looks bad — the visual effect of the shadow reveal is what matters, not whether the window is literally a hole.

**Window frame:** Each window gets a thin dark frame (2-3mm thick, dark grey `#4A4A4A`) that sits on the wall surface, outlining the opening. This is the architectural line drawing effect.

**Commit message:** "Part 3: Recessed windows with shadow reveals and thin frames"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT 1:** Close-up of the 3D model showing recessed windows — glass panels should be visibly behind the wall surface, with shadow depth visible
3. **INTERACT:** Orbit to a low angle where the sun creates shadows on the window reveals — the depth should be apparent
4. **INTERACT:** Change window count — new windows should also have the recess
5. The building should look noticeably more architectural than before — closer to the clean massing model reference
6. **PERFORMANCE:** Still smooth with recessed windows? (Each window now has more geometry)
7. Report: "Recessed windows implemented via [Approach A/B]. Reveals visible from oblique angles. Shadow depth creates architectural feel. [X] windows rendered. Performance: [smooth/needs optimisation]."

---

## PART 4: 3D upgrade — edge lines and materials

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

Add clean architectural edge lines and refine materials to match the reference image (clean white massing model).

**Edge lines:**
- Use `@react-three/drei`'s `<Edges>` component or `<Line>` to render visible edges on all building surfaces
- Edge colour: soft dark grey (`#666666`), thin (1px)
- Edges should appear on: building outline, floor-to-floor lines, window frames, roof edges
- This gives the SketchUp-style line drawing effect over the solid model

**Material refinements (matching the white massing reference):**
- Walls: white/very light grey (`#F5F3F0`), matte (roughness 0.9, metalness 0), with subtle warmth
- Glass: very slightly blue-tinted transparency (`#D8E8F0`, opacity 0.3, roughness 0.05, metalness 0.15) — should be subtle, not bright blue
- Roof: slightly darker than walls (`#E8E5E0`)
- Window reveals: medium grey (`#C0C0C0`) — creates contrast with the white walls
- Floor plate edges between floors: thin dark line (part of the edge rendering)

**Base plate:**
- Add a slightly raised rectangular platform under the building (extending ~2m beyond the footprint on all sides)
- Colour: white, matching the reference image
- This grounds the building and creates a clean shadow on the ground plane

**Ambient occlusion:**
- If available, use `@react-three/drei`'s `<ContactShadows>` or `<AccumulativeShadows>` for soft contact shadows where the building meets the base plate
- This adds the subtle darkening at intersections that makes the model feel solid

**Commit message:** "Part 4: Edge lines, white massing materials, base plate, ambient occlusion"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT 1:** The building should now look like a clean white architectural model — visible edge lines, white/light walls, subtle glass, base plate
3. Compare mentally against the reference image Chris shared — does it have the same clean, professional feel?
4. **INTERACT:** Orbit around — edges should remain clean at all angles. Glass should have a subtle tint, not be invisible or too blue.
5. The solar overlay (when on) should still tint the walls from the white base colour toward warm amber
6. When solar overlay is off, the building should be clean white/light grey
7. Report: "White massing model style achieved. Edge lines on all surfaces. Glass subtle blue tint. Base plate grounds the building. Contact shadows [working/not available]. Overall feel: [architectural/still engineering/close to reference]."

---

## PART 5: 3D upgrade — improved camera and environment

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

Refine the camera defaults and environment for a more architectural presentation.

**Default camera position:**
- Slightly lower angle than current (more like a person standing nearby looking at the building, less like a satellite view)
- Approximately: position at 45° elevation, 30° from the front-right corner
- Distance: enough to see the full building with ~20% margin around the edges

**Environment:**
- Use `@react-three/drei`'s `<Environment preset="city" />` for subtle ambient lighting and reflections on glass
- If the environment adds too much colour/distraction, use `<Environment>` with `background={false}` so it only affects reflections, not the sky
- The background should remain a clean gradient: light grey at the top to slightly darker grey at the bottom (or the off-white from the app background)

**Orbit controls refinement:**
- Limit the polar angle so the camera can't go below the ground plane (prevents disorienting upside-down views)
- Enable damping for smooth orbit deceleration
- Auto-rotate: add a very slow auto-rotation when the user hasn't interacted for 5 seconds (stops immediately on mouse interaction). This gives a subtle "living" feel. Add a toggle to disable it.

**Commit message:** "Part 5: Improved camera angle, environment reflections, orbit damping, auto-rotate"

**Verify:**
1. Navigate to /building
2. The default view should feel more natural — slightly lower, looking at the building as if standing nearby
3. **INTERACT:** Orbit around — movement should feel smooth with damping (slight deceleration after releasing mouse)
4. Stop interacting — after 5 seconds, the building should slowly rotate
5. Touch the model — rotation stops immediately
6. Glass should show subtle environmental reflections (very subtle, not mirror-like)
7. Camera should not go below ground level
8. Report: "Camera defaults improved — lower angle, architectural perspective. Damping smooth. Auto-rotate after 5s, stops on interaction. Environment reflections on glass [visible/too subtle/too strong]. Polar angle limited."

---

## PART 6: Expandable Sankey overlay

**File(s):** `frontend/src/components/modules/building/ExpandedSankeyOverlay.jsx` (new), update `frontend/src/components/modules/building/LiveResultsPanel.jsx`

Add an "Expand" button on the butterfly chart that opens a full-width Sankey energy flow diagram as an overlay.

**Button:** Small expand icon (↗ or lucide `Maximize2`) in the top-right of the butterfly chart section. Label: "Expand to Sankey view"

**Overlay behaviour:**
- Clicking the button opens a semi-transparent dark overlay covering the centre and right columns (leaving the left input column visible so the user can still make changes)
- The overlay contains a full Sankey diagram at ~800×500px
- The Sankey uses the same data as the butterfly chart (from instant calc) and updates live as inputs change
- A close button (X) in the top-right dismisses the overlay

**Sankey layout:**
Left side: Energy sources (Electricity, Gas if applicable, Solar gains, Internal gains)
Centre: Building thermal balance node
Right side: End uses and losses (Heating demand, Cooling demand, Wall losses by facade, Roof loss, Floor loss, Infiltration, Ventilation)

The Sankey should use the same d3-sankey library already in the project. Reuse colour tokens from chartTokens.js.

Keep the Sankey from the Results Dashboard Energy Flows tab as-is — this expanded Sankey is specifically for the Building module's instant-calc data and focuses on the fabric balance, not the full systems energy flow.

**Commit message:** "Part 6: Expandable Sankey overlay on Building module butterfly chart"

**Verify:**
1. Navigate to /building
2. Click the expand button on the butterfly chart
3. **SCREENSHOT 1:** The Sankey overlay should appear, covering the centre area, showing energy flows
4. **INTERACT:** While the overlay is open, change the wall U-value on the left panel — the Sankey should update (wall loss flow width changes)
5. **INTERACT:** Change orientation — solar gain flows should shift
6. Click close — overlay should dismiss, butterfly chart visible again
7. Report: "Expandable Sankey working. [X] nodes, [X] links. Updates live while overlay is open. Left input panel still accessible. Close dismisses cleanly."

---

## PART 7: Butterfly chart — group solar gains

**File(s):** `frontend/src/components/modules/building/GainsLossesChart.jsx`

The butterfly currently shows individual bars for "F1 Solar", "F2 Solar", "F3 Solar", "F4 Solar", "Wall Solar", "Roof Solar" — that's 6 solar-related rows. This is too many.

**Consolidate:** Show a single "Solar Gains" bar on each side that represents the total solar contribution. When the user hovers on it, show a tooltip breaking down the per-facade values:

```
Solar Gains: 246 MWh
├── F3 (S): 115 MWh
├── F4 (W): 41 MWh
├── F2 (E): 19 MWh
├── F1 (N): 15 MWh
├── Wall solar: 38 MWh
└── Roof solar: 18 MWh
```

Optionally: make the solar bar clickable to expand/collapse the per-facade detail inline (like an accordion). Default: collapsed (single bar). Click: expanded (individual facade bars appear below).

This cleans up the chart significantly — from ~14 rows to ~8, making it more readable at the compact `w-80` size.

**Commit message:** "Part 7: Consolidate solar gains in butterfly chart with hover/expand detail"

**Verify:**
1. Navigate to /building
2. The butterfly should show a single "Solar Gains" bar instead of 6 individual solar bars
3. **INTERACT:** Hover on the solar bar — tooltip should show the per-facade breakdown
4. **INTERACT:** Click the solar bar — it should expand to show individual facade bars (if accordion implemented)
5. The chart should feel cleaner and more readable
6. Report: "Solar gains consolidated. Single bar on each side: heating offset [X] MWh, cooling driver [X] MWh. Hover tooltip shows [X] facade values. [Accordion expand implemented / tooltip only]. Chart now has [X] rows (was 14)."

---

## PART 8: Occupancy input — bedrooms and occupancy rate

**File(s):** `frontend/src/components/modules/building/BuildingDefinition.jsx`, `frontend/src/utils/instantCalc.js`, update `frontend/src/context/ProjectContext.jsx`

Add occupancy inputs to the Building module left column. This is crucial for hotel modelling — a 138-bed hotel at 60% occupancy has very different internal gains from one at 95%.

**Add to ProjectContext building params:**
```js
num_bedrooms: 138,       // number of hotel bedrooms
occupancy_rate: 0.75,    // average annual occupancy rate (0-1)
people_per_room: 1.5,    // average people per occupied room
```

**Add to the Building module left column** (new section between Glazing and Fabric):

**Occupancy section:**
- **Bedrooms:** number input (default 138 for Bridgewater)
- **Occupancy rate:** slider 0-100% (default 75%)
- **People per room:** number input (default 1.5)
- **Derived metrics** (read-only, calculated):
  - Average occupants: bedrooms × occupancy_rate × people_per_room = 155 people
  - Occupancy density: average_occupants / GIA = 0.043 people/m²

**Update instant calc:**
- Use the occupancy inputs instead of hardcoded `occ_m2 = 0.04`
- People internal gains = 60W × average_occupants × occupied_hours / 1000
- Equipment should also scale with occupancy: more occupied rooms = more TVs, chargers running
- DHW demand should scale with actual occupants, not just GIA

This connects the occupancy directly to the energy balance — changing occupancy rate from 75% to 50% should visibly reduce internal gains, increase heating demand (less free heat from people), and reduce DHW.

**Commit message:** "Part 8: Occupancy inputs — bedrooms, occupancy rate, people per room"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT:** Occupancy section showing 138 bedrooms, 75% rate, 1.5 people/room
3. **INTERACT:** Change occupancy rate from 75% to 50% — internal gains should decrease in the butterfly, heating demand should increase, EUI should change
4. **INTERACT:** Change to 95% — internal gains increase, heating decreases (more free heat from people), DHW increases
5. **DATA CHECK:** At 138 rooms × 75% × 1.5 people = 155.25 average occupants. At 50%: 103.5 occupants. The internal gains bar should be roughly 2/3 as large at 50% vs 75%.
6. Report: "Occupancy inputs working. 138 rooms × 75% × 1.5 = 155 avg occupants. At 75%: people gains [X] kWh, EUI [X]. At 50%: people gains [X] kWh, EUI [X]. At 95%: people gains [X] kWh, EUI [X]. Occupancy clearly drives internal gains and EUI."

---

## PART 9: Wire occupancy to EnergyPlus assembler

**File(s):** `nza_engine/generators/epjson_assembler.py`, `api/routers/projects.py`

Ensure the occupancy inputs feed through to the full EnergyPlus simulation, not just the instant calc.

Update the assembler to use `num_bedrooms`, `occupancy_rate`, and `people_per_room` from the building params:
- Calculate the occupancy density (people/m²) from these inputs
- Apply it to the EnergyPlus `People` objects in each zone
- The occupancy schedule is already set separately (from the profiles editor) — this just changes the peak number of people

Also update the DHW demand calculation in the assembler to use actual occupant count rather than a fixed litres-per-m² assumption.

Ensure the project API persists the new fields.

**Commit message:** "Part 9: Occupancy inputs wired to EnergyPlus assembler"

**Verify:**
1. Set occupancy to 50%, run full simulation. Note EUI.
2. Set occupancy to 95%, run full simulation. Note EUI.
3. The two EUI values should differ. Higher occupancy = more internal gains = less heating but more cooling and more DHW.
4. Compare instant calc prediction with EnergyPlus result — should be directionally consistent
5. Report: "Occupancy wired to EnergyPlus. At 50%: EUI [X] (instant [X]). At 95%: EUI [X] (instant [X]). Higher occupancy: heating [direction], cooling [direction], DHW [direction]. Instant calc and EnergyPlus agree on direction."

---

## PART 10: Full integration test

Complete walkthrough:

1. Open /building with Bridgewater defaults
2. Verify butterfly chart shows asymmetric gains (heating offsets ≠ cooling drivers)
3. Set south-only glazing (F3 80%, others 5%), rotate 0° → 180° — EUI should change meaningfully
4. Facade labels should show "F1 (N)" at 0° and "F1 (S)" at 180°
5. 3D model: windows should be recessed with shadow reveals, edge lines visible, white massing materials
6. Glass should have subtle blue tint and environmental reflections
7. Expand the Sankey overlay — should show energy flows, update with changes
8. Change occupancy from 75% to 50% — internal gains drop, heating increases
9. Auto-simulation should verify all changes after 3 seconds
10. The overall Building module should feel like a professional architectural analysis tool — the kind of thing you'd show a client

**SCREENSHOTS:**
1. 3D model close-up showing recessed windows and edge lines
2. Butterfly chart with consolidated solar gains
3. Expanded Sankey overlay
4. Facade labels at 45° orientation showing NE/SE/SW/NW
5. Occupancy section with inputs

**Commit message:** "Part 10: Full integration test — architectural 3D, fixed butterfly, facade naming, occupancy"

**Verify — report:**
- Butterfly double-counting fixed: ✓/✗
- Orientation impacts EUI (south-heavy test): ✓/✗ — difference [X] kWh/m²
- Facade naming F1-F4 with compass: ✓/✗
- 3D recessed windows: ✓/✗
- 3D edge lines: ✓/✗
- 3D white massing style: ✓/✗
- Expandable Sankey: ✓/✗
- Occupancy inputs: ✓/✗
- Auto-simulation: ✓/✗
- Zero console errors

---

## After all 10 parts are complete

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 10 complete. Butterfly chart fixed — no more double-counting, EUI now shifts [X] kWh/m² between 0° and 180° with south-heavy glazing. Facades renamed F1-F4 with live compass annotations. 3D model has recessed windows, edge lines, white massing materials — looks architectural. Expandable Sankey overlay. Occupancy inputs (bedrooms, rate, people/room) drive internal gains and EUI."
