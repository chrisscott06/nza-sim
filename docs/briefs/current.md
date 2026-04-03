# Brief 09: Orientation Fix, Gains & Losses Diagram, 3D Visual Upgrade

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

The Live Studio three-column layout is working well. Chris has identified a critical bug: **building orientation doesn't affect the instant calc or the live results**. Rotating the building should change which facades receive more solar radiation, which directly impacts heating and cooling demand. This must be fixed.

Additionally, this brief upgrades the Building module's live results panel with a Sefaira-style gains & losses butterfly diagram and improves the 3D viewer's visual quality with better lighting, shadows, and an optional map tile ground plane.

**Reference:** The Sefaira SketchUp plugin showed a "Gains & Losses" chart with heating impact on the left and cooling impact on the right. Each building element (infiltration, wall conduction, south solar, glazing conduction, etc.) appears as a bar showing its contribution. The same element can contribute to both sides — south solar reduces heating but increases cooling. This updates in real time as the user changes the model.

10 parts. Do them in order.

---

## PART 1: Fix orientation in instant calc

**File(s):** `frontend/src/utils/instantCalc.js`

**The bug:** Solar radiation per facade is hardcoded by facade label (`north`, `south`, `east`, `west`) and ignores the building orientation. When the building is rotated 90°, the facade labelled "north" in the geometry now actually faces east — so it should receive east-facing solar radiation, not north-facing.

**The fix:** Rotate the solar radiation assignments based on the orientation angle.

The building orientation is defined as degrees clockwise from north. At 0°, the "north" facade faces north. At 90°, the "north" facade faces east. At 180°, it faces south. At 270°, it faces west.

Implement a function that maps facade labels to actual compass directions based on orientation, then looks up the solar radiation for the actual direction:

```js
// Solar radiation by TRUE compass direction (kWh/m²/yr, UK)
const SOLAR_BY_COMPASS = {
  N: 350, NE: 400, E: 500, SE: 650, S: 750, SW: 650, W: 500, NW: 400
}

function getActualDirection(facadeLabel, orientationDeg) {
  // facadeLabel is relative to building geometry (north = along +y axis)
  // orientationDeg rotates the building clockwise from true north
  const baseAngles = { north: 0, east: 90, south: 180, west: 270 }
  const trueAngle = (baseAngles[facadeLabel] + orientationDeg) % 360
  // Map angle to compass direction (8-point)
  // 0=N, 45=NE, 90=E, 135=SE, 180=S, 225=SW, 270=W, 315=NW
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const index = Math.round(trueAngle / 45) % 8
  return directions[index]
}

function getSolarRadiation(facadeLabel, orientationDeg) {
  const dir = getActualDirection(facadeLabel, orientationDeg)
  return SOLAR_BY_COMPASS[dir]
}
```

Update the solar gains calculation to use this:
```js
const orientation = Number(building.orientation ?? 0)
const solar_gains = {
  north: glazing.north * getSolarRadiation('north', orientation) * g_value / 1000,
  south: glazing.south * getSolarRadiation('south', orientation) * g_value / 1000,
  east:  glazing.east  * getSolarRadiation('east',  orientation) * g_value / 1000,
  west:  glazing.west  * getSolarRadiation('west',  orientation) * g_value / 1000,
}
```

Now when the building is at 0°, north gets 350 and south gets 750 (as before). But at 90°, north (now facing east) gets 500 and south (now facing west) gets 500. At 180°, north (now facing south) gets 750. This is physically correct.

Also include the 8-point compass resolution so diagonal orientations (45°, 135°, etc.) get interpolated values.

**Commit message:** "Part 1: Fix orientation in instant calc — solar radiation rotates with building"

**Verify:**
1. Open the app, navigate to /building
2. Set orientation to 0° — note the EUI and solar gains in the right panel. South solar should be highest.
3. **INTERACT:** Change orientation to 90° — the EUI should change. The solar gains should shift: what was the south facade's gain should now be lower (it faces west), and what was the east facade's gain should increase (it now faces south).
4. **INTERACT:** Change orientation to 180° — north and south solar gains should swap compared to 0°
5. **INTERACT:** Slowly drag the orientation slider from 0° to 360° — the EUI should smoothly vary, peaking when the high-WWR facade faces south and dipping when it faces north
6. **DATA CHECK:** At 0°, south solar > north solar. At 180°, north solar > south solar. At 90° and 270°, east/west should be more balanced.
7. **SCREENSHOT:** Solar gains panel at 0° vs 180° showing the values have swapped
8. Report: "Orientation now affects instant calc. At 0°: south solar [X] kWh, north [X] kWh, EUI [X]. At 180°: south [X] kWh, north [X] kWh, EUI [X]. At 90°: EUI [X]. Values rotate correctly with 8-point compass resolution."

---

## PART 2: Verify orientation in EnergyPlus simulation

**File(s):** No code changes expected — this is a verification part. If issues found, fix them.

Confirm that the full EnergyPlus simulation also responds to orientation changes.

1. Set orientation to 0°, run a full simulation (click Run Simulation or wait for auto-sim). Note the EUI and solar gains.
2. Set orientation to 180°, run a full simulation. Note the EUI and solar gains.
3. The results should differ. If they don't, check:
   - Is `building_params["orientation"]` being passed to the assembler?
   - Is the assembler setting `north_axis` in the Building object?
   - Is the auto-save actually persisting the orientation before the simulation triggers?

The EnergyPlus assembler already has `north_axis: float(building_params.get("orientation", 0.0))` — so this should work. The most likely issue is a timing problem: the auto-simulation fires before the orientation save completes, so it runs with the old value. If this is the case, ensure the simulation waits for the save to complete (the auto-sim timer should only start after `saveStatus === 'saved'`).

**Commit message:** "Part 2: Verify EnergyPlus orientation response" (or fix if needed)

**Verify:**
1. At 0°: run full simulation. EUI = [X], south solar gains from EnergyPlus = [X]
2. At 180°: run full simulation. EUI = [X], south solar gains = [X]
3. The two EUI values MUST be different (unless the building has identical WWR on all facades, in which case change north WWR to 40% and south to 10% to force asymmetry, then retest)
4. Compare: instant calc EUI change (0° vs 180°) should be directionally consistent with EnergyPlus change (both increase or both decrease)
5. Report: "EnergyPlus orientation verified. At 0°: EUI [X] kWh/m². At 180°: EUI [X] kWh/m². Change: [X] kWh/m² ([X]%). Consistent with instant calc direction. [No fix needed / Fix applied: describe]."

---

## PART 3: Sefaira-style Gains & Losses butterfly diagram

**File(s):** `frontend/src/components/modules/building/GainsLossesChart.jsx` (new), update `frontend/src/components/modules/building/LiveResultsPanel.jsx`

Create a butterfly/diverging bar chart that shows what contributes to heating demand (left side) and what contributes to cooling demand (right side). This replaces or sits above the current fabric breakdown bar in the live results panel.

**Data from instant calc:**

Each building element has a heating impact and a cooling impact:

| Element | Heating Impact (increases demand) | Cooling Impact (increases demand) |
|---------|----------------------------------|-----------------------------------|
| Wall conduction | Heat loss through walls (bad) | Slight benefit — walls lose excess heat (small/ignore) |
| Roof conduction | Heat loss through roof (bad) | Similar small benefit |
| Floor conduction | Heat loss to ground (bad) | Ground cooling benefit in summer (small) |
| Glazing conduction | Heat loss through glazing (bad) | Slight cooling benefit |
| Infiltration | Cold air entering (bad) | Some cooling benefit in mild weather |
| Ventilation | Cold air supply (bad, reduced by MVHR) | Cooling benefit when outdoor < indoor |
| North solar | Reduces heating (good) | Minor cooling contribution |
| South solar | Significantly reduces heating (good) | Significantly increases cooling (bad) |
| East solar | Moderate heating reduction | Moderate cooling increase |
| West solar | Moderate heating reduction | Moderate cooling increase (afternoon) |
| Internal gains (people) | Reduces heating (good) | Increases cooling (bad) |
| Internal gains (equipment) | Reduces heating (good) | Increases cooling (bad) |
| Internal gains (lighting) | Reduces heating (good) | Increases cooling (bad) |

**Chart layout:**

```
     HEATING IMPACT          │          COOLING IMPACT
     ◄── increases demand    │    increases demand ──►
                             │
  ████████████ Infiltration  │
  ██████████ Wall conduct.   │
  ████████ Ventilation       │
  ██████ Glazing conduct.    │
  ████ Roof conduction       │
  ██ Floor conduction        │
                             │  ████████████████ South Solar
  South Solar ██████████████ │  ████████████ Equipment
  Equipment █████████████    │  ██████████ Lighting
  Lighting ████████████      │  ████████ People
  People █████████           │  ██████ West Solar
  North Solar ████           │  ████ East Solar
  East Solar █████           │  ██ North Solar
  West Solar █████           │  █ Infiltration (free cooling)
                             │
  ◄── LOSSES (bad)  GAINS ──►│◄── GAINS (bad)  LOSSES ──►
```

Left side: bars extending left = increases heating demand (losses are bad, gains are good = shown as negative/reducing bars). Right side: bars extending right = increases cooling demand.

Colour coding:
- Fabric losses: warm brown tones (`#A1887F` family)
- Glazing losses: light blue (`#4FC3F7`)
- Infiltration: grey (`#9E9E9E`)
- Ventilation: cyan (`#06B6D4`)
- Solar gains: warm yellows (graduated by facade: south darkest)
- Internal gains: purple/slate tones

Each bar is labelled with its value in kWh.

The chart should be an SVG component that updates instantly from the instant calc results. As the user changes orientation, the solar gain bars shift. As they change WWR, the glazing bars change. As they change insulation, the wall bars change.

**Implementation note:** You'll need to extend the instant calc to separate gains that offset heating from gains that contribute to cooling. The simplest approach:
- Heating side: show all fabric/infiltration/ventilation losses as bars extending left, and all gains (solar + internal) as bars extending right (they offset heating)
- Cooling side: show all gains (solar + internal) as bars extending right (they drive cooling demand)

Add `GainsLossesChart` to the `LiveResultsPanel`, positioned below the EUI gauge and above the key metrics. It should be compact — approximately 200px tall — to fit in the `w-80` right column.

**Commit message:** "Part 3: Sefaira-style gains & losses butterfly diagram in Building live results"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT 1:** The butterfly chart should be visible in the right panel, showing heating impacts on the left and cooling impacts on the right
3. **INTERACT:** Change orientation from 0° to 180° — south solar bars should shift (south solar was a big heating offset at 0° because south facade gets most sun; at 180°, it's the north facade that gets south-facing radiation)
4. **INTERACT:** Increase south WWR to 60% — south solar gain bars should grow on both sides
5. **INTERACT:** Change wall U-value to enhanced — wall conduction bar on the heating side should shrink
6. **INTERACT:** Change infiltration to 1.5 ACH — infiltration bar on heating side should grow
7. **DATA CHECK:** The largest heating impact should be one of: wall conduction, infiltration, or ventilation (fabric losses). The largest cooling impact should be solar gains or internal gains.
8. Report: "Gains & Losses butterfly chart working. Heating side: largest impact [element] at [X] kWh. Cooling side: largest [element] at [X] kWh. Responds to orientation change — south solar shifts correctly. Responds to WWR, U-value, and infiltration changes. Chart is compact and fits in the w-80 column."

---

## PART 4: 3D viewer — improved lighting and shadows

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

Upgrade the 3D rendering quality to make the building look more architectural and less like a basic box.

**Lighting improvements:**
- Add a `directionalLight` with shadow casting enabled, positioned to simulate afternoon sun (from the south-west, elevated ~45°)
- Enable shadow maps on the renderer: `<Canvas shadows>`
- The building meshes should `castShadow` and `receiveShadow`
- The ground plane should `receiveShadow` to show the building's shadow
- Add soft `ambientLight` at ~0.4 intensity for fill
- Consider `@react-three/drei`'s `Environment` component with a preset (e.g. "city" or "apartment") for subtle reflections on glazing

**Ground plane:**
- Replace the current grid/flat ground with a larger plane (~200m × 200m)
- Light grey/off-white colour (`#EEEEE`) with a subtle grid or no grid
- Receives shadows from the building
- Slightly below the building (y = -0.01) to avoid z-fighting

**Building materials:**
- Walls: `MeshStandardMaterial` with roughness 0.85, metalness 0.0 — matte masonry feel. Colour: `#D4C5B8` (warm light stone)
- Glazing: `MeshPhysicalMaterial` with roughness 0.05, metalness 0.1, transparency 0.6, colour `#88C8E8` — subtle reflective glass
- Roof: `MeshStandardMaterial` with roughness 0.7, colour `#8A8A8A` — darker grey
- Floor edges (between floors): thin dark lines or `@react-three/drei` `<Edges>` component

**Sky/environment:**
- Use `@react-three/drei`'s `<Sky>` component or a subtle gradient background
- Alternatively, a soft HDRI environment that gives realistic ambient lighting

The goal: the building should look like a clean architectural massing model — the kind of image you'd put in a feasibility report. Think of the Autodesk rendering in Chris's reference image but simpler.

**Commit message:** "Part 4: 3D viewer visual upgrade — shadows, materials, environment lighting"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT 1:** The 3D viewer should look noticeably better than before — soft shadows on the ground, warmer wall materials, glassy windows, subtle sky/environment
3. **INTERACT:** Orbit around the building — shadows should move correctly relative to the camera
4. **INTERACT:** Change floors from 4 to 8 — the shadow should get larger
5. **VISUAL CHECK:** Does the building look like something you'd put in a report? Is the lighting natural-looking? Are the glazing panels slightly reflective?
6. **PERFORMANCE:** Still smooth orbit/zoom? Shadow rendering can be expensive — if it's laggy, reduce shadow map resolution
7. Report: "3D visual quality significantly improved. Shadows rendering on ground plane. Wall materials warm stone-like. Glazing has subtle reflection/transparency. [Sky/environment component used]. Performance: [smooth/minor lag]. Building looks [architectural/still basic]."

---

## PART 5: Solar gain heat mapping on 3D facades

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

Add a visual overlay on the 3D model showing solar gain intensity per facade. This gives immediate visual feedback about which facades receive the most solar radiation — and updates as orientation changes.

**Implementation:**
- Each wall surface's colour is tinted based on its annual solar radiation:
  - High solar (>600 kWh/m²): warm amber/orange tint
  - Medium solar (400-600): warm yellow tint
  - Low solar (<400): cool grey/blue tint
- The tinting is subtle — blended with the base wall colour, not replacing it
- Only the opaque wall portions are tinted (not the glazing)
- The glazing panels could have a subtle orange glow on high-solar facades

**Data source:** Use the same `getSolarRadiation(facadeLabel, orientation)` function from Part 1.

**Add a legend** in the corner of the 3D viewer: a small gradient bar from blue (low solar) to amber (high solar) with "kWh/m²/yr" label.

**Toggle:** Add a small button in the 3D viewer toolbar to toggle the solar overlay on/off. Default: on. When off, walls return to the neutral stone colour from Part 4.

**Commit message:** "Part 5: Solar gain heat map overlay on 3D building facades"

**Verify:**
1. Navigate to /building with solar overlay on (default)
2. **SCREENSHOT 1:** At 0° orientation, the south facade should have a warm amber tint, north facade should be cooler grey/blue
3. **INTERACT:** Rotate to 90° — the tints should shift. The facade that was south-tinted should now be cooler (it faces west), and the east-facing facade should warm up (now facing south)
4. **INTERACT:** Rotate to 180° — north and south tints should swap compared to 0°
5. **INTERACT:** Toggle the solar overlay off — all walls should return to neutral
6. The legend should be visible and correctly shows the scale
7. Report: "Solar heat map overlay working. South facade warm amber at 0°, shifts with orientation. Toggle on/off works. Legend visible. Visual effect is [subtle/strong/needs adjustment]."

---

## PART 6: Map tile ground plane (optional visual upgrade)

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`, update `frontend/src/context/ProjectContext.jsx`

Add the option to display a satellite/map tile as the ground plane texture, centred on the building's real-world location.

**Add to ProjectContext building params:**
```js
location: {
  latitude: 51.127,   // Bridgewater, Somerset
  longitude: -2.992,
  name: "Bridgewater, Somerset"
}
```

Add a "Location" section to the Building module left column:
- Latitude / Longitude number inputs
- Location name text input
- A small "Show on map" toggle

**When location is provided and "Show on map" is on:**
1. Fetch a satellite tile from a free tile provider. Options:
   - **OpenStreetMap tiles:** `https://tile.openstreetmap.org/{z}/{x}/{y}.png` — free, no API key, but basic styling
   - **Mapbox Static API:** Better quality but needs a free API key
   - **Stamen/Stadia Maps:** `https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}.jpg` — satellite imagery, free tier
   
   Use OpenStreetMap as the default (no API key needed). Fetch a zoom level ~17 tile centred on the lat/long.

2. Apply the tile as a texture on the ground plane in Three.js:
   ```js
   const texture = useLoader(TextureLoader, tileUrl)
   <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
     <planeGeometry args={[200, 200]} />
     <meshStandardMaterial map={texture} />
   </mesh>
   ```

3. Scale and position: the tile should be roughly to scale (1 pixel ≈ 1 metre at zoom 17). The building sits in the centre.

**When location is not provided or "Show on map" is off:**
Fall back to the plain grey ground plane from Part 4.

**Note:** This is a visual nicety, not a simulation input. The weather file determines the climate, not the map tile. But it gives tremendous context — clients see their actual building site.

If tile fetching proves too complex (CORS issues, tile server rate limits), implement just the lat/long inputs for now and mark the map overlay as "coming soon." Getting the location stored in the project is valuable regardless.

**Commit message:** "Part 6: Map tile ground plane with location inputs"

**Verify:**
1. Navigate to /building
2. Enter Bridgewater coordinates: lat 51.127, long -2.992
3. Toggle "Show on map" on
4. **SCREENSHOT 1:** The ground plane should show a map tile of the Bridgewater area with the building sitting on top of it
5. If CORS or loading issues: confirm the fallback grey ground plane shows cleanly, and report the error
6. Toggle "Show on map" off — should return to plain ground plane
7. The location inputs should persist through page refresh
8. Report: "Map tile ground plane [working/CORS blocked/loading error]. Location inputs persist. Lat [X], Long [X] stored in project. [Map shows Bridgewater area / Fallback to grey plane]. Building positioned on map."

---

## PART 7: Gains & Losses — add conduction gains through opaque elements

**File(s):** `frontend/src/utils/instantCalc.js`, update `frontend/src/components/modules/building/GainsLossesChart.jsx`

Extend the instant calc to account for solar-driven conduction gains through opaque elements (walls and roof), not just through glazing.

In reality, when the sun shines on a south-facing wall, it heats the outer surface, which drives heat inward. This "sol-air" effect means opaque walls contribute some heat gain, not just heat loss. The effect is stronger for:
- Dark-coloured walls (high solar absorptance)
- South-facing walls (more solar radiation)
- Poorly insulated walls (heat flows through faster)

**Simplified calculation:**
```
opaque_solar_gain_kWh = solar_radiation × wall_area × absorptance × U / U_ext × (1 - U/U_ext)
```

Actually, a simpler and more standard approach:
```
sol_air_gain = solar_radiation (kWh/m²/yr) × absorptance × U_value × area / outside_film_coefficient
```

But for instant calc simplicity, use:
```
opaque_gain_fraction = 0.04  // ~4% of incident solar on opaque wall contributes as internal gain
opaque_wall_solar_kWh[facade] = solar_radiation[facade] × opaque_wall_area[facade] × opaque_gain_fraction
```

This is small compared to glazing solar gains but it adds up for large south-facing walls.

Add these to the gains & losses butterfly chart as separate small bars: "Wall solar (S)", "Wall solar (N)", etc. — only show if the value is meaningful (>1% of total gains).

Also add the roof solar gain:
```
roof_solar_kWh = horizontal_solar_radiation × roof_area × opaque_gain_fraction
// UK horizontal solar ≈ 950 kWh/m²/yr
```

**Commit message:** "Part 7: Sol-air conduction gains through opaque elements"

**Verify:**
1. Navigate to /building
2. Check the gains & losses chart — there should be small "Wall solar" and "Roof solar" bars on the gains side
3. **DATA CHECK:** These should be much smaller than glazing solar gains (typically 5-15% of glazing gains). If they're larger than glazing gains, the opaque_gain_fraction is too high.
4. **INTERACT:** Change orientation — wall solar gains per facade should shift
5. Report: "Opaque solar gains added. South wall solar: [X] kWh, Roof solar: [X] kWh. Total opaque gains [X]% of glazing gains. Responds to orientation. Values are [plausible/too high/too low]."

---

## PART 8: Instant calc — g-value from glazing library

**File(s):** `frontend/src/utils/instantCalc.js`

Currently the instant calc uses a hardcoded `DEFAULT_G_VALUE = 0.4` for solar heat gain coefficient. It should read the actual g-value from the selected glazing construction in the library.

Update `calculateInstant()` to:
1. Look up the glazing construction from `constructionChoices.glazing`
2. Find it in `libraryData.constructions`
3. Read `config_json.g_value` (this should be stored in the construction library items)
4. Fall back to 0.4 if not found

This means switching from `double_low_e` (g=0.42) to `triple_glazing` (g=0.35) should visibly reduce solar gains in the live results — which is physically correct (triple glazing blocks more solar).

**Commit message:** "Part 8: Instant calc reads g-value from glazing library item"

**Verify:**
1. Navigate to /building with double_low_e selected (g ≈ 0.42)
2. Note the solar gains in the live results
3. Switch to triple_glazing (g ≈ 0.35)
4. Solar gains should decrease by approximately (0.35/0.42 ≈ 83%) — roughly 17% reduction
5. EUI should change slightly (less solar gain = more heating needed in winter)
6. Report: "g-value now read from library. double_low_e: solar [X] kWh (g=0.42). triple_glazing: solar [X] kWh (g=0.35). Reduction: [X]%. EUI change: [X] kWh/m². Correct direction — less solar gain means more heating."

---

## PART 9: Visual polish — 3D viewer toolbar and interaction

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

Add a small toolbar overlay on the 3D viewer with:

1. **Reset view button** — returns camera to the default 3/4 angle
2. **Solar overlay toggle** — on/off for the facade heat map (from Part 5)
3. **Map toggle** — on/off for the map ground plane (from Part 6, if implemented)
4. **Compass indicator** — a small compass rose in the corner showing true north, that stays fixed as the camera orbits

The toolbar should be semi-transparent, positioned in the top-right or bottom-right of the viewer, and not obstruct the model.

Also improve the hover interaction:
- When hovering on a wall surface, show: facade direction (e.g. "South facade"), wall area (m²), glazing area (m²), WWR (%), and solar radiation (kWh/m²/yr) — this last value comes from the orientation-aware solar lookup
- When hovering on a glazing panel, show: U-value, g-value, solar gain (kWh/yr for this panel)

**Commit message:** "Part 9: 3D viewer toolbar, compass indicator, and enhanced hover info"

**Verify:**
1. Navigate to /building
2. **SCREENSHOT 1:** The toolbar should be visible in the corner with reset, solar, and map toggle buttons
3. **INTERACT:** Click reset — camera returns to default angle
4. **INTERACT:** Hover on the south wall — tooltip should show "South facade, [X] m², [X] kWh/m²/yr solar"
5. **INTERACT:** Hover on a glazing panel — should show U-value and g-value
6. The compass should show N correctly and stay fixed during camera orbit
7. Report: "Toolbar working — reset, solar toggle, map toggle. Compass indicator fixed during orbit. Hover info shows facade direction, area, solar radiation, and glazing properties."

---

## PART 10: Full integration test

Complete walkthrough of the Building module:

1. Open /building with Bridgewater defaults (0° orientation, 25% WWR all facades)
2. Check gains & losses chart — heating side should show infiltration and fabric losses; cooling side should show solar and internal gains
3. Change orientation to 45° — solar gains should shift, gains & losses chart should update, 3D facade tints should change
4. Change orientation to 180° — gains & losses should roughly mirror (south solar now on north facade)
5. Change south WWR to 60% — south solar bars should grow on both sides of the butterfly
6. Change wall to cavity_wall_enhanced — wall conduction bar on heating side should shrink
7. Change glazing to triple_glazing — solar gain bars should shrink (lower g-value), glazing conduction bar should shrink (lower U-value)
8. Change infiltration to 1.5 ACH — infiltration bar should grow significantly
9. Enter Bridgewater location coordinates — map tile should appear (if implemented)
10. Wait for auto-simulation after each change — verified results should refine the instant estimates
11. Check that the 3D viewer has proper shadows, materials, and the solar overlay

**SCREENSHOTS:**
1. Building module at 0° with gains & losses chart
2. Building module at 180° showing the gains & losses shift
3. 3D viewer with shadows and solar overlay
4. Hover tooltip on a facade showing solar radiation
5. Map tile ground plane (if working)

**Commit message:** "Part 10: Full integration test — orientation, gains/losses, 3D visuals"

**Verify — report:**
- Orientation affects instant calc: ✓/✗
- Orientation affects EnergyPlus: ✓/✗
- Gains & losses butterfly chart: ✓/✗ with [X] elements
- 3D shadows: ✓/✗
- Solar overlay on facades: ✓/✗
- Map tile: ✓/✗/not implemented
- g-value from library: ✓/✗
- Opaque solar gains: ✓/✗
- Hover info enhanced: ✓/✗
- Zero console errors

EUI at 0° orientation: [X] kWh/m² (instant) / [X] kWh/m² (EnergyPlus)
EUI at 180° orientation: [X] kWh/m² (instant) / [X] kWh/m² (EnergyPlus)
Solar gains at 0°: south [X] kWh, north [X] kWh
Solar gains at 180°: south [X] kWh, north [X] kWh

---

## After all 10 parts are complete

Update STATUS.md with:
- All 10 parts completed
- Orientation bug fixed and verified
- Gains & losses chart description
- 3D visual improvements
- Map tile status
- Instant calc accuracy at different orientations
- Known issues
- Suggestions for Brief 10 (dual-screen comparison, report export PowerPoint, EV charging, future weather files, surrounding buildings for shading analysis)

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 09 complete. Orientation fixed — rotating the building now changes solar gains, EUI, and the gains & losses chart in real time. Sefaira-style butterfly diagram shows heating drivers on the left and cooling drivers on the right. 3D viewer has shadows, better materials, solar heat map overlay, and [optional: map tile from OS data]. South facade at 0°: [X] kWh solar. Same facade at 180°: [X] kWh. EUI shifts by [X] kWh/m² between orientations."
