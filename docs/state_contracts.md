# NZA-Sim State Contracts (v2.5)

**Status:** Canonical. Every brief that touches computation, UI, or data flow must conform to this document.

**Changes from v2.4 (Brief 28f Part 1 — State 3 systems contract sharpening, 2026-05-15):**

The State 3 section is refined to reflect Brief 28f's scope decisions, which
codify what State 3 is and — equally important — what it deliberately is not.

1. **Heating and cooling each gain a primary + optional secondary split.**
   v2.4 treated each as a single system. Real buildings often run dual systems
   (e.g. ASHP primary + gas boiler backup for heating, VRF primary + DX backup
   for cooling). v2.5 introduces `primary` and `secondary` sub-systems per
   service with a `primary_pct` allocation (0–100; secondary = 100 − primary).
   Each sub-system references a library `system_template` for efficiency
   and fuel.

2. **DHW also splits into primary + optional secondary** (vocabulary mirrors
   heating/cooling for consistency, not because of any operational order —
   DHW is often dual-fuel by design, e.g. gas boiler primary + electric
   immersion secondary). `systems.dhw.primary` + `systems.dhw.secondary`
   with `systems.dhw.primary_pct` allocation.

3. **DHW circulation pump is a flat field, not a sub-system.** Modelled as
   `systems.dhw.circulation_pump_w` (continuous electrical baseload) plus
   `systems.dhw.circulation_schedule_ref` (optional — defaults to 8760 h
   on). NOT counted in primary or secondary delivered/fuel. Reported as its
   own line in the energy output.

4. **Mechanical ventilation becomes an array of independent systems.** v2.4
   modelled a single `systems.ventilation` block. v2.5 lifts this to
   `systems.ventilation[]` — an array of `{id, library_id, flow_l_s,
   sfp_w_per_l_s, hre, schedule_ref}` per system. Sum across systems gives
   total fan energy and total heating-offset from heat recovery.

5. **V1 efficiency representation = scalars only.** SCOP, SEER,
   `seasonal_efficiency`, COP — whichever metric is appropriate for the
   system type. **No performance-curve lookups in V1.** Curves can be added
   later only if calibration reveals they're needed; doing so requires a
   contract version bump. This is a deliberate simplification to keep V1
   tractable and to defer complexity to where evidence demands it.

6. **Dual-function library items.** A library `system_template` declares
   which services it supports via `supports_services: ['heating', 'cooling',
   'dhw'?]` and carries the per-service efficiency fields it needs (e.g.
   `heating_scop`, `cooling_seer`). The same `library_id` may be referenced
   from `systems.heating.primary` AND `systems.cooling.primary` when one
   physical unit does both jobs (e.g. VRF with heat recovery; ASHP with
   reversing valve). Energy bookkeeping still attributes delivered + fuel
   to each service independently.

7. **Library-id is strict; engine halts on missing required field.** Every
   sub-system MUST reference a `library_id`. Hardcoded efficiency values are
   forbidden in engine and UI. If a required field is missing in the
   referenced library item (e.g. HRE on a ventilation template,
   `heating_scop` on a heating template, `cooling_seer` on a cooling
   template), the engine halts with a `MissingLibraryField` error that
   names the sub-system path AND the missing field. No silent defaults.
   This is the same single-source-of-truth discipline that governs
   constructions (per CLAUDE.md).

8. **Building-level setpoint per service** — `systems.heating.setpoint_c`
   and `systems.cooling.setpoint_c`. Sub-systems share the service setpoint.
   This is a deliberate single-zone simplification for V1; multi-zone
   setpoints land with the later multi-zone brief.

9. **New `energy_use` output shape: per-fuel × per-service × per-system.**
   v2.4's flat `consumption` (fuel totals only) and `end_use` (service
   totals only) blocks are replaced by `energy_use`, which exposes all three
   dimensions simultaneously. This shape enables calibration against
   sub-metered electricity data (e.g. "the chiller circuit is metered
   separately — does the model's `energy_use.electricity.cooling.primary`
   match the meter?") without restructuring outputs later. `eui_kwh_per_m2`
   and `carbon_kg_co2_per_m2` remain as top-level convenience aggregates.

10. **Explicit out-of-scope list for State 3 at 28f.** Per-zone systems,
    distribution losses, non-DHW pumps, air curtains (Brief 28e), and
    on-site renewables are all explicitly excluded. Each future relaxation
    requires a contract version bump.

11. **Verification tightened to five gates.** Hand-calc per system at ±2%,
    byte-identity on shared physics (State 1/2 outputs pass through
    unchanged), ideal-loads regression (State 3 reduces to State 2.5 demand
    at COP=1.0 / HRE=0), A1/A2 sensitivity tests pass with percentages
    unchanged (demand scales, splits constant), EUI plausibility as sanity
    check (not halt gate).

The v2.4 changes (multi-profile gains, full exception schedules, canvas
schedule editor, load-type library) carry forward unchanged. State 1 / State
2 / State 2.5 sections are untouched.

**Owner:** Chris.
**Version:** 2.5 (May 2026).

---

**Changes from v2.3 (Brief 27 Revised Part 6 — Internal Gains walkthrough):**

The Part 5 walkthrough on Bridgewater surfaced three architectural decisions
that grew Brief 27 from 9 parts to 11 parts. v2.4 codifies them in the
contract so the remaining Internal Gains work, future Operation v2 work,
and any other module with primary schedule-editing activity all conform
to the same shape.

1. **Lighting and Equipment are arrays of profiles, not single quantities.**
   Real-world buildings have load-type-aware splits — a hotel has bedroom
   lighting + corridor lighting + exterior lighting, each with its own
   LPD, relationship-to-occupancy, and schedule. v2.3's single-quantity
   `gains.lighting` and `gains.equipment` collapsed this to a building
   average and made it impossible to distinguish (for example) corridor
   24/7 baseload from bedroom proportional. v2.4 introduces a
   `profiles[]` array with `area_share` weighting per profile; sum across
   profiles equals 1.0 of GIA. Occupancy stays a single object (it has
   no analogous load-type split).

2. **Exception periods are full editable schedules, not date ranges
   inheriting the default curves.** v2.3's exceptions captured name +
   date range only, with hourly profile inherited from the parent
   schedule — making "Christmas shutdown" only useful if Christmas
   happened to follow the same hourly pattern as the rest of the year.
   v2.4 lifts each exception to a full `{weekday, saturday, sunday}`
   schedule editable independently of the parent, with an
   `ignore_monthly_multipliers` toggle for exceptions that should also
   bypass seasonal modulation. Exceptions get an `id` for stable
   referencing and an optional `icon` for visual identity.

3. **Schedule editor placement: centre canvas, not left panel.** For any
   module where schedule editing is a primary activity (Internal Gains,
   future Operation v2), the schedule editor is a canvas-level workspace
   rather than a left-panel input. The 288 px left panel constrains
   schedule editing to the point of frustration; the centre canvas has
   the room to host a proper editing surface with quick-set tools, an
   annual heatmap, and inline exception-period authoring. Left panel
   holds magnitude / structural inputs + a read-only mini-profile of
   the current schedule; centre canvas hosts the editor itself. UI
   principle #3 (centre canvas max ~1000px) is overridden for the
   schedule editor — the annual heatmap and 8760-hour visualisations
   earn full width.

4. **Load-type library.** A small canonical set of building-type-aware
   default load splits (hotel / office / school / retail). Used by the
   "Add profile" affordance to offer sensible starting profiles. Defined
   in `frontend/src/data/loadTypeLibrary.js`. Users can rename, add
   custom profiles, or use "Custom" for non-standard splits.

The State 2 expected ranges revised in v2.3 (BREDEM-derived,
docs/state_2_expected_ranges.md, updated again post-Part 2 diagnostic)
carry forward unchanged at the headline / aggregate level. Per-profile
ranges aren't BREDEM-derivable a priori — the headline aggregate is what
verifies.

**Owner:** Chris.
**Version:** 2.4 (May 2026)

---

**Changes from v2.2 (Brief 27 Part 0):**
- State 2 reframed around occupancy as a first-class building property
  (not nested under gains). Lighting and equipment derive from occupancy
  by default via a `relationship_to_occupancy` field, with override to
  independent schedules.
- State 2 expected ranges for Bridgewater rewritten to be BREDEM-derived
  and anchored to the post-Brief 26.2 State 1 baseline. The v2.2 ranges
  (15–40 MWh heating, 20–50 MWh cooling) were gut-feel from before the
  discipline rule landed and have been retracted. Full derivation in
  `docs/state_2_expected_ranges.md`.
- Discipline rule extended: expected ranges must be derived analytically
  **before** the relevant brief begins, not during it. (Brief 26 was
  caught mid-flight by retroactive BREDEM; we don't repeat the mistake.)
- Open contract question #5 (schedule preset library schema) resolved
  inline — see Schedule preset library section.
- Exception period mechanism added — schedules carry 0–5 named
  date-ranged exception periods that override the default pattern (e.g.
  Christmas shutdown, summer holiday, exam week).
- Schedules live inline in the gain card / occupancy section; the
  standalone `/profiles` route is deprecated and slated for deletion in
  Brief 27 Part 9.
**Owner (v2.3):** Chris.
**Version (superseded by v2.4 above):** 2.3 (May 2026)
**Changes from v2.2 (Brief 27 Part 0) — summarised above.**

**Version:** 2.2 (May 2026)
**Changes from v2.1:**
- State 1 verification ranges revised to standard UK 2018-vintage hotel construction (the as-built Bridgewater reference), not Passivhaus targets. Reference scenario explicitly documented with fabric U-values, q50 airtightness, and trickle-vent area so subsequent verifications can reproduce the inputs deterministically.
- Open contract question #6 (verification ranges for States 2–4) given a stronger answer: every expected range must be backed by an independent first-principles calculation with stated fabric / occupancy / systems spec. The State 1 v2.2 ranges are the worked example.

**Changes from v2.0:** v2.1 defined the full provenance schema (storage shape, default values, helper API contract); enum values unchanged.

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

Every input in `building_config`, `gains_config`, `operation_config`, `systems_config` has a `provenance` field tracking where the value came from.

**Enum values (unchanged from v2.0):**

- `user_entered` — directly typed/selected by user
- `spec_sheet` — entered with reference to manufacturer or project documentation
- `vintage_default` — pulled from a building-stock library based on age band
- `benchmark` — pulled from CIBSE TM46/TM54 or equivalent
- `inferred` — derived from another input or measured data
- `calibrated` — adjusted by State 4 reconciliation, with link to adjustment log entry

**Storage shape (v2.1 addition).** Provenance lives in a sibling `_provenance` object next to the values it annotates, keyed by dot-notated input path relative to the config:

```json
{
  "fabric": {
    "external_wall": { "u_value": 0.28 },
    "_provenance": {
      "external_wall.u_value": {
        "source": "spec_sheet",
        "ref": "WGL800_datasheet.pdf",
        "confidence": "high"
      }
    }
  }
}
```

Per-path record fields:

| Field | Required? | Allowed values | Notes |
|---|---|---|---|
| `source` | yes | one of the six enum values above | the only mandatory field |
| `ref` | optional | string | filename, URL, manufacturer code, library name, adjustment-log entry id |
| `confidence` | optional | `'high'` \| `'medium'` \| `'low'` | the user's stated confidence in the value, NOT statistical |
| `recorded_at` | optional | ISO 8601 timestamp | when this provenance was set |

**Default for unspecified inputs:** `{ source: 'user_entered', confidence: 'medium' }`. The helpers (see below) return this when no record exists at the requested path. State 4 treats absence-of-provenance as `user_entered/medium`.

**Helper API contract.** Implementations must expose four helpers, available identically on both frontend (`frontend/src/utils/provenance.js`) and backend (`nza_engine/utils/provenance.py`):

- `getProvenance(config, path) → { source, ref?, confidence?, recorded_at? }` — read; falls back to the default record above when the path has no entry.
- `setProvenance(config, path, record) → updated_config` — write or replace; immutable, returns a new config with the `_provenance` block updated. `record.source` is required; other fields optional.
- `clearProvenance(config, path) → updated_config` — remove a single entry (so it falls back to default). Used when a previously-set provenance is no longer valid (e.g., user replaces a spec-sheet value with a fresh manual override).
- `listProvenance(config) → [{ path, ...record }]` — enumerate every provenance entry currently set, with the resolved record. Used by State 4 reconciliation and by future UI surfaces (provenance audit table).

**State 4 dependency.** State 4 reads the per-input provenance + confidence to weight the bottom-up estimate and to bound the proposed-adjustment ranges (`adjustment_log` entries reference the `calibrated` source). States 1–3 do not require provenance metadata to compute; they should record it when collected but should not branch on it.

**Brief discipline.** Any brief that adds inputs to the data model must:
1. Default the new field's provenance to `user_entered/medium` when written via the UI.
2. Expose a way for the user to mark provenance as `spec_sheet`, `benchmark`, etc. (UI not required immediately — recording is sufficient).
3. Not block on missing provenance — read should always return at least the default record.

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

### Occupancy as a first-class building property (v2.3)

`building_config.occupancy` is a top-level property of the building, NOT a child of `gains`. The rationale:

- People presence is a property of how the building is **used**, not of one of its gain sources. Lighting on/off and equipment active/standby are caused by people being present.
- Many downstream state computations (State 2 gains, future State 3 DHW demand, future ventilation demand) all reference the same occupancy schedule and density. Co-locating them under one input prevents drift.
- It makes the v2.2 anti-pattern (configure people present + lighting off → meaningless combination) syntactically harder.

`gains.lighting` and `gains.equipment` carry a `relationship_to_occupancy` field that controls whether they derive from `occupancy.schedule` or use an independent schedule of their own. The default in seeded projects is `proportional_with_spill` (lighting) and `proportional` (equipment) — the occupancy-derived pattern. Override to `independent` for cases where the user has reason to break the relationship.

### Schedule preset library (v2.3 — Open contract question #5 resolved)

Schedules carry significant shape information (when people are present, when lighting runs, when equipment is active). Re-creating a hotel-bedroom occupancy pattern from scratch every project is friction. Resolution: a preset library that the UI exposes as a starting-point dropdown per input.

Schema (`frontend/src/data/schedulePresets.js` or equivalent):

```js
export const SCHEDULE_PRESETS = {
  occupancy: [
    {
      id: 'hotel_bedroom_overnight',
      name: 'Hotel bedroom (overnight)',
      description: 'Guest present overnight + evening, away during day',
      icon: '🏨',  // optional
      schedule: {
        weekday: [...24 values 0..1],
        saturday: [...24 values],
        sunday:  [...24 values],
        monthly_multipliers: [...12 values],
      },
    },
    // ...6-8 typical patterns: hotel bedroom, office Mon-Fri, school term,
    //   retail open hours, residential, 24/7, etc.
  ],
  lighting: [ /* same shape — patterns for lighting controls */ ],
  equipment: [ /* same shape — patterns for equipment use */ ],
}
```

**Properties:**
- Presets are starting points, NOT first-class library items. Applying a preset populates the schedule fields; from there the user edits in place. Edits do not modify the preset.
- Presets do NOT carry `exceptions` (those are project-specific). Applying a preset preserves any existing exceptions in the target schedule.
- Presets have a stable `id` so re-applying after edits gives a predictable reset.
- The UI may also surface a "Save current as preset…" affordance that adds a project-level custom preset; project presets live alongside the seeded ones in the same dropdown.

### Exception period mechanism (v2.3)

A schedule's default `weekday/saturday/sunday/monthly_multipliers` pattern repeats for every week of the year by default. Real buildings have periods when this pattern breaks down — Christmas shutdown, summer holiday, exam week, conference season. The exception period mechanism captures these without inflating the default schedule to 8,760 explicit values.

Each schedule carries 0–5 named `exceptions[]`:

```js
exceptions: [
  {
    id: 'exc_1',
    name: 'Christmas shutdown',
    icon: '🎄',                  // optional emoji or icon for the heatmap legend
    start_date: '12-22',         // MM-DD
    end_date: '01-05',           // MM-DD; wraps year if end < start
    weekday: [...24 values],     // overrides the default pattern within this range
    saturday: [...24 values],
    sunday:  [...24 values],
    ignore_monthly_multipliers: true,  // if true, skip the monthly multiplier during exception period
  },
  // ...up to 5
]
```

**Behaviour:**
- For any hour, the algorithm checks whether the date falls within any exception's `start_date`–`end_date` window (wrapping year-end correctly). If yes, the exception's day-type curve replaces the default. If no, the default applies.
- If two exceptions overlap, the one defined first in the array wins (deterministic precedence). UI should warn on overlap.
- `ignore_monthly_multipliers` lets a Christmas shutdown read as zero regardless of "December busy season" multiplier.
- The annual heatmap visualisation surfaces exceptions as distinctly-coloured bands so the user can see at a glance that the period exists.
- EnergyPlus emission: each exception period is rendered as a `Schedule:Year` date-ranged override on top of the default `Schedule:Compact`. The live engine's `computeHourlyGains` honours the same lookup logic.

The cap of 5 is a UI affordance, not a contract limit. Briefs introducing more nuanced operational schedules (e.g. State 3 multi-zone HVAC) may need higher limits; revisit then.

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

**Bridgewater reference scenario** (the as-built standard UK 2018-vintage hotel, the canonical State 1 verification target):

| Input | Value |
|---|---|
| Geometry | 60 m × 15 m × 4 floors × 3.2 m → 3,600 m² GIA, 11,520 m³ |
| Wall | U ≈ 0.28 W/m²·K (standard cavity wall, not enhanced, not Passivhaus) |
| Roof | U ≈ 0.18 W/m²·K |
| Floor | U ≈ 0.22 W/m²·K |
| Glazing | U ≈ 1.43 W/m²·K, g-value 0.56 (typical double glazing) |
| Airtightness | q50 ≈ 7 m³/h·m² (vintage default, no blower-door test) |
| Permanent openings | 138 trickle vents × ≈ 7,000 mm² equivalent area each (Renson Invisivent EVO AK) |
| Weather | Yeovilton TMYx (~51.0°N) |
| Comfort band | 20°C lower, 26°C upper |

Expected State 1 envelope numbers for this reference:

| Output | Range |
|---|---|
| Heating demand | 150–250 MWh/yr |
| Cooling demand | 5–20 MWh/yr |
| Overheating hours | 200–600 |
| Underheating hours | 4,500–6,500 (long-period deficit expected — no system) |

If the fabric inputs change (enhanced spec, Passivhaus retrofit, etc.), the expected ranges shift accordingly. The above is the **as-built standard hotel reference**. Future verifications for different fabric specs should record their inputs + expected ranges in this document or in `docs/state_1_divergences.md`.

If results fall outside the ranges for a given declared fabric spec, the model is wrong — not the ranges.

---

## State 2 — Envelope + Internal Gains

**Module:** Internal Gains (`/gains`)

**Question this state answers:** *Given realistic occupancy, lighting, and equipment, how do the internal gains modify the envelope's heating and cooling demand?*

### Inputs honoured

Everything in State 1, plus the new occupancy and gain inputs introduced in v2.3:

**Occupancy (first-class building property):**

| Input | Source | Path |
|---|---|---|
| Density value + basis | User | `building_config.occupancy.density.{value, basis}` — basis ∈ {`per_room`, `per_m2`, `total`, `per_workstation`} |
| Occupancy rate | User | `building_config.occupancy.occupancy_rate` (0–1, fraction of rooms typically occupied) |
| Sensible / latent heat per person | User or default | `building_config.occupancy.{sensible_w_per_person, latent_w_per_person}` |
| Occupancy schedule | User | `building_config.occupancy.schedule.{weekday, saturday, sunday, monthly_multipliers, exceptions}` |
| Exception periods (0–5) | User | `building_config.occupancy.schedule.exceptions[]` — see Exception period mechanism |

**Gains (multi-profile, v2.4) — Lighting and Equipment as arrays of load-type profiles:**

| Input | Source | Path |
|---|---|---|
| Lighting profiles | User | `building_config.gains.lighting.profiles[]` — array of `{ id, label, magnitude, relationship_to_occupancy, spill_minutes, daylight_factor, schedule?, area_share, _provenance }` |
| Equipment profiles | User | `building_config.gains.equipment.profiles[]` — array of `{ id, label, magnitude, baseload?, active?, relationship_to_occupancy, standby_factor, schedule?, area_share, _provenance }` |
| Radiant/convective splits | Default | (typical values, hidden unless advanced) |

**Per-profile fields** (Lighting):

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable string (e.g. `bedroom_lighting`, `corridor_lighting`, `custom_<uuid>`). Used for keying UI state and engine output. |
| `label` | yes | User-visible name. Defaults to load-type-library label; user can rename. |
| `magnitude.{value, unit}` | yes | Profile's LPD. Unit ∈ {`w_per_m2`, `w_per_room`, `total_w`}. |
| `relationship_to_occupancy` | yes | ∈ {`proportional_with_spill`, `proportional`, `independent`, `always_on`} |
| `spill_minutes` | optional | Used at EP-schedule generation when relationship is `proportional_with_spill`. |
| `daylight_factor` | optional | Fraction during daylight hours (~09:00–16:00 inclusive). |
| `schedule` | only if `independent` | v2.4 schedule shape (see below). |
| `area_share` | yes | Fraction of GIA this profile applies to. Sum across profiles in the same category ≤ 1.0. Used as a weighting factor in single-zone mode; future multi-zone work could repurpose to "applies to zones". |
| `_provenance` | optional | v2.1+ provenance block. |

**Per-profile fields** (Equipment) — same shape as Lighting, except `magnitude` is split into `baseload.{value, unit}` (24/7 occupancy-independent) and `active.{value, unit}` (occupancy-driven). Both optional individually but at least one required.

**Aggregate fields under `gains.lighting` and `gains.equipment`** (not stored — computed):

These are exposed in the engine OUTPUT (see Outputs below); they are not user inputs. The contract specifies they sum from `profiles[]` so the live engine and EP path produce identical aggregates regardless of profile count.

**Why multi-profile** (rationale): real buildings have load-type-aware splits. A hotel has bedroom lighting (proportional to guest presence, with spill), corridor lighting (always-on at low level), exterior lighting (night-only). v2.3's single-quantity `gains.lighting` collapsed these to a building average and made it impossible to distinguish them — even though they have radically different schedules and relationships. v2.4 lets each load type have its own profile with its own relationship semantics. The single-zone weighting via `area_share` keeps the math tractable (sum of per-profile contributions); multi-zone modelling later can repurpose `area_share` to "applies to zones N, M".

**Why occupancy is NOT multi-profile** (rationale carried from v2.3): occupancy is a single building-property concept; people are people regardless of where they sit in the building. Lighting and Equipment are PHYSICALLY varied (different rooms have different luminaires running at different times); occupancy isn't.

**Migration v2.3 → v2.4 (idempotent):** projects with a single-quantity `gains.lighting` are migrated to a single-profile array with `area_share: 1.0`, preserving all other fields. Same for `gains.equipment`. Migration must be idempotent — re-running on an already-migrated project produces the same result. Engine output for migrated projects is byte-identical to v2.3 behaviour (single profile at full area share = the v2.3 single-quantity case).

Schedules are properties of the profile they describe — defined on the same screen as the profile itself, in the centre canvas (see UI rules below). There is no global `/profiles` editor in the State 2 contract; if one exists in the UI, it is deprecated and slated for deletion (Brief 27 Part 11).

**Exception period mechanism (v2.4 — upgraded from v2.3).** Each schedule's `exceptions[]` now carries FULL editable curves per exception, not just date ranges with parent inheritance:

```js
schedule: {
  weekday:             [...24 values],   // 0..1 fraction by hour
  saturday:            [...24 values],
  sunday:              [...24 values],
  monthly_multipliers: [...12 values],   // 0..2, default 1.0
  exceptions: [
    {
      id:         'exc_christmas',
      name:       'Christmas shutdown',
      icon:       '🎄',                  // optional emoji or preset icon
      start_date: '12-22',
      end_date:   '01-05',               // year-wrap supported (end < start)
      weekday:    [...24 values],        // INDEPENDENT — not inherited
      saturday:   [...24 values],
      sunday:     [...24 values],
      ignore_monthly_multipliers: true,  // default true for short shutdowns
    },
  ],
}
```

The v2.3 "inherit from parent" semantic is retracted. v2.4 exceptions are full schedules so a Christmas shutdown can have a genuinely different hourly pattern (close at 12:00 on Dec 24, reopen at 09:00 on Jan 5, etc.) — not just the regular pattern attenuated. Engine processes exceptions in array order: the first whose date range covers the active date wins. Year-wrap (end < start) is supported and treated as two intervals (`start` to `12-31` and `01-01` to `end`).

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

### Outputs (v2.4 multi-profile)

State 1 output shape, plus:

```js
{
  state: 2,
  mode: 'envelope-gains',          // matches stateMode.js MODES.ENVELOPE_GAINS

  gains: {
    // State 1 solar gains carry through unchanged, plus:

    people: {                       // single-object (occupancy is not multi-profile)
      sensible_kwh: number,
      latent_kwh:   number,
      total_kwh:    number,
      peak_kw:      number,
      hours_active: number,
    },

    lighting: {
      profiles: [
        {
          id:           string,    // e.g. 'bedroom_lighting'
          label:        string,
          kwh:          number,
          peak_kw:      number,
          hours_active: number,
        },
        // ...one entry per profile in `building_config.gains.lighting.profiles[]`
      ],
      total_kwh:              number,   // Σ profiles[].kwh
      total_peak_kw:          number,   // max of (Σ-at-each-hour)
      effective_lpd_w_per_m2: number,   // Σ (profile.LPD × profile.area_share)
      total_hours_active:     number,   // hours with ANY profile contributing > threshold
    },

    equipment: {
      profiles: [
        {
          id:            string,
          label:         string,
          kwh:           number,
          peak_kw:       number,
          baseload_kwh:  number,        // sum of profile's baseload component
          active_kwh:    number,        // sum of profile's active component
          hours_active:  number,
        },
      ],
      total_kwh:           number,
      total_peak_kw:       number,
      total_baseload_kwh:  number,
      total_active_kwh:    number,
      total_hours_active:  number,
    },
  },

  state1_delta: {
    heating_demand_change_mwh: number,   // typically negative — gains offset heating
    cooling_demand_change_mwh: number,   // typically positive — gains add to cooling
    overheating_hours_change: number,
    comfort_hours_change: number,
    free_running_temp_change_annual_mean_c: number,
  },

  occupancy_summary: {
    average_occupants: number,           // time-weighted across the year
    peak_occupants: number,
    annual_occupant_hours: number,
  },
}
```

The `state1_delta` is mandatory. State 2 is meaningless without showing
*what gains did to State 1*. Per-profile `kwh` / `peak_kw` are mandatory
in v2.4 — they are the diagnostic users need to answer "which load type
contributes most to cooling demand?" The single-profile case (typical for
migrated v2.3 projects) yields the same aggregate numbers as v2.3 with a
one-element profiles array.

### UI rules (v2.4) — left-panel inputs + centre-canvas schedule workspace

The v2.3 "unified gain card" (inputs + schedule + outputs stacked in a
single column) is retracted. The Brief 27 Part 5 walkthrough showed that
schedule editing in a 288 px left panel is hostile to the work — the
24-bar grid is cramped, monthly multipliers feel like an afterthought,
and exception authoring is impossible at that width. v2.4 separates
input definition from schedule workspace:

**Left panel** holds magnitude / structural inputs + a read-only mini-
profile of the current schedule + an "Edit schedule" affordance that
focuses the centre canvas:

- People / Occupancy section: density (value + basis), occupancy_rate,
  sensible/latent heat per person, read-only mini-profile of the
  occupancy weekday curve, "Edit schedule →" link.
- Lighting section: profile list (each profile shows label, LPD,
  area share, relationship icon, mini-profile thumbnail, [⋯] menu),
  "+ Add profile" affordance with building-type-aware options.
- Equipment section: same shape as Lighting.

Live readouts (annual MWh, peak kW per category) live inside each
section so the magnitude inputs have immediate numeric anchors. These
are input-side feedback, not pre-simulation results — equivalent to a
U-value badge updating as construction layers change.

**Centre canvas** hosts the schedule workspace and diagnostic views via
a context-sensitive tab strip. The first tab is always "Schedule" for
the currently-active gain section, followed by always-available
diagnostic views:

  `[Schedule: <gain>] [State 1 → State 2] [Heat balance] [Free-running] [Hourly profile] [Annual breakdown] [3D Model]`

The "active gain" is the most-recently-expanded or clicked left-panel
section. Default on landing: Schedule: Occupancy (occupancy is the
foundation that lighting + equipment cascade from).

**Schedule editor (centre canvas):**

- Full readable width (~900–1000 px or wider — UI principle #3 exception
  because annual heatmap and 8760-hour visualisations earn the space).
- Preset dropdown ("Apply preset…") with reset.
- Day-type tabs (Weekday / Saturday / Sunday) above the 24-bar grid.
- Drag-paint UX on the bar grid (vertical drag sets fraction, horizontal
  drag paints adjacent bars). Hover readout shows hour + value above.
- Quick-set tools: Flat 0.5, Copy weekday → weekend, Invert, Shift ←/→,
  Apply shape preset.
- Modifier toggles: weekend factor, daylight dimming, always-on
  baseload, holiday weeks. Each modifier composes onto the base curve.
- Monthly variation (12-bar mini-row) below the main grid.
- Exception periods listed below — clicking an exception enters edit
  mode (see Exception period authoring below).
- Statistics panel: peak fraction, average fraction, annual operating
  hours.
- Annual heatmap (year × hour) showing the assembled 8760-hour pattern
  including monthly multipliers and exceptions.

**Exception period authoring (v2.4):**

Each exception is a full-fledged schedule with its own editable curves.
The schedule editor renders an exceptions panel listing the current
exceptions (with date range + icon + duplicate/delete actions). Clicking
an exception enters **edit mode**:

- Schedule editor canvas switches to display the exception's curves.
- A distinct-coloured banner at the top: "✏ Editing: <name> · weeks <n>–<m> · [Save & return to default →]"
- All editing tools (drag-paint, presets, quick-set, modifiers) operate
  on the exception's curves, not the default schedule's.
- Annual heatmap highlights the exception's weeks while in edit mode.

A small set of exception presets ("Christmas shutdown", "Summer holidays",
"Bank holidays", "Custom") let users one-click a common pattern. Year-
wrap (Dec → Jan) is supported.

**Card colour palette (carried from v2.3 with refinement):**

The accent colour appears on the left-panel section header, on the
section's read-only mini-profile, on the centre-canvas schedule bars
when that section is active, and on the corresponding flows in the
Heat Balance view.

- People / Occupancy: violet `#8B5CF6`
- Lighting:           gold   `#F59E0B`
- Equipment:          orange `#FB923C`
- Heating:            red    `#DC2626`
- Cooling:            blue   `#00AEEF`
- Solar:              amber  `#F59E0B` (shared family with Lighting; distinguished by face direction in stacks)

Module identity colour (vermillion `#EA580C` for Internal Gains) lives
purely in structural surfaces: sidebar active indicator, page title bar,
tab strip underline. Gain colours occupy section headers + content;
module accent occupies the shell around them. UI principle #2
(related items in one card) still applies within each gain category.

**State 1 ↔ State 2 toggle:** the State 1 → State 2 delta tab (the
headline diagnostic) directly shows what gains did to State 1 — heating
demand reduction, cooling demand add, overheating hours change, with a
per-profile breakdown so users can attribute the contribution to specific
load types. See the v2.4 output shape for `state1_delta`.

**Load-type library (v2.4):**

Building-type-aware default load splits, used by the "Add profile"
affordance. Defined in `frontend/src/data/loadTypeLibrary.js`:

```js
LIGHTING_LOAD_TYPES = {
  hotel:  ['bedroom_lighting', 'corridor_lighting', 'exterior_lighting', 'back_of_house'],
  office: ['workstation_lighting', 'general_lighting', 'corridor_lighting', 'server_room'],
  school: ['classroom_lighting', 'corridor_lighting', 'sports_hall', 'catering'],
  retail: ['sales_floor', 'display_lighting', 'back_of_house', 'exterior_lighting'],
}

EQUIPMENT_LOAD_TYPES = {
  hotel:  ['guest_equipment', 'refrigeration', 'back_of_house', 'lifts_pumps'],
  office: ['workstation_equipment', 'refrigeration_kitchen', 'server_room', 'lifts_pumps'],
  // ... etc
}
```

Each entry maps to a default profile spec: label, magnitude, default
relationship, default schedule preset, default area_share. The library
is starting-points, not a first-class library item — users edit in
place once a profile is added.

### Verification

State 2 must equal State 1 when all gain inputs are set to zero (sanity check).

**Bridgewater expected State 2 ranges (v2.3 — BREDEM-derived, anchored to post-Brief 26.2 State 1):**

The full derivation lives in `docs/state_2_expected_ranges.md`. Summary:

| Metric | Expected State 2 range | Source |
|---|---|---|
| heating_demand_mwh (live) | 95–125 | State 1 155.1 minus 30–60 gain offset |
| heating_demand_mwh (sim)  | 105–135 | State 1 164.2 minus 30–60 gain offset |
| cooling_demand_mwh (live) | 80–105 | State 1 67.9 plus 15–35 gain add |
| cooling_demand_mwh (sim)  | 55–85  | State 1 45.0 plus 15–35 gain add |
| overheating_hours | 2,400–2,900 | State 1 ~2,050 plus 400–800 |
| underheating_hours | 3,500–4,500 | State 1 ~5,030 minus 500–1,500 (hours migrate to comfort) |
| comfort_hours | 1,500–2,200 | residual |
| annual_mean_c | 19.5–22.0 | State 1 18.8 plus ~1.5–3 K from total gain |
| people_kwh | 50,000–65,000 | 151 effective occupants × 75 W × 14 h × 365 |
| lighting_kwh | 50,000–70,000 | 8 W/m² × 3,457 m² × 1,800–2,500 hrs |
| equipment_kwh | 110,000–150,000 | 3 W/m² baseload + 7 W/m² active × ~1,500 hrs |

**Stated assumptions** (the spec these ranges are tied to):
- Occupancy density 1.5 ppl/room, rate 0.75 (typical UK hotel)
- Hotel-bedroom presence pattern (~14 hrs/day overnight + evening)
- Sensible heat 75 W/person, latent 55 W/person (rest)
- Lighting 8 W/m² LED, proportional to occupancy with 15-min spill, 60% daylight dimming 09:00–17:00
- Equipment 3 W/m² baseload (24/7) + 7 W/m² active (proportional to occupancy with 10% standby)
- All other inputs as per State 1 Bridgewater reference scenario

If the model's Bridgewater output lands outside these ranges, treat it as a model bug unless the user has changed one of the stated assumptions.

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

### Inputs honoured (Brief 28f sharpening — v2.5)

Everything in State 2.5, plus:

| Input | Source | Path |
|---|---|---|
| Heating setpoint (building-level, single-zone simplification) | User | `systems.heating.setpoint_c` |
| Heating primary system (required) | User + library | `systems.heating.primary.library_id` |
| Heating secondary system (optional) | User + library | `systems.heating.secondary.library_id` |
| Heating primary/secondary split | User | `systems.heating.primary_pct` (0–100; secondary = 100 − primary; defaults to 100 if no secondary) |
| Cooling setpoint (building-level, single-zone simplification) | User | `systems.cooling.setpoint_c` |
| Cooling primary system (required) | User + library | `systems.cooling.primary.library_id` |
| Cooling secondary system (optional) | User + library | `systems.cooling.secondary.library_id` |
| Cooling primary/secondary split | User | `systems.cooling.primary_pct` (0–100; defaults to 100 if no secondary) |
| DHW primary system (required) | User + library | `systems.dhw.primary.library_id` |
| DHW secondary system (optional) | User + library | `systems.dhw.secondary.library_id` |
| DHW primary/secondary split | User | `systems.dhw.primary_pct` (0–100; defaults to 100 if no secondary) |
| DHW circulation pump baseload | User | `systems.dhw.circulation_pump_w` (electrical, continuous unless schedule_ref is set) |
| DHW circulation pump schedule (optional) | User | `systems.dhw.circulation_schedule_ref` (defaults to 8760 h on if absent) |
| Mechanical ventilation systems | User + library | `systems.ventilation[]` — array of `{id, library_id, flow_l_s, sfp_w_per_l_s, hre, schedule_ref}` |

### Library reference rules (v2.5)

- **All efficiency / fuel data lives in `system_template` library items.** Engine and UI never carry hardcoded efficiency values. Sub-systems reference a template by `library_id`; the engine resolves the template at run time.
- **V1 efficiency = scalar only.** SCOP, SEER, `seasonal_efficiency`, COP — whichever metric is appropriate for the system type. No performance-curve lookups in V1. Curves are a future contract bump.
- **Dual-function library items are supported.** A `system_template` declares `supports_services: ['heating', 'cooling', 'dhw'?]` and carries the per-service efficiency fields it needs (`heating_scop`, `cooling_seer`, `dhw_seasonal_efficiency`, etc.). The same `library_id` may be referenced from `systems.heating.primary` AND `systems.cooling.primary` when one physical unit does both jobs (e.g. VRF heat recovery, ASHP with reversing valve). Engine attributes delivered + fuel to each service independently from the unit's per-service efficiency.
- **Missing required field is a halt, not a default.** If a referenced template lacks a required field for the service it's being used for (e.g. `heating_scop` missing on a heating primary; HRE missing on a vent template), the engine throws `MissingLibraryField` with the sub-system path AND the missing field name — e.g. `MissingLibraryField: systems.cooling.primary (library_id = "vrf_brand_x_2023") is missing required field "cooling_seer"`. No silent defaults, ever.

### Inputs ignored (Brief 28f — v2.5)

State 3 in 28f is **building-level only**. The following are explicitly out of scope and must NOT be honoured at State 3:

- **Per-zone systems.** One set of systems serves the whole building. Multi-zone HVAC is a later brief.
- **Distribution losses.** End-to-end efficiency convention (CIBSE TM54) — library efficiencies include distribution implicitly.
- **Pumps and fans other than DHW circulation.** No primary-heating pumps, no chiller pumps, no zone valves. The DHW circulation pump (continuous baseload) is the only auxiliary load.
- **Air curtains.** Door-attached; land with Brief 28e (State 2.5 doors).
- **On-site renewables** (PV, solar thermal, wind, batteries). Future brief.

These exclusions are deliberate scope guards for 28f. Future briefs may relax them — each relaxation requires a contract version bump.

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

  demand: { ... },   // from State 2.5, recomputed with Systems setpoints

  // ── Energy use: per-fuel × per-service × per-system ────────────────────
  // The primary output structure. Replaces v2.4's flat `consumption` and
  // `end_use` blocks. Each leaf is kWh/year. Sub-system fields are present
  // only if that service has primary/secondary configured (secondary may
  // be absent). Fuels other than electricity + gas are added by extending
  // the shape (contract bump). At V1, only electricity + gas are emitted.
  energy_use: {
    electricity: {
      heating:   { primary, secondary, total },           // kWh
      cooling:   { primary, secondary, total },
      fans:      { per_system: [{id, kwh}], total },      // mech vent fan electrical
      dhw:       { primary, secondary, circulation, total },
      lighting:  number,                                  // from State 2 internal gains
      equipment: number,                                  // from State 2 internal gains
      total:     number,
    },
    gas: {
      heating:   { primary, secondary, total },
      dhw:       { primary, secondary, total },
      total:     number,
    },
    totals: {
      electricity_kwh:      number,
      gas_kwh:              number,
      delivered_energy_kwh: number,
      eui_kwh_per_m2:       number,
    },
  },

  // ── System performance: delivered + avg efficiency (complementary view) ─
  // Same numbers as energy_use but indexed by service rather than fuel,
  // with the avg efficiency per sub-system surfaced. Useful for inspector
  // panels and the ideal-loads regression test.
  system_performance: {
    heating: {
      primary:   { delivered_mwh, fuel_mwh, avg_cop_or_eff, fuel },
      secondary: { delivered_mwh, fuel_mwh, avg_cop_or_eff, fuel } | null,
      total:     { delivered_mwh, fuel_mwh },
    },
    cooling: {
      primary:   { delivered_mwh, fuel_mwh, avg_eer_or_scop_cool, fuel },
      secondary: { delivered_mwh, fuel_mwh, avg_eer_or_scop_cool, fuel } | null,
      total:     { delivered_mwh, fuel_mwh },
    },
    dhw: {
      primary:               { delivered_mwh, fuel_mwh, avg_eff, fuel },
      secondary:             { delivered_mwh, fuel_mwh, avg_eff, fuel } | null,
      circulation_pump_kwh:  number,    // separate line; not in primary/secondary fuel
      total:                 { delivered_mwh, fuel_mwh },
    },
    ventilation: {
      systems: [{ id, fan_kwh, recovery_mwh, hours_active }],
      total:   { fan_kwh, recovery_mwh },
    },
  },

  // Top-level convenience aggregate; emitted alongside energy_use.totals.
  carbon_kg_co2_per_m2: number,
}
```

**Note on the two output blocks.** `energy_use` is the calibration-facing
shape (fuel-indexed, system-resolved, sub-meter-comparable). `system_performance`
is the engineering-facing shape (service-indexed, surfaces delivered +
average efficiency per sub-system). They report the same underlying numbers
in two indices; consumers pick whichever fits their question. The
ideal-loads regression test compares against `system_performance.*.total`
because that is where the engine-vs-State-2.5 demand check lives most
naturally.

### UI rules

- Each system has an **Inspector** view showing inferred vs. specified vs. defaulted values, and what's actually reaching EnergyPlus.
- Primary + secondary sub-systems are displayed side-by-side with their split percentages; the inspector exposes per-sub-system delivered + fuel.
- DHW shows primary, secondary, and the circulation pump baseload as three distinct rows on the energy-use breakdown.
- Mechanical ventilation systems are listed individually (e.g. "AHU-1 supply 1500 l/s, SFP 1.6, HRE 85%, schedule occupied").
- Inspectors must surface model simplifications honestly (e.g., "Daylight dimming applied as 0.6× LPD scalar — true zone-by-zone daylight modelling not enabled").
- Inspectors must surface setpoint cross-state dependency: "Setpoint X°C drives State 2.5 demand re-computation."
- Energy-use breakdown shown by fuel and by service (the `energy_use` shape carries both indices simultaneously).
- Carbon trajectory uses real fuel split from `energy_use`, not assumed all-electric.
- Dual-function library items surfaced in the inspector: "VRF unit `vrf_brand_x_2023` provides heating (SCOP 3.1) AND cooling (SEER 4.2) from one library entry."

### Verification (Brief 28f discipline)

1. **Hand-calc per system at ±2%.** For each system group (heating primary + secondary, cooling primary + secondary, DHW primary + secondary + circulation pump, mechanical ventilation per system), reproduce the engine's annual fuel + delivered + auxiliary numbers in a spreadsheet from first principles. Match within ±2%. Discrepancies above ±2% halt the brief.

2. **Byte-identity on shared physics.** State 3 must emit byte-identical State 1 outputs (solar gains, fabric losses, free-running T_op) and byte-identical State 2 outputs (internal gains, gains-warmed T_op, State 2 demand integrals) compared to running State 1 / State 2 on the same project. State 3 only adds the system overlay; everything below it must pass through unchanged.

3. **Ideal-loads regression.** State 3 must reduce to State 2.5 demand when all systems are switched to ideal loads (COP / efficiency = 1.0 for delivered:fuel; HRE = 0 for ventilation). With ideal loads, `total.fuel_mwh = total.delivered_mwh = State 2.5 demand_mwh`. This is the regression that proves the system-overlay layer is correctly composed.

4. **Sensitivity tests pass with percentages unchanged.** A1 (double length) — system fuel + delivered should scale ≈ 2×; per-system split percentages unchanged (demand scales, splits constant). A2 (rotate 90°) — system fuel + delivered should shift consistently with State 2.5 demand redistribution; per-system split percentages unchanged.

5. **Library-strict halt is verified by engine test.** A unit test must construct a project with a sub-system referencing a library template missing the required field for that service (e.g. heating primary pointing at a template without `heating_scop`) and verify the engine throws `MissingLibraryField` with both the sub-system path AND the missing field name. Silent default = test fail.

6. **Headline EUI plausibility (sanity check, not halt gate).** Bridgewater State 3 EUI expected in 150–300 kWh/m² (CIBSE TM54 hotel range, per Brief 07 acceptance criteria). Outside-range values trigger investigation, not automatic halt.

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

5. ~~**Schedule preset library schema — what does the preset library look like and where does it live?** Referenced in State 2 UI rules. Needs a schema before State 2 brief.~~ **RESOLVED in v2.3.** Schema defined in Cross-cutting concepts § Schedule preset library. Presets are starting-points (not first-class library items); they live in `frontend/src/data/schedulePresets.js` keyed by gain type (`occupancy`, `lighting`, `equipment`). UI exposes a dropdown per input; applying a preset populates the fields, and from there the user edits in place. A "Save current as preset…" affordance adds project-level custom presets to the same dropdown.

6. **Expected verification ranges for State 2, 2.5, 3, 4** — currently only State 1 has documented Bridgewater bounds. Brief 26 Part 2.5 caught three compounding bugs only because the contract had State 1 ranges to compare against — engine-agreement alone wouldn't have flagged them since both engines share `geometry.py`. Brief 26 Part 3 then revealed that the State 1 ranges themselves were gut-feel (Passivhaus targets, not standard-fabric reality) and had to be revised against a BREDEM-style sanity check. The discipline rule below is the v2.2 answer to this question.

### Discipline rule: expected ranges must be backed by first-principles math

Every expected range in this document — for every state, for every reference scenario — must be:

1. **Tied to a stated fabric / occupancy / systems / operation spec.** "Bridgewater" alone is not enough; the scenario must include U-values, ACH, schedules, system efficiencies, and any other inputs the state's `inputs_used` list reads. Different specs of the same building give different ranges; that is correct, not a contract violation.

2. **Backed by an independent first-principles calculation** (BREDEM, CIBSE TM37, ASHRAE Fundamentals, or equivalent) that uses no NZA Sim code. The range is bounded above and below by physically-defensible margins around that calculation (typically ±30–50% to allow for the divergences catalogued in `state_1_divergences.md`).

3. **Documented in this contract** with the spec, the first-principles result, and the resulting range. So when a future brief reports "model says 175 MWh, range is 150-250", the trail back to "BREDEM says 270 MWh, our model is 35% lower because of thermal mass + solar credit" is followable without re-deriving from scratch.

4. **Derived before the implementation brief begins, not during it** (v2.3). The Brief 26 close-out caught itself mid-flight when retroactive BREDEM revealed the State 1 ranges were Passivhaus targets, not standard-fabric reality. The cost: a contract revision while the implementation was already done. Future briefs that introduce a new state's expected ranges (e.g. Brief 27 for State 2, future Brief X for State 3) must include the BREDEM-style derivation as Part 0 of the brief itself, before any code. Process lesson #5 in `state_1_divergences.md` applies.

The State 1 Bridgewater reference (v2.2) is the worked example. State 2 follows the same pattern with derivation in `docs/state_2_expected_ranges.md` (Brief 27 Part 0). Future state ranges follow the same pattern.

When this discipline lapses — when a range is set by intuition or copy-pasted from another building — the verification gate becomes worse than useless: it either passes everything (range too wide), fails everything (range too narrow), or worst, fails real bugs because the gate didn't catch them. The contract caught itself in Brief 26 Part 3; that's the kind of self-correction this document is meant to enable.

These are tracked as TODOs in this document and resolved as briefs require them.
