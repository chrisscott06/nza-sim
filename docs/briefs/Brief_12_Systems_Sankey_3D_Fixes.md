# Brief 12: Systems Module Overhaul — Sankey Schematic, 3D Fixes, Collapsible Inputs

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read this ENTIRE brief before writing a single line of code
4. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** Take screenshots, report actual numbers, check console for errors.

---

## Context

The Building module is in good shape. Now it's time to make the Systems module equally impressive. Chris has identified several issues and a vision for the centre schematic:

**Bugs to fix:**
- 3D shadow z-fighting on the base plate (jittery flickering)
- Wall colour too brown — should be clean grey
- Glass lacks blue tint — should be consistent blue regardless of viewing angle
- System type dropdowns showing "Loading..." — the frontend filters by `l.type` but the API returns `l.category`
- Heating demand showing 0 MWh in instant calc (likely gains overweighting losses after units fix)

**Systems module vision:**
The centre schematic should be a **Sankey-style flow diagram** with proportional line widths, showing energy flowing from sources (grid, gas) through systems (VRF, MVHR, boiler, lighting) to end uses (heating, cooling, DHW, light). Crucially, it should show **inter-system connections** — heat rejected by VRF cooling feeding into DHW preheat, MVHR recovering heat from exhaust air. The diagram changes dynamically when systems are switched (add MVHR → heat recovery loop appears, enable ASHP preheat → VRF→DHW link appears).

**Left panel improvements:**
Collapsible accordion sections so all systems are visible at once (collapsed) and can be expanded one at a time for detail.

12 parts. Do them in order.

---

## PART 1: Fix 3D shadow z-fighting

**File(s):** `frontend/src/components/modules/building/BuildingViewer3D.jsx`

The base plate and shadow/ground plane are at nearly the same Y coordinate, causing the GPU to flicker between them (z-fighting).

**Fix options (try in order):**
1. Remove the separate shadow-receiving plane if there is one — let the base plate receive shadows directly
2. If using `<ContactShadows>`, position it slightly above the base plate (y = base_y + 0.02)
3. Increase the gap between the base plate top surface and any shadow plane
4. If using a standard shadow map, increase `shadow-camera` near/far range and shadow map resolution
5. Disable auto-rotate as a test — if z-fighting stops, the issue is shadow map updates during rotation. Fix by increasing shadow map bias: `directionalLight.shadow.bias = -0.001`

**Also fix materials:**
- **Walls:** Change from the current warm brown/stone colour to a clean light grey (`#E8E6E3` or `#EBEBEB`). Matte finish (roughness 0.9, metalness 0).
- **Glass:** Use `MeshPhysicalMaterial` with a consistent blue tint:
  - `color: '#A8C8E0'` (cool blue)
  - `transparent: true`
  - `opacity: 0.35`
  - `roughness: 0.1`
  - `metalness: 0.1`
  - This gives a constant blue-tinted glass look from any angle, matching Chris's reference image

**Commit message:** "Part 1: Fix z-fighting, grey walls, blue-tinted glass"

**Verify:**
1. Navigate to /building
2. **Z-FIGHTING TEST:** Let the building auto-rotate for 10 seconds. The base plate should NOT flicker or jitter.
3. **SCREENSHOT 1:** The building showing clean grey walls and blue-tinted glass panels
4. The glass should look blue from every angle — orbit around to confirm
5. The solar overlay should still work — when "Solar on", walls tint toward amber. When off, they should be the clean grey.
6. Report: "Z-fighting fixed via [method]. Walls now light grey. Glass consistently blue-tinted from all angles. Auto-rotate smooth — no flickering on base plate. Solar overlay still functional."

---

## PART 2: Fix system type dropdowns

**File(s):** `frontend/src/components/modules/SystemsZones.jsx`

**The bug:** The library items from `/api/library/systems` have a `category` field (e.g. `"hvac"`, `"ventilation"`, `"dhw"`) but the frontend filters by `l.type` which doesn't exist.

**Fix:**
```js
// BEFORE (broken):
const items = library.filter(l => l.type === 'hvac')

// AFTER (fixed):
const items = library.filter(l => l.category === 'hvac')
```

Apply this fix for all three dropdowns: hvacOpts, ventOpts, dhwOpts.

**Commit message:** "Part 2: Fix system dropdowns — filter by category not type"

**Verify:**
1. Navigate to /systems
2. **HVAC dropdown:** Should show actual system names (e.g. "VRF System — Standard", "VRF — High Efficiency") instead of "Loading..."
3. **Ventilation dropdown:** Should show "MEV — Standard", "MVHR — Standard" etc.
4. **DHW dropdown:** Should show "Gas Boiler — DHW" etc.
5. **INTERACT:** Select a different HVAC system — it should save and the live results should update
6. Report: "Dropdowns now populated. HVAC: [X] options. Ventilation: [X] options. DHW: [X] options. Selection saves and triggers instant calc update."

---

## PART 3: Fix heating demand showing zero

**File(s):** `frontend/src/utils/instantCalc.js`

Investigate why the instant calc shows 0 MWh heating. After the solar units fix, the heat balance is:

```
heating = MAX(0, losses - gains × util_factor)
```

If gains × 0.75 > losses, heating is zero. For Bridgewater with MVHR (85% recovery), ventilation losses are very small. With good fabric and high internal + solar gains, it's plausible that the building is cooling-dominated in the instant calc.

**Check:**
1. Log `heat_losses` and `heat_gains * util_factor` — if gains > losses, heating = 0 is correct
2. Compare with EnergyPlus result — does EnergyPlus also show very low heating?
3. If the instant calc is correct (building genuinely cooling-dominated), this is fine — it just means the hotel has high internal gains relative to its losses
4. If the instant calc disagrees with EnergyPlus significantly, adjust the utilisation factor or check that the gains aren't still overweighted

**If heating is genuinely zero:** The display should show "< 1 MWh" or "Negligible" rather than "0 MWh" which looks like an error. Update the display formatting in `SystemsLiveResults.jsx` and `LiveResultsPanel.jsx`.

**If heating should NOT be zero:** Adjust the utilisation factor. The current 0.75 may be too generous for a hotel with 24-hour occupancy. Consider reducing to 0.60 (meaning less of the gains are useful for heating) or making it dependent on the building's loss/gain ratio.

**Commit message:** "Part 3: Investigate heating zero — [fix applied / display improved / util factor adjusted]"

**Verify:**
1. Check instant calc debug output: losses = [X], gains × util = [X]. If gains > losses, heating = 0 is physically reasonable.
2. If zero is correct: display should show "< 1 MWh" instead of "0 MWh"
3. If zero is wrong: adjusted util factor to [X], heating now shows [X] MWh
4. Report: "Heating [is genuinely zero because gains exceed losses / was incorrectly zero, fixed by adjusting util factor to X]. Instant calc losses: [X] kWh, gains×util: [X] kWh. Display now shows [value]."

---

## PART 4: Collapsible accordion inputs on Systems left panel

**File(s):** `frontend/src/components/modules/SystemsZones.jsx`

Replace the current flat list of system inputs with collapsible accordion sections. Each section shows a one-line summary when collapsed and expands to show all parameters.

**Accordion sections:**

1. **Simulation Mode** — always visible (not collapsible), stays at the top
2. **HVAC** — collapsed summary: "VRF Standard — COP 3.5 / EER 3.2". Expanded: system dropdown, COP slider, EER slider
3. **Ventilation** — collapsed summary: "MVHR — SFP 1.1, 85% HR". Expanded: type dropdown, SFP slider, heat recovery slider, control strategy, natural vent toggle
4. **DHW** — collapsed summary: "Gas Boiler — 60°C, No preheat". Expanded: primary system, preheat option, setpoint, estimated demand
5. **Lighting** — collapsed summary: "11 W/m² — Occupancy sensing". Expanded: LPD slider with presets, control strategy
6. **Small Power** — collapsed summary: "15 W/m²". Expanded: equipment density slider

**Interaction:**
- Click the section header to expand/collapse
- Only one section expanded at a time (clicking a new one collapses the previous) — or allow multiple open if space permits
- Chevron icon rotates on expand/collapse
- The one-line summary shows the most important parameters so the user can scan all systems without expanding

**Visual:**
- Each section has a thin left border in the teal module accent colour
- Expanded section has a subtle teal background tint
- Smooth height animation on expand/collapse (CSS transition on max-height)

**Commit message:** "Part 4: Collapsible accordion system inputs with one-line summaries"

**Verify:**
1. Navigate to /systems
2. **SCREENSHOT 1:** All sections collapsed — each showing a one-line summary. All 5 system sections visible without scrolling.
3. **INTERACT:** Click HVAC — it expands to show COP/EER sliders. Other sections stay collapsed.
4. **INTERACT:** Click Ventilation — HVAC collapses, Ventilation expands showing SFP/HR sliders.
5. The summaries should update in real time: change COP to 4.0, collapse HVAC — summary should show "COP 4.0"
6. Report: "Accordion working. 5 collapsible sections. Summaries update in real time. [Single/multiple] expand mode. All visible without scrolling when collapsed."

---

## PART 5: Systems Sankey — data model and instant calc extension

**File(s):** `frontend/src/utils/instantCalc.js`

Extend the instant calc to provide the data structure needed for the systems Sankey diagram.

Add a new `systems_flow` field to the return object:

```js
systems_flow: {
  nodes: [
    { id: 'grid',        label: 'Grid Electricity',  type: 'source',  energy_kWh: electricity_kWh },
    { id: 'gas',         label: 'Natural Gas',        type: 'source',  energy_kWh: gas_kWh },
    { id: 'vrf',         label: 'VRF',               type: 'system',  category: 'hvac' },
    { id: 'mvhr',        label: 'MVHR',              type: 'system',  category: 'ventilation' },
    { id: 'boiler',      label: 'Gas Boiler',        type: 'system',  category: 'dhw' },
    { id: 'lighting',    label: 'Lighting',          type: 'system',  category: 'lighting' },
    { id: 'small_power', label: 'Small Power',       type: 'system',  category: 'equipment' },
    { id: 'space_heat',  label: 'Space Heating',     type: 'end_use' },
    { id: 'space_cool',  label: 'Space Cooling',     type: 'end_use' },
    { id: 'dhw_del',     label: 'Hot Water',         type: 'end_use' },
    { id: 'fresh_air',   label: 'Fresh Air',         type: 'end_use' },
    { id: 'light_del',   label: 'Light',             type: 'end_use' },
    { id: 'equip_del',   label: 'Equipment Use',     type: 'end_use' },
    { id: 'heat_reject', label: 'Heat Rejection',    type: 'waste' },
    { id: 'mvhr_recov',  label: 'Recovered Heat',    type: 'recovered' },
  ],
  links: [
    // Sources → Systems
    { source: 'grid', target: 'vrf',         value_kWh: vrf_electricity },
    { source: 'grid', target: 'mvhr',        value_kWh: fan_electricity },
    { source: 'grid', target: 'lighting',    value_kWh: lighting_kWh },
    { source: 'grid', target: 'small_power', value_kWh: equipment_kWh },
    { source: 'gas',  target: 'boiler',      value_kWh: dhw_gas_kWh },

    // Systems → End uses
    { source: 'vrf',         target: 'space_heat',  value_kWh: heating_delivered },
    { source: 'vrf',         target: 'space_cool',  value_kWh: cooling_delivered },
    { source: 'vrf',         target: 'heat_reject', value_kWh: heat_rejected },
    { source: 'boiler',      target: 'dhw_del',     value_kWh: dhw_delivered },
    { source: 'mvhr',        target: 'fresh_air',   value_kWh: ventilation_air_kWh },
    { source: 'lighting',    target: 'light_del',   value_kWh: lighting_kWh },
    { source: 'small_power', target: 'equip_del',   value_kWh: equipment_kWh },

    // Inter-system connections
    { source: 'mvhr_recov',  target: 'space_heat',  value_kWh: mvhr_heat_recovery_kWh, style: 'recovered' },
  ]
}
```

**Key calculations for new fields:**

- `vrf_electricity` = heating_electricity + cooling_electricity + vrf_fan_kWh
- `heating_delivered` = heating_thermal (what the VRF delivers to the space)
- `cooling_delivered` = cooling_thermal
- `heat_rejected` = cooling_thermal + cooling_electricity (total heat rejected to outdoor air = cooling load + compressor waste heat). In reality this is COP × cooling_electricity but simplified: heat_rejected ≈ cooling_thermal × (1 + 1/EER)
- `mvhr_heat_recovery_kWh` = ventilation_loss_without_recovery - ventilation_loss_with_recovery (the heat MVHR recovers)
- If ASHP DHW preheat is enabled, add: `{ source: 'grid', target: 'boiler', value_kWh: dhw_elec_kWh, style: 'preheat' }` and `{ source: 'heat_reject', target: 'boiler', value_kWh: ashp_preheat_kWh, style: 'recovered' }` — showing the heat cascade

**Nodes and links should be conditional:**
- If ventilation is MEV (no recovery): omit `mvhr_recov` node and the recovery link
- If no gas boiler: omit `gas` source node and `boiler` system node
- If no ASHP preheat: omit the heat_reject→boiler link
- Filter out any links with value_kWh ≤ 0

**Commit message:** "Part 5: Systems flow data model in instant calc — nodes, links, inter-system connections"

**Verify:**
1. Check instant calc output includes `systems_flow` with correct structure
2. With VRF + MVHR + Gas boiler: should have grid, gas, vrf, mvhr, boiler, lighting, small_power nodes
3. With MVHR: should have mvhr_recov node and recovery link
4. With ASHP preheat: should have heat_reject→boiler link
5. With MEV: no recovery node/link
6. All link values > 0
7. Report: "Systems flow data model working. [X] nodes, [X] links for current config. Recovery link present for MVHR: [X] kWh. Heat rejection: [X] kWh. Links filter to >0 correctly."

---

## PART 6: Systems Sankey diagram — centre panel

**File(s):** `frontend/src/components/modules/systems/SystemSankey.jsx` (new), update `frontend/src/components/modules/SystemsZones.jsx`

Replace the current `SystemSchematic.jsx` with a proper Sankey-style flow diagram that uses the `systems_flow` data from the instant calc.

**Layout:**
Use d3-sankey (already in the project) with a three-column layout:
- Left: Source nodes (Grid, Gas) — coloured circles or rounded rectangles
- Centre: System nodes (VRF, MVHR, Boiler, Lighting, Small Power) — rounded rectangles with system name, key metric (COP, HR%, efficiency), and icon
- Right: End use nodes (Space Heating, Space Cooling, Hot Water, Fresh Air, Light, Equipment) — rounded rectangles

**Link styling:**
- Width proportional to energy flow (kWh)
- Electricity links: gold/amber (`#ECB01F`)
- Gas links: red-orange (`#E74C3C`)
- Heat delivery links: red (`#DC2626`) for heating, blue (`#3B82F6`) for cooling
- Recovered heat links: dashed green (`#16A34A`) — shows heat that's being recovered/reused
- Waste heat links: dashed grey (`#9E9E9E`)

**Inter-system connections (the showstopper):**
- MVHR heat recovery: a green dashed link from "MVHR" back to "Space Heating" (or from a "Recovered Heat" node), showing the ventilation heat being recovered and reused
- ASHP preheat: if enabled, a green dashed link from "VRF Heat Rejection" to "Gas Boiler" (or to a "DHW Preheat" intermediate node), showing waste heat being cascaded to DHW
- These recovered/cascaded flows are the key visual insight — they show energy being reused rather than wasted

**Labels:**
- Each link shows its value: "158 MWh" or "43%" — togglable between absolute and percentage
- Each system node shows its key metric inside: "COP 3.5", "85% HR", "92% eff"

**Responsive sizing:**
- The Sankey should fill the available centre column space
- Use a ResizeObserver (same pattern as the existing Sankey in EnergyFlowsTab) to adapt to container width

**Dynamic updates:**
- The Sankey reads from the instant calc `systems_flow` and re-renders when it changes
- Switching MEV → MVHR: the MVHR node appears with a heat recovery link; the MEV node (if it was separate) disappears
- Enabling ASHP preheat: the heat_reject→boiler cascade link appears
- Changing COP: the electricity→VRF link width changes (higher COP = less electricity for same heating)

**Header:** "Energy Flow — Systems" with "Detailed" / "MVHR" badges (showing current system mode and ventilation type)

**Commit message:** "Part 6: Systems Sankey flow diagram with proportional links and inter-system connections"

**Verify:**
1. Navigate to /systems
2. **SCREENSHOT 1:** The Sankey diagram showing energy flowing from Grid/Gas through systems to end uses. Link widths should be proportional.
3. **INTERACT:** Switch ventilation from MEV to MVHR — a heat recovery link should appear (green dashed)
4. **INTERACT:** Enable ASHP preheat — a cascade link from heat rejection to boiler should appear
5. **INTERACT:** Increase COP from 3.5 to 5.0 — the electricity→VRF link should get thinner (more efficient)
6. **INTERACT:** Switch to Ideal Loads mode — the Sankey should simplify (no system efficiencies, just direct energy)
7. **DATA CHECK:** Grid electricity total across all links should match the instant calc total. Gas should match.
8. Report: "Systems Sankey working. [X] nodes, [X] links rendered. MVHR recovery link: [X] MWh (green dashed). ASHP cascade: [visible/N/A]. COP change visibly affects link width. All energy values balance."

---

## PART 7: System nodes — detail and interaction

**File(s):** `frontend/src/components/modules/systems/SystemSankey.jsx`

Enhance the system nodes in the Sankey to be more informative and interactive.

**Node content:**
Each system node should display:
- System name (e.g. "VRF Standard")
- Key metric (e.g. "COP 3.5 / EER 3.2")
- A small icon or colour indicator for the system type
- Energy in → Energy out summary: "In: 45 MWh → Out: 158 MWh" (for heat pumps where output > input)

**Hover interaction:**
Hovering on a system node highlights all its connected links and dims everything else. This lets the user trace one system's energy flow. Show a tooltip with:
- System name and description
- Energy input (kWh)
- Energy output (kWh)
- Efficiency / COP / recovery rate
- "Edit in Library →" link

**Click interaction:**
Clicking a system node expands the corresponding accordion section in the left panel (from Part 4). This creates a direct link between the visual diagram and the input controls.

**Commit message:** "Part 7: Enhanced system nodes with hover highlighting and click-to-expand"

**Verify:**
1. **INTERACT:** Hover on VRF node — its links should highlight, others dim. Tooltip shows COP, energy in/out.
2. **INTERACT:** Hover on MVHR node — its links highlight, including the recovery link.
3. **INTERACT:** Click on VRF node — the HVAC section in the left panel should expand/scroll into view.
4. **INTERACT:** Click on Boiler node — the DHW section should expand.
5. Report: "Node hover highlighting working. Tooltips show [energy in]/[energy out]/[efficiency]. Click-to-expand links to correct accordion section."

---

## PART 8: Sankey — dynamic system changes and animation

**File(s):** `frontend/src/components/modules/systems/SystemSankey.jsx`

Make the Sankey respond smoothly to system changes.

**Transitions:**
When a parameter changes (COP slider, system type switch), the Sankey should animate:
- Link widths smoothly transition to new values (CSS transition on width)
- New nodes/links fade in (opacity 0 → 1)
- Removed nodes/links fade out (opacity 1 → 0)
- Use a 300ms transition duration

**System mode badges:**
At the top of the Sankey, show small badges indicating active configurations:
- "Detailed" (teal) or "Ideal Loads" (amber)
- "MVHR" (green) or "MEV" (grey)
- "ASHP Preheat" (green) — only if enabled
- "Natural Vent" (blue) — only if enabled

These badges give quick context about what the Sankey is showing.

**Energy balance watermark:**
Show a subtle total at the bottom: "Total site energy: 276 MWh/yr — Electricity 158 MWh (57%) / Gas 118 MWh (43%)"

**Commit message:** "Part 8: Animated Sankey transitions and system mode badges"

**Verify:**
1. **INTERACT:** Drag the COP slider — link widths should animate smoothly, not jump
2. **INTERACT:** Switch MEV → MVHR — the recovery link should fade in, the diagram should rearrange smoothly
3. **INTERACT:** Enable ASHP preheat — cascade link fades in
4. Mode badges should update correctly
5. Energy balance total should match instant calc
6. Report: "Animated transitions working. [X]ms transition on link width changes. Fade in/out for new/removed elements. Badges: [Detailed, MVHR, ASHP]. Total: [X] MWh."

---

## PART 9: Systems live results — update for consistency

**File(s):** `frontend/src/components/modules/systems/SystemsLiveResults.jsx`

Update the right panel to be consistent with the Sankey and include the same inter-system insights.

**Updates:**
1. Fix heating showing "0 MWh" — display as "< 1 MWh" or show actual decimal value if non-zero
2. Add a "System Efficiency" section:
   - VRF: "45 MWh electricity → 158 MWh heating + 32 MWh cooling" (shows the COP multiplier effect)
   - MVHR: "4 MWh fan energy → 86 MWh recovered heat" (shows the massive ratio of recovery to fan energy)
   - Boiler: "118 MWh gas → 109 MWh hot water (92% efficiency)"
3. Add an "Energy Recovery" callout if MVHR or ASHP preheat is active:
   - "MVHR recovers 86 MWh of ventilation heat — equivalent to £X/yr at current gas prices" (use 5p/kWh gas)
   - "ASHP preheat saves 35 MWh gas — reducing carbon by X kgCO₂/yr"
4. Ensure the fuel split bar matches the Sankey totals

**Commit message:** "Part 9: Systems live results — efficiency insights and recovery callouts"

**Verify:**
1. Navigate to /systems
2. The right panel should show system efficiency summaries with in → out format
3. MVHR recovery callout should show kWh and estimated cost saving
4. Fuel split should match Sankey totals
5. Report: "Systems results updated. VRF: [X] MWh in → [X] MWh delivered. MVHR recovery: [X] MWh ([£X/yr]). Fuel split: [X]% elec / [X]% gas."

---

## PART 10: Integration test — Systems module

Run a complete Systems module walkthrough:

1. Navigate to /systems — three-column layout, Sankey in centre
2. All dropdowns populated (HVAC, Ventilation, DHW)
3. Accordion sections: collapse all, verify summaries. Expand HVAC, change COP — Sankey animates
4. Switch MEV → MVHR: recovery link appears in Sankey, heating demand drops in right panel
5. Enable ASHP preheat: cascade link appears, gas fraction drops
6. Switch to Ideal Loads: Sankey simplifies, right panel shows lower EUI
7. Change LPD from 11 to 4 (LED): lighting link shrinks
8. Change equipment density: small power link changes
9. Auto-simulation triggers: verified results replace instant estimates
10. Navigate to /building: 3D model has grey walls, blue glass, no z-fighting

**SCREENSHOTS:**
1. Systems Sankey with VRF + MVHR + Gas Boiler (showing recovery link)
2. Accordion inputs — all collapsed with summaries
3. Sankey after enabling ASHP preheat (showing cascade link)
4. 3D building with grey walls and blue glass

**Commit message:** "Part 10: Full integration test — Systems Sankey, collapsible inputs, 3D fixes"

**Verify — report:**
- Z-fighting fixed: ✓/✗
- Grey walls: ✓/✗
- Blue glass: ✓/✗
- Dropdowns populated: ✓/✗
- Heating display: ✓/✗ (shows [value] not "0 MWh")
- Accordion sections: ✓/✗
- Sankey rendering: ✓/✗ with [X] nodes, [X] links
- MVHR recovery link: ✓/✗ at [X] MWh
- ASHP cascade link: ✓/✗
- Animated transitions: ✓/✗
- Click-to-expand: ✓/✗
- System efficiency callouts: ✓/✗
- Auto-simulation: ✓/✗
- Zero console errors

---

## After all 10 parts are complete

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 12 complete. Systems module overhauled — Sankey flow diagram shows energy from Grid/Gas through VRF/MVHR/Boiler to end uses with proportional link widths. MVHR heat recovery shown as green link ([X] MWh recovered). ASHP preheat cascade visible when enabled. Collapsible accordion inputs with one-line summaries. Click a system node → expands its inputs. 3D fixed — grey walls, blue glass, no z-fighting."
