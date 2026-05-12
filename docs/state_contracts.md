# NZA-Sim State Contracts (v2)

**Status:** Canonical. Every brief that touches computation, UI, or data flow must conform to this document.
**Owner:** Chris.
**Version:** 2.0 (May 2026)
**Changes from v1:** Added simulation persistence and baselines section. Added comfort band as project-level input. Refined engine agreement to three-tier informational system. Added State 2 unified card pattern. Refined State 2.5 control modes. Documented setpoint cross-state dependency.

---

## Purpose

NZA-Sim models buildings progressively, in four layered **states** (with State 2.5 as an intermediate). Each state adds physical reality to the previous one and produces a defined set of outputs. The progressive structure is the tool's diagnostic spine: every module corresponds to a state, every result is traceable to the state that produced it, and every calibration adjustment is bounded by what its state allows.

This document defines what each state computes, what it ignores, what it outputs, and how it must behave. It is the contract that briefs implement.

When a brief is ambiguous, this document resolves it. When a brief contradicts this document, this document wins.

---

## Cross-cutting concepts

### Simulation persistence and baselines

There are **two engines** that produce results:

- **Live engine** (`instantCalc.js`) — runs on every input change, returns instantly, never saved. It's a calculator showing live consequences.
- **EnergyPlus** — runs explicitly when the user hits "Run Simulation". Each run is a deliberate act with a saved output.

EnergyPlus runs are organised in two tiers:

**Tier 1 — Run history.** Auto-saved when "Run Simulation" is hit. Each run captures:
- Timestamp
- A snapshot of `building_config`, `gains_config`, `operation_config`, `systems_config` at the moment of run
- The `eplusout.sql` file preserved (not overwritten)
- The state-contract outputs at every state level (State 1, 2, 2.5, 3 numbers)
- An auto-generated label ("Run 12 — 14 May 14:32")
- Retention: last 30 runs per project, or last 30 days, whichever is greater

**Tier 2 — Named baselines.** The user explicitly promotes a run to a named baseline. Baselines are the references for scenarios and State 4 calibration. A project can have multiple baselines:

- "Design intent" (the as-spec'd model)
- "Commissioned" (after construction adjustments)
- "Calibrated 2025" (after State 4 work)
- etc.

Baselines never expire. They are append-only — a baseline can be superseded but not deleted (audit trail).

**State 1 envelope-only runs** are saved separately within the same project. They share `building_config` but use the State 1 simulation path (gains zeroed, ideal loads with wide setpoints). Stored under a `state_1_runs` table parallel to the main `simulation_runs` table.

**Scenarios** reference a baseline. Running a scenario re-simulates from the baseline's inputs with the scenario's overrides applied, producing a comparison view. Scenarios do not modify the baseline.

The state contract does not mandate the storage schema — that's an implementation decision. It mandates the behaviour: explicit save points, preserved snapshots, append-only audit, and the ability to reference a baseline from State 4.

### Engine agreement

The live engine and EnergyPlus must produce comparable numbers at every state. Disagreement is **informational, not blocking**:

| Disagreement | Behaviour |
|---|---|
| < 5% per line item | Silent. Both engines valid. Engine toggle works without ceremony. |
| 5–10% | Soft flag in engine toggle area. Click reveals per-line-item breakdown. User can investigate but isn't blocked. |
| 10–30% | Persistent warning, more prominent. Logged in `model_health` per project. User can continue work. |
| > 30% | Hard warning. Numbers may be meaningless. Engine toggle still works but with explicit warning that one engine should not be trusted until investigated. |

Investigation flow: click flag → see per-line-item comparison → identify which item disagrees → documented as known divergence if expected (e.g., simplified thermal mass in live engine), or fixed if not.

The user can always continue work regardless of disagreement level. The system never blocks; it informs.

### Comfort band

Every project has a **comfort band** — a lower and upper indoor temperature bound used for State 1 and State 2/2.5 demand calculation when no system is configured:

- Lower default: 20°C (winter heating threshold)
- Upper default: 26°C (summer cooling threshold)
- Editable inline on the Heat Balance view at any state
- Persisted at project level (`project.comfort_band.{lower_c, upper_c}`)
- Used by both the live engine and EnergyPlus

The comfort band is **not** a Systems setpoint. Systems setpoints (when configured in State 3) override the comfort band for demand calculation in State 2/2.5. The comfort band is the convention used in the absence of Systems input.

### Input provenance

Every input in `building_config`, `gains_config`, `operation_config`, `systems_config` has a `provenance` field tracking where the value came from:

- `user_entered` — directly typed/selected by user
- `spec_sheet` — entered with reference to manufacturer or project documentation
- `vintage_default` — pulled from a building-stock library based on age band
- `benchmark` — pulled from CIBSE TM46/TM54 or equivalent
- `inferred` — derived from another input or measured data
- `calibrated` — adjusted by State 4 reconciliation, with link to adjustment log entry

State 4 requires this metadata to function. States 1–3 do not require it to compute, but should record it as it is collected. Briefs that add inputs to the data model must include provenance handling.

### State independence

States 1, 2, 2.5, 3, 4 must be computable independently. Computing State 3 does not require State 4 inputs. Computing State 1 does not require State 2 inputs to be set. Each state has a defined `inputs_used` list and ignores everything else.

### Setpoint cross-state dependency

This is the one exception to strict state independence. Heating and cooling setpoints affect *demand* (a State 2.5 output), not just *consumption* (a State 3 output). The contract resolves this as follows:

- **When no Systems are configured:** demand is computed against the comfort band (State 1 convention).
- **When Systems are configured with setpoints:** Systems setpoints override the comfort band for demand calculation in State 2 and State 2.5. The setpoint becomes the effective lower/upper bound for that computation.
- **State 1 always uses the comfort band**, never Systems setpoints, because State 1 is "no systems" by definition.

UI implication: when the user changes a Systems setpoint, State 2/2.5 outputs should update because the demand calculation depends on it. The Inspector for the relevant system surfaces this dependency: "Heating setpoint 21°C — used as lower bound for State 2.5 demand calculation."

### Mode threading

Every computation, API endpoint, and component that produces or displays state output **must** accept and honour a `mode` or `state` parameter. Calling a State 1 computation must produce State 1 output regardless of what else is in `building_config`.

---

## State 1 — Envelope only

**Module:** Building (`/building`)

**Question this state answers:** *What does this envelope do, on its own, against this climate, with no occupants and no systems?*

### Inputs honoured

| Input | Source | Path |
|---|---|---|
| Building geometry | User | `bc_length`, `bc_width`, `bc_num_floors`, `bc_floor_height`, `orientation` |
| Glazing ratios per façade | User | `glazing.f{1-4}.wwr`, `window_count` |
| Glazing properties | User | `glazing.u_value`, `glazing.g_value`, `glazing.frame_factor` |
| Shading per façade | User | `shading_overhang.f{1-4}`, `shading_fin.f{1-4}` |
| Permanent openings | User | `permanent_openings.{vent_preset, vent_count, ea_per_vent_mm2, reference_pressure_pa, discharge_coefficient}` |
| Fabric U-values | User | `fabric.{external_wall, roof, ground_floor}.u_value` |
| Thermal mass | User | `fabric.thermal_mass_category` |
| Thermal bridging | User | `fabric.psi_value` or `fabric.thermal_bridge_factor` |
| Airtightness | User | `airtightness.q50` |
| Comfort band | Project | `project.comfort_band.{lower_c, upper_c}` |
| Weather | EPW file | (read from `data/weather/current/` per project) |

### Inputs ignored

State 1 must produce identical output regardless of any value in:

- `gains.*` (people, equipment, lighting — including their schedules)
- `openings.*` operable window fields (`face.openable_fraction`, opening schedule, control mode)
- `operation.*` (window opening logic, purge ventilation, night cooling)
- `systems.*` (heating, cooling, MVHR, DHW — everything)
- Any control schedule outside `permanent_openings`

If a State 1 computation reads any of the above fields, that is a contract violation.

### Computation

For each hour in the 8760-hour annual EPW run:

1. **Solar gain through glazing** by façade, post-shading:
   `Q_solar[f] = WWR[f] × Wall_area[f] × g_value × Frame_factor × Solar_incident[f, hour] × Shading_factor[f, hour]`
   where `Solar_incident` comes from EPW direct + diffuse decomposition and `Shading_factor` from the overhang/fin geometry per Brief 22.

2. **Conduction loss/gain** per element:
   `Q_cond[element] = U × A × (T_in - T_out)`
   where T_in is the free-running zone temperature from step 4 (one-step-lagged for stability) and T_out is the EPW dry-bulb.

3. **Ventilation loss/gain** split into two distinct contributors:
   - **Fabric leakage:** derived from `q50` via the in-service divisor (default 20 for low-rise; configurable). Modulated by wind and stack per AIM-2 or simplified Sherman-Grimsrud.
   - **Permanent vent flow:** orifice equation `Q = Cd × A_total × √(2ΔP/ρ)` where ΔP is wind + stack effective pressure, with `ΔP_ref = 1 Pa` baseline.
   These remain *separately addressable* in the output — never combined into a single "infiltration" number for the user.

4. **Free-running zone temperature:** lumped-capacitance model:
   `dT/dt × (m × c) = Σ Q_solar - Σ Q_cond - Σ Q_vent`
   No setpoint, no system. The zone temperature is what it is.

5. **Demand against comfort band** (derived, not driving):
   - `Heating demand` = ∫ max(0, losses - gains - heat from thermal mass) over hours where free-running T < comfort_band.lower_c
   - `Cooling demand` = ∫ max(0, gains - losses + heat to thermal mass) over hours where free-running T > comfort_band.upper_c
   - These are the energy the envelope would *require* a system to provide. They are outputs, not inputs.

### Outputs

```js
{
  state: 1,
  mode: 'envelope-only',
  inputs_used: [...list of config paths actually read...],
  comfort_band_used: { lower_c: 20, upper_c: 26 },

  gains: {
    solar: {
      f1: kWh, f2: kWh, f3: kWh, f4: kWh,
      roof: kWh,  // if rooflights present
      total: kWh,
    },
    // No people, equipment, lighting in State 1.
  },

  losses: {
    conduction: {
      external_wall: kWh, roof: kWh, ground_floor: kWh,
      glazing: { f1: kWh, f2: kWh, f3: kWh, f4: kWh },
      thermal_bridging: kWh,
    },
    ventilation: {
      fabric_leakage: kWh,
      permanent_vents: kWh,
      // Never combined.
    },
  },

  free_running: {
    annual_mean_c: number,
    winter_min_c: number,
    summer_max_c: number,
    hourly_temperature_c: [...8760 values],
  },

  demand: {
    heating_demand_mwh: number,
    cooling_demand_mwh: number,
    underheating_hours: number,    // hours below comfort_band.lower_c, free-running
    overheating_hours: number,     // hours above comfort_band.upper_c, free-running
    comfort_hours: number,         // hours within band, free-running
  }
}
```

### UI rules

- The Building module mounts the Heat Balance view with `mode='envelope-only'` forced.
- A "**Envelope only — no occupancy, no systems, no operable windows**" badge is visible.
- Heating and cooling are rendered as **derived demand rows below the gains/losses balance**, not as input flows on the gains side.
- An expandable disclosure lists what is not included: people, lighting, equipment, operable windows, mechanical systems.
- The comfort band is shown inline on the Heat Balance chart with editable lower/upper inputs. Changes update the State 1 demand in real time (live engine) and re-run on next "Run Simulation" (EnergyPlus).
- The comfort band edit control is also accessible from the project settings area, but its primary location is on the Heat Balance view itself.

### Verification

State 1 numbers must be consistent between the live engine and EnergyPlus within the engine agreement tolerance (see Cross-cutting concepts).

For Bridgewater (3,600 m² lightweight UK hotel) expected State 1 envelope numbers:
- Heating demand: 30–60 MWh/yr
- Cooling demand: 5–15 MWh/yr
- Overheating hours: 200–600
- Underheating hours: 1500–3500 (envelope alone won't hold 20°C overnight in winter)

If results fall outside these ranges, the model is wrong — not the ranges.

---

## State 2 — Envelope + Internal Gains

**Module:** Internal Gains (`/gains`)

**Question this state answers:** *Given realistic occupancy, lighting, and equipment, how do the internal gains modify the envelope's heating and cooling demand?*

### Inputs honoured

Everything in State 1, plus:

| Input | Source | Path |
|---|---|---|
| People density | User | `gains.people.density_per_m2` |
| Sensible heat per person | User or default | `gains.people.sensible_w_per_person` |
| Latent heat per person | User or default | `gains.people.latent_w_per_person` |
| People weekday schedule | User | `gains.people.schedule.weekday` |
| People weekend schedule | User | `gains.people.schedule.weekend` |
| People monthly multipliers | User | `gains.people.schedule.monthly` |
| Lighting power density | User | `gains.lighting.lpd_w_per_m2` |
| Lighting control scalar | User | `gains.lighting.control_scalar` (1.0 occ-sensing, 1.2 manual, 0.6 daylight dimming) |
| Lighting schedule (same shape as people) | User | `gains.lighting.schedule.*` |
| Equipment power density | User | `gains.equipment.epd_w_per_m2` |
| Equipment schedule (same shape as people) | User | `gains.equipment.schedule.*` |
| Radiant/convective splits | Default | (typical values, hidden unless advanced) |

Schedules are properties of the gain they describe — defined on the same screen as the gain itself. There is no global `/profiles` editor in the State 2 contract; if one exists in the UI, it is deprecated.

### Inputs ignored

- Operable windows
- All systems
- All operational controls

### Computation

State 1 computation runs unchanged. Then for each hour:

1. **Internal gain contribution**:
   ```
   Q_gains_hour =
     (People_density × Sensible_per_person × People_schedule[hour] × Monthly_mult[month])
     + (LPD × Control_scalar × Lighting_schedule[hour] × Monthly_mult[month])
     + (EPD × Equipment_schedule[hour] × Monthly_mult[month])
   ```

2. **Re-solve free-running temperature** with internal gains added to the energy balance.

3. **Re-solve demand against comfort band** (or Systems setpoints if State 3 is configured — see Setpoint cross-state dependency) with the new free-running temperature.

### Outputs

State 1 output shape, plus:

```js
{
  state: 2,
  mode: 'envelope-plus-gains',

  gains: {
    // State 1 gains, plus:
    people: { sensible_kwh, latent_kwh, total_kwh, peak_kw },
    lighting: { kwh, effective_lpd_w_per_m2, peak_kw },
    equipment: { kwh, peak_kw },
  },

  state1_delta: {
    heating_demand_change_mwh: number,  // typically negative — gains offset heating
    cooling_demand_change_mwh: number,  // typically positive — gains add to cooling
    overheating_hours_change: number,
    comfort_hours_change: number,
  }
}
```

The `state1_delta` is mandatory. State 2 is meaningless without showing *what gains did to State 1*.

### UI rules — the unified gain card pattern

State 2 introduces a **unified card pattern** for gain inputs. Each gain (People, Lighting, Equipment) is a single card combining:

1. **Quantity inputs** at the top (density, LPD, EPD, plus sensible/latent for people)
2. **Schedule editor** in the middle (weekday canvas, weekend canvas, monthly multipliers)
3. **Annual output** at the bottom (kWh/yr, kWh/m²/yr, peak kW)

Each card is colour-themed throughout — the accent colour appears on the card border, schedule canvas strokes, monthly multiplier bars, and the corresponding flows in the Heat Balance view.

**Card colour palette:**
- People / Occupancy: purple (`#A78BFA` or your existing People colour from `balanceColours.js`)
- Lighting: gold (`#F0C544`)
- Equipment: orange (`#E97451`)
- Heating: red (`#D63E2A`)
- Cooling: blue (`#3FA7D6`)
- Solar: amber (`#F4A14A`)

**Schedule UX:**
- Weekday canvas: 24-hour bar profile, drag-to-edit, 0.0–1.0 fraction
- Weekend canvas: same shape, separately editable
- Monthly multipliers: 12-bar canvas, 0.0–2.0 scaling factor per month, defaults to 1.0
- Schedule preset library: dropdown to load common patterns ("UK hotel bedroom", "Office Mon-Fri 8-6", etc.) — loads into the canvas as a starting point, then user-editable in place
- No standalone `/profiles` route. Schedules live inside the gain card.

**Live output:**
- Annual energy (kWh/yr and kWh/m²/yr)
- Peak gain (kW and W/m²)
- Hours active (out of 8,760)
- All update in real time as inputs and schedule are adjusted

**Re-running State 1 ↔ State 2 toggle:**
- The Heat Balance view at the bottom of the gain card (or in the centre canvas if mounted there) can toggle between "envelope only" and "with gains" to show the State 1 → State 2 delta directly. This makes the contribution of gains immediately visible.

### Verification

State 2 must equal State 1 when all gain inputs are set to zero (sanity check).

Bridgewater expected State 2 numbers (full hotel occupancy and benchmark equipment):
- Heating demand: 15–40 MWh/yr (down from State 1)
- Cooling demand: 20–50 MWh/yr (up from State 1)
- Overheating hours: 500–1500 (up from State 1)

---

## State 2.5 — Envelope + Gains + Passive Operation

**Module:** Operation (`/operation`)

**Question this state answers:** *Given that occupants and façade controls (operable windows, purge ventilation, night cooling) can respond to comfort, how does passive operation modify demand?*

### Inputs honoured

Everything in State 2, plus:

| Input | Source | Path |
|---|---|---|
| Operable area per façade | User | `openings.f{1-4}.openable_fraction` |
| Opening control mode | User | `openings.control_mode` (see modes below) |
| Opening schedule (Mode 1) | User | `openings.schedule.*` |
| Opening temperature threshold (Modes 2, 3) | User | `openings.temperature_threshold_c` |
| Opening occupancy requirement (Mode 3) | User | `openings.requires_occupancy` |
| Night cooling enabled | User | `operation.night_cooling.enabled` |
| Night cooling trigger | User | `operation.night_cooling.trigger_c` |
| Night cooling target | User | `operation.night_cooling.target_ach` |

### Inputs ignored

- All mechanical systems

### Control modes

**Mode 1: Schedule-only.** Windows are "open" at full openable fraction whenever the schedule value is non-zero. Simplest model. Useful for "rooms get aired in the morning."

**Mode 2: Temperature-controlled.** Windows open proportionally between `temperature_threshold_c` and `temperature_threshold_c + 3°C`. Fully closed below threshold, fully open at threshold + 3°C. Closes during unoccupied hours unless night cooling is enabled. Closer to real behaviour for offices, schools.

**Mode 3: Temperature + occupancy.** Same as Mode 2 but ANDed with occupancy schedule from State 2. Windows can't open when no-one is present. Night cooling (if enabled) operates as a separate path that doesn't require occupancy.

For each mode, the **openable fraction** per façade limits how much opening can happen — it's the maximum, not the actual. Control logic determines when within that range.

**Night cooling** operates separately:
- Triggered when zone temperature exceeds `night_cooling.trigger_c` (default 22°C) during unoccupied night hours
- Adds `night_cooling.target_ach` of outdoor air ventilation
- Stops when zone temperature drops below trigger or occupancy resumes
- Models automated night purge, BMS-controlled openings, or motorised vents

Window opening details (top-hung vs side-hung vs casement) are **not modelled** — the openable fraction is the user-facing simplification. The contract acknowledges this is a substantial simplification given how uncertain occupant behaviour is. UI should surface this honestly: "Occupant behaviour is the largest uncertainty in this calculation."

### Computation

State 2 plus operable airflow. When windows are "open" by their control mode, additional ventilation airflow is added at outdoor air conditions:

`Q_operable_hour = Cd × A_openable × √(2 × ΔP_effective / ρ)`

where `A_openable` is the open fraction × the total openable area at that hour, and `ΔP_effective` includes wind and stack effects.

### Outputs

State 2 shape, plus:

```js
{
  state: 2.5,
  mode: 'envelope-plus-gains-plus-operation',

  losses: {
    // State 2 losses, plus:
    operable_window_ventilation: kWh,
    night_cooling_ventilation: kWh,
  },

  operation_summary: {
    operable_window_hours_open: number,
    operable_window_avg_open_fraction: number,
    night_cooling_hours_active: number,
  },

  state2_delta: {
    heating_demand_change_mwh: number,
    cooling_demand_change_mwh: number,
    overheating_hours_change: number,
  }
}
```

### UI rules

- Operable windows live exclusively in `/operation`. The Building module shows them nowhere.
- The State 2 → State 2.5 delta is shown explicitly.
- The Operation module surfaces the uncertainty disclaimer prominently: "Occupant behaviour is the largest uncertainty in this calculation. Results are indicative of strategy, not guaranteed performance."
- Control mode selection is a prominent radio/segmented control at the top of the openings input card.

### Verification

State 2.5 must equal State 2 when all operable areas are zero. Bridgewater (sealed windows) is a State 2.5 = State 2 case by design — this is the diagnostic that justifies the VRF cooling system.

---

## State 3 — Full (Demand served by Systems)

**Module:** Systems (`/systems`)

**Question this state answers:** *How does the building's demand translate into fuel consumption given the installed systems?*

### Inputs honoured

Everything in State 2.5, plus:

| Input | Source | Path |
|---|---|---|
| Space heating system type and efficiency | User | `systems.heating.{type, cop, efficiency, fuel}` |
| Space heating setpoint | User | `systems.heating.setpoint_c` |
| Space cooling system type and efficiency | User | `systems.cooling.{type, eer, fuel}` |
| Space cooling setpoint | User | `systems.cooling.setpoint_c` |
| Mechanical ventilation type and efficiency | User | `systems.ventilation.{type, sfp, heat_recovery, control}` |
| DHW system type and efficiency | User | `systems.dhw.{type, primary, preheat, efficiencies}` |
| Control schedules | User | `systems.*.control_schedule` |
| Performance curves | Default or user | `systems.*.performance_curves` |

### Inputs ignored

None. State 3 is the full model.

### Setpoint propagation

Per the Setpoint cross-state dependency (Cross-cutting concepts), Systems heating and cooling setpoints **override the comfort band** for demand calculation in State 2 and State 2.5. This means:

- Changing the heating setpoint from 20°C to 22°C re-runs State 2 demand with a higher lower bound, which increases heating demand.
- That new demand becomes the input to State 3 system efficiency calculation.
- Inspectors must surface this: "Setpoint 22°C — drives State 2.5 demand to X MWh, served by this system at COP Y to give Z MWh fuel."

### Computation

State 2.5 demand (computed with Systems setpoints if configured) is served by the configured systems with their efficiencies and performance curves. EnergyPlus is the canonical engine for State 3 — the live engine is an approximation for fast feedback only, particularly weak on system performance curves.

### Outputs

```js
{
  state: 3,
  mode: 'full',

  demand: { ... },  // from State 2.5, recomputed with Systems setpoints

  consumption: {
    electricity_kwh: number,
    natural_gas_kwh: number,
    other_kwh: number,
    total_kwh: number,
    electricity_fraction: number,
    gas_fraction: number,
  },

  end_use: {
    space_heating_kwh: number,
    space_cooling_kwh: number,
    dhw_kwh: number,
    ventilation_fans_kwh: number,
    lighting_kwh: number,
    equipment_kwh: number,
    other_kwh: number,
  },

  eui_kwh_per_m2: number,
  carbon_kg_co2_per_m2: number,

  system_performance: {
    heating: { delivered_mwh, fuel_mwh, avg_cop_or_eff },
    cooling: { delivered_mwh, fuel_mwh, avg_eer },
    dhw: { delivered_mwh, fuel_mwh, avg_eff },
    ventilation: { fan_kwh, recovery_mwh },
  }
}
```

### UI rules

- Each system has an **Inspector** view showing inferred vs. specified vs. defaulted values, and what's actually reaching EnergyPlus.
- Inspectors must surface model simplifications honestly (e.g., "Daylight dimming applied as 0.6× LPD scalar — true zone-by-zone daylight modelling not enabled").
- Inspectors must surface setpoint cross-state dependency: "Setpoint X°C drives State 2.5 demand re-computation."
- End-use breakdown shown by fuel and by service.
- Carbon trajectory uses real fuel split, not assumed all-electric.

### Verification

State 3 EUI for Bridgewater expected in 150–300 kWh/m² (CIBSE TM54 hotel range, per Brief 07 acceptance criteria).

State 3 must reduce to State 2.5 demand when systems are switched to ideal loads — this is the regression that proves State 3 systems are working correctly.

---

## State 4 — Reconciliation

**Module:** Calibration (`/calibration`, or `/reconciliation`)

**Question this state answers:** *Where does the modelled State 3 picture agree and disagree with the measured energy data, and what adjustments — within physically defensible bounds — would close the gap?*

State 4 is not another layer of physics. It is the **reconciliation** between the State 3 model output and the building's actual measured energy data, with explicit confidence tracking and physically-bounded adjustments. It produces a documented argument, not a single answer.

### Inputs honoured

Everything from States 1–3, plus:

| Input | Source | Path |
|---|---|---|
| Measured electricity (annual/monthly/HH) | Bill or meter | `consumption.electricity.*` |
| Measured gas (annual/monthly) | Bill or meter | `consumption.gas.*` |
| Per-series provenance | User-declared | `consumption.*.provenance` |
| Per-series data quality flags | Auto + user | `consumption.*.quality_flags` |
| End-use attribution | User-declared | `consumption.*.end_use_mapping` |
| Per-input confidence on State 1–3 inputs | User-declared | (provenance metadata threaded through `building_config`) |
| Weather actually experienced in measurement period | Real AMY file or EPW match | `consumption.weather_basis` |
| Baseline reference | User | `calibration.baseline_id` (which named baseline to reconcile) |

### Inputs ignored

None. State 4 sees everything.

### Computation

State 4 computation is a workflow, not a single equation. It runs in four passes:

**Pass 1: Confidence-weighted bottom-up estimate.**
For each end-use, generate a value with declared uncertainty:
- From the referenced baseline's State 3 model (with parameter uncertainty propagated)
- From measured sub-metering if present
- From bill split heuristic (e.g. summer baseload vs winter peak via change-point regression)

**Pass 2: Reconciliation gap.**
Compare sum of bottom-up estimates against the measured total bill. Compute:
- The gap (sign and magnitude)
- The propagated uncertainty on the combined estimate
- Whether the gap is within the uncertainty envelope (model consistent with measurement) or outside (something is wrong)

**Pass 3: Pattern diagnosis.**
Decompose the gap by temporal pattern:
- Universal bias (flat across all months) → baseload / unmetered loads / global multiplier
- Heating-season bias → infiltration / heating setpoint / heating schedule
- Cooling-season bias → cooling setpoint / solar shading factor / equipment density
- Shoulder-season bias → simultaneous heating/cooling / control issues
- Weekday/weekend bias → schedule mismatch
- Diurnal bias (HH data only) → occupancy hours / setback behaviour

Each detected pattern points to a small set of candidate parameter adjustments.

**Pass 4: Bounded adjustment.**
For each detected pattern, surface 2–4 candidate adjustments to State 1–3 parameters, each:
- Within the parameter's physically defensible range
- Within the parameter's declared confidence band
- Logged with provenance (timestamp, reasoning, evidence)
- Re-runnable through the model to confirm impact

The user accepts, rejects, or modifies each adjustment. The tool never silently overwrites State 1–3 values.

Accepted adjustments create a **new named baseline** ("Calibrated to 2025 actuals") — the original baseline is preserved.

### Outputs

```js
{
  state: 4,
  mode: 'reconciliation',
  baseline_id: 'baseline_abc123',
  weather_basis: 'amy_2025',

  stack_up: [
    {
      end_use: 'space_heating',
      modelled_kwh: number,
      modelled_uncertainty_pct: number,
      modelled_provenance: 'state3_model',
      measured_kwh: number | null,
      measured_provenance: 'sub_meter' | 'bill_split' | null,
      gap_kwh: number,
      gap_pct: number,
      status: 'within_tolerance' | 'edge_of_band' | 'outside_band',
    },
    // ... one per end-use
  ],

  total_reconciliation: {
    modelled_kwh: number,
    measured_kwh: number,
    gap_kwh: number,
    gap_within_uncertainty: boolean,
    unexplained_kwh: number,
  },

  detected_patterns: [
    {
      pattern: 'heating_season_bias' | 'baseload_creep' | 'simultaneous_heating_cooling' | ...,
      magnitude_kwh: number,
      confidence: 'high' | 'medium' | 'low',
      candidate_adjustments: [
        {
          parameter: 'building_config.airtightness.q50',
          current_value: 7.0,
          proposed_value: 10.0,
          proposed_range: [9.0, 12.0],
          rationale: string,
          impact_kwh: number,
          accepted: boolean | null,
        },
      ]
    }
  ],

  adjustment_log: [
    {
      timestamp: ISO8601,
      parameter: string,
      from_value: any,
      to_value: any,
      reasoning: string,
      evidence: string | null,
      user: string,
    }
  ]
}
```

### UI rules

- State 4 is its own module — does not modify State 1–3 displays.
- The Stack-up view shows the per-end-use reconciliation as a table with confidence bars.
- The Pattern Diagnostic view shows detected patterns as cards, each with "Investigate" leading to the Adjustment Workspace.
- The Adjustment Workspace surfaces candidate adjustments within physically defensible bounds; user can accept, reject, or provide additional evidence (upload blower door result, attach commissioning record, etc.).
- Every adjustment is logged in the `adjustment_log` with full provenance.
- Unexplained residual energy is shown explicitly — the tool never pretends to a precision it doesn't have.
- Accepting adjustments creates a new named baseline, preserving the original.

### Verification

State 4 must satisfy the regression: when all measured data is absent or unattributed, State 4 reduces to "no calibration possible — model output is the answer with State 3 uncertainty bands."

When measured total agrees with modelled total within combined uncertainty, no adjustments are proposed (model already consistent with measurement).

When measured total disagrees beyond combined uncertainty, at least one pattern must be detected and at least one candidate adjustment proposed.

Adjustment log is append-only — reversals append a new entry, never edit or delete an old one.

For Bridgewater calibration target:
- Monthly NMBE within ±5% (ASHRAE Guideline 14)
- Monthly CV(RMSE) ≤ 15% (ASHRAE Guideline 14)
- Adjustments documented with rationale and within physically defensible bounds
- Unexplained residual surfaced if reconciliation cannot close the gap within these tolerances

---

## How briefs implement this document

When writing a brief that touches state behaviour:

1. **Cite the state.** "This brief implements State X per `state_contracts.md`."
2. **Cite the inputs.** List which `inputs_used` paths the brief touches.
3. **Define the outputs.** Match the output shape exactly.
4. **Honour the UI rules.** Badge, deltas, derived-vs-input flows, etc.
5. **Verify against expected ranges.** The Bridgewater expected ranges are the regression test for whether physics is realistic.

When a brief seems to need behaviour outside the contract, the contract is updated **first**, in its own commit, before the brief proceeds.

---

## Open contract questions

These are unresolved and need decisions before the relevant brief is written:

1. **Multi-zone — how does the state contract apply per-zone vs. building-level?** Currently single-zone-per-building. When multi-zone arrives, do State 1–4 outputs report per-zone, per-floor, building-total, or all three?

2. **Provenance schema details — what exact enum values and what schema?** Sketched in Cross-cutting concepts. Needs full definition before State 4 brief.

3. **Weather basis for State 4 — AMY vs TMY matching.** State 1–3 use TMY. State 4 needs measured-period weather. How is this stored and selected?

4. **Sub-metering schema — how is partial sub-metering represented?** E.g., "we have a meter on the HVAC plant but not on individual systems."

5. **Schedule preset library schema — what does the preset library look like and where does it live?** Referenced in State 2 UI rules. Needs a schema before State 2 brief.

6. **Expected verification ranges for State 2, 2.5, 3, 4** — currently only State 1 has documented Bridgewater bounds (heating demand 30–60 MWh, cooling 5–15 MWh, etc.). Brief 26 Part 2.5 caught three compounding bugs only because the contract had State 1 ranges to compare against — engine-agreement alone wouldn't have flagged them since both engines share `geometry.py`. Before each subsequent state is implemented, document its expected ranges (heating/cooling demand, EUI bands, fuel split, key flow magnitudes) so the same discipline applies.

These are tracked as TODOs in this document and resolved as briefs require them.
