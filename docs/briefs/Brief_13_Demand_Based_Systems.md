# Brief 13: Demand-Based System Assignment & Auto-Generated Sankey

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

The current Systems module treats "HVAC" as a single black box that does both heating and cooling. But real buildings have distinct systems serving distinct demands — a gas boiler for heating, a VRF for cooling, a separate gas boiler for DHW. The Sankey diagram can't show the energy story accurately until we know what serves what.

This brief restructures how systems are defined: instead of "HVAC type: VRF", the user assigns systems to energy demands. The Sankey then draws itself automatically from whatever systems are assigned.

**The six energy demands:**
1. **Space heating** — driven by fabric losses, infiltration, ventilation (from Building module)
2. **Space cooling** — driven by solar gains, internal gains (from Building module)
3. **DHW** — driven by occupancy (from Building module)
4. **Ventilation** — driven by air quality requirements
5. **Lighting** — always electric, no system assignment needed
6. **Small power** — always electric, no system assignment needed

**For each assignable demand (heating, cooling, DHW, ventilation):**
- **Primary system** (required) — handles the main load
- **Secondary system** (optional) — backup or preheat, with a percentage split
- **Tertiary system** (optional) — rare, for trivalent setups

**Waste streams shown on the Sankey:**
- Heat rejection from cooling systems (VRF, chillers) — light grey solid line
- Ventilation exhaust heat (when no MVHR) — light grey solid line
- Boiler flue losses — light grey solid line (1 - efficiency)
- These show where energy is being wasted and where recovery opportunities exist

12 parts. Do them in order.

---

## PART 1: New data model for system assignments

**File(s):** `frontend/src/context/ProjectContext.jsx`

Replace the flat `systems_config` with a demand-based structure:

```js
const DEFAULT_SYSTEMS = {
  mode: 'detailed',   // 'detailed' or 'ideal'
  
  // ── Demand assignments ──────────────────────────────────────────
  space_heating: {
    primary:   { system: 'gas_boiler_heating', share: 1.0 },
    secondary: null,   // { system: 'vrf_standard', share: 0.2 } for bivalent
    tertiary:  null,
  },
  space_cooling: {
    primary:   { system: 'vrf_standard', share: 1.0 },
    secondary: null,
    tertiary:  null,
  },
  dhw: {
    primary:   { system: 'gas_boiler_dhw', share: 1.0 },
    secondary: null,   // { system: 'ashp_dhw_preheat', share: 0.7 } for ASHP preheat
    tertiary:  null,
  },
  ventilation: {
    primary:   { system: 'mvhr_standard', share: 1.0 },
    secondary: null,
    tertiary:  null,
  },
  
  // ── Direct parameters (not demand-assigned) ─────────────────────
  lighting_power_density: 8,
  lighting_control: 'occupancy_sensing',
  equipment_power_density: 15,
  natural_ventilation: true,
  window_opening_threshold: 22,
}
```

**System library items** should each declare:
- `fuel_type`: 'electricity' | 'gas' | 'renewable'
- `serves`: 'heating' | 'cooling' | 'heating_and_cooling' | 'dhw' | 'ventilation'
- `efficiency_type`: 'cop' | 'eer' | 'thermal_efficiency' | 'sfp' | 'heat_recovery'
- `efficiency_value`: the rated efficiency
- `has_heat_rejection`: boolean (true for VRF cooling, chillers)
- `has_exhaust_waste`: boolean (true for MEV, boiler flue)

**Migration:** The existing flat `systems_config` (with `hvac_type`, `ventilation_type`, `dhw_primary`, etc.) needs to be migrated to the new structure. Write a migration function in ProjectContext that converts old format to new format on load. Map the old values:
- `hvac_type: 'vrf_standard'` → `space_heating.primary = vrf_standard, space_cooling.primary = vrf_standard`
- `ventilation_type: 'mvhr_standard'` → `ventilation.primary = mvhr_standard`
- `dhw_primary: 'gas_boiler_dhw'` + `dhw_preheat: 'ashp_dhw'` → `dhw.primary = gas_boiler_dhw, dhw.secondary = ashp_dhw_preheat`

**Commit message:** "Part 1: Demand-based system assignment data model with migration from flat config"

**Verify:**
1. Open the app — existing Bridgewater project should load without errors
2. Check browser console — the migration should silently convert old format to new
3. Check ProjectContext state (via React DevTools or console log): systems should have the new structure
4. The auto-save should persist the new structure to the database
5. Report: "Data model migrated. Old hvac_type='vrf_standard' → space_heating.primary=vrf_standard, space_cooling.primary=vrf_standard. Old dhw_primary + preheat → dhw with primary and secondary. No data loss."

---

## PART 2: System library — heating-specific and cooling-specific items

**File(s):** `nza_engine/library/systems.py`, `api/db/database.py`

Extend the system library to include heating-specific and cooling-specific options. Currently the library has "VRF Standard" which does both heating and cooling. We need items that can serve individual demands:

**New/updated library items:**

Heating systems:
- `gas_boiler_heating` — Gas condensing boiler for space heating. Fuel: gas. Efficiency: 92%. Serves: heating.
- `vrf_heating` — VRF in heating mode. Fuel: electricity. SCOP: 3.5. Serves: heating. Has heat rejection: no (heating mode absorbs heat).
- `electric_panel` — Direct electric panel heaters. Fuel: electricity. Efficiency: 100%. Serves: heating. (Baseline comparison)
- `ashp_heating` — Air source heat pump. Fuel: electricity. SCOP: 3.2. Serves: heating.

Cooling systems:
- `vrf_cooling` — VRF in cooling mode. Fuel: electricity. SEER: 3.2. Serves: cooling. Has heat rejection: yes.
- `split_system` — Split AC system. Fuel: electricity. SEER: 2.8. Serves: cooling. Has heat rejection: yes.
- `none_cooling` — No mechanical cooling (natural ventilation only). Serves: cooling.

Combined systems (can serve both):
- `vrf_standard` — VRF doing both heating and cooling. Update metadata: serves: heating_and_cooling. SCOP: 3.5, SEER: 3.2. Has heat rejection: yes (in cooling mode).

DHW systems:
- `gas_boiler_dhw` — existing. Fuel: gas. Efficiency: 92%.
- `ashp_dhw_preheat` — ASHP preheat stage. Fuel: electricity. COP: 2.8. Serves: dhw (preheat to 45°C).
- `electric_immersion` — Direct electric DHW. Fuel: electricity. Efficiency: 100%.
- `solar_thermal_dhw` — Solar thermal preheat. Fuel: renewable. Serves: dhw.

Ventilation systems:
- `mev_standard` — existing. Fuel: electricity. SFP: 0.8 W/(l/s). Heat recovery: 0%.
- `mvhr_standard` — existing. Fuel: electricity. SFP: 1.2 W/(l/s). Heat recovery: 85%. Has exhaust waste: no (heat is recovered).
- `natural_ventilation` — No mechanical system. SFP: 0. Serves: ventilation.

Each item should have a `serves` field and a `fuel_type` field. Seed these into the library via init_db.

**Also rename COP/EER labels:**
- Heating systems: label as "SCOP" (Seasonal COP) not "COP"
- Cooling systems: label as "SEER" (Seasonal EER) not "EER"
- These are the correct industry terms for seasonal performance.

**Commit message:** "Part 2: Expanded system library with heating, cooling, DHW, ventilation categories and SCOP/SEER labels"

**Verify:**
1. Restart backend (seeds new items)
2. `curl http://127.0.0.1:8002/api/library/systems` — should list all new items
3. Each item should have `serves`, `fuel_type`, and efficiency fields
4. Report: "Library expanded. Heating: [X] items. Cooling: [X] items. DHW: [X] items. Ventilation: [X] items. Combined: [X] items. All have serves/fuel_type fields."

---

## PART 3: Left panel — demand-based input layout

**File(s):** `frontend/src/components/modules/SystemsZones.jsx`

Rewrite the left panel to organise inputs by demand rather than by system type.

**New accordion sections:**

1. **Simulation Mode** — always visible (Detailed / Ideal Loads toggle)

2. **Space Heating** — collapsed summary: "Gas Boiler (92% eff) — 100%"
   - Primary system dropdown (filtered to items where `serves` includes 'heating' or 'heating_and_cooling')
   - Primary share slider (50-100%, default 100%)
   - Key parameter for primary (efficiency/SCOP, shown inline)
   - "+ Add secondary" button → reveals secondary dropdown and share slider
   - If secondary added: share sliders auto-balance (primary 80% + secondary 20% = 100%)
   - If primary is a combined system (VRF), note: "Also serving Space Cooling"

3. **Space Cooling** — collapsed summary: "VRF Standard (SEER 3.2) — 100%"
   - Same pattern as heating
   - If the same VRF is assigned to both heating and cooling, show a "Linked to Space Heating" note
   - "None" option available (natural ventilation only)

4. **DHW** — collapsed summary: "Gas Boiler (92%) + ASHP preheat (COP 2.8)"
   - Primary dropdown (filtered to DHW-capable items)
   - Secondary dropdown (for preheat — filtered to DHW preheat items)
   - If secondary is ASHP preheat, show the split: "ASHP heats 10→45°C, Boiler tops up 45→60°C"
   - Setpoint temperature input (default 60°C, min 55°C for Legionella)

5. **Ventilation** — collapsed summary: "MVHR (SFP 1.2, 85% HR)"
   - System dropdown (MEV, MVHR, Natural)
   - SFP slider + number input (range 0-3)
   - Heat recovery slider (only visible for MVHR, range 0-95%)
   - Control strategy dropdown (Continuous / Occupied / Timer)
   - Natural ventilation toggle + threshold

6. **Lighting** — collapsed summary: "8 W/m² — Occupancy sensing"
   - LPD slider with presets
   - Control strategy dropdown

7. **Small Power** — collapsed summary: "15 W/m²"
   - Equipment density slider

**Combined system handling:**
When VRF is assigned to Space Heating, automatically offer it as an option for Space Cooling too. If the user selects VRF for both, show them as linked. If they select VRF for heating but a different system for cooling, that's fine — it means the VRF only operates in heating mode.

**Commit message:** "Part 3: Demand-based accordion inputs with primary/secondary system assignment"

**Verify:**
1. Navigate to /systems
2. **SCREENSHOT 1:** All sections collapsed showing demand-based summaries
3. **INTERACT:** Expand Space Heating — dropdown should show gas boiler, VRF, ASHP, electric panel options
4. **INTERACT:** Select gas boiler for heating, VRF for cooling — these should be separate systems
5. **INTERACT:** Click "+ Add secondary" on heating — a secondary dropdown appears with share slider
6. **INTERACT:** On DHW, select gas boiler primary + ASHP preheat secondary — summary should show both
7. **INTERACT:** Collapse all — summaries should accurately reflect selections
8. Report: "Demand-based inputs working. Heating: [system]. Cooling: [system]. DHW: [primary + secondary]. Ventilation: [system]. Secondary assignment with share slider working."

---

## PART 4: Update instant calc for demand-based assignments

**File(s):** `frontend/src/utils/instantCalc.js`

Update the instant calc to read from the new demand-based system assignment structure.

For each demand:
1. Look up the primary system's properties from the library (fuel type, efficiency)
2. If a secondary exists, split the demand by share percentages
3. Calculate fuel consumption for each system serving each demand:
   ```
   fuel_kWh = demand_kWh × share / efficiency
   ```
4. Track electricity and gas separately

**Heating calculation:**
```js
const heating_demand = /* existing thermal demand from fabric balance */
const primary = systems.space_heating.primary
const primary_sys = lookupSystem(primary.system, libraryData)
const primary_fuel = heating_demand * primary.share / primary_sys.efficiency

if (systems.space_heating.secondary) {
  const sec = systems.space_heating.secondary
  const sec_sys = lookupSystem(sec.system, libraryData)
  const sec_fuel = heating_demand * sec.share / sec_sys.efficiency
  // Add to appropriate fuel bucket (electricity or gas)
}
```

**Cooling calculation:** Same pattern, using SEER.

**DHW calculation:**
- If primary is gas boiler + secondary is ASHP preheat:
  - ASHP handles: demand × preheat_fraction × secondary_share / ashp_cop → electricity
  - Boiler handles: demand × topup_fraction × primary_share / boiler_eff → gas

**Waste streams:**
- Heat rejection = cooling_demand × (1 + 1/SEER) — total heat dumped to outdoor air
- Ventilation exhaust = ventilation_heat_loss × (1 - heat_recovery_efficiency) — heat blown out
- Boiler flue loss = gas_input × (1 - efficiency) — heat up the chimney

**Update systems_flow** to use the new assignments:
- Nodes are generated from whatever systems are assigned (not hardcoded)
- Links are generated from the demand → system → fuel chain
- Waste nodes are generated for systems with heat_rejection or exhaust_waste

**Commit message:** "Part 4: Instant calc reads demand-based assignments with multi-system splits"

**Verify:**
1. Set heating = gas boiler (92%), cooling = VRF (SEER 3.2), DHW = gas boiler
2. Check instant calc: heating fuel should be gas, cooling fuel should be electricity, DHW should be gas
3. Set heating = VRF (SCOP 3.5) — heating fuel should switch to electricity
4. Add secondary heating = gas boiler at 20% — 80% of heating from VRF (electricity), 20% from gas boiler (gas)
5. Waste streams: heat rejection from VRF cooling should be non-zero
6. Report: "Instant calc using demand-based assignments. Gas boiler heating: [X] kWh gas. VRF heating: [X] kWh elec. Bivalent split 80/20: [X] kWh elec + [X] kWh gas. Heat rejection: [X] kWh. Ventilation exhaust: [X] kWh."

---

## PART 5: Auto-generated Sankey from assignments

**File(s):** `frontend/src/components/modules/systems/SystemSankey.jsx`

Rewrite the Sankey to auto-generate its nodes and links from the `systems_flow` data in the instant calc. No hardcoded system nodes.

**Node generation rules:**
- For each unique fuel type used: create a source node (Grid Electricity, Natural Gas)
- For each system assigned to any demand: create a system node
- For each demand with non-zero energy: create an end-use node
- For each system with heat rejection: create a waste node ("VRF Heat Rejection")
- For each system with exhaust waste: create a waste node ("Ventilation Exhaust")
- For boilers: create a flue loss waste node

**Link generation rules:**
- Source → System: fuel input link (width = fuel kWh consumed)
- System → End use: energy delivered link (width = demand kWh served)
- System → Waste: rejection/exhaust link (width = waste kWh)
- System → System: if one system's waste feeds another (ASHP preheat from heat rejection), create an inter-system link

**Link colours:**
- Electricity: gold (`#ECB01F`)
- Gas: orange-red (`#E74C3C`)
- Heating delivered: red (`#DC2626`)
- Cooling delivered: blue (`#3B82F6`)
- DHW delivered: orange (`#F97316`)
- Ventilation: cyan (`#06B6D4`)
- Light: yellow (`#F59E0B`)
- Equipment: slate (`#64748B`)
- **Waste/rejection: light grey solid (`#D4D4D4`)** — NOT dashed, just a subtle light grey solid line that clearly reads as "this energy goes nowhere useful"
- **Recovered/cascaded: green solid (`#16A34A`)** — shows energy being reused between systems

**When systems change:**
- Switch heating from VRF to gas boiler: the electricity→VRF→heating chain disappears, replaced by gas→boiler→heating
- Add ASHP DHW secondary: a green link appears from electricity to ASHP, and the gas→boiler link thins (less gas needed)
- Switch MVHR to MEV: the heat recovery link disappears, replaced by a light grey "Ventilation Exhaust" waste link showing the heat being thrown away

**Commit message:** "Part 5: Auto-generated Sankey from demand-based system assignments"

**Verify:**
1. **Config A:** Gas boiler heating, VRF cooling, gas boiler DHW, MVHR
   - Sankey should show: Gas → Boiler → Space Heating, Grid → VRF → Space Cooling, Gas → DHW Boiler → Hot Water, Grid → MVHR → Fresh Air
   - VRF should have heat rejection waste link
   - MVHR should show recovered heat (no exhaust waste)
2. **Config B:** VRF heating AND cooling, gas boiler DHW, MEV
   - VRF should have links to BOTH heating and cooling
   - MEV should have a light grey exhaust waste link (no recovery)
3. **Config C:** VRF heating+cooling, gas boiler DHW with ASHP preheat, MVHR
   - ASHP preheat should show as a separate node with green recovered link from electricity
   - Gas boiler DHW link should be thinner (ASHP handles the preheat portion)
4. **SCREENSHOT:** Config A showing the gas/electric split with waste streams
5. Report: "Auto-generated Sankey working. Config A: [X] nodes, [X] links. Config B: [X] nodes. Config C: [X] nodes with ASHP preheat cascade. Waste streams: heat rejection [X] MWh, ventilation exhaust [X] MWh (for MEV). All links auto-generated from assignments."

---

## PART 6: Sankey — waste streams and recovery opportunities

**File(s):** `frontend/src/components/modules/systems/SystemSankey.jsx`

Polish the waste and recovery visualisation.

**Waste stream styling:**
- Light grey solid lines (`#D4D4D4`, opacity 0.6) — clearly read as "wasted energy"
- Waste nodes positioned at the far right, below the useful end-use nodes
- Each waste node shows its value: "Heat Rejection: 45 MWh"
- Waste nodes have a light grey background

**Recovery opportunity callouts:**
When waste energy exists that COULD be recovered but ISN'T currently:
- Show a subtle dashed green outline around the waste node
- Add a small "?" icon or "Recovery possible" label
- Hovering shows: "This heat rejection could preheat DHW — add ASHP secondary to DHW"
- This is the consultancy insight — showing the client where they're wasting energy and what they could do about it

**Specifically:**
- VRF heat rejection exists + no ASHP DHW preheat → show "Recovery opportunity: DHW preheat"
- MEV exhaust waste exists + not using MVHR → show "Recovery opportunity: Heat recovery ventilation"
- Boiler flue losses → show value but no recovery suggestion (not practical for most buildings)

**Ventilation exhaust handling:**
- If MVHR: show "Recovered Heat: [X] MWh" as a green link. Show small residual exhaust as light grey (the 15% not recovered).
- If MEV: show the full ventilation heat loss as a light grey exhaust waste link. This should be thick — it's a significant waste stream. It makes the case for MVHR visually obvious.

**Commit message:** "Part 6: Waste streams and recovery opportunity callouts on Sankey"

**Verify:**
1. With MEV ventilation: a thick light grey "Ventilation Exhaust" waste link should be visible
2. Switch to MVHR: the exhaust waste largely disappears, replaced by a green recovery link
3. With VRF cooling but no ASHP DHW: heat rejection waste should show "Recovery possible" hint
4. Enable ASHP DHW preheat: heat rejection shrinks, green cascade link to DHW appears
5. The visual difference between MEV and MVHR should be striking — MEV shows a fat grey waste stream, MVHR shows a green recovery stream
6. Report: "Waste streams showing. MEV exhaust: [X] MWh (thick grey). MVHR recovery: [X] MWh (green). Heat rejection: [X] MWh with recovery hint. Switching MEV→MVHR visually dramatic — waste stream becomes recovery stream."

---

## PART 7: Left panel — system parameter overrides

**File(s):** `frontend/src/components/modules/SystemsZones.jsx`

When a system is selected for a demand, show its key editable parameters inline (without needing to go to the library).

**For each assigned system, show:**
- The system name and a "Library →" link to view/edit the full library item
- The key efficiency parameter as an editable slider:
  - Gas boiler: "Seasonal efficiency" slider (80-98%, step 1%)
  - VRF heating: "SCOP" slider (2.0-6.0, step 0.1)
  - VRF cooling: "SEER" slider (2.0-6.0, step 0.1)
  - ASHP: "SCOP" slider (2.0-5.0, step 0.1)
  - MVHR: "Heat recovery" slider (0-95%, step 1%) + "SFP" slider (0-3, step 0.1)
  - MEV: "SFP" slider (0-3, step 0.1)

These overrides are stored per-project (not in the library). They let the user say "I know the manufacturer states SCOP 4.2 for this specific unit" without modifying the generic library template.

**The pattern:**
```
Space Heating          Gas Boiler (92% eff) ▸
├── Seasonal eff:  ═══●═══  92%
└── + Add secondary
```

Clicking the ▸ chevron or "Library →" link opens the full library item detail.

**Commit message:** "Part 7: Inline system parameter overrides with SCOP/SEER labels"

**Verify:**
1. Select gas boiler for heating — efficiency slider should appear showing 92%
2. Drag efficiency to 85% — instant calc should update (more gas consumed)
3. Select VRF for cooling — SEER slider should appear (not "EER")
4. The override value should persist through page refresh
5. Report: "Inline overrides working. Boiler efficiency adjustable (85-98%). VRF SCOP/SEER sliders. Values persist. Instant calc responds to changes."

---

## PART 8: Update EnergyPlus assembler for demand-based assignments

**File(s):** `nza_engine/generators/epjson_assembler.py`, update `api/routers/projects.py`

Update the EnergyPlus assembler to read the new demand-based system structure.

**Mapping demand assignments to EnergyPlus objects:**
- Space heating = gas boiler → use `ZoneHVAC:Baseboard:RadiantConvective:Water` + `Boiler:HotWater` objects
- Space heating = VRF → use the existing PTHP objects in heating mode
- Space cooling = VRF → use the existing PTHP objects in cooling mode
- Space cooling = none → remove cooling coil from zone equipment
- DHW = gas boiler → existing `WaterHeater:Mixed` with NaturalGas
- DHW = gas boiler + ASHP preheat → existing dual-stage setup
- Ventilation = MVHR → existing `ZoneHVAC:EnergyRecoveryVentilator`
- Ventilation = MEV → existing extract ventilation setup

**For bivalent systems (primary + secondary):**
This is complex in EnergyPlus. For feasibility accuracy, use a simplified approach:
- Model only the primary system in EnergyPlus
- Apply a correction factor to the results based on the share split
- Document this as an approximation: "Secondary system share applied as a post-processing correction"

**Handle the API:**
- Ensure the project PUT endpoint accepts and persists the new systems structure
- The simulate endpoint should read from the new structure

**Commit message:** "Part 8: EnergyPlus assembler reads demand-based system assignments"

**Verify:**
1. Set heating = gas boiler, cooling = VRF. Run simulation.
2. Results should show gas consumption for heating and electricity for cooling
3. Set heating = VRF. Run simulation. Heating should now be electricity.
4. Check `.err` file: zero fatal errors
5. Report: "Assembler updated. Gas boiler heating: [X] kWh gas. VRF heating: [X] kWh elec. Cooling: [X] kWh elec. DHW: [X] kWh gas. Zero fatal errors."

---

## PART 9: Sankey hover interaction and node detail

**File(s):** `frontend/src/components/modules/systems/SystemSankey.jsx`

Restore and enhance the hover interaction from Brief 12:

**Hover on a system node:**
- Highlight all connected links (full opacity), dim everything else (0.1 opacity)
- Show tooltip: system name, fuel type, energy in, energy out, efficiency, waste
- For VRF: "Grid → 45 MWh electricity → VRF (SCOP 3.5) → 158 MWh heating. Heat rejection: 12 MWh"
- 300ms smooth transitions

**Hover on a link:**
- Highlight that link and its source/target nodes
- Show tooltip: "[X] MWh [fuel/energy type] from [source] to [target]"

**Hover on a waste node:**
- Highlight the waste link
- If recovery is possible, show the recovery suggestion prominently

**Click on a system node:**
- Expand the corresponding demand section in the left accordion
- Scroll it into view if needed

**Commit message:** "Part 9: Sankey hover highlighting with efficiency tooltips and click-to-expand"

**Verify:**
1. Hover on VRF node — connected links highlight, tooltip shows SCOP and energy in/out
2. Hover on a waste node — shows waste amount and recovery suggestion if applicable
3. Click on boiler node — DHW section in left panel expands
4. Report: "Hover interaction working. Tooltips show [in]/[out]/[efficiency]. Click-to-expand links to correct demand section."

---

## PART 10: Animated transitions when systems change

**File(s):** `frontend/src/components/modules/systems/SystemSankey.jsx`

Smooth transitions when the user changes system assignments:

- Link widths animate over 300ms (CSS transition)
- New nodes/links fade in (opacity 0→1 over 300ms)
- Removed nodes/links fade out (opacity 1→0 over 300ms)
- When switching from MEV to MVHR: the grey exhaust waste fades out, the green recovery link fades in — this should feel like "the waste is being captured"

**Mode badges** at the top of the Sankey:
- Current mode: "Detailed" (teal) or "Ideal" (amber)
- Active recovery: "MVHR ✓" (green) or "MEV" (grey)
- Active preheat: "ASHP Preheat ✓" (green) — only if enabled
- Total site energy watermark at bottom

**Commit message:** "Part 10: Animated Sankey transitions and mode badges"

**Verify:**
1. Switch MEV → MVHR — exhaust waste fades out, recovery fades in smoothly
2. Change SCOP slider — link widths animate
3. Enable ASHP preheat — cascade link fades in
4. Mode badges update correctly
5. Report: "Animated transitions working. MEV→MVHR transition visually compelling — waste becomes recovery. Badges: [list]. Total: [X] MWh."

---

## PART 11: Right panel — updated system efficiency insights

**File(s):** `frontend/src/components/modules/systems/SystemsLiveResults.jsx`

Update the right panel to reflect the demand-based assignments.

**Energy by demand** (replacing "Energy by end use"):
- Show each demand with its assigned system and fuel:
  - "Space Heating: 45 MWh (Gas Boiler, gas)" or "Space Heating: 13 MWh (VRF, electricity)"
  - "Space Cooling: 32 MWh (VRF, electricity)"
  - "DHW: 109 MWh (Gas Boiler, gas)" or "DHW: 78 MWh gas + 12 MWh elec (Gas Boiler + ASHP)"
  - "Ventilation: 4 MWh (MVHR, electricity)"

**Efficiency summary:**
For each system, show the multiplier effect:
- "Gas Boiler: 45 MWh gas → 41 MWh heating (92% efficient, 4 MWh flue loss)"
- "VRF Cooling: 10 MWh electricity → 32 MWh cooling removed (SEER 3.2, 42 MWh rejected)"
- "MVHR: 4 MWh fans → 71 MWh heat recovered (18:1 energy ratio)"

**Recovery callouts** (if applicable):
- "MVHR saves [X] MWh/yr — £[X]/yr at [5p/kWh gas]"
- "ASHP preheat saves [X] MWh gas — [X] tCO₂/yr avoided"

**Waste summary:**
- "Total waste: [X] MWh — [X] MWh recoverable"

**Commit message:** "Part 11: Right panel with demand-based energy breakdown and efficiency insights"

**Verify:**
1. Right panel shows each demand with system and fuel type
2. Efficiency summaries show in→out for each system
3. Recovery callouts present when MVHR/ASHP active
4. Waste summary shows total and recoverable
5. Report: "Right panel updated. Heating: [system] at [X] MWh. Cooling: [system] at [X] MWh. MVHR recovery: [X] MWh (£[X]/yr). Total waste: [X] MWh."

---

## PART 12: Full integration test

Complete walkthrough with 3 different system configurations:

**Config 1 — Gas boiler heating, VRF cooling, gas DHW, MEV:**
- Should show gas for heating and DHW, electricity for cooling and ventilation
- MEV should have thick grey exhaust waste link
- VRF should have heat rejection waste
- Recovery hints on both waste streams

**Config 2 — VRF heating + cooling, gas DHW + ASHP preheat, MVHR:**
- VRF serves both heating and cooling
- ASHP preheat cascade link visible (green)
- MVHR recovery link visible (green)
- Less total waste than Config 1

**Config 3 — Gas boiler heating (80%) + VRF backup (20%), VRF cooling, gas DHW, MVHR:**
- Bivalent heating with share split
- Gas boiler link thick (80%), VRF heating link thin (20%)
- Both systems visible on the Sankey

**SCREENSHOTS:**
1. Config 1 Sankey showing gas/electric split with MEV waste
2. Config 2 Sankey showing MVHR recovery and ASHP cascade
3. Config 3 Sankey showing bivalent heating split
4. Left panel with demand-based accordion
5. Right panel efficiency insights

**Commit message:** "Part 12: Full integration test — 3 system configurations compared"

**Verify — report table:**

| Config | Heating System | Cooling | DHW | Ventilation | EUI (kWh/m²) | Gas (MWh) | Elec (MWh) | Waste (MWh) |
|--------|---------------|---------|-----|-------------|-------------|-----------|------------|-------------|
| 1 | Gas boiler | VRF | Gas boiler | MEV | | | | |
| 2 | VRF | VRF | Gas+ASHP | MVHR | | | | |
| 3 | Boiler 80%+VRF 20% | VRF | Gas boiler | MVHR | | | | |

- Config 2 should have lowest waste (MVHR + ASHP recovery)
- Config 1 should have highest waste (MEV exhaust + no preheat)
- Zero console errors across all configs

---

## After all 12 parts are complete

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 13 complete. Systems module restructured around energy demands — assign systems to heating, cooling, DHW, ventilation independently. Sankey auto-generates from whatever systems you assign. Gas boiler heating shows gas flow; switch to VRF and it becomes electricity. MVHR recovery appears as green link. MEV shows thick grey exhaust waste. ASHP preheat cascade visible. Three configs tested — waste ranges from [X] MWh (Config 1, no recovery) to [X] MWh (Config 2, full recovery)."
