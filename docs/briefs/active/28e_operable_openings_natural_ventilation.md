# Brief 28e — Operable windows, doors, and natural ventilation

**Status:** Draft
**Author:** Chris (with Claude Chat)
**Date opened:** 2026-05-16
**Builds on:** Brief 28k (heat loss setpoint convention), Brief 28L (BRUKL ingestion + dual-engine validation) — both CLOSED.
**Validation evidence:** `Bridgewater_Bottom_Up_Energy_Model.xlsx` (project root, to be updated in parallel) + EnergyPlus dual-engine comparison.

---

## Background

The engine currently models two kinds of envelope openings:

1. **Permanent louvres** (`params.openings.{face}.louvre_area_m2`) — always-open envelope holes, configured in BuildingDefinition. Wind-driven flow via BS 5925: `Q = Cd × A × √Cw × v_wind`.
2. **Operable glazing fraction** (`params.openings.{face}.openable_fraction`) — per-facade fraction of glazing area that can open, with a building-wide schedule (never / occupied / summer_day / always). Configured in OperationModule. Wind-only flow, no stack effect, schedule is all-or-nothing.

This is insufficient for three real workflows:

- **Doors aren't modelled at all.** Bridgewater's ground floor entrance — a real opening that affects ventilation when held open — can't be represented except by abusing the louvre or openable-glazing fields. Both lose physical meaning.
- **The schedule is global**, not per-opening. A real building has different openings on different schedules: entrance door 09-18, bedroom windows during summer night purge, BMS-controlled dampers above 24°C zone temperature, etc.
- **The physics is wind-only.** Stack-driven flow (buoyancy from indoor/outdoor ΔT through tall openings) is missing. For entrance doors with 2m+ height, stack contribution can match or exceed wind during calm summer days — exactly when natural ventilation matters most.

Brief 28e adds operable openings as a properly-modelled envelope feature: per-opening definition, three control modes (permanent / scheduled / temperature-triggered), and combined wind+stack physics per CIBSE AM10 / EN 16798-7.

Even though Bridgewater's bedroom windows don't open in reality, the engine needs operable openings to model:
- "What if a 2 × 2 m entrance door is propped open during business hours?"
- "What if we add openable windows to bedrooms for summer night purge?"
- "What if BMS-controlled vents open when zone exceeds 22°C?"

These are real intervention questions for the existing-buildings retrofit market.

---

## Scope

### In scope

**Part A — Engine: opening list schema + physics**

1. New schema field on `building_config`:
   ```
   building_config.operable_openings: [
     {
       id: 'gf_entrance_door',           // stable id, used for UI selection
       name: 'Main entrance door',        // user-visible label
       facade: 'south',                   // north | east | south | west
       area_m2: 4.0,                      // total open area when open
       height_m: 2.0,                     // stack effect lever arm (top minus bottom)
       discharge_coefficient: 0.6,        // Cd, default 0.6
       wind_coefficient: 0.25,            // Cw, default per BS 5925 for opening type
       opening_type: 'door',              // door | window | vent (UI hint only, no physics impact)
       parent_glazing_face: null,         // optional: 'north'..'west' — if set, this opening
                                          // consumes openable_fraction from that facade's glazing
                                          // (i.e., "operable windows on F1"); for doors leave null
                                          // (doors are extra envelope area, not part of glazing)
       control: {
         mode: 'permanent' | 'scheduled' | 'temperature',
         // For 'scheduled':
         schedule_ref: 'business_hours',  // names a schedule in the project schedule library
         // For 'temperature':
         open_above_zone_c: 22.0,         // open when zone temperature exceeds this
         hysteresis_c: 1.0,               // re-close when zone drops below (open - hysteresis)
         require_outside_cooler: true,    // physically-sane gate: only open if T_out < T_zone
         schedule_ref: 'business_hours',  // optional: scheduled-AND-temperature combined mode
       },
     },
     ...
   ]
   ```

2. New engine math in `_calculateEnvelopeOnly` and `_calculateState2`:

   Per opening, per hour:
   ```
   is_open = evaluate_control(opening.control, hour, T_zone, T_out)
   if is_open:
     dT_abs = |T_zone − T_out|
     Q_wind  = Cd × A × √(Cw × v_wind²)
     Q_stack = Cd × A × √(2 × g × h × dT_abs / T_avg_K)
     Q_open  = √(Q_wind² + Q_stack²)         // combined wind+stack per EN 16798-7
     UA_open = ρ_air × Cp_air × Q_open / 1000  // W/K
     heat_loss_h = UA_open × max(0, T_heat − T_out)
     cool_gain_h = UA_open × max(0, T_out − T_cool)
   else:
     heat_loss_h = 0
     cool_gain_h = 0
   ```

   Each opening accumulates its own line in:
   ```
   losses_at_setpoint.natural_ventilation: [
     { id, name, facade, area_m2, height_m, mode,
       open_hours, heat_loss_kwh, cool_gain_kwh,
       avg_flow_when_open_l_s, avg_dT_when_open_k }
   ]
   ```

   Each line included in `H_weather` / `C_weather` for the shoulder gate test (these are weather-driven losses tracking T_out, same convention as mechanical ventilation lines).

3. **Backward compatibility migration.** The existing `params.openings.{face}.openable_fraction` field and `params.openings.schedule` field continue to work — on engine init, if `operable_openings` is absent but the legacy fields are present, the engine synthesises one operable_openings entry per facade with `parent_glazing_face = face`, area derived from `openable_fraction × glazing[face]`, height from facade height, control mode `scheduled` referencing the legacy schedule mapping. Legacy fields then deprecated but not removed.

4. **For doors**, the `parent_glazing_face` is null, so doors don't consume openable_fraction. They add net opening area beyond glazing. The opening's `area_m2` is the door area.

**Part B — UI: OperationModule expansion with bidirectional 3D selection**

5. **OperationModule rewrite** (`frontend/src/components/modules/OperationModule.jsx`):
   - Section "Operable openings" replaces the current per-facade `openable_fraction` sliders
   - Lists all entries in `building_config.operable_openings` as collapsible rows
   - "Add door" / "Add operable window bank" / "Add vent" buttons append new entries with sensible defaults
   - Each row exposes: name, facade dropdown, area, height, discharge coefficient (advanced/collapsed), wind coefficient (advanced/collapsed), control mode dropdown, schedule selector (when scheduled), temperature threshold + hysteresis (when temperature-triggered)
   - Removing a row deletes the entry
   - Legacy `openable_fraction` UI is removed; on load, migration synthesises entries (Part A point 3)
   - **Building tab keeps permanent louvres only** — they remain "always-open envelope geometry," distinct from operable

6. **Bidirectional 3D selection state:**
   - New context state: `selectedOpeningId` (string | null) and `selectedFacade` (string | null), in ProjectContext or a dedicated UI context
   - Clicking an opening row in OperationModule sets `selectedOpeningId`; the row visually marks selected
   - Clicking elsewhere clears it
   - 3D viewer (`BuildingViewer3D.jsx`) reads `selectedOpeningId` and `selectedFacade`:
     - When `selectedOpeningId` is set: identify the opening's facade and (if applicable) parent glazing; highlight that opening
     - When `selectedFacade` is set without `selectedOpeningId`: highlight the whole facade
     - Highlight visuals:
       - **Glazing on selected facade**: bold colour (e.g., bright cyan or coral — pick at implementation; non-subtle, must read clearly against the existing palette)
       - **Wall on selected facade**: subtler colour shift (warm tint or saturation bump — present but secondary to glazing)
       - **Selected door** (or specific opening): outlined rectangle on the facade at approximate location, same bold colour as glazing
       - Non-selected elements render normally
   - **Reverse direction**: clicking a window/door rectangle in the 3D viewer sets `selectedOpeningId` to the matching opening (or `selectedFacade` if user clicks an opaque part of a facade). The OperationModule row for that opening scrolls into view + expands

7. **3D viewer extensions** (`BuildingViewer3D.jsx`):
   - Existing facade hover/click infrastructure (raycast against BoxGeometry materialIndex) extended to:
     - Identify individual window rectangles within a facade (use existing window mesh data if present, or compute from WWR + glazing distribution)
     - Identify door rectangles for openings with `opening_type: 'door'` (rendered as thin rectangles on the facade)
   - Each clickable element carries its `opening_id` (or `facade_key` for opaque facade area)
   - Highlight rendering: emissive material or colour swap on the selected element, with subtle pulse/glow to draw the eye
   - Doors rendered as 2D rectangles inset slightly from the facade surface (not full 3D geometry — geometry simplification consistent with current single-zone approach)

**Part C — Bridgewater seed**

8. Seed `building_config.operable_openings` with one entry for Bridgewater:
   ```
   {
     id: 'gf_entrance_door',
     name: 'Main entrance door (south)',
     facade: 'south',
     area_m2: 4.0,                // 2m × 2m door (one realistic V1 entry)
     height_m: 2.0,
     discharge_coefficient: 0.6,
     wind_coefficient: 0.25,       // BS 5925 typical sheltered/open door
     opening_type: 'door',
     parent_glazing_face: null,
     control: {
       mode: 'scheduled',
       schedule_ref: 'business_hours_09_18_weekdays',
       open_above_zone_c: 22.0,    // unused for 'scheduled' but pre-populated
       hysteresis_c: 1.0,
       require_outside_cooler: true,
     },
   }
   ```

   No other entries. Bedroom windows stay fixed (real Bridgewater). Permanent louvres stay at the 1.76 m² already configured.

9. **Add `business_hours_09_18_weekdays` schedule** to the schedule library if not already present: 1.0 from 09:00-18:00 Mon-Fri, 0.0 otherwise. Standard schedule shape; mirrors office occupancy except weekdays-only.

**Part D — Validation**

10. **Hand-calc spreadsheet**:
    - New ventilation line "Operable openings (natural ventilation)" added to `05_Heat_Loss` and `08_Heat_Balance`
    - Hourly precompute (Python) integrates the combined wind+stack flow for the entrance door, with business-hours schedule, against the same EPW
    - Expected annual heat loss for the door at 21°C setpoint: order ~5-15 MWh (back-of-envelope: 0.6 × 4 m² × ~1 m/s effective × 1.2 × 1005 × 8 hr/day × 230 days × ~5K ΔT ≈ 7-12 MWh — to be precomputed precisely)

11. **Static engine vs hand-calc**: per-element row "Operable openings: gf_entrance_door" agreement within ±5% (same tolerance as Brief 28k Gate 1).

12. **Dynamic engine vs Static**:
    - EnergyPlus already has `ZoneVentilation:WindandStackOpenArea` — the direct equivalent
    - Assembler emits one such object per operable_openings entry, with the right schedule and parameters
    - Per-opening EP heat loss vs Static `losses_at_setpoint.natural_ventilation[id]` agreement within ±15%

13. **Temperature-triggered control validation**:
    - Add a second seed entry to a *test* project (not Bridgewater) using `mode: 'temperature'` with `open_above_zone_c: 22.0`
    - Verify: opening contributes heat loss only on hours when T_zone > 22°C in Static
    - Verify: EP `ZoneVentilation:WindandStackOpenArea` with appropriate schedule + `Maximum Outdoor Temperature` / `Maximum Indoor Temperature` settings produces equivalent behaviour
    - Document the EP equivalent settings used

### Out of scope (deferred or separate briefs)

- **Multi-zone cross-ventilation** — single-zone effective ventilation only. If the entrance door is open and a bedroom window is open on the opposite facade, the model treats them as two independent flows into the single zone, not as a coupled cross-flow. Multi-zone is a separate, much larger brief.
- **Controlled night purge logic / BMS automation** — beyond temperature threshold + schedule combination, no automation logic. "Open at 02:00 to flush thermal mass" is achievable via a schedule with the right hours, but adaptive control isn't modelled.
- **Operable shading devices** — separate brief; shading is geometry, operability of shading is a different physics question.
- **Wind-pressure-coefficient detail per opening orientation** — V1 uses a single user-set `wind_coefficient` per opening. Computing per-facade Cw from wind direction is more rigorous but a separate engine improvement.
- **Brief 28-AssemblerAudit dependencies** — the EP assembler bugs found at Brief 28L Gate L4 don't affect the natural ventilation EP objects (those are `ZoneVentilation:WindandStackOpenArea`, separate from `People`/`Lights`/`ElectricEquipment`). Brief 28e proceeds independently; AssemblerAudit remains queued.

### Not changing

- Permanent louvres (BuildingDefinition) — stay in Building tab, unchanged.
- Brief 28k convention math — engine still uses setpoint convention with sol-air on opaque, T_out on glazing/ventilation, T_ground on floor.
- Brief 28k three-way solar bucketing.
- Brief 28L BRUKL ingestion via per-project overrides.
- Brief 28j hourly MVHR recovery cap mechanics.

---

## Engine changes

### Files modified

**`frontend/src/utils/instantCalc.js`**

- **Module-scope helper**: `evaluateOpeningControl(control, hourState, zoneState)` returns `is_open: bool` plus diagnostics. Branches on `control.mode`:
  - `'permanent'`: always returns true
  - `'scheduled'`: returns the schedule value at this hour (treats >0.5 as open)
  - `'temperature'`: returns true if `zoneState.T_zone > control.open_above_zone_c` AND (schedule_ref absent OR schedule value > 0.5) AND (NOT control.require_outside_cooler OR hourState.T_out < zoneState.T_zone). Hysteresis tracked across hours via a small state object.

- **New accumulators** (one set per operable opening, generated dynamically from `building_config.operable_openings`):
  - `acc_heat_loss_natvent[id]`, `acc_cool_gain_natvent[id]`
  - `acc_open_hours[id]`
  - `acc_flow_sum_l_s[id]`, `acc_dT_sum_k[id]` (for averaging)

- **Per-hour block** (after existing ventilation handling):
  ```javascript
  for (const opening of operableOpenings) {
    const is_open = evaluateOpeningControl(opening.control, h, T_zone_h, T_out)
    if (!is_open) continue
    const dT_abs = Math.abs(T_zone_h - T_out)
    const T_avg_K = 0.5 * (T_zone_h + T_out) + 273.15
    const Q_wind  = opening.discharge_coefficient * opening.area_m2
                  * Math.sqrt(opening.wind_coefficient * v_wind_h * v_wind_h)
    const Q_stack = opening.discharge_coefficient * opening.area_m2
                  * Math.sqrt(Math.max(0, 2 * 9.81 * opening.height_m * dT_abs / T_avg_K))
    const Q_open  = Math.sqrt(Q_wind * Q_wind + Q_stack * Q_stack)  // m³/s
    const UA_open = AIR_RHO * AIR_CP * Q_open  // W/K
    acc_heat_loss_natvent[opening.id] += UA_open * Math.max(0, T_heat - T_out)
    acc_cool_gain_natvent[opening.id] += UA_open * Math.max(0, T_out - T_cool)
    acc_open_hours[opening.id] += 1
    acc_flow_sum_l_s[opening.id] += Q_open * 1000
    acc_dT_sum_k[opening.id] += dT_abs
  }
  ```

- **Inclusion in shoulder gate** (`H_weather` / `C_weather`): sum of `heat_loss_h` across all open openings added; same for cool gain.

- **Output**: new `losses_at_setpoint.natural_ventilation: [...]` array, one entry per opening, populated from the accumulators.

- **Mirrored in `_calculateState2`**: same accumulator structure, same per-hour math, same output. Invariance check (State 1 vs State 2): natural ventilation per-element loss is gain-independent (must be invariant).

**`frontend/src/components/modules/OperationModule.jsx`**

- Full rewrite of the operable section. Existing structure (schedule selector + per-facade openable_fraction sliders) replaced with the opening-list editor.
- Imports `selectedOpeningId` from context; sets it on row click.
- Migration logic on load: if `building_config.operable_openings` absent but legacy `params.openings.{face}.openable_fraction` present, synthesise entries and persist.

**`frontend/src/components/modules/building/BuildingViewer3D.jsx`**

- Extend raycast/hover infrastructure to identify individual window rectangles and door rectangles.
- Add `selectedOpeningId` / `selectedFacade` consumer.
- Highlight rendering for selected elements (bold glazing colour, subtler wall tint).
- Reverse-click: setting `selectedOpeningId` on element click, plus scroll-OperationModule-row-into-view side-effect via context.

**`frontend/src/context/ProjectContext.jsx`** (or dedicated UI context)

- Add `selectedOpeningId`, `setSelectedOpeningId` state.
- Add `selectedFacade`, `setSelectedFacade` state.

**`scripts/seed_bridgewater_v25_systems.mjs`**

- Add `operable_openings: [{ gf_entrance_door ... }]` to the Bridgewater seed config.
- Add `business_hours_09_18_weekdays` schedule if not already in library.

**Assembler (Python): `nza_engine/generators/epjson_assembler.py`**

- New function `_build_operable_openings_objects(building_config, schedules)`:
  - For each entry in `building_config.operable_openings`, emit one `ZoneVentilation:WindandStackOpenArea` per zone with:
    - `opening_area` = entry.area_m2 / num_zones
    - `opening_area_fraction_schedule_name` = derived from entry.control (permanent → always-1.0; scheduled → schedule_ref; temperature → schedule-modulated by EP `Maximum Outdoor Temperature` + `Maximum Indoor Temperature` fields)
    - `opening_effectiveness` = entry.discharge_coefficient
    - `effective_angle` = facade angle relative to north
    - `height_difference` = entry.height_m
    - `discharge_coefficient_for_opening` = autocalculate
    - For temperature mode: `Maximum Indoor Temperature` left unset (we want opening above zone T to trigger), `Minimum Outdoor Temperature` similar treatment, with the schedule providing the gate
- Wire into the main assembler flow for State 1 and State 2 (envelope-only and gains modes).

### Files NOT modified

- `frontend/src/components/modules/building/BuildingDefinition.jsx` — louvres remain unchanged.
- `frontend/src/utils/wallModel.js`
- `frontend/src/utils/computeVentilationEnergy.js` — mechanical ventilation handling unchanged.
- Brief 28k engine convention code — no change.
- Brief 28L per-project overrides — no change.

---

## Validation targets

Spreadsheet to be updated in parallel with this brief. Targets computed via Python pre-compute against the Yeovilton EPW with the Bridgewater seed config.

### Static envelope-only — Gate 1 (per-element loss)

Bridgewater after seed update. New row in the loss table:

| Element | Hand-calc kWh | Engine kWh | Tolerance |
|---|---:|---:|---:|
| Operable opening: gf_entrance_door | (pre-compute) | (engine) | ±5% |

Plus all existing rows remain unchanged (invariance to opening addition for non-opening elements).

### Static State 2 — Gate 3 (with internal gains)

Same as Gate 1 plus internal gain offset behaviour unchanged. Operable opening per-element loss must be **invariant State 1 ↔ State 2** (same proof as for other ventilation lines in Brief 28k).

### Dynamic vs Static

Per-opening: Static `losses_at_setpoint.natural_ventilation[gf_entrance_door].heat_loss_kwh` vs EP per-zone `Zone Ventilation Sensible Heat Loss Energy` aggregated for the corresponding `ZoneVentilation:WindandStackOpenArea` objects. Tolerance ±15%.

Demand-level State 2: Static `heating_demand_mwh` vs Dynamic Ideal Loads heating energy, including the natural ventilation contribution in both engines. Tolerance ±15% convention-adjusted (same convention differences from Brief 28L carry through; nothing new at this gate).

### Temperature-triggered mode (test project, separate from Bridgewater)

Synthetic test project with one opening on `mode: 'temperature'`, `open_above_zone_c: 22.0`:
- Static: count of hours where `T_zone > 22` matches `open_hours` in the opening's output
- Engine produces nonzero heat loss only in those hours
- EP equivalent (`ZoneVentilation:WindandStackOpenArea` with `Maximum Indoor Temperature` settings — exact field treatment to be confirmed in implementation) produces qualitatively similar open-hours count

---

## Halt gates

Five gates with code review at each. Same discipline as Brief 28L.

### Gate E1 — Schema + migration

Implement `building_config.operable_openings` schema, the migration from legacy `openable_fraction`, the Bridgewater seed entry, and the `business_hours_09_18_weekdays` schedule. No engine math yet; just data shape and persistence.

**Halt and report:**
- Diff of seed script showing new opening entry
- Diff of schedule library if updated
- Confirmation: Bridgewater fetched via API now returns `operable_openings: [{ gf_entrance_door ... }]`
- Confirmation: a legacy project with `openable_fraction` set gets synthesised entries on engine init
- Existing tests pass (no engine math touched yet)

**PASS:** schema valid, migration works on legacy data, Bridgewater seeded correctly.
**FAIL:** any data shape issue or migration regression.

### Gate E2 — Static engine math + per-opening output

Implement the per-opening loss accumulator in `_calculateEnvelopeOnly`, the `evaluateOpeningControl` helper, the combined wind+stack physics, and the `losses_at_setpoint.natural_ventilation[]` output. Replicate in `_calculateState2`. Push commits.

**Halt and report:**
- Diff of engine changes
- Engine output for Bridgewater envelope-only and State 2, showing the new `natural_ventilation` array
- Per-opening: heat_loss_kwh, cool_gain_kwh, open_hours, avg_flow_when_open_l_s
- Invariance: per-element loss including natural_ventilation is identical State 1 vs State 2 (gain-independence proof)
- Conservation invariants from Brief 28k still hold (solar buckets, gain buckets)

**Chris reviews code before approving Gate E3.**

**PASS:** Static engine produces non-zero heat loss for gf_entrance_door on business-hours schedule, invariance holds, Brief 28k invariants unchanged.
**FAIL:** zero output, negative loss, NaN, or invariance broken.

### Gate E3 — Hand-calc validation

Update spreadsheet `05_Heat_Loss` and `08_Heat_Balance` with the new operable openings line. Hand-calc Python pre-computes the expected value. Engine validator script compares.

**Halt and report:**
- Updated spreadsheet attached to commit
- Hand-calc Python output: kWh/yr for gf_entrance_door under business hours
- Engine vs hand-calc: per-row delta within ±5%
- All Brief 28k Gate 1-3 rows still pass within their original tolerances (no regression)

**Chris reviews numerical agreement.**

**PASS:** operable opening row within ±5%, no regressions.
**FAIL:** out of tolerance → investigate, halt.

### Gate E4 — Dynamic engine validation

Implement assembler `_build_operable_openings_objects`. Configure Bridgewater Dynamic run with operable openings injected. Run EP. Compare per-opening heat loss and demand-level outputs vs Static.

**Halt and report:**
- Diff of assembler changes
- EP epJSON snippet showing `ZoneVentilation:WindandStackOpenArea` for gf_entrance_door
- Per-opening: Static vs Dynamic heat loss, ±15% tolerance
- Demand-level State 2: Static `heating_demand_mwh` vs Dynamic Ideal Loads, ±15% convention-adjusted
- Temperature-triggered test project: open_hours count matches between Static and EP within ±10%

**Chris reviews code + numerical agreement.**

**PASS:** per-opening within ±15%, demand-level within convention-adjusted ±15%.
**FAIL:** investigation needed; document EP `WindAndStackOpenArea` field treatment if relevant.

### Gate E5 — UI: OperationModule + 3D selection

Rewrite OperationModule to the opening-list editor. Implement bidirectional 3D selection. Wire BuildingViewer3D to consume `selectedOpeningId` / `selectedFacade`. Bold glazing colour highlight; subtler wall tint; door rectangle highlight.

**Halt and report:**
- Diff of OperationModule, BuildingViewer3D, ProjectContext (or UI context)
- Screenshots: row-click-selects-3D, 3D-click-selects-row, multiple selection states
- Migration: a project with legacy `openable_fraction` now renders correctly in the new UI
- Manual smoke test: add a new door via UI, persist, refresh, verify it loads and renders in 3D

**Chris reviews UX in browser + code.**

**PASS:** bidirectional selection works smoothly, highlights are bold and clear (glazing) plus subtle (wall), no console errors, persistence works.
**FAIL:** any UX rough edge or persistence issue.

---

## PASS/FAIL browser scenarios

After Gate E5 closes, run browser-level smoke tests.

### Scenario 1 — Bridgewater Building tab, Heat Balance view

**Setup:** Open Bridgewater, set state mode to envelope-only (State 1).

**Check:**
- Heat Balance shows a new line "Natural ventilation: Main entrance door (south)"
- Annual loss reads in the 5-15 MWh range (precise target from hand-calc pre-compute)
- Permanent louvres line still shows ~52 MWh (unchanged)
- Total fabric+vent loss includes the new line

**PASS:** new line visible with correct value.
**FAIL:** missing line or wrong value.

### Scenario 2 — Operation module: edit and add openings

**Setup:** Open Bridgewater /operation.

**Check:**
- Opening list shows "Main entrance door (south)" entry
- Click the row → south facade highlights in 3D viewer with bold glazing colour, subtler wall tint
- Click in 3D viewer on south facade → row scrolls into view, expands
- Click "Add operable window bank" → new entry appears in list
- Set new entry: facade = north, parent_glazing_face = north, area = 5 m², control = scheduled to summer-day → entry persists
- Refresh page → new entry still there

**PASS:** all interactions work as described.
**FAIL:** selection breaks, persistence fails, or 3D highlight wrong.

### Scenario 3 — Temperature-triggered control

**Setup:** Add a test opening to Bridgewater (or test project): control mode = temperature, open_above_zone_c = 22.

**Check:**
- Static engine reports `open_hours` proportional to summer/warm hours only
- Heat loss is non-zero on hot days (T_zone > 22 AND T_out < T_zone), zero on cold days
- EP run produces qualitatively similar pattern

**PASS:** opening only contributes loss when zone exceeds threshold.
**FAIL:** always open or never open.

### Scenario 4 — Door propped open intervention

**Setup:** Change the gf_entrance_door schedule to "always open" (mode = permanent).

**Check:**
- Total annual heat loss rises substantially (door open 8760 hours vs 9-18 weekdays)
- Engine produces ~3-4× the original entrance door loss
- Cooling load slightly increases in summer

**PASS:** "always open" produces sensible larger loss; matches expected ratio.
**FAIL:** loss unchanged or pathological.

---

## Out of scope reminders

These remain parked / queued and don't move until Brief 28e closes:

- Brief 28f Part 5.4 (Systems UI rewrite)
- Brief 28M (LPD calibration — needs BRUKL p.27 / NCM defaults)
- Brief 28g (measured data ingester)
- Brief 28-AssemblerAudit (EP People + schedule integration bugs)
- Brief 28-SolAirSkyRadiation (Static `solAirT` correction)
- Multi-zone cross-ventilation
- BMS automation modelling
- Operable shading
- Internal Gains Dynamic toggle bug

---

## File pointers

**Engine:**
- `frontend/src/utils/instantCalc.js::_calculateEnvelopeOnly` (line ~406, extend with natural ventilation accumulators)
- `frontend/src/utils/instantCalc.js::_calculateState2` (line ~1216, mirror the same accumulators)
- New module-scope helper `evaluateOpeningControl`
- New constants if not present: `AIR_RHO = 1.2`, `AIR_CP = 1005`, `GRAVITY = 9.81`

**UI:**
- `frontend/src/components/modules/OperationModule.jsx` (full rewrite of operable section)
- `frontend/src/components/modules/building/BuildingViewer3D.jsx` (extend hover/click + highlight rendering)
- `frontend/src/context/ProjectContext.jsx` (new selection state)

**Assembler:**
- `nza_engine/generators/epjson_assembler.py` (new `_build_operable_openings_objects`)

**Seed:**
- `scripts/seed_bridgewater_v25_systems.mjs` (add `operable_openings` entry)
- Schedule library (add `business_hours_09_18_weekdays` if absent)

**Validation:**
- `Bridgewater_Bottom_Up_Energy_Model.xlsx` (repo root, parallel update)
- `scripts/_check_28e_gate3_natural_ventilation.mjs` (new — Static vs hand-calc)
- `scripts/_check_28e_gate4_dynamic_natural_ventilation.py` (new — Static vs EP)

**Briefs and docs:**
- `docs/briefs/active/28e_operable_openings_natural_ventilation.md` (this brief)
- `docs/validation/brief_28e_validation.md` (to be written at Gate E5 close)

---

## Code review discipline (reminder from Brief 28L)

Each halt gate requires:
1. Claude Code commits + pushes to main
2. Reports back with gate number, diff link, validation script output, PASS/FAIL per criterion
3. Halts and waits

Chris then:
1. Pulls the latest
2. Reads the diff
3. Approves the gate or flags issues

No gate proceeds without explicit approval.

---

## Acknowledgement

Brief 28e is the final piece of envelope physics before calibration work begins. Once it closes, the engine has:
- Fabric (✓ Brief 28k convention + Brief 28L BRUKL inputs)
- Internal gains (✓ Brief 28k bucketing)
- Mechanical ventilation (✓ Brief 28k 3-system per-line accounting)
- Permanent envelope openings (✓ existing louvres)
- **Operable openings — doors, windows, vents — with three control modes and wind+stack physics** (Brief 28e)
- Thermal bridging (✓ Brief 28L α convention)

After Brief 28e, the "envelope" layer is complete. Then:
- **Brief 28M** — LPD calibration (input realism)
- **Brief 28g** — measured data ingester (strategic calibration piece)
- Then 28-AssemblerAudit, 28-SolAirSkyRadiation, 28f Part 5.4, 28h, 28i, etc.

The product positioning ("physics-based + actuals-calibrated + fast") requires both the physics layer (Brief 28k/L/e/AssemblerAudit/SolAirSkyRadiation) and the calibration layer (Brief 28M/g). Brief 28e completes the physics-layer envelope work.

---

**End of Brief 28e.**
