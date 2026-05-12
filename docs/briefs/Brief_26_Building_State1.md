# Brief 26: Building Module — State 1 envelope-only

BEFORE DOING ANYTHING:
1. Read `CLAUDE.md`
2. Read `docs/state_contracts.md` — **canonical**. This brief implements State 1. When the brief and the contract disagree, the contract wins.
3. Read `STATUS.md`
4. Read `docs/briefs/Brief_24_Building_Module.md` — the predecessor planning doc. Some scope from Brief 24 still applies; this brief replaces the parts that conflict with the contract.
5. Read this brief in full before writing code.
6. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## Why this brief exists, before any State 3 work

The Building Heat Balance is currently **broken at State 1**:
- Gains side shows **Heating** as a flow (it's a State 3 service, not a State 1 envelope gain).
- Gains side shows **People / Equipment / Lighting** (these are State 2 gains, not State 1).
- Losses side shows **Cooling** (State 3 service) and **Openings — windows** (State 2.5 operation).
- There is no "envelope-only" mode and no comfort band on the Building page.
- There is no derived demand readout (`heating_demand_mwh`, `cooling_demand_mwh`, `underheating_hours`, `overheating_hours`).

State 1 is the diagnostic spine — *what does this envelope do, on its own, against this climate, with no occupants and no systems?* Building the Inspectors of Brief 27 on top of a broken State 1 view stacks complexity on a wrong baseline. **Fix State 1 first.**

This brief also **establishes the state-isolation pattern** on a focused scope. Once mode-threading works for State 1, applying it to States 2, 2.5, 3, 4 is mechanical. Brief 27 will lean on the helpers built here.

---

## State Contract Compliance

**This brief implements State 1 per `docs/state_contracts.md` § State 1 — Envelope only.**

### Inputs honoured (per the contract)
- Building geometry: `bc_length`, `bc_width`, `bc_num_floors`, `bc_floor_height`, `orientation`
- Glazing: `wwr.f{1-4}`, `window_count`, glazing U / g / frame factor (from library)
- Shading: `shading_overhang.f{1-4}`, `shading_fin.f{1-4}`
- Permanent openings: `openings.{face}.louvre_area_m2` + `openings.site_exposure`
- Fabric: `constructions.{external_wall, roof, ground_floor}` (U-values from library)
- Thermal mass: **NEW** — `fabric.thermal_mass_category` (light / medium / heavy)
- Thermal bridging: `psi_value` or `thermal_bridge_factor` on construction library items (Y-factor already wired)
- Airtightness: `infiltration_ach` (existing) — to be replaced with `q50` in a future brief
- Comfort band: **NEW** — `project.comfort_band.{lower_c, upper_c}`
- Weather: EPW (existing)

### Inputs IGNORED (contract violation if read)
State 1 computation **must produce identical output** regardless of any value in:
- `params.num_bedrooms`, `params.occupancy_rate`, `params.people_per_room`
- `systems.*` (everything — lighting, equipment, heating, cooling, DHW, ventilation)
- `openings.{face}.openable_fraction`, `openings.schedule` (operable windows live in `/operation` per Brief 25 — these are State 2.5 inputs)
- Any schedule that isn't `permanent_openings`-related

### Outputs (per the contract)
```js
{
  state: 1,
  mode: 'envelope-only',
  inputs_used: [...],            // list of config paths actually read
  comfort_band_used: { lower_c, upper_c },
  gains: {
    solar: { f1, f2, f3, f4, roof, total },
    // no people, equipment, lighting
  },
  losses: {
    conduction: { external_wall, roof, ground_floor, glazing: { f1..f4 }, thermal_bridging },
    ventilation: {
      fabric_leakage: kWh,
      permanent_vents: kWh,
      // NEVER combined
    },
  },
  free_running: {
    annual_mean_c, winter_min_c, summer_max_c,
    hourly_temperature_c: [...8760],
  },
  demand: {
    heating_demand_mwh,           // derived, not driving
    cooling_demand_mwh,
    underheating_hours,
    overheating_hours,
    comfort_hours,
  }
}
```

Heating and cooling appear **only as derived demand rows below the gains/losses balance** — never as input flows on the gains side.

---

## VERIFICATION RULES

**Browser verification is mandatory.** Open `/building` at 1440×900 after each part. Take screenshots of the Heat Balance view. Check the DevTools console for red errors.

**State isolation regression** (mandatory at every commit on parts 1–5): set `params.num_bedrooms = 1000` (absurd value) and `systems.heating.efficiency = 0.1` (absurd). State 1 output must be **byte-identical** to State 1 output with default values. If anything changes, State 1 is reading something it shouldn't be.

**Engine agreement** (per contract): live engine vs EnergyPlus at State 1 must agree within 5% per line item. If outside that, log to model_health but do not block.

**Bridgewater expected ranges** (per contract):
- Heating demand: **30–60 MWh/yr**
- Cooling demand: **5–15 MWh/yr**
- Overheating hours: **200–600**
- Underheating hours: **1500–3500**

If results fall outside, the model is wrong — not the ranges.

**Three strikes then escalate.** If a part doesn't satisfy verification after 3 attempts, document what was tried and stop.

---

## Part 0 — Mode threading foundation

Establishes the pattern every later state will reuse.

### What lands

1. **`mode` parameter on every state-producing function and component**:
   - `calculateInstant(building, constructions, systems, libraryData, weatherData, hourlySolar, { mode })` — new options arg. Default `mode='state-3'` preserves current behaviour. `mode='state-1'` enters the new path.
   - `GET /api/projects/{id}/simulations/{run_id}/balance?mode=state-1` — query param. Default `state-3`.
   - `POST /api/projects/{id}/simulate?mode=state-1` — query param. Default `state-3`. State 1 runs save into a separate `state_1_runs` table (or use an `is_state_1` flag on `simulation_runs` — implementation choice, contract doesn't mandate).
   - `<HeatBalance mode='envelope-only' ... />` — already takes `mode` for layout (`rows`/`stacked`/`sankey`); add a parallel `state` prop (`state-1` | `state-3`).

2. **Mode-aware helpers** (so individual state paths don't repeat conditionals):
   - `frontend/src/data/balanceColours.js` — add `LOSS_ORDER_STATE_1` (no cooling, no openings_window, replaces single `infiltration` with `fabric_leakage` + `permanent_vents`) and `GAIN_ORDER_STATE_1` (solar only).
   - `frontend/src/utils/stateMode.js` (new) — `isStateOne(state)`, `forbiddenStateOneInputs(state)`, `loadOrderFor(state)`, `gainOrderFor(state)`. Single home for the state-routing logic so subsequent briefs grep for one file.

3. **`state` prop wiring** through:
   - `BuildingDefinition.jsx` — mount `<HeatBalance state='state-1' />`. The Building module is **always** State 1; it never shows State 2/3 view.
   - `flattenLosses` and `flattenGains` in `HeatBalance.jsx` — accept the `state` prop, filter their output through `loadOrderFor(state)` / `gainOrderFor(state)`.

### Verification (Part 0)
- `calculateInstant(..., { mode: 'state-3' })` produces output byte-identical to the current default — pure refactor, no behaviour change yet.
- `calculateInstant(..., { mode: 'state-1' })` returns the State 1 output shape (mostly stubbed — Part 2 fills it in).
- Heat Balance with `state='state-1'`: gains column hides heating/people/equipment/lighting, losses column hides cooling/openings_window.

### Commit
`Brief 26 Part 0: mode-threading foundation for state isolation`

---

## Part 1 — Comfort band as project-level input

### What lands

1. **Data model**:
   - New field `project.comfort_band.{lower_c, upper_c}` on the project row.
   - Defaults: `lower_c = 20`, `upper_c = 26`.
   - Migration: every existing project gets the defaults on read (no destructive backfill needed if the field is read-on-demand).
   - `ProjectContext.jsx` — exposes `comfortBand` + `updateComfortBand` similar to `params` + `updateParam`.

2. **UI**:
   - Heat Balance view (Building module) — small editable card above the gains/losses bars: *"Comfort band: [20]°C ⋯ [26]°C"*. Inputs are number fields with step 1°C, clamped 16–30 lower, 22–32 upper.
   - Editing the comfort band updates the live engine immediately. EnergyPlus picks it up on the next "Run Simulation".
   - Same comfort band card surfaces on the Information module's project metadata block. Single source of truth — both edit the same field.

3. **Both engines read it**:
   - Live calc: replaces the hardcoded heating/cooling setpoint constants (currently `T_heat_setpoint = 21` / `T_cool_setpoint = 24` in `instantCalc.js`) — for **State 1 mode**, use `comfort_band.lower_c` and `comfort_band.upper_c` as the derived-demand bounds. State 3 retains the existing system setpoints. Per contract § Setpoint cross-state dependency.
   - EnergyPlus: in State 1 generation mode (Part 3), use `comfort_band` as the demand bounds. State 3 generation continues to use system setpoints.

### Verification (Part 1)
- Comfort band edit on Heat Balance instantly updates the live engine's State 1 demand readout.
- Information module shows the same comfort band. Edit in either place, the other updates.
- State 3 simulation behaviour unchanged — comfort band only drives State 1 demand and the State 2/2.5 derived demand when no system setpoint is configured.

### Commit
`Brief 26 Part 1: project comfort band (20-26°C default) as State 1 demand basis`

---

## Part 2 — Live engine State 1 path

### What lands

1. **New State 1 path in `instantCalc.js`**. Branches on `mode === 'state-1'` at the top of `calculateInstant`. The path:
   - **Ignores** `building.num_bedrooms`, `building.occupancy_rate`, `building.people_per_room`, all of `systems`, `building.openings.face.openable_fraction`, `building.openings.schedule`. Reads only the contract's "Inputs honoured" list.
   - **Solar gains** — already computed per-face in the hourly loop. Reuse with shading factors. Sum into `gains.solar.{f1..f4, roof, total}`.
   - **Conduction losses** per element — already computed. Surface as `losses.conduction.{external_wall, roof, ground_floor, glazing.f1..f4, thermal_bridging}`. Thermal bridging contribution = Σ (Y-factor × centre-of-element U × area × ΔT). Already in the live calc via `getUValue`'s Y-factor multiplier — extract as a separate accumulator so it surfaces as its own line item.
   - **Ventilation split**:
     - `losses.ventilation.fabric_leakage` — from `infiltration_ach × volume × ΔT × AIR_HEAT_CAPACITY`. (Future Brief: replace with q50-driven AIM-2 or simplified Sherman-Grimsrud — out of scope here.)
     - `losses.ventilation.permanent_vents` — from `permanent_openings`-only `Q = Cd × A_total × √Cw × v_wind` in `openings.{face}.louvre_area_m2`. Reuse the existing openings code path but **only the louvre branch** — operable windows are excluded.
   - **Free-running zone temperature** — simplified lumped-capacitance:
     - `C_zone = thermal_mass_category × gia` (J/K). Categories per CIBSE TM52: `light = 80,000 J/K/m²`, `medium = 160,000 J/K/m²`, `heavy = 280,000 J/K/m²`. Default `light` if `fabric.thermal_mass_category` not set.
     - Hourly: `T_new = T_old + (Q_solar - Q_conduction - Q_vent) × 3600 / C_zone`. Initial `T_old = comfort_band.lower_c`. Clamp to a sane range (-10°C to 50°C) to avoid runaway.
   - **Derived demand**:
     - `heating_demand_mwh` = Σ over hours where `T_free_running < comfort_band.lower_c` of `(comfort_band.lower_c - T_free_running) × (UA_total) × ...`. Simplification: integrate `max(0, comfort_band.lower_c - T_free_running)` × heat-loss-rate.
     - `cooling_demand_mwh` = symmetric for the upper bound.
     - `underheating_hours` / `overheating_hours` / `comfort_hours` — simple counts of free-running T vs band.
   - **Output shape** matches the contract exactly.

2. **The State 3 path is left intact.** All existing behaviour, all existing accumulators, all existing fields. State 1 is additive.

### Verification (Part 2)
- Set `params.num_bedrooms = 1000`. State 1 output unchanged. State 3 output changes (occupancy gains). Regression that proves isolation.
- Compute State 1 demand for HIX Bridgewater with defaults: heating demand falls in 30–60 MWh range.
- Compute State 1 with all glazing g-value bumped to 0.8: cooling demand rises, overheating hours rise. Direction sanity check.

### Commit
`Brief 26 Part 2: live engine State 1 path — envelope-only, free-running temp, derived demand`

---

## Part 3 — EnergyPlus State 1 generation

The simulation path is the canonical answer; live is an approximation for fast feedback.

### What lands

1. **`epjson_assembler.py` accepts `mode='envelope-only'`**:
   - Zero out `People`, `Lights`, `ElectricEquipment` objects (or omit them entirely — cleaner). State 1 has no internal gains.
   - Replace the thermostat setup. Two viable approaches; choose by stub trial first:
     - **Approach A (preferred):** keep `ZoneHVAC:IdealLoadsAirSystem` but with very wide setpoints (`heating_setpoint = -100°C`, `cooling_setpoint = +100°C`). System never engages, zone runs free, EP reports zone temperature each hour. Post-process the free-running temperature against the comfort band to compute demand. **Confirmed working pattern** — same trick used in real EP studies.
     - **Approach B:** strip the thermostat entirely (`ZoneControl:Thermostat` omitted, `ZoneHVAC:IdealLoadsAirSystem` omitted). EP zone temperature floats. Slightly cleaner but EP convergence behaves badly with uncontrolled zones in some weathers.
   - Operable windows: emit only the louvre `ZoneVentilation:WindandStackOpenArea` objects from `_build_openings_objects` — skip openable-window emission entirely in State 1 mode.
   - Don't emit any DHW / VRF / boiler objects in State 1 mode. They're State 3.

2. **`sql_parser.py` State 1 output path**:
   - New `get_heat_balance(sql_path, building_config, weather_file_path, mode='state-1')` branch.
   - Reads `Zone Mean Air Temperature` for each zone, averages weighted by floor area to get building-level hourly `T_free_running[8760]`.
   - Computes `underheating_hours`, `overheating_hours`, `comfort_hours`, `annual_mean_c`, `winter_min_c`, `summer_max_c` from that series against `comfort_band`.
   - Computes derived demand from the free-running temperature + heat-loss rate (same formula as live engine for consistency).
   - Reads conduction losses per element from `Surface Inside Face Conduction Heat Transfer Energy` (already done — keep).
   - Splits ventilation: queries `ZoneInfiltration:DesignFlowRate.Zone Infiltration Sensible Heat Loss Energy` for `fabric_leakage`, and `ZoneVentilation:WindandStackOpenArea.Zone Ventilation Sensible Heat Loss Energy` for the louvre-only `permanent_vents`. (Brief 25 already split these — reuse the attribution helper.)
   - Returns the State 1 output shape — no `consumption`, no `end_use`, no `system_performance`.

3. **Run persistence**:
   - State 1 runs save with `is_state_1 = true` flag (or into a parallel `state_1_runs` table — implementation choice).
   - Run history surfaces State 1 runs alongside State 3 runs with a small "State 1" badge.

### Verification (Part 3)
- Run a State 1 EnergyPlus simulation for HIX. EP `eplusout.err` clean (no severe errors).
- Returned demand within Bridgewater expected ranges (30–60 / 5–15 MWh).
- Live engine vs EnergyPlus agreement within 5% per line item.

### Commit
`Brief 26 Part 3: EnergyPlus State 1 generation — free-running zone, no systems`

---

## Part 4 — Heat Balance UI in envelope-only mode

### What lands

1. **Mount `<HeatBalance state='state-1' />` in `BuildingDefinition.jsx`**. The Building module is locked to State 1.

2. **Visual changes**:
   - **"Envelope only — no occupancy, no systems, no operable windows" badge** at the top of the Heat Balance card. Click for expandable disclosure listing what's not included.
   - Gains column shows solar by face only.
   - Losses column shows conduction by element + `fabric_leakage` + `permanent_vents`. Never combined into "infiltration".
   - **Heating and cooling appear BELOW the bars as derived demand rows**, visually separated from the gains/losses balance. Each row shows: name, MWh, kWh/m²·a, small icon. Red for heating demand, blue for cooling demand.
   - **Comfort hours strip** below the demand rows: a horizontal bar split into `underheating_hours / comfort_hours / overheating_hours` segments, each labelled.
   - **Free-running temperature** mini-stat below the comfort strip: "Annual mean: 18.4°C  ·  Winter min: -2.1°C  ·  Summer max: 31.2°C".

3. **Comfort band editor** above the bars (Part 1 lands the data; this part adds the visual). Two number inputs side by side with a short label *"Comfort band — defines when the envelope is in demand"*.

### Verification (Part 4)
- `/building` shows: badge, solar gains only, conduction + ventilation split losses, heating/cooling **as derived demand below**, comfort hours strip, free-running mini-stats.
- Nothing on the gains side except solar facades.
- Nothing on the losses side except envelope elements + ventilation pair.
- Comfort band edit triggers live re-render.

### Commit
`Brief 26 Part 4: Building Heat Balance in envelope-only mode with derived demand`

---

## Part 5 — Cross-state regression + commit final

Comprehensive verification that State 1 isolation actually holds.

### What lands

1. **State isolation regression test** documented in `STATUS.md`:
   - Step 1: capture the current State 1 output for HIX with default inputs.
   - Step 2: edit `params.num_bedrooms = 1000`, `systems.heating.efficiency = 0.1`, `openings.face.openable_fraction = 0.99 on all faces`, `gains.equipment.epd_w_per_m2 = 100`.
   - Step 3: re-capture State 1 output. **Must be byte-identical** to step 1. If different, state isolation is leaking. Open a debugger.

2. **Engine agreement check** documented:
   - Compare live State 1 output to EnergyPlus State 1 output. Within 5% per line item is silent. 5–10% surfaces the soft flag. > 10% surfaces a persistent warning per contract § Engine agreement.

3. **Bridgewater expected-range check** documented in `STATUS.md` under a new `state_1_acceptance` block.

4. **Documentation updates**:
   - `STATUS.md` — what State 1 looks like now, link to this brief, regression test recipe.
   - `docs/state_contracts.md` — no changes; the contract drove this brief, not the other way round.

### Commit
`Brief 26 Part 5: State 1 isolation verified — Bridgewater within contract bounds, engine agreement < 5%`

**Push.**

---

## What this brief does NOT do

- **State 2 (gains)** — Internal Gains module + unified card pattern. Future Brief 28.
- **State 2.5 (operation) upgrades** — Modes 2 + 3 (temperature-controlled, temperature + occupancy) + night cooling. Currently only Mode 1 is implemented in `/operation`. Future Brief 29.
- **State 3 (systems) Inspectors** — Brief 27, depends on this brief.
- **State 4 (calibration)** — multi-brief scope, depends on State 3 + provenance schema.
- **q50-based infiltration** — contract mentions `airtightness.q50` as the canonical input. This brief uses the existing `infiltration_ach` to avoid a destructive schema change. A future small brief migrates the input.
- **Real AIM-2 / Sherman-Grimsrud for fabric leakage** — contract mentions this; this brief uses the simpler temperature-driven model. Future brief upgrades.
- **Provenance metadata recording** — not required at State 1 (the contract says States 1–3 should record provenance "as it is collected" but does not require it for computation). Defer to Brief 27 where the Inspector form fields make provenance UI natural.

---

## Notes for the implementer

- The state-isolation regression in Part 5 is **non-negotiable**. State 1 must be a closed system — write a quick test harness (a `tests/state_isolation.test.js` file or a Python script) that runs the regression on every commit. If it fails, the brief regresses.
- Use the `stateMode.js` helpers from Part 0 everywhere. Don't sprinkle `if (state === 'state-1')` conditionals through the codebase — that's how state leaks happen.
- The lumped-capacitance free-running model is a **simplified** version of real building thermal dynamics. The contract acknowledges this is a simplification. EnergyPlus is canonical for free-running temperature; live engine is fast feedback. The 5% engine-agreement tolerance applies.
- Thermal mass categories default to `light` if not set. Add a small "Thermal mass" dropdown to the Building module's Fabric section (light / medium / heavy) so users can adjust. CIBSE TM52 values (80k / 160k / 280k J/K/m²) baked in.
- The Heat Balance view's existing layouts (Rows / Stacked / Sankey) all need to render correctly in State 1 mode. Rows and Stacked use `flattenGains` / `flattenLosses` — they'll auto-pick up the State 1 loss order. Sankey uses `LOSS_ORDER` directly — needs the same update.

---

## Estimated effort

| Part | Effort | Why |
|---|---|---|
| 0 — mode threading | M | Touches many call sites, but mechanical |
| 1 — comfort band | S | New project field + two UI cards |
| 2 — live State 1 path | L | Free-running temperature + derived demand + ventilation split is new physics |
| 3 — EnergyPlus State 1 | L | Stripping thermostat, zone temperature post-processing, parser path |
| 4 — Heat Balance UI | M | Layout rework, new visual elements |
| 5 — verification | S | Test harness + STATUS.md updates |

Total: ~5–7 sessions if no surprises. The new physics (free-running temperature) is the biggest unknown.
