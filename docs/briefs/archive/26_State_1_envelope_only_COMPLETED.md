# Brief 26: State 1 Envelope-Only Computation

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read `docs/state_contracts.md` — this brief implements State 1 per the contract. Every part of this brief must conform to it.
4. Read this ENTIRE brief before writing a single line of code
5. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** After completing each part, open the application in a real browser and visually confirm it works. Take screenshots. Report what you actually see. Check browser DevTools console for red errors. Fix before committing.

**Contract conformance is the bar.** This brief implements State 1. The state contract document defines the inputs honoured, inputs ignored, computation, outputs, and UI rules. If something in this brief conflicts with the contract, the contract wins — flag the conflict and stop.

**Bridgewater is the regression case.** Expected State 1 numbers for Bridgewater are documented in the contract:
- Heating demand: 30–60 MWh/yr
- Cooling demand: 5–15 MWh/yr
- Overheating hours: 200–600
- Underheating hours: 1500–3500

If results fall outside these ranges at any verification step, stop and investigate. Out-of-range numbers indicate a contract violation or a computation bug, not a range error.

**Three strikes rule.** If a particular State 1 calculation doesn't match between live engine and EnergyPlus within ±10% after 3 attempts, document the divergence as a known issue in `docs/state_1_divergences.md` and continue — but flag in the final report. Per the contract, engine disagreement is informational, not blocking.

---

## Context

Brief 25 restructured the Building module UI: removed the Live Results Panel, moved operable windows to the new `/operation` module, added a Permanent Openings input section. However, **Brief 25 did not thread the State 1 mode through the computation**. The Heat Balance still renders in full mode regardless of which module mounts it — see screenshot from Chris's 12 May session showing "Heating" on the gains side, People/Equipment/Lighting flows present, and "Openings — windows" dominating the loss side.

This brief finishes what Brief 25 started: implements State 1 envelope-only computation honestly, in both engines (live + EnergyPlus), and ensures the Building module Heat Balance reflects only what the envelope is doing.

After this brief:
- `instantCalc.js` has a `mode: 'envelope-only'` path that strictly honours the State 1 input list
- The backend `/balance` endpoint supports `mode=envelope-only`
- The Heat Balance component renders State 1 cleanly — solar gains only, conduction + ventilation losses, heating/cooling shown as **derived demand rows**, not input flows
- The Building module mounts the Heat Balance with `mode='envelope-only'` forced
- The comfort band is a project-level input editable inline on the Heat Balance view
- Engine disagreement is reported as a soft flag, not a blocker
- Bridgewater shows State 1 numbers in the expected ranges

10 parts. Do them in order.

---

## PART 1: Project comfort band as a first-class input

**File(s):** `nza_engine/models.py` (or wherever the Project model lives), `frontend/src/context/ProjectContext.jsx`, `api/routers/projects.py`

The comfort band is a project-level input per the contract (Cross-cutting concepts → Comfort band). It needs to exist in the data model before State 1 can use it.

**Schema addition to Project:**
```python
class Project(...):
    # existing fields ...
    comfort_band_lower_c: float = 20.0
    comfort_band_upper_c: float = 26.0
```

**Migration:** existing projects default to 20/26. No data loss.

**Context exposure:** `ProjectContext` exposes `comfortBand` as `{ lower_c, upper_c }` with an updater `setComfortBand({ lower_c, upper_c })`. Persists to the backend on change via the existing `PUT /api/projects/{id}` endpoint.

**API endpoint:** the existing `PUT /api/projects/{id}` accepts `comfort_band_lower_c` and `comfort_band_upper_c` fields with validation (8°C ≤ lower < upper ≤ 32°C).

Do not yet wire the band to the UI — Part 7 mounts the edit control on the Heat Balance view. This part is just the data model.

**Commit message:** "Part 1: Project-level comfort band as first-class input"

**Verify:**
1. DB migration runs cleanly on the existing Bridgewater project
2. `GET /api/projects/{id}` returns `comfort_band_lower_c: 20.0` and `comfort_band_upper_c: 26.0` for Bridgewater
3. `PUT /api/projects/{id}` with `comfort_band_lower_c: 21.0` persists and re-fetches correctly
4. Invalid values (lower > upper, lower < 8, upper > 32) are rejected with clear error
5. `ProjectContext.comfortBand` returns `{ lower_c: 20.0, upper_c: 26.0 }` for Bridgewater
6. Report: "Comfort band added to Project model. Bridgewater defaults: 20.0 / 26.0. Validation rules enforced. Context exposes comfortBand and setComfortBand."

---

## PART 2: Input provenance schema (foundation for State 4)

**File(s):** `docs/state_contracts.md` (update), `nza_engine/models.py`, relevant schema files

Per the contract (Cross-cutting concepts → Input provenance), every input in the various configs needs a `provenance` field. Brief 26 is the right time to lay the groundwork — even though State 4 is several briefs away, retrofitting provenance to every input later is much more painful than adding it now.

**Define the enum values in the contract first.** Resolve open contract question #2. Edit `state_contracts.md` to add an explicit section:

```markdown
### Provenance enum values

- `user_entered` — directly typed/selected by user
- `spec_sheet` — entered with reference to manufacturer or project documentation, plus optional `source_ref` (file URL or note)
- `vintage_default` — pulled from a building-stock library based on age band, plus optional `library_ref`
- `benchmark` — pulled from CIBSE TM46/TM54 or equivalent, plus optional `benchmark_ref`
- `inferred` — derived from another input or measured data
- `calibrated` — adjusted by State 4 reconciliation, plus required `adjustment_log_ref`

Provenance is stored as `{ source: enum_value, ref?: string, confidence?: 'high' | 'medium' | 'low' }` alongside each value.
```

Commit this contract update **before** the schema work, in its own commit. This is the discipline: contract updates land first, in isolation.

**Schema addition:** the `building_config` and other config blobs gain a sibling `_provenance` structure mirroring the input paths. Example:

```json
{
  "fabric": {
    "external_wall": { "u_value": 0.28 },
    "_provenance": {
      "external_wall.u_value": { "source": "spec_sheet", "ref": "WGL800_datasheet.pdf", "confidence": "high" }
    }
  }
}
```

Default provenance for unspecified inputs: `{ source: 'user_entered', confidence: 'medium' }`. Don't try to retrofit existing data with anything more specific.

**Helper utilities:**
- `getProvenance(config, path) → { source, ref?, confidence? }`
- `setProvenance(config, path, provenance) → updated config`

Both available in frontend (`frontend/src/utils/provenance.js`) and backend (`nza_engine/utils/provenance.py`).

State 1 doesn't need to *use* provenance — it just needs to not break when it's present. Future briefs (especially State 4) will read and write it heavily.

**Commit messages:**
- Contract commit: "Contract v2.1: Define provenance enum values"
- Schema commit: "Part 2: Input provenance schema scaffolding"

**Verify:**
1. Contract updated, provenance enum values documented
2. Schema changes don't break existing project load
3. `getProvenance(buildingConfig, 'fabric.external_wall.u_value')` for Bridgewater returns the default `{ source: 'user_entered', confidence: 'medium' }`
4. `setProvenance(...)` correctly nests the provenance under `_provenance` and is persisted
5. Report: "Provenance scaffolding in place. Default `user_entered` for unspecified. Bridgewater load unchanged. Foundation ready for State 4."

---

## PART 3: Live engine — `envelope-only` mode strict implementation

**File(s):** `frontend/src/utils/instantCalc.js`

Implement `envelope-only` mode strictly per the contract. This is the heart of State 1.

**Function signatures:**
```js
calculateInstant(building, weather, options = { mode: 'full' })
calculateInstantDegreeDay(building, weather, options = { mode: 'full' })

// Modes accepted:
// 'envelope-only'    — State 1
// 'envelope-gains'   — State 2 (future brief)
// 'envelope-gains-operation' — State 2.5 (future brief)
// 'full'             — State 3 (current default behaviour)
```

**Critical behaviour in `envelope-only` mode:**

1. **Read from `inputs_used` only** per State 1 contract. Any read from `gains.*`, `openings.f*.openable_fraction`, `openings.schedule`, `openings.control_mode`, `operation.*`, `systems.*` is a contract violation. Wrap reads in a `withMode(building, mode)` helper that returns a stripped-down config containing only the State 1 inputs.

2. **Comfort band drives demand.** Read `project.comfort_band.lower_c` and `project.comfort_band.upper_c`. Heating demand = integrated max(0, losses - gains) when free-running T < lower bound. Cooling demand = integrated max(0, gains - losses) when free-running T > upper bound.

3. **Heating and cooling are derived outputs, not flows.** The returned heat_balance.gains has solar only. The returned heat_balance.losses has conduction + ventilation only. Heating and cooling appear in `heat_balance.demand` as MWh values, not in `heat_balance.gains`.

4. **Permanent vent flow split from fabric leakage.** Both contribute to ventilation losses but are reported separately in `heat_balance.losses.ventilation.{fabric_leakage, permanent_vents}`. Never combined.

5. **Free-running temperature.** Compute the 8760-hour free-running indoor temperature using lumped-capacitance with thermal mass from `fabric.thermal_mass_category`. Return as `heat_balance.free_running.hourly_temperature_c` plus annual_mean, winter_min, summer_max.

**Helper to enforce contract:**
```js
function withMode(building, mode) {
  if (mode === 'envelope-only') {
    return {
      // Geometry
      bc_length: building.bc_length, bc_width: building.bc_width,
      bc_num_floors: building.bc_num_floors, bc_floor_height: building.bc_floor_height,
      orientation: building.orientation,
      // Glazing
      glazing: building.glazing,
      window_count: building.window_count,
      // Shading
      shading_overhang: building.shading_overhang,
      shading_fin: building.shading_fin,
      // Permanent openings
      permanent_openings: building.permanent_openings,
      // Fabric
      fabric: building.fabric,
      airtightness: building.airtightness,
      // Explicitly omit: gains, openings (operable), operation, systems
    };
  }
  // Other modes return progressively more
  return building;
}
```

This makes the contract enforcement mechanical, not advisory.

**Output shape per the contract (Outputs section, State 1).** Match exactly.

**Backward compatibility:** calling `calculateInstant(building, weather)` without options must return the existing full-mode result. No regression in other modules.

**Commit message:** "Part 3: Live engine envelope-only mode with strict input enforcement"

**Verify:**
1. Call `calculateInstant(bridgewaterBuilding, weather, { mode: 'envelope-only' })` from dev tools console
2. Confirm `heat_balance.gains` contains only solar (by orientation), no people/equipment/lighting fields
3. Confirm `heat_balance.losses.ventilation` is split into `fabric_leakage` and `permanent_vents` (separate values)
4. Confirm `heat_balance.demand` contains `heating_demand_mwh`, `cooling_demand_mwh`, `overheating_hours`, `underheating_hours`, `comfort_hours`
5. Confirm `heat_balance.free_running.hourly_temperature_c` is an 8760-element array
6. Confirm Bridgewater State 1 numbers in expected ranges:
   - Heating demand 30–60 MWh
   - Cooling demand 5–15 MWh
   - Overheating hours 200–600
   - Underheating hours 1500–3500
7. **Critical test:** set `gains.lighting.lpd_w_per_m2 = 100` (absurd value) in the building config. Re-run `envelope-only`. The output must be **identical** to the run before the change. If it differs, `withMode` is leaking gains into State 1.
8. Backward compat: `calculateInstant(building, weather)` (no options) returns existing full-mode result with no errors
9. Report: "envelope-only mode strict. Bridgewater State 1: heating [X] MWh, cooling [X] MWh, overheating [X]h, underheating [X]h. Within expected ranges. Contract isolation verified — setting lighting to 100 W/m² has zero impact on envelope-only output. Backward compatibility preserved."

---

## PART 4: Backend `/balance` endpoint — envelope-only mode

**File(s):** `nza_engine/parsers/sql_parser.py`, `nza_engine/generators/epjson_assembler.py`, `api/routers/simulations.py`

The backend needs to produce State 1 numbers via EnergyPlus. The cleanest approach is a separate State 1 simulation run that zeroes gains and uses wide setpoints.

**Approach:**

1. **State 1 simulation generation.** Add a `state_1_simulation: bool` flag to the simulation request. When set, the assembler:
   - Emits `People`, `Lights`, `ElectricEquipment` with zero density
   - Emits `ZoneHVAC:IdealLoadsAirSystem` with very wide setpoints (heating 5°C, cooling 50°C) — effectively free-running with optional ideal load supply
   - Does **not** emit any operable window airflow or AFN operable opening objects
   - Does emit permanent opening infiltration via `ZoneInfiltration:FlowCoefficient` as normal
   - Does emit fabric leakage infiltration as normal

2. **Storage path for State 1 simulations.** Per the contract (Cross-cutting concepts → Simulation persistence), State 1 runs are saved separately. A simple approach: store under `simulations/` with `simulation_type: 'state_1' | 'full'` column. Don't overcomplicate now — just enough to identify and retrieve State 1 runs separately from full runs.

3. **`/balance?mode=envelope-only` endpoint.** Update `GET /api/projects/{id}/simulations/{run_id}/balance` to accept a `mode` query param. When `mode=envelope-only`:
   - If `run_id` is a State 1 run, return its heat balance in the State 1 output shape
   - If `run_id` is a full run, return a "post-processed" State 1 view by extracting envelope-only components from the full SQL (less accurate but still useful when a dedicated State 1 run isn't available)
   - Output shape matches the live engine's State 1 output exactly

4. **Trigger from frontend.** A new "Run State 1 Simulation" button (the existing Re-run Simulation runs a full sim). Don't add the button yet — Part 7 mounts it on the Heat Balance view. This part is just the backend capability.

**Commit message:** "Part 4: Backend State 1 simulation path and /balance envelope-only mode"

**Verify:**
1. Trigger State 1 simulation via API: `POST /api/projects/{id}/simulations { state_1_simulation: true }`
2. Generated epJSON has zero people/lights/equipment and wide-setpoint ideal loads
3. No `AirflowNetwork:MultiZone:Component:DetailedOpening` objects for operable windows
4. `ZoneInfiltration:FlowCoefficient` present for permanent vents
5. Simulation runs without fatal errors
6. `GET /api/projects/{id}/simulations/{run_id}/balance?mode=envelope-only` returns the State 1 output shape
7. Numbers within ±10% of live engine State 1 output for Bridgewater
8. Old `/balance?mode=full` and `/balance` (no mode) calls return existing full-mode shape (backward compat)
9. Report: "Backend State 1 working. State 1 epJSON validated. Bridgewater EP State 1: heating [X] MWh, cooling [X] MWh, overheating [X]h. Live vs EP agreement: heating [X]%, cooling [X]%, overheating [X]%. Within ±10% tolerance."

---

## PART 5: Heat Balance component — honour envelope-only mode

**File(s):** `frontend/src/components/modules/balance/HeatBalance.jsx`, `frontend/src/components/modules/balance/BalanceSankey.jsx`, `frontend/src/components/modules/balance/HeatBalanceStacked.jsx`, `frontend/src/components/modules/balance/DrillDown.jsx`

The Heat Balance component currently renders the same way regardless of mode. It needs to honour the `mode` prop and render State 1 visuals correctly.

**Prop signature:**
```jsx
<HeatBalance
  projectId={X}
  runId={Y}
  mode="envelope-only" | "envelope-gains" | "envelope-gains-operation" | "full"
  defaultMode="full"  // for the existing /results mount, unchanged
/>
```

**When `mode === 'envelope-only'`:**

1. **Fetch the right data.**
   - Live engine: call `calculateInstant` with `{ mode: 'envelope-only' }`
   - Simulation: call `/balance?mode=envelope-only`
   - Engine toggle works exactly the same way as before, just with State 1 endpoints

2. **Render gains side with solar only.** No people, equipment, or lighting flows. If the data accidentally contains them (defensive check), filter them out.

3. **Render losses side with conduction + ventilation only.** No "Openings — windows" or operable window losses. Permanent vent flow and fabric leakage shown as two distinct ventilation segments.

4. **Heating and cooling as derived demand rows.** Below the main gains/losses balance, render a "Demand against comfort band" row showing:
   - "Heating demand at X°C: Y MWh"
   - "Cooling demand at Z°C: W MWh"
   - "Overheating hours: N"
   - "Underheating hours: M"
   The values are derived outputs, not flows participating in the balance.

5. **Badge at the top:** "Envelope only — no occupancy, no systems, no operable windows" with subtle styling that makes it impossible to miss.

6. **Disclosure for "what's not included":** an expandable info pill below the badge listing the ignored inputs.

7. **DrillDown adapts.** The first-principles / instantCalc / EnergyPlus comparison only shows rows relevant to State 1. Internal gain rows hidden in envelope-only mode.

**Engine disagreement handling per the contract.** When the live and simulation engines disagree, show the appropriate level:
- < 5% silent
- 5–10% soft flag, click reveals breakdown
- 10–30% persistent warning
- > 30% hard warning

The flag UI element lives near the engine toggle. Don't block the user — just inform.

**When `mode === 'full'`:** existing behaviour preserved, no regression. The `/results` Heat Balance tab continues to work as before.

**Commit message:** "Part 5: Heat Balance component honours envelope-only mode with State 1 visuals"

**Verify:**
1. Mount `<HeatBalance mode="envelope-only" .../>` in a test page
2. Confirm gains side shows only solar (split by F1/F2/F3/F4 orientation)
3. Confirm losses side shows conduction (walls, roof, floor, glazing) and ventilation (fabric leakage and permanent vents as distinct segments)
4. Confirm **no** "Heating" flow on the gains side
5. Confirm **no** "Openings — windows" on the losses side
6. Confirm demand row at bottom shows heating MWh, cooling MWh, overheating hours, underheating hours
7. Confirm "Envelope only" badge visible
8. Toggle Live ↔ Simulation — values agree (engine flag silent if within 5%)
9. Mount `<HeatBalance mode="full" .../>` (the /results behaviour) — full Sankey/Stacked render unchanged
10. **SCREENSHOT 1:** Heat Balance in envelope-only mode for Bridgewater showing correct State 1 visual
11. **SCREENSHOT 2:** Heat Balance in full mode (from /results) showing no regression
12. Report: "Heat Balance honours mode prop. envelope-only mode: solar-only gains, ventilation split, demand-as-derived-rows, badge visible. Full mode: no regression. Engine agreement on Bridgewater within [X]% (silent / soft flag / warning) for heating, cooling, overheating."

---

## PART 6: Building module — mount Heat Balance with envelope-only forced

**File(s):** `frontend/src/components/modules/BuildingDefinition.jsx`

Update the Building module's centre canvas Heat Balance tab to mount the component with `mode='envelope-only'` forced. The user cannot toggle out of envelope-only mode from the Building module — that's the contract.

The 3D Model tab is unchanged.

Once Parts 7–9 land, additional tabs (Free-running Temperature, Heat Loss Breakdown) join the centre canvas. For now, the Heat Balance tab is where State 1 visuals appear.

**Commit message:** "Part 6: Building module mounts Heat Balance with envelope-only mode forced"

**Verify:**
1. Navigate to /building
2. Click Heat Balance tab in centre canvas
3. Confirm "Envelope only" badge visible
4. Confirm no internal gains in the gains stream
5. Confirm no operable window losses in the losses stream
6. **Critical test:** open the /operation module in a separate tab, tick operable windows on F1 with a non-zero schedule, save. Navigate back to /building → Heat Balance. The Heat Balance should be **unchanged** — the operable window does not appear in the envelope-only loss stream. (Per the contract: "If a State 1 computation reads any of the above fields, that is a contract violation.")
7. **SCREENSHOT:** /building Heat Balance tab showing State 1 visual for Bridgewater, contrasted with the broken screenshot from Brief 25 (12 May)
8. Report: "Building module mounts Heat Balance in envelope-only mode. Operable windows in /operation have no effect on Building module Heat Balance — contract isolation verified end-to-end."

---

## PART 7: Comfort band inline editor on Heat Balance view

**File(s):** `frontend/src/components/modules/balance/HeatBalance.jsx`, `frontend/src/components/modules/balance/ComfortBandEditor.jsx` (new)

Add the comfort band edit control inline on the Heat Balance view, per the contract (Cross-cutting concepts → Comfort band).

**UI:** a compact control near the demand rows, something like:
```
Demand calculated against comfort band: [20]°C – [26]°C  ⓘ
```

The `[20]` and `[26]` are editable inputs (numeric with up/down arrows, range constrained to 8–32 with lower < upper).

Tooltip on the ⓘ icon: "Reference band for envelope diagnostics. When Systems are configured, real heating/cooling setpoints override this band for demand calculation."

**Behaviour on change:**
- Updates `project.comfort_band` via context
- Triggers a live re-compute of State 1 demand (live engine — instant)
- Does not auto-trigger an EnergyPlus re-run, but a small "Re-run State 1" button appears next to the engine toggle (only after changes)

**Persistence:** changes save to backend immediately via the existing project update endpoint.

**Visible across all states.** Although this brief only implements State 1 use, the comfort band control should appear on the Heat Balance view regardless of mode (since it's a project-level input). When systems are configured (State 3 in future briefs), the setpoint values from Systems are shown in addition to the comfort band, with explicit indication that setpoints override the band.

**Commit message:** "Part 7: Comfort band inline editor on Heat Balance view"

**Verify:**
1. Navigate to /building → Heat Balance
2. See comfort band edit control showing 20 and 26
3. Adjust lower to 21 — live engine re-computes State 1 demand instantly, heating demand changes
4. Adjust upper to 25 — live engine re-computes, cooling demand changes
5. Reload page — values persist
6. Try lower = 27, upper = 25 — validation rejects (lower must be < upper)
7. Try lower = 5 — validation rejects (must be ≥ 8)
8. The "Re-run State 1" button appears after a change and triggers EnergyPlus re-simulation
9. **SCREENSHOT:** Heat Balance view with comfort band editor showing 21°C / 25°C, demand values updated accordingly
10. Report: "Comfort band editor working. Bridgewater at 20/26: heating [X] MWh, cooling [X] MWh. At 21/25: heating [X] MWh, cooling [X] MWh. Live engine response instant. Persistence verified. Validation enforced."

---

## PART 8: Engine agreement flag UI

**File(s):** `frontend/src/components/modules/balance/EngineAgreementFlag.jsx` (new), update `frontend/src/components/modules/balance/HeatBalance.jsx`

Implement the three-tier engine agreement flag per the contract (Cross-cutting concepts → Engine agreement).

**Behaviour:**

The flag component computes per-line-item disagreement between the live engine and simulation results for the same mode. For each line item (solar by orientation, conduction by element, ventilation split, heating demand, cooling demand), it computes percentage difference.

The overall flag level is determined by the maximum per-line disagreement:
- All items < 5%: no flag (silent)
- Any item 5–10%: soft flag (clickable, breakdown popup)
- Any item 10–30%: persistent warning indicator
- Any item > 30%: hard warning indicator with text

Soft flag display: a small `~` icon near the engine toggle, in muted colour.
Persistent warning: a `!` icon in amber.
Hard warning: a `!` icon in red plus a short text "Engines disagree significantly — investigate before trusting numbers."

Clicking any flag opens a breakdown popup listing each line item with live value, simulation value, and absolute/percentage difference, sorted by disagreement magnitude.

**Critical:** the user is **never blocked**. The flag is informational. The Heat Balance still renders fully and is fully interactive at all flag levels.

**Logging:** persistent warnings and hard warnings are logged to `model_health` (a new project sub-resource if needed, or a simple log table). Don't overcomplicate — a list of `{ timestamp, mode, line_item, live_value, sim_value, pct_disagreement }` is enough.

**Commit message:** "Part 8: Engine agreement flag UI — three-tier informational indicator"

**Verify:**
1. Bridgewater State 1: live and EP should agree well, expect silent or soft flag at most
2. Force a disagreement: temporarily modify the live engine's solar calculation to be 50% off, re-render
3. Confirm hard warning appears with breakdown showing the affected line item
4. Click the flag — breakdown popup lists items sorted by disagreement, with values from both engines
5. Confirm the Heat Balance is still interactive at all flag levels (not blocked)
6. Restore the live engine, confirm flag returns to silent
7. **SCREENSHOT 1:** Heat Balance with silent flag (normal Bridgewater State 1)
8. **SCREENSHOT 2:** Breakdown popup showing per-line disagreement
9. Report: "Engine agreement flag working. Bridgewater State 1 default: [silent/soft/warning] flag. Worst-disagreement line item: [X] at [Y]% deviation. Flag never blocks interaction. Breakdown popup functional."

---

## PART 9: Simulation persistence — State 1 runs separately

**File(s):** `nza_engine/models.py`, `api/routers/simulations.py`, `frontend/src/components/...` (run history view if it exists)

Implement the two-tier simulation persistence per the contract (Cross-cutting concepts → Simulation persistence).

**Schema additions:**

1. `SimulationRun` table gains a `simulation_type: 'full' | 'state_1'` column (or equivalent enum). State 1 runs are distinguishable from full runs.

2. `SimulationRun` gains optional `auto_label: string` (auto-generated like "Run 12 — 14 May 14:32") and `user_label: string | null` (named baseline).

3. `is_baseline: bool` flag. When `true`, the run is a named baseline and never expires from retention policy.

4. Retention: last 30 non-baseline runs per project, or 30 days, whichever is greater. Baselines never expire.

**Endpoints:**

- `GET /api/projects/{id}/simulations` — lists runs, filterable by `simulation_type` and `is_baseline`
- `POST /api/projects/{id}/simulations/{run_id}/promote_to_baseline` — sets `is_baseline=true`, requires `user_label`
- `POST /api/projects/{id}/simulations/{run_id}/demote_from_baseline` — sets `is_baseline=false`
- Existing simulation trigger endpoints unchanged, just gain the `simulation_type` field

**No UI changes in this brief** beyond the existing run list. The Baseline / Scenario UX is a future brief. This brief just ensures the persistence model is in place so future work has the foundation.

**Commit message:** "Part 9: Simulation persistence two-tier — auto runs + named baselines, State 1 separate"

**Verify:**
1. Trigger a full simulation → row in `simulation_runs` with `simulation_type='full'`, auto_label populated
2. Trigger a State 1 simulation → row with `simulation_type='state_1'`, auto_label populated
3. Promote a run to baseline via API → `is_baseline=true`, `user_label` set
4. Trigger 31 more full simulations → oldest non-baseline auto-pruned, baseline preserved
5. `GET /api/projects/{id}/simulations?simulation_type=state_1` returns only State 1 runs
6. Report: "Simulation persistence implemented. Bridgewater: [N] runs in history, [M] baselines preserved. State 1 runs filterable. Retention policy active."

---

## PART 10: Full integration test on Bridgewater

Run the complete State 1 walkthrough on Bridgewater.

1. Open the app, load Bridgewater project
2. Confirm `comfort_band.lower_c=20, upper_c=26` in project settings
3. Navigate to /building
4. Confirm no Live Results Panel (Brief 25 verification — should still hold)
5. Inputs: Geometry, Glazing, Shading, Permanent Openings, Fabric all present with no operable window inputs (Brief 25 verification — should still hold)
6. Click Heat Balance tab in centre canvas
7. Confirm "Envelope only — no occupancy, no systems, no operable windows" badge prominent
8. Confirm gains side: solar by orientation only, no people/equipment/lighting flows
9. Confirm losses side: conduction by element (walls, roof, floor, glazing), ventilation split into fabric leakage + permanent vents distinctly
10. Confirm demand rows below the balance: heating MWh, cooling MWh, overheating hours, underheating hours
11. Confirm comfort band editor showing 20 / 26
12. Adjust comfort band to 21 / 25 — live engine re-computes, demand values change
13. Adjust back to 20 / 26
14. Trigger Re-run State 1 Simulation
15. Confirm new State 1 simulation appears in run history
16. Toggle Live ↔ Simulation engine — values agree within tolerance, engine flag silent or soft
17. **Critical isolation test:** open /operation in a separate tab, tick operable windows on F1 with a busy schedule, save. Navigate back to /building → Heat Balance. The State 1 numbers must be **unchanged**. The operable window has zero effect on State 1.
18. **Critical isolation test 2:** in another tab, go to /profiles or /gains (whichever holds internal gains), set lighting to 100 W/m² (absurd), save. Navigate back to /building → Heat Balance. State 1 numbers must be **unchanged**.

**Expected Bridgewater State 1 numbers:**
- Heating demand: 30–60 MWh/yr
- Cooling demand: 5–15 MWh/yr
- Overheating hours: 200–600
- Underheating hours: 1500–3500

If any number falls outside these ranges, **stop and investigate** before reporting complete.

**SCREENSHOTS:**
1. /building Heat Balance tab showing complete State 1 view with badge, demand rows, comfort band editor
2. Comfort band changed to 21 / 25 showing updated demand values
3. Run history view showing both full and State 1 simulations distinguishable
4. Engine breakdown popup showing per-line agreement between live and EP
5. Side-by-side: /building Heat Balance (State 1) vs /results Heat Balance (full) — no regression in full mode

**Commit message:** "Part 10: State 1 envelope-only computation — full integration verified end-to-end"

**Verify — final report:**
- State 1 envelope-only mode in live engine: ✓/✗
- State 1 EnergyPlus simulation path: ✓/✗
- Heat Balance honours envelope-only mode: ✓/✗
- Building module mounts envelope-only forced: ✓/✗
- Comfort band project-level input: ✓/✗
- Comfort band inline editor: ✓/✗
- Engine agreement flag three-tier: ✓/✗
- Simulation persistence two-tier: ✓/✗
- Provenance scaffolding in place: ✓/✗
- Bridgewater State 1 numbers in expected ranges:
  - Heating: [X] MWh (expected 30–60)
  - Cooling: [X] MWh (expected 5–15)
  - Overheating: [X] hours (expected 200–600)
  - Underheating: [X] hours (expected 1500–3500)
- Contract isolation verified:
  - Operable windows in /operation have zero impact on State 1: ✓/✗
  - Internal gains in /gains have zero impact on State 1: ✓/✗
- Engine agreement: [silent / soft flag / warning], worst line item [X] at [Y]%
- Browser console: zero red errors across walkthrough
- /results Heat Balance full mode regression: clean

---

## After all 10 parts are complete

Update STATUS.md with:
- All 10 parts completed
- State 1 envelope-only mode implemented in both engines per `state_contracts.md` v2
- Bridgewater State 1 numbers as the reference baseline for future work
- Comfort band as a project-level input
- Two-tier simulation persistence in place (foundation for State 4 baselines)
- Provenance scaffolding in place (foundation for State 4)
- Engine agreement flag system (informational, never blocking)
- Known divergences (if any) in `docs/state_1_divergences.md`
- Suggestions for Brief 27 (Systems Inspector framework + Space Heating + DHW Inspectors)
- Suggestions for Brief 29 (Internal Gains module — State 2 with unified gain card pattern, kills /profiles editor)

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 26 complete. State 1 envelope-only computation in place per the state contract. Bridgewater State 1: heating demand [X] MWh, cooling demand [X] MWh, overheating [X]h, underheating [X]h — all within expected ranges. Building module Heat Balance now shows clean State 1 visual: solar gains in, conduction + ventilation losses out, heating/cooling as derived demand rows, comfort band editable inline. Contract isolation verified — operable windows in /operation and internal gains in /profiles have zero effect on State 1. Engine agreement [silent/soft/warning] — worst line item [X] at [Y]%. Two-tier simulation persistence in place (foundation for State 4 baselines). Provenance scaffolding in place (foundation for State 4). Ready for Brief 27 (Systems Inspectors) and Brief 29 (Internal Gains, State 2)."
