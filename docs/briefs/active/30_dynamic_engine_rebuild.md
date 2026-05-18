# Brief 30 — Dynamic Engine Rebuild (Bottom-Up, States 1 → 3)

> **Repo front matter — superseded in active queue by Brief 32 (2026-05-18):**
> **Status:** ACTIVE BUT PAUSED — superseded by Brief 32 (Pause Dynamic, Complete Static, Audit Across Modules) in the active queue until Static is client-ready. Phase 1.1 onwards will resume after Brief 32 closes. Dynamic backend code (`sql_parser.py`, `epjson_assembler.py`, `api/routers/projects.py`, `scripts/test_api_simulate_mode.py`, `scripts/_state1_strip_regression.py`) is FROZEN at HEAD `54407e3` (post Brief 31), not deleted. Brief 32 Part 1 hides Dynamic from the user-facing UI; this brief resumes once Static is shippable.
> **Progress (frozen state):**
> - Phase 0 audit documents committed: `docs/audit/30_ep_outputs_baseline.md`, `30_ep_outputs_required.md`, `30_phase0_schema_lock.md`, `30_phase0_test_rig.md`.
> - Phase 1.0 (precondition): API `mode` parameter binding fix in `api/routers/projects.py` + regression test `scripts/test_api_simulate_mode.py` + checkpoint (a) `docs/audit/30_state1_corrected_baseline.md`.
> - Phase 1.1 (strip) and Phase 1.2 (parser rewrite) NOT STARTED. To be re-authorised after Brief 32 closes.

---

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Supersedes Brief 29 Parts 3–8 (those remain queued; resume after this brief lands).
**Date opened:** 2026-05-17 (overnight)
**Scope:** End-to-end rebuild of the Dynamic engine across all four states. Single deliverable.

---

## What this brief is

This brief makes the Dynamic engine actually Dynamic.

Today, "Dynamic" is a Python re-implementation of the Static heat balance with EnergyPlus's T_zone trace substituted in as the only EP-derived quantity. EnergyPlus emits ~25 Output:Variables — per-surface conduction, transmitted solar, infiltration, ventilation, surface temperatures, the entire physics-resolved heat balance — and the parser reads three of them. The remaining variables are written to SQL and discarded.

Worse, the State 1 envelope-only mode emits the building's real HVAC and ventilation systems and tries to mute them with widened thermostat setpoints. That fails: Issue #13 confirmed 29.5% of hours in T_zone are pinned at exactly 21.0 °C because the VRF terminal units and `DesignSpecificationOutdoorAir` system actively drive the zone toward setpoint regardless of deadband. The "muted setpoint" approach to state suppression is structurally broken.

The same pattern exists at every state. Internal Gains has it. Operation will have it. Systems will have it. The architecture has to change before any further audit work or any further module development is meaningful.

This brief rebuilds Dynamic bottom-up across all four states. Each state stands alone as a defensible physical model. Each is computed by EnergyPlus directly, not by Python re-derivation. Cross-state and cross-engine comparisons become diagnostics, not reconciliations.

The four states:

- **State 1 — Envelope-only.** No occupancy, no gains, no operable openings, no systems. The zone runs free under EnergyPlus's own physics. Free-running T_zone is the headline.
- **State 2 — Gains added.** Occupancy, lighting, equipment, transmitted solar interacting with envelope. Still no operable openings, still no systems. Free-running T_zone with gains.
- **State 2.5 — Operation added.** Operable windows, doors, scheduled vent control. Still no mechanical systems.
- **State 3 — Systems added.** HVAC, mechanical ventilation, DHW, lighting controls. Full operational model. Heating and cooling demand are computed here, from EnergyPlus directly.

---

## Principles — these override every tactical decision

Read these first. If any later instruction in this brief appears to contradict one of these, the principle wins. Flag the contradiction.

### 1. Dynamic computes its own answer

EnergyPlus runs the simulation. The parser reads the simulation results. The parser does not re-derive what EP could have computed. If EP does not emit a quantity, either request the appropriate Output:Variable, or do not display the quantity.

The parser is allowed to: aggregate, sum, convert units, group by category, format for display.

The parser is not allowed to: compute heat balance terms from T_zone; apply `(T_set - T_zone)` expressions; re-implement infiltration flow calculations; estimate solar gains from orientation and weather; compute demand integrals from environmental conditions.

If you find yourself writing a formula in the parser that takes physical inputs and produces a physical output, stop. EP can do this. Request the Output:Variable.

### 2. Static stays as-is

Static is currently defensible (post–Brief 29 Part 1, post-door-fix) and the user trusts it. Do not modify the Static engine in this brief.

The only Static-side change permitted: where the display layer currently shows the same number for Static and Dynamic because Dynamic is re-derived from Static formulas, the display must be updated so that Static and Dynamic numbers come from their own respective sources. Display-layer changes only.

### 3. Dynamic is allowed to disagree with Static

If Dynamic produces 195 MWh and Static produces 210 MWh, that is a finding to be understood, not a problem to be closed. Do not calibrate Dynamic to Static. Do not introduce correction factors. Do not pick the engine output that "looks right" and hide the other.

Both numbers are shown to the user with provenance. The cross-engine delta becomes a diagnostic the user can interrogate. If the divergence cannot be understood, that is itself the finding, surfaced via the open-issues log.

This is the inverse of the architecture today, in which Static is the de-facto reference and Dynamic is re-derived to match its shape. From this brief onward, Static and Dynamic are independent physics implementations producing independent outputs.

### 4. State suppression means object removal, not parameter widening

State 1 "no systems" means no HVAC objects in the epJSON. Not HVAC objects with widened deadbands. Not HVAC objects with availability schedules set to off. **No objects.**

Same for occupancy (no `People` in State 1), gains (no `Lights`, no `ElectricEquipment` in State 1), operable openings (no `ZoneVentilation:WindandStackOpenArea`, no `AirflowNetwork:*` in State 1 or State 2), mechanical ventilation (no `ZoneVentilation:DesignFlowRate` or HVAC-routed OA in States 1, 2, or 2.5).

The state contract is defined by what is in the epJSON, not by what is hidden inside the epJSON.

Refactor any ad-hoc gating into a single shared helper:

```python
def should_emit_for_state(object_type: str, state: str) -> bool:
    """The canonical state-suppression gate. All emission decisions route through here."""
    ...
```

Every emission function calls this helper. No exceptions. No private gating logic in individual emission functions.

### 5. Every quantity displayed has visible provenance

Engine pill (Static / Dynamic) on every number. Methodology note that names the EnergyPlus Output:Variable (Dynamic) or the formula and inputs (Static). Per the Data Discipline rules in the NZA Development Bible and CLAUDE.md.

If a number is shown without provenance, the brief has not been delivered.

### 6. Integrand-vs-display invariant applies to Dynamic

Every term entering a Dynamic-side aggregate must appear in the displayed breakdown. The check that closed for Static in Brief 29 Part 1 (Σ integrand = Σ display = 251.5 MWh) must close equivalently for Dynamic at every state.

For State 1: Σ of per-element conduction (read from EP per-surface variables) + infiltration + solar = Σ of the elements displayed in the Heat Balance view.

For State 2, 2.5, 3: same invariant, including the gain terms, opening flows, and HVAC delivery as applicable.

### 7. No invented mechanisms

If Static and Dynamic disagree, the explanation states the specifics: "Static uses [named simplifying assumption]; Dynamic uses [named EP method]; the difference is approximately [magnitude] for [traceable reason]."

Specifically banned, repeating Brief 29's list and extending it:

- "Lumped 2-node mass artefact"
- "T_zone swings below T_out via sky radiation"
- "Dynamic uses CTF and Static uses 2-node so they're just different"
- "Dynamic is more accurate"
- "Static is more accurate"
- Any unquantified appeal to "engine differences"

Specifics with citations, or silence. If a divergence cannot be explained, mark it UNDEFENDED in `docs/audit/30_FINDINGS.md` and surface it as an open issue.

### 8. Diagnose before fix, at every step

Per the NZA Development Bible's "Diagnose before you fix" rule. If a Dynamic output looks wrong, do not adjust the parser to produce the right number. Add Output:Variable requests, run, read the SQL, understand the EP behaviour, then decide.

---

## Phase 0 — Audit what EP is currently emitting, and what it needs to emit

This phase produces two documents. No code changes. The documents drive Phase 1's strip.

### 0.1 — Current EP Output:Variable baseline

Read `nza_engine/generators/epjson_assembler.py` end to end. List every `Output:Variable` currently requested in any state path. For each, state:
- The exact variable name
- The reporting frequency (Hourly / Detailed / Daily / RunPeriod)
- Whether the parser consumes it (which function in `sql_parser.py`), discards it, or never knew it existed

Write the table to `docs/audit/30_ep_outputs_baseline.md`.

### 0.2 — Required EP Output:Variable list

From EnergyPlus's InputOutputReference and EngineeringReference, identify the variables needed to assemble each state's heat balance directly from EP. Minimum coverage:

**State 1 (envelope-only) requires:**
- `Surface Inside Face Conduction Heat Transfer Energy` (per surface, hourly)
- `Surface Outside Face Conduction Heat Transfer Energy` (per surface, hourly, for diagnostic only — energy balance check on each surface)
- `Surface Window Heat Loss Energy` and `Surface Window Heat Gain Energy` (per window, hourly)
- `Surface Window Transmitted Solar Radiation Energy` (per window, hourly)
- `Zone Infiltration Sensible Heat Loss Energy` (per zone, hourly)
- `Zone Infiltration Sensible Heat Gain Energy` (per zone, hourly)
- `Zone Mean Air Temperature` (per zone, hourly — for display, not for re-derivation)
- `Site Outdoor Air Drybulb Temperature` (hourly — for context)
- `Surface Outside Face Sunlit Fraction` (per surface, hourly — for shading audit per Brief 23 open issue)

**State 2 adds:**
- `Zone People Total Heating Energy` (sensible + latent per zone, hourly)
- `Zone People Sensible Heating Energy` (per zone, hourly)
- `Zone People Latent Gain Energy` (per zone, hourly)
- `Zone Lights Total Heating Energy` (per zone, hourly)
- `Zone Lights Electricity Energy` (per zone, hourly — for the delivered electrical input, separate from the heat gain)
- `Zone Electric Equipment Total Heating Energy` (per zone, hourly)
- `Zone Electric Equipment Electricity Energy` (per zone, hourly)
- `Zone Total Internal Total Heating Energy` (per zone, hourly — the sum, for cross-check)

**State 2.5 adds:**
- `Zone Ventilation Sensible Heat Loss Energy` and `Zone Ventilation Sensible Heat Gain Energy` (per zone, hourly — these report the EP-modelled flow through the operable openings)
- `AFN Zone Infiltration Sensible Heat Loss Energy` / `AFN Zone Infiltration Sensible Heat Gain Energy` (if AirflowNetwork is used)
- `AFN Linkage Node 1 to Node 2 Mass Flow Rate` (per linkage, for diagnostic)
- `Schedule Value` for the opening control schedules (hourly — to confirm what control is doing)

**State 3 adds:**
- `Zone Ideal Loads Supply Air Total Heating Energy` and `Zone Ideal Loads Supply Air Total Cooling Energy` (if IdealLoads)
- For real HVAC: `Heating Coil Heating Energy`, `Cooling Coil Total Cooling Energy`, `Boiler Heating Energy`, `Chiller Electricity Energy`, `Fan Electricity Energy`, `Pump Electricity Energy`, `Water Use Equipment Hot Water Energy`, and the corresponding zone-level `Zone Air System Sensible Heating Energy` / `Zone Air System Sensible Cooling Energy`
- Whichever system-specific variables are required for the systems currently supported (VRF: `VRF Heat Pump Heating Electricity Energy`, `VRF Heat Pump Cooling Electricity Energy`, terminal unit variables; gas boilers: boiler-specific; MVHR: heat recovery effectiveness variables)

Write the required-variable table to `docs/audit/30_ep_outputs_required.md`. Group by state.

### 0.3 — Schema version lock

Confirm the installed EnergyPlus version per `CLAUDE.md`. For each Output:Variable in the required list, confirm the exact name in this EP version. Document any deviations.

This step exists because of Brief 22's lost day on schema field names. Do not skip.

### 0.4 — Test rig

Bridgewater is the canonical test building. Document the file paths and config IDs that produce the current Brief 29 baseline. Capture the post-door-fix Static numbers as reference values:

- Static State 1 heating demand: 194.3 MWh/yr
- Static State 1 fabric losses total: 251.5 MWh/yr
- Static State 1 displayed solar (annual gross): 99.4 MWh/yr
- Static State 1 displayed solar (credited in heating hours): ~57.2 MWh/yr

These are reference values for comparison, **not targets for Dynamic to match.** If Dynamic disagrees, the disagreement is investigated and explained, not closed by adjustment.

---

## Phase 1 — State 1 envelope-only

The simplest possible building model. The zone is bounded by walls, roof, floor, windows. No occupancy. No equipment. No lighting. No HVAC. No operable openings. No mechanical ventilation. The only ventilation is infiltration through the q50-rated envelope. The zone runs free. T_zone is determined by conduction, solar transmission, and infiltration — nothing else.

### 1.1 — Strip the State 1 epJSON

In `epjson_assembler.py`, the State 1 path emits **only**:

- Simulation control objects: `Version`, `Building`, `GlobalGeometryRules`, `RunPeriod`, `Site:Location`, `Site:WaterMainsTemperature` (if required for materials only), `SimulationControl`, `Timestep`, `ShadowCalculation`, `SurfaceConvectionAlgorithm:Inside`, `SurfaceConvectionAlgorithm:Outside`, `HeatBalanceAlgorithm`
- Envelope materials and constructions: `Material`, `Material:NoMass` (where appropriate), `WindowMaterial:*`, `Construction`
- Geometry: `Zone` (one zone per zone in the building config), `BuildingSurface:Detailed` for opaque surfaces, `FenestrationSurface:Detailed` for windows, `Shading:Building:Detailed` only for fixed external shading (not for operable elements)
- Infiltration: `ZoneInfiltration:DesignFlowRate` with the q50-derived flow rate (model 1 in the EP options — flow per zone or flow per exterior area, whichever matches the assembler's existing convention)
- Schedules: `ScheduleTypeLimits` and only the schedules referenced by the objects above (likely just an "always on" schedule for infiltration)
- Outputs: `Output:Variable` requests from Phase 0.2 State 1 list, plus `Output:SQLite` set to SimpleAndTabular, plus required tabular outputs

That is the complete State 1 epJSON. Anything else is removed.

Specifically NOT emitted in State 1:

- No `People`
- No `Lights`
- No `ElectricEquipment`
- No `ZoneInfiltration:EffectiveLeakageArea` if `DesignFlowRate` is already used (one infiltration object per zone)
- No `ZoneVentilation:*` of any kind
- No `AirflowNetwork:*`
- No `ZoneControl:Thermostat`
- No `ThermostatSetpoint:*`
- No `ZoneHVAC:*`
- No `AirLoopHVAC:*`
- No `PlantLoop`, `CondenserLoop`, or `Coil:*`, `Boiler:*`, `Chiller:*`, `Pump:*`
- No `ZoneList`, `ZoneHVAC:EquipmentList`, `ZoneHVAC:EquipmentConnections` (no equipment to list)
- No `DesignSpecification:OutdoorAir` or `DesignSpecification:ZoneAirDistribution`
- No `Sizing:Zone`, `Sizing:System`, `Sizing:Plant` (no system to size)
- No `WaterUse:*`
- No `Output:Variable` requests for variables that can't be produced in this model (those would crash the run or silently emit zeros)

Apply the `should_emit_for_state` gate to every emission function. Audit the assembler after the strip: no function may emit an object based on a private flag — every emission flows through the gate.

### 1.2 — Rewrite the State 1 parser path

In `sql_parser.py`, delete `_get_heat_balance_state1` entirely. Do not adapt it. Do not preserve any of its logic. The function used a Static-shaped formula and contaminated downstream code with its assumptions.

Replace with `_parse_state1_results` that:

- Opens `eplusout.sql`
- Reads `Surface Inside Face Conduction Heat Transfer Energy` for every external opaque surface, accumulates per surface and per category (wall / roof / ground floor)
- Reads `Surface Window Heat Loss Energy` and `Surface Window Heat Gain Energy` per window, accumulates per orientation and total
- Reads `Surface Window Transmitted Solar Radiation Energy` per window, accumulates per orientation and total
- Reads `Zone Infiltration Sensible Heat Loss Energy` and `Zone Infiltration Sensible Heat Gain Energy` per zone, accumulates
- Reads `Zone Mean Air Temperature` per zone hourly — keeps the full 8,760-hour trace
- Reads `Site Outdoor Air Drybulb Temperature` hourly — keeps the trace
- Returns a structured result:

```python
{
    "engine": "dynamic",
    "state": 1,
    "ep_version": <version>,
    "run_id": <id>,
    "zone_count": <n>,
    "annual": {
        "losses_by_category": {
            "external_wall": <MWh>,
            "roof": <MWh>,
            "ground_floor": <MWh>,
            "glazing_conduction": <MWh>,
            "infiltration": <MWh>,
        },
        "gains_by_category": {
            "solar_transmitted": {
                "north": <MWh>, "east": <MWh>, "south": <MWh>, "west": <MWh>,
                "total": <MWh>,
            },
        },
        "totals": {
            "loss_total": <MWh>,
            "gain_total": <MWh>,
            "net": <MWh>,  # gain - loss; in free-running this manifests as ΔT_zone
        },
    },
    "monthly": { same structure, per month },
    "hourly": { T_zone trace, T_out trace, optionally per-element trace if displayed },
    "tzone_stats": {
        "mean": <°C>, "min": <°C>, "max": <°C>, "stdev": <K>,
        "hours_below_18": <h>, "hours_18_to_24": <h>, "hours_above_24": <h>,
        "winter_min": <°C, Jan>, "summer_max": <°C, Aug>,
    },
    "provenance": {
        "outputs_consumed": [<list of EP variable names>],
        "outputs_emitted_unused": [<list>],  # zero in a clean implementation
    },
}
```

There is no demand integral in State 1. No heating MWh. No cooling MWh. Both are meaningless in a free-running envelope-only model — there is no system to satisfy a setpoint and no setpoint defined.

### 1.3 — State 1 UI

In the Building module, when the user selects State 1 and the engine pill is set to Dynamic:

- The Heat Balance view shows the Dynamic-derived envelope loss/gain breakdown
- The Heating Demand and Cooling Demand panels are hidden in State 1 (they are State 3 concepts, not State 1 concepts)
- The headline becomes T_zone summary: mean, winter min, summer max, hours within a user-set comfort band, hours below comfort, hours above comfort
- The Profiles view shows the T_zone trace (Dynamic) overlaid with the Static engine's T_zone trace if available, for visual comparison
- Sankey, stacked, monthly: same structure as today, displaying Dynamic numbers when Dynamic pill is selected

When the engine pill is Static, the existing Static State 1 view is unchanged (Static still has its own demand integral concept, defensible per Brief 29 Part 1).

### 1.4 — Integrand-vs-display invariant, Dynamic side

Add the reconciliation check for Dynamic State 1:

Σ of per-element loss/gain values read from EP and accumulated in `_parse_state1_results` = Σ of values displayed in the Heat Balance view's IN bars + OUT bars.

This check runs every time the parser returns results. Failure logs loudly. The reconciliation row in the Heat Balance view shows the result for both Static and Dynamic.

### 1.5 — State 1 expected behaviour

In a UK building with no internal gains, mass-light or mass-medium construction, q50-rated envelope, and HIX Bridgewater's location:

- Free-running winter T_zone should fall well below the heated comfort band. Expect mean January T_zone in the range 5–12 °C depending on construction mass and infiltration.
- Free-running summer T_zone should rise above the cooling comfort band on sunny days. Expect July afternoon T_zone in the range 25–32 °C depending on solar gain, glazing area, and mass.
- The previous baseline of T_zone clamped at 21.0 °C across 29.5% of hours is impossible in a correctly-stripped State 1 model. If anything resembling that pattern appears, the strip in 1.1 is incomplete.
- Static and Dynamic should produce broadly similar T_zone traces in State 1, since both are solving similar physics with similar inputs. A divergence greater than 2–3 K on monthly means is a finding to investigate before proceeding to Phase 2.

### 1.6 — State 1 sign-off deliverable

`docs/audit/30_state1_FINDINGS.md`:

- Heat balance table for Bridgewater (Dynamic and Static side-by-side)
- T_zone summary statistics (both engines)
- Integrand-vs-display invariant result (Dynamic side)
- Provenance log: list of EP variables consumed, list emitted-but-unused (should be empty)
- Cross-engine divergence table with stated reasons for each delta
- Any UNDEFENDED entries

---

## Phase 2 — State 2 internal gains

Now add the heat sources inside the building. Still no operable openings, still no mechanical systems.

### 2.1 — Add gain objects

In State 2 mode, emit (in addition to all State 1 objects):

- `People` per zone, with `Number_of_People_Schedule_Name`, `Activity_Level_Schedule_Name`, `Sensible_Heat_Fraction` (or autocalculated), and the schedules driving them
- `Lights` per zone, with `Schedule_Name`, `Design_Level_Calculation_Method`, `Watts_per_Zone_Floor_Area`, and `Fraction_Radiant`, `Fraction_Visible`, `Fraction_Replaceable`, `End_Use_Subcategory`
- `ElectricEquipment` per zone, with the same structure as Lights
- All `Schedule:Compact` (or `Schedule:Day:Interval` + `Schedule:Week:Daily` + `Schedule:Year`) objects referenced by the above

Schedules come from the existing Brief 27 Internal Gains schedule infrastructure (the inline schedule editor). Verify the schedules in the emitted epJSON exactly match what Static is using. If they don't, that is a finding — flag in `docs/audit/30_state2_FINDINGS.md`, do not silently reconcile.

The State 2 gating in `should_emit_for_state` returns True for People/Lights/Equipment when state in ("state2", "state2.5", "state3"). False for State 1.

Still no operable openings, still no HVAC, still no thermostat.

### 2.2 — Extend the parser

Add to `_parse_state2_results` (which can share most of its body with `_parse_state1_results` — refactor common logic, do not duplicate):

- All State 1 variables, plus:
- `Zone People Total Heating Energy` per zone, hourly
- `Zone People Sensible Heating Energy` per zone, hourly
- `Zone People Latent Gain Energy` per zone, hourly
- `Zone Lights Total Heating Energy` per zone, hourly
- `Zone Lights Electricity Energy` per zone, hourly (this is the delivered electrical input — should equal the total heating energy for lights since 100% of light electrical input ultimately becomes heat in the zone, plus a check for the radiant/visible/convective split being internally consistent)
- `Zone Electric Equipment Total Heating Energy` per zone, hourly
- `Zone Electric Equipment Electricity Energy` per zone, hourly
- `Zone Total Internal Total Heating Energy` per zone, hourly (sum of the above — for cross-check against the components)

The result structure adds a `gains_internal` block:

```python
"gains_internal": {
    "people_sensible": <MWh>,
    "people_latent": <MWh>,
    "lighting": <MWh>,
    "equipment": <MWh>,
    "total": <MWh>,
    "cross_check_total_from_components": <MWh>,  # for invariant
    "cross_check_total_from_zone_internal": <MWh>,  # for invariant
}
```

The cross-check must agree to within 0.1% — these are the same quantity computed two ways, and EP itself should not produce a divergence. If they do, that is an EP-side issue to investigate (almost certainly an Output:Variable name or scope mistake).

### 2.3 — State 2 UI

When the user selects State 2 and engine pill is Dynamic:

- The Heat Balance view shows envelope losses (from State 1) plus internal gains (new) as IN bars
- T_zone summary now reflects the gains effect — winter T_zone is higher than State 1, summer T_zone is also higher (overheating risk)
- Comfort hours analysis becomes meaningful — how many hours does the building naturally stay within band given gains alone, with no system intervention
- Still no demand integral (no system to satisfy)

When engine pill is Static, the existing Static State 2 view is unchanged.

### 2.4 — State 2 expected behaviour

For HIX Bridgewater (hotel use, 134 rooms, occupancy ~75% average, lighting and equipment per the existing config):

- Internal gains add roughly 60–100 MWh/yr of heat input across the year (sensible only — latent doesn't affect T_zone directly)
- Winter T_zone mean should rise by 3–6 K vs State 1, depending on gain intensity and envelope losses
- Summer overheating worsens — expect more hours above 27 °C than in State 1
- Cross-engine: Static and Dynamic should agree on monthly internal gain totals (since they read the same schedules). They may disagree on T_zone effect because Dynamic resolves the hourly interaction with envelope dynamics while Static's 2-node model treats gains as quasi-steady additions to the zone heat balance. Divergence in T_zone mean of 1–3 K is plausible; larger is a finding to investigate.

### 2.5 — State 2 sign-off deliverable

`docs/audit/30_state2_FINDINGS.md`, same structure as State 1's findings document plus a section on cross-engine gain handling differences.

---

## Phase 3 — State 2.5 operation

Add operable openings and their control logic. Still no mechanical systems.

### 3.1 — Add operable opening objects

In State 2.5 mode, emit (in addition to all State 2 objects):

For each opening flagged `flow_mode: "cross"` or `flow_mode: "single_sided"` in the building config (per Brief 29's data-model recommendation — implement the data model in this brief as part of State 2.5):

- `ZoneVentilation:WindandStackOpenArea` with:
  - `Opening_Area` per opening
  - `Opening_Effectiveness` (the EP-side C_d equivalent; use the per-opening C_d from the building config, not a global default)
  - `Effective_Angle` per orientation
  - `Height_Difference` per stack-driven opening pair (if any)
  - `Minimum_Indoor_Temperature_Schedule_Name`, `Maximum_Indoor_Temperature_Schedule_Name`, `Delta_Temperature_Schedule_Name`, `Minimum_Outdoor_Temperature_Schedule_Name`, `Maximum_Outdoor_Temperature_Schedule_Name`, `Maximum_Wind_Speed` — the control envelope per the user-defined operation logic
  - `Opening_Area_Fraction_Schedule_Name` — the operational schedule

For each opening flagged `flow_mode: "balanced_mechanical"`: do not emit in State 2.5 — these are mechanically-driven and belong in State 3.

If the existing data model has no `flow_mode` field, add it as part of this brief (data model change is in scope here). Default for existing openings: `"cross"` if multiple openings exist on opposite façades; `"single_sided"` if only one façade has openings; user can override per opening.

### 3.2 — Parser extension

Add the State 2.5 variables from Phase 0.2:

- `Zone Ventilation Sensible Heat Loss Energy` and `Zone Ventilation Sensible Heat Gain Energy` per zone, hourly
- If `AirflowNetwork` is used (it is not in this baseline, but flag for future): the AFN-specific variables

The result structure adds a `losses_ventilation` and `flows_ventilation` block per zone, broken down by which openings are contributing.

### 3.3 — State 2.5 UI

When the user selects State 2.5 and engine pill is Dynamic:

- Heat Balance view shows envelope + gains + ventilation losses
- The ventilation row distinguishes infiltration (always present) from operable opening flow (operational)
- Profiles view can show opening operation schedule overlaid on T_zone — diagnostic for whether the control logic is doing what the user intended
- Still no demand integral

### 3.4 — Hand-calc cross-check

Per Brief 29's locked permanent-vent methodology, reproduce the topology-aware hand calculation for Bridgewater in `docs/audit/30_state25_FINDINGS.md`, comparing:

- Dynamic engine output for ventilation heat loss
- Hand calculation using the documented method
- Static engine output

These three should agree to within 20% if the assumption set is the same. Divergence is a finding.

### 3.5 — State 2.5 sign-off deliverable

`docs/audit/30_state25_FINDINGS.md`, same structure plus a hand-calc reconciliation section.

---

## Phase 4 — State 3 systems

Add HVAC, mechanical ventilation, DHW, lighting controls. Heating and cooling demand are computed in this state, by EnergyPlus directly.

### 4.1 — Add system objects

In State 3 mode, emit (in addition to State 2.5):

- Thermostat objects: `ZoneControl:Thermostat` per zone, `ThermostatSetpoint:DualSetpoint` referencing heating and cooling setpoint schedules
- HVAC chain per the building config's `systems_config`:
  - For the existing VRF support: `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow`, `AirConditioner:VariableRefrigerantFlow`, the relevant performance curves
  - For IdealLoads (a useful baseline / sizing option): `ZoneHVAC:IdealLoadsAirSystem` per zone
  - For other systems supported: emit the appropriate EP objects (boilers, chillers, fan coils, etc.)
- Mechanical ventilation: `DesignSpecification:OutdoorAir` per zone, routed through the HVAC system if the system supports it, or emitted as `ZoneVentilation:DesignFlowRate` with appropriate scheduling if mechanical extract is the modelled mode
- MVHR / heat recovery objects where applicable: `HeatExchanger:AirToAir:SensibleAndLatent` and the corresponding setup
- DHW: `WaterUse:Equipment`, `WaterUse:Connections`, `WaterHeater:Mixed` or appropriate water heater type
- Lighting controls: `Daylighting:Controls`, `Daylighting:ReferencePoint`, and the modifications to `Lights` objects to use the daylighting fraction
- Sizing: `Sizing:Zone`, `Sizing:System`, `Sizing:Plant` per the existing assembler logic
- ZoneList, EquipmentList, EquipmentConnections as needed

### 4.2 — Parser extension

Add the State 3 variables from Phase 0.2. The result structure adds:

- `demand_heating` (annual + monthly + hourly), read from the appropriate EP variable for the modelled system (`Zone Air System Sensible Heating Energy` per zone, summed across zones, or the IdealLoads variant)
- `demand_cooling` (same structure)
- `delivered_energy` block: electricity by end-use, gas by end-use, district energy if applicable
- `system_performance` block: COP/SCOP if computable, MVHR recovery effectiveness, fan power, pump power
- `dhw` block: hot water energy delivered, primary fuel energy input

The demand integral concept is reintroduced *here*, computed by EP, read by the parser, displayed by the UI. The parser does not compute demand — EP computes demand and the parser reads it.

### 4.3 — State 3 UI

When the user selects State 3 and engine pill is Dynamic:

- Heat Balance view shows the complete picture
- Heating Demand and Cooling Demand panels reappear, showing EP-computed values with engine pill = Dynamic
- Systems Sankey shows EP-derived flows
- Comparison to Static demand becomes meaningful — these are two engines computing the same quantity with different methods, both shown to the user, gap exposed as diagnostic

### 4.4 — State 3 sign-off deliverable

`docs/audit/30_state3_FINDINGS.md`, full heat balance, demand reconciliation, cross-engine comparison.

---

## Display layer changes (across all states)

### Engine pill behaviour

The engine pill on every chart and KPI switches the displayed source between Static and Dynamic. Today, in places, the pill switches the label but not the data because both labels point at the same underlying calculation. Audit every place the pill appears. Each pill state must select genuinely independent data:

- Static pill → values from `instantCalc.js`'s `_calculateStateN`
- Dynamic pill → values from `sql_parser.py`'s `_parse_stateN_results`

Where a number cannot be produced by one engine but can by the other (e.g. State 1 has no demand integral in Dynamic; some EP-specific diagnostics like sunlit fractions have no Static equivalent), the unavailable engine's pill shows the number as N/A or as "—" with a tooltip explaining why.

### Provenance and methodology notes

Every displayed number carries a methodology note (one or two sentences) accessible via hover or expansion:

- Static: name the formula and the inputs
- Dynamic: name the EP Output:Variable, the aggregation method, the reporting frequency

Use the existing methodology-note infrastructure where it exists. Per Brief 29's cleanup, no invented-mechanism language. Specifics only.

### Cross-engine divergence display

Where Static and Dynamic are both available for the same quantity, the UI shows both values and the delta. Today's "fabric gap" diagnostic from POL-M1 (which was −20% pre-fix and is now ~+8% post-door-fix, both built on the contaminated Dynamic) becomes a genuine divergence display showing the Static value, the Dynamic value, the delta, and a one-line note on the dominant reason for the delta if known. If the delta is UNDEFENDED, the note says so, with a link to the open-issues document.

### Removed displays

Anywhere in the current UI that displays a quantity computed by the deprecated parser path (everything `_get_heat_balance_state1`/`state2` etc. produced before this brief): replace with the new parser output or remove.

Remove the POL-M1 "20% fabric gap" diagnostic if it was hard-coded against the contaminated Dynamic. Either point it at the new Dynamic with the new (likely-different) magnitude, or remove the panel until the new Dynamic stabilises.

---

## Cleanup (per Bible "clean up before you build")

Delete:

- `_get_heat_balance_state1`, `_get_heat_balance_state2`, and any other deprecated parser functions that re-derive heat balance terms
- The "Static-shaped formula in Python parser" code path entirely
- Any commented-out blocks left from Brief 29's cleanup
- Any unused imports in `sql_parser.py` and `epjson_assembler.py` after the rewrite
- The deprecated `_issue13_diagnostic.py` script in `scripts/` (move to `docs/audit/` if useful as a reference, otherwise delete)
- Any test fixtures that depended on the deprecated parser shape

Grep for references to deleted function names across the codebase and update or remove. Per the Bible's clean-up rule.

---

## Deliverables checklist

By the end of this brief, the following exist:

- [ ] `docs/audit/30_ep_outputs_baseline.md` — what EP currently emits
- [ ] `docs/audit/30_ep_outputs_required.md` — what EP needs to emit per state
- [ ] `docs/audit/30_state1_FINDINGS.md` — State 1 sign-off document
- [ ] `docs/audit/30_state2_FINDINGS.md` — State 2 sign-off document
- [ ] `docs/audit/30_state25_FINDINGS.md` — State 2.5 sign-off document
- [ ] `docs/audit/30_state3_FINDINGS.md` — State 3 sign-off document
- [ ] `docs/audit/30_open_issues.md` — running list of UNDEFENDED items and other findings
- [ ] `should_emit_for_state(object_type, state)` helper in `epjson_assembler.py`, used by every emission function
- [ ] State 1, 2, 2.5, 3 epJSON paths rewritten per the strip rules
- [ ] `_parse_stateN_results` functions in `sql_parser.py` that read EP outputs directly and never re-derive
- [ ] Integrand-vs-display invariant check active for Dynamic at all four states
- [ ] `flow_mode` field added to the operable_openings data model, with per-opening C_d
- [ ] UI updated: State 1 hides demand panels and shows T_zone summary; Profile view shows engine-specific traces; methodology notes refreshed
- [ ] All deprecated parser functions deleted, grep clean
- [ ] `STATUS.md` updated with Brief 30 close-out
- [ ] `CLAUDE.md` updated with any new rules emerging from this work (likely: the "parser does not compute heat balance terms" rule from Principle 1, and the "state suppression means object removal" rule from Principle 4)
- [ ] Two new Bible lessons appended to the Notion page:

```
| The Dynamic engine in any tool that wraps a slow authoritative simulator (EnergyPlus, IES, TAS, etc.) must consume that simulator's own outputs as the source of truth for displayed quantities. If a layer between the simulator and the UI re-implements the calculation, that layer IS the engine, regardless of what the UI calls it. The wrapper's job is to request, read, aggregate, and display — never to compute physical quantities the simulator can produce. | NZA-Sim Brief 30, May 2026 |

| State suppression in a multi-state model must remove the relevant objects from the simulation, not mute them via parameter widening. "No systems" means no system objects in the model file. Muted setpoints, zero schedules, and disabled availabilities do not constitute suppression — the simulator's default behaviours in the muted state will contaminate the supposedly-suppressed result. | NZA-Sim Brief 30, May 2026 |
```

---

## What MUST NOT happen in this brief

- No calibration of Dynamic to Static
- No correction factors applied to Dynamic outputs to "make them more sensible"
- No falling back to the deprecated parser path because the new path is producing unexpected numbers — investigate the EP behaviour, do not retreat to the wrong-but-familiar code
- No new modules added; this is a rebuild of existing functionality
- No changes to the Static engine's calculation logic; display-layer Static changes only
- No skipping the Phase 0 audit because "we know what's there" — the Phase 0 documents are what the rest of the brief is built on
- No inventing physical mechanisms to explain divergences; specifics or UNDEFENDED

## When to escalate to Chris

- If a Phase produces results that are physically implausible (e.g. State 1 T_zone clamping again, despite a complete strip — would indicate a deeper EP configuration issue requiring a decision)
- If an EP Output:Variable from the required list does not exist in the installed EP version and there is no documented equivalent
- If the cross-engine divergence in a State exceeds 30% on any headline number and cannot be explained with a citable mechanism after one diagnostic attempt
- If any of the principles in this brief appear to contradict each other in a specific case
- If the work uncovers a structural issue in a previously-closed brief (26, 27, 28-IM) that requires material rework beyond display-layer changes

---

## Sign-off sequence

Each phase signs off individually before the next begins:

1. Phase 0 audit documents → Chris reviews → authorises Phase 1
2. Phase 1 State 1 rebuild → Chris reviews `30_state1_FINDINGS.md` → authorises Phase 2
3. Phase 2 State 2 rebuild → Chris reviews → authorises Phase 3
4. Phase 3 State 2.5 rebuild → Chris reviews → authorises Phase 4
5. Phase 4 State 3 rebuild → Chris reviews → brief closes

If Chris is unavailable for sign-off between phases, do not proceed. Wait. The cost of getting this wrong by ploughing ahead is greater than the cost of pausing.

The Brief 29 audit Parts 3 through 8 are queued to resume after Brief 30 closes. They will be much faster post-Brief-30 because the structural issue they would have surfaced is fixed at the architectural level.

**Standing by for authorisation to begin Phase 0.**
