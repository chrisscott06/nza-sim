# Brief 40 — Systems Library Architecture

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active.
**Date opened:** 2026-05-19
**Target outcome:** The Systems module has a coherent architecture where each demand (heating, cooling, DHW, ventilation, lighting, small power) is served by one or more systems with proportional shares. Each system declares its own setpoint and efficiency metric. A comfort-vs-setpoint diagnostic surfaces over/under-delivery against the homepage comfort band. The DHW tap-mix model corrects the current overestimate. Bridgewater migrates cleanly to the new schema with documented pre/post numbers. Chris can open the Systems module and confidently test interventions, knowing input changes propagate correctly through demand and delivered-energy calculations.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md end to end. Particularly:
   - Non-negotiable technical rules (especially Rule 14 — envelope-physics parity)
   - Process rules (especially Rules 7 documentation hygiene, 10 scope statement, 11 stop dev server before migrations)
   - "Module scopes" — the Systems stub will be expanded by this brief
3. Read STATUS.md as currently on disk; confirm last entry is Brief 42 close. Confirm Brief 42's commit chain landed cleanly (Parts 1–6, closing with the CLAUDE.md "Module scopes" Building update and Rule 14 amendment naming per-opening physics).
4. Read `docs/audit/29_open_issues.md` for the current issue numbering — new issues continue from there.
5. Read `docs/audit/38_systems_library_schema.md` if it exists from the earlier draft of this brief (the original 502-line Brief 38 work); some schema thinking may be salvageable.
6. Read the existing Systems module code:
   - `frontend/src/components/modules/systems/` directory contents
   - The Systems engine path in `frontend/src/utils/instantCalc.js` (specifically `_calculateState3` and anything tagged `// systems` or referring to `sysDefaults`)
   - Brief 38 Sankey polish shipped `consumption.space_heating.primary` + `.secondary` with `{delivered_mwh, fuel_mwh, fuel, efficiency}` — this is the existing n=2 proportional split for heating that Part 2 will generalise from
7. Confirm working tree clean: `git status --short`.
8. Confirm `origin/main == local main`.
9. Do not begin Part 1 until all eight checks pass.

---

## Scope statement

This brief touches the **Systems module** and a small slice of the engine that the Systems module consumes. The DHW calculation is part of the Systems module per CLAUDE.md "Module scopes" and is therefore in scope.

Per CLAUDE.md "Module scopes" Systems stub (current state pre-Brief-40), the Systems module computes the energy used by installed equipment to provide services the building demands. It reads demand quantities from upstream modules (Building's heating/cooling envelope demand; Internal Gains' lighting and small power gains; DHW demand calculated here). It does not compute envelope physics, occupancy schedules, or operable envelope operation.

This brief delivers six substantive Parts plus close.

---

## Operational mode — keep ploughing through

Per Chris's authorisation: this brief runs end-to-end without phase-by-phase sign-off pauses. Authorisation granted up-front for all Parts. Walkthrough sign-off after Part 5 before Part 6 close, per the established pattern (Briefs 36, 39, 41, 42).

Stop and escalate ONLY for the conditions in "When to escalate" below. Final report at end of Part 6.

---

## Principles

1. **No code touches Dynamic-side paths.** `sql_parser.py`, `epjson_assembler.py`, and the simulation API endpoints stay frozen. Brief 30 (Dynamic rebuild) remains paused.

2. **Comfort band stays envelope-level.** The homepage comfort band drives the *demand* calculation (Building module's heating/cooling demand to maintain comfort). System setpoints drive the *delivered* calculation. The two questions are kept distinct.

3. **Proportional split only.** Multiple systems serving one demand share by a declared percentage. No priority+capacity, no lead/lag, no schedule-based handoff. Brief 38 Sankey polish has already shipped this for heating (n=2); this brief generalises to N systems and rolls out to other services.

4. **Renewables and heat networks out of scope.** Follow-up brief. Heat networks treated as `source: 'district_heating'` with an efficiency and loss factor; that's the limit of network-side modelling here.

5. **Lighting and small power get thin Systems entries.** Heat gain stays sourced from Internal Gains (no double-counting). Systems accounts the delivered electrical energy with optional controls applied (daylight dimming, occupancy sensors for lighting; rarely-used for small power).

6. **No pre-assumed numerical targets.** Per Brief 33 Principle 1. When Bridgewater migrates, the resulting numbers are what they are. Any movement is investigated from first principles, not calibrated away.

7. **Library save/load reuses the Brief 37 schedule library pattern.** Same persistence model, separate namespace `'systems'`.

8. **DHW tap-mix model.** Current engine treats `DHW_LITRES_PER_M2_DAY` as litres needing to be heated from 10°C to 60°C. In reality, tap consumption is mixed at the outlet — only the hot fraction needs full-temperature heating. Part 2 corrects this with an explicit tap outlet temperature, which is also the right shape for the comfort-vs-setpoint pattern (DHW: tap temp = demand, setpoint = delivered).

9. **Documentation hygiene per Process Rule 7.** STATUS.md and audit-doc updates in the same commit as the code changes. Each Part is one commit (with its STATUS.md + audit-doc update bundled), except where a Part fails verification and a follow-up fix commit is needed.

10. **Rule 14 parity stays in force.** Any change touching State 1 / State 2 / inline-legacy envelope-physics terms must port across all three locations in the same commit. This brief mostly works *after* the envelope demand integral, so Rule 14 should rarely fire — but if any Part needs to touch envelope demand to support setpoint parameterisation, the parity rule applies.

---

## Parts

### Part 1 — Systems library data model + schema documentation

**Goal:** Define the generic system schema, per-service specific schemas, the proportional-split data structure, and the comfort-vs-setpoint diagnostic mathematics. Document in a new audit doc. No code yet — this Part captures the design on disk so Parts 2–5 have a single canonical reference.

**Files touched:**
- `docs/audit/40_systems_library_schema.md` (new — supersedes the earlier `38_systems_library_schema.md` if that file still exists from the original Brief 38 draft)
- `CLAUDE.md` — Systems stub in "Module scopes" expanded to full scope statement
- `docs/briefs/active/40_systems_library_architecture.md` — this brief file folded into active per the established pattern

**Steps:**

1.1 **Generic system shape.** Applicable to all services:

```
system:
  id: string                                       // stable UUID
  label: string                                    // user-facing name
  service: 'heating' | 'cooling' | 'dhw' | 'ventilation' | 'lighting' | 'small_power'
  source: enum                                     // service-specific (see below)
  efficiency_metric: number | object               // service-specific shape
  setpoint: number | null                          // null = follow comfort band
  control_mechanism: 'constant' | 'weather_compensation' | 'occupancy_driven' | 'scheduled'
  control_schedule_id: string | null
  share_pct: number                                // 0–100; per-service shares sum to 100
  capacity_kw: number | null                       // stored but not used in proportional split
  notes: string
```

1.2 **Per-service specific schemas.**

**Heating:**
- `source`: `'electricity' | 'gas' | 'oil' | 'biomass' | 'district_heating' | 'ambient_air' | 'ambient_ground'`
- `efficiency_metric`: SCOP (heat pumps) or seasonal combustion efficiency (fossil/biomass), dimensionless
- `setpoint`: heating setpoint in °C; null = follow comfort band's lower setpoint

**Cooling:**
- `source`: `'electricity' | 'district_cooling'`
- `efficiency_metric`: SEER (or SCOP cooling), dimensionless
- `setpoint`: cooling setpoint in °C; null = follow comfort band's upper setpoint

**DHW:**
- `source`: heating sources + `'solar_thermal_assisted'` (latter listed but out of scope per Principle 4)
- `efficiency_metric`: overall point-of-use efficiency (generation + storage + distribution as a single factor)
- `setpoint`: storage temperature in °C (default 60 for legionella)
- **`tap_outlet_temp_c`**: tap outlet temperature in °C (default 40 for hotel use; building-type-driven). This drives the tap-mix calc — see 1.4.
- **`cold_supply_temp_c`**: cold supply temperature in °C (default 10)
- **`demand_litres_per_m2_day`**: demand basis (default 1.1 for hotels, but building-type-driven; see Part 2's DHW work for the lookup table)

**Ventilation:**
- `source`: `'electricity'` (mechanical) or `'natural'` (listed for completeness; natural ventilation is operable-window territory and largely out of Systems scope)
- `efficiency_metric` is an object, not a scalar:
  - `sfp_w_per_lps`: Specific Fan Power (W/(l/s))
  - `recovery_sensible_pct`: 0–100 (only for MVHR)
  - `recovery_latent_pct`: 0–100 (only for enthalpy-wheel MVHR)
- `flow_rate`: scalar value
- `flow_rate_basis`: `'per_person' | 'per_m2' | 'constant'`
- `setpoint`: not applicable
- `defrost_penalty_kwh`: optional, for cold-climate MVHR

**Lighting (thin):**
- `source`: `'electricity'`
- `efficiency_metric`: not applicable (gain comes from Internal Gains)
- `control_mechanism`: `'constant' | 'daylight_dimming' | 'occupancy_sensors' | 'both'`
- `control_factor`: multiplier on Internal Gains lighting gain → delivered electricity (default 1.0; daylight dimming 0.70; occupancy sensors 0.70; both 0.50 — editable defaults, not fixed)
- `share_pct`: typically 100

**Small power (thin):**
- `source`: `'electricity'`
- `control_factor`: default 1.0
- `share_pct`: typically 100

1.3 **Proportional-split mathematics.**

For heating, cooling, DHW:
- Sum of `share_pct` across systems for a service MUST equal 100 (engine validation; UI prevents)
- Per system: `delivered = demand_for_this_setpoint × (share_pct / 100)`
- Per system: `source_energy = delivered / efficiency_metric`
- Blended seasonal efficiency for reporting = weighted harmonic mean: `1 / Σ (share_i / efficiency_i)` (this is the headline efficiency for the service)

For ventilation:
- Per system: `fan_electrical = flow_rate × sfp × hours_active × (share_pct / 100)`
- Per system recovery credit reduces heating/cooling demand seen by those services (MVHR recovers heat that heating doesn't have to supply)
- Recovery credit composition across multiple ventilation systems: sum the absolute recovered kWh per system, not the recovery percentages

For lighting/small_power:
- Per system: `electrical = gain_from_internal_gains × control_factor × (share_pct / 100)`

1.4 **DHW tap-mix mathematics.** This corrects the current overestimate.

Current (wrong):
```
annual_dhw_kwh = demand_litres × (setpoint - cold_supply) × WATER_SHC × days
              = 1.1 × GIA × (60 - 10) × 0.001161 × 365
```

Corrected:
```
hot_fraction = (tap_outlet_temp - cold_supply_temp) / (setpoint - cold_supply_temp)
boiler_litres_per_day = demand_litres × hot_fraction
annual_dhw_thermal_kwh = boiler_litres_per_day × (setpoint - cold_supply_temp) × WATER_SHC × 365 × GIA
annual_dhw_source_kwh = annual_dhw_thermal_kwh / dhw_system_efficiency
```

For Bridgewater defaults (tap 40°C, cold 10°C, setpoint 60°C):
- `hot_fraction = (40-10)/(60-10) = 0.60`
- 1.1 L/m²/day becomes 0.66 L/m²/day of "boiler litres at 60°C delivered"
- This is the headline correction. Expected magnitude: Bridgewater DHW thermal drops from ~101 MWh to ~60 MWh, a 1.67× correction.

1.5 **Comfort-vs-setpoint diagnostic mathematics.**

For each system whose setpoint differs from the comfort band's corresponding setpoint:
- `demand_at_comfort` = the Building/Internal-Gains demand at the comfort band setpoint (already computed upstream)
- `delivered_at_setpoint` = Static engine's recomputation of demand using the system's setpoint
- `delta = delivered_at_setpoint − demand_at_comfort`
- Positive delta = overdelivery (e.g. cooling at 20°C when comfort is 24°C)
- Negative delta = underdelivery (e.g. heating at 18°C when comfort is 21°C)

For DHW specifically:
- `demand_at_comfort` = annual_dhw_thermal_kwh at the user's tap_outlet_temp
- `delivered_at_setpoint` = annual_dhw_thermal_kwh if tap_outlet_temp were equal to setpoint (i.e., no blending)
- `delta` surfaces the overcurrent if a building heats all DHW to 60°C and delivers it neat to the tap (some commercial buildings do; some don't have blending valves)

Setpoint resolution per system:
- If `setpoint === null`, use comfort band's corresponding setpoint
- Otherwise, recompute demand using the system's setpoint (Part 2 implements this)

1.6 **Update CLAUDE.md "Module scopes" Systems stub to a full scope statement.** Replace the existing stub with the following (or equivalent wording):

```markdown
### Systems module — scope

**Computes:**
- Energy delivered by installed equipment to serve heating, cooling, DHW,
  ventilation, lighting, and small power demands
- Per-system: efficiency (SCOP / SEER / combustion η / SFP / recovery
  effectiveness / DHW point-of-use η), setpoint, control mechanism,
  share of demand served
- Proportional split across multiple systems serving the same demand
- Comfort-vs-setpoint diagnostic: demand at envelope comfort vs delivered
  at system setpoint, per service, with the delta exposed
- DHW tap-mix model: boiler heats only the hot fraction of tap consumption,
  not the total tap litres
- Electrical end-use accounting for lighting and small power (thin
  entries reading gain from Internal Gains and applying any controls)
- Fuel split, carbon, total EUI roll-ups across all systems

**Does not contain:**
- Envelope physics (Building)
- Occupancy schedules (Internal Gains)
- Operable envelope operation (Operation)
- Renewables (PV, solar thermal) — out of scope for current brief; queued
  for follow-up
- Heat networks at the network level (district heat is modelled as a
  source with an efficiency and loss factor; network-side modelling is
  out of scope)
- Capacity-based or schedule-based system stacking (proportional split
  only)
```

1.7 **Document everything in `docs/audit/40_systems_library_schema.md`.** Include:
- Generic schema (1.1)
- Per-service schemas (1.2)
- Proportional-split mathematics (1.3)
- DHW tap-mix mathematics (1.4)
- Comfort-vs-setpoint diagnostic mathematics (1.5)
- Migration notes for Bridgewater (what existing `systems_config_v25` maps to — Part 5 implements)

**Commit message:**
```
Brief 40 Part 1: Systems library schema documented

Generic system shape + per-service schemas (heating, cooling, DHW,
ventilation, lighting, small power). Proportional-split mathematics
defined. DHW tap-mix model defined (corrects current overestimate
that assumes all tap litres need heating to 60°C). Comfort-vs-
setpoint diagnostic mathematics defined.

CLAUDE.md "Module scopes" Systems stub expanded to full scope
statement.

No code changes. docs/audit/40_systems_library_schema.md is the
canonical reference for Parts 2–5.
```

STATUS.md update in the same commit. Brief 40 folded into `docs/briefs/active/`.

---

### Part 2 — Engine: proportional-split, setpoint parameterisation, DHW tap-mix

**Goal:** The Static engine reads the new systems schema, computes per-system delivered energy with proportional splits, computes the comfort-vs-setpoint diagnostic, and corrects the DHW tap-mix calculation. The engine work for Brief 38 Sankey polish's n=2 heating split generalises to N systems and rolls out to other services.

**Files touched:**
- `frontend/src/utils/instantCalc.js` — extend `_calculateState3` (or equivalent) to consume the new systems schema; add setpoint parameterisation to `_calculateState2`
- `frontend/src/utils/systemsEngine.js` (new) — separate file for systems-side calculation logic, called from State 3; keeps `instantCalc.js` manageable
- `frontend/src/utils/withMode.js` — allowlist additions for new systems schema fields (per Brief 33 Finding 1 ALLOWLIST DRIFT discipline)
- `frontend/src/context/ProjectContext.jsx` — `DEFAULT_PARAMS` includes the new systems schema

**Steps:**

2.1 **Setpoint parameterisation (Option 1 — parameterise existing functions).** Per the earlier conversation decision, add an optional `setpointOverride` parameter to `_calculateState2`:

```javascript
_calculateState2(building, constructions, libraryData, weatherData, hourlySolar, comfortBand, opts = {})
// opts.setpointOverride = { heating: number, cooling: number } | undefined
// When set, demand integrals use these setpoints instead of comfortBand.{lower_c, upper_c}
// When undefined (default), behaviour is unchanged from pre-Brief-40
```

The demand integration loop reads `effectiveLowerC = opts?.setpointOverride?.heating ?? comfortBand.lower_c` and `effectiveUpperC = opts?.setpointOverride?.cooling ?? comfortBand.upper_c`. Same change in any parallel reimpl per Rule 14 (State 1, inline-legacy if it also computes demand).

Sanity test: with `setpointOverride` undefined, all existing tests/walkthroughs produce identical numbers to pre-Brief-40. Behaviour change is null when nothing calls it with overrides.

2.2 **Implement `computeSystemsDelivered(building, demand, systems_config)` in `systemsEngine.js`.**

For each service:
- Read systems for this service from `systems_config.{service}` (array of systems per schema in 1.1/1.2)
- Validate sum of `share_pct` equals 100; engine error if not
- For each system, compute `delivered`, `source_energy`, and per-system metrics per the math in 1.3
- For systems whose setpoint differs from comfort band: call `_calculateState2` again with `setpointOverride` to get `demand_at_setpoint`, then scale by share
- Roll up to per-service totals + grand totals for EUI / carbon / fuel split

Return shape (extends Brief 38 Sankey polish's `consumption` object):
```javascript
{
  heating: {
    demand_at_comfort_mwh,
    delivered_total_mwh,
    blended_efficiency,
    systems: [
      { id, label, share_pct, setpoint, demand_at_this_setpoint_mwh,
        delivered_mwh, source_energy_mwh, source_fuel,
        delta_vs_comfort_mwh, delta_vs_comfort_pct },
      ...
    ]
  },
  cooling: { ... },
  dhw: {
    ...,
    tap_outlet_temp_c,           // for the diagnostic
    cold_supply_temp_c,
    hot_fraction,                // exposed for transparency
    boiler_litres_per_day,
    systems: [...]
  },
  ventilation: { ... },
  lighting: { ... },
  small_power: { ... },
  totals: {
    eui_kWh_per_m2,
    annual_source_kWh,
    fuel_split: { electricity_kWh, gas_kWh, ... },
    carbon_kgCO2_per_m2,
  }
}
```

2.3 **DHW tap-mix correction.** Replace the existing DHW thermal calculation (currently `1.1 × GIA × 365 × (60-10) × WATER_SHC`) with the tap-mix version per 1.4. Existing constants `DHW_LITRES_PER_M2_DAY`, `DHW_COLD_TEMP`, `DHW_SETPOINT` become defaults for the new schema fields (which can be edited per system).

2.4 **withMode allowlist updates.** Every new field on a system that needs to reach the engine via the State 3 contract gets added to `withMode`'s allowlist for `mode === 'full'` (or whatever the current State 3 mode key is). Per the ALLOWLIST DRIFT WARNING.

2.5 **Sanity test the engine on a synthetic config** (no UI yet; this is engine-side verification):
- Single heating system, SCOP 3.5, share 100%, setpoint null (follow comfort): delivered = demand_at_comfort, source = demand / 3.5. Verify to within rounding.
- Two heating systems, GSHP SCOP 3.5 at 60% share + gas boiler η 0.85 at 40% share, both null setpoint: blended efficiency = 1 / (0.6/3.5 + 0.4/0.85) ≈ 1.43. Verify.
- Cooling system with custom setpoint 20°C, comfort upper 24°C: `delivered_at_setpoint` > `demand_at_comfort`, delta is positive (overcool). Verify the diagnostic surfaces the right magnitude.
- DHW: with default tap 40°C, expected thermal ≈ 0.60 × current calculation. Verify against hand calc.

Document the sanity test results in `docs/audit/40_systems_library_schema.md` § "Part 2 engine verification".

2.6 **Rule 14 sweep.** Setpoint parameterisation touches `_calculateState2`. If State 1 or inline-legacy also compute demand against the comfort band in a way that would need parameterisation for the diagnostic to work, they need the same change. Practical expectation: State 1 doesn't compute system delivered energy so its demand integral may not need the override (envelope demand is the *input* to systems, not the *output*); but the parity sweep verifies this rather than assuming it. If State 1/inline-legacy need the parameter, port in the same commit per Rule 14.

**Commit message:**
```
Brief 40 Part 2: Systems engine — proportional split, setpoint param, DHW tap-mix

systemsEngine.js implements computeSystemsDelivered() consuming the
new schema. Per-service proportional split across N systems; per-system
delivered-at-setpoint computation with setpointOverride threaded into
_calculateState2; comfort-vs-setpoint diagnostic.

DHW tap-mix model corrects the previous overestimate. Bridgewater DHW
thermal drops from ~101 MWh to ~60 MWh (1.67× correction, expected and
documented in audit doc; not a calibration).

withMode allowlist updated for new systems schema fields per Brief 33
Finding 1 ALLOWLIST DRIFT discipline.

Rule 14 parity check: setpointOverride parameter added to _calculateState2;
State 1 and inline-legacy reviewed — [actual finding documented in commit
message].

Sanity test results: blended efficiency for two-system heating verified;
DHW tap-mix verified against hand calc.
```

STATUS.md + audit doc updated in same commit.

---

### Part 3 — UI: Systems module rebuild with per-system editor card template

**Goal:** The Systems module UI lets the user add systems per service, configure each system with service-aware fields, save/load from a library, and see the comfort-vs-setpoint diagnostic both inline per system card and in a dedicated panel.

**Files touched:**
- `frontend/src/components/modules/systems/SystemsModule.jsx` (major rework — current file likely needs significant rewriting; pre-Brief-40 code paths preserved where they handle data we still want)
- `frontend/src/components/modules/systems/SystemEditorCard.jsx` (new) — per-system editor card, service-aware
- `frontend/src/components/modules/systems/AddSystemButton.jsx` (new) — per-service add affordance
- `frontend/src/components/modules/systems/SystemsDiagnosticPanel.jsx` (new) — dedicated comfort-vs-setpoint summary
- Library save/load — reuse Brief 37 UnifiedScheduleEditor pattern with namespace `'systems'`

**Steps:**

3.1 **Left panel layout.** Six service sections (Heating / Cooling / DHW / Ventilation / Lighting / Small power), each with its own colour per Brief 37 Part 1 (heating red, cooling cyan-bright, DHW pink, ventilation teal-500, lighting amber, small power violet).

Each service section shows:
- Section header with service icon + name + total share % validation indicator
- List of systems serving that demand (collapsed cards by default)
- "+ Add system" button at the bottom of the section

Collapsed system card shows: dot (service colour), label, share %, source type + headline efficiency, setpoint summary. Click expands to the editor (or opens it as a side panel — UX decision Claude Code's call; collapsed list + side panel is cleaner for 4+ systems but inline expand is fine for typical 1–2 systems per service).

3.2 **`SystemEditorCard` template.** Service-aware fields in four groups (this is the template UI Chris sketched earlier in the session):

```
┌─ IDENTITY ─────────────────────────┐
│ Label: [Main GSHP            ]     │
│ Share: [───●──── 60%]              │
└────────────────────────────────────┘

┌─ ENERGY ───────────────────────────┐
│ Source:    [Ambient (air-source) ▼]│
│ Efficiency: SCOP [3.5]             │  ← field label per service
└────────────────────────────────────┘

┌─ CONTROL ──────────────────────────┐
│ Setpoint: ○ Follow comfort (21°C)  │
│           ● Custom [───●── 19 °C]  │
│ Mechanism:[Weather compensation ▼] │
│ Schedule: [Open schedule editor →] │   ← opens UnifiedScheduleEditor
└────────────────────────────────────┘

┌─ DIAGNOSTIC (only when setpoint ≠ comfort)
│ Demand at comfort:    87.3 MWh     │
│ Delivered at 19°C:    79.2 MWh     │
│ Δ: −8.1 MWh (−9.3%, underdeliver)  │
└────────────────────────────────────┘

┌─ LIBRARY ──────────────────────────┐
│ [Load from library ▼]              │
│ [Save current as library item]     │
└────────────────────────────────────┘
```

3.3 **Service-specific field variations.** Same template, different fields per `service`:

- **Heating** — efficiency field labelled "SCOP" (heat pumps) or "Seasonal η" (combustion), driven by `source` selection
- **Cooling** — efficiency labelled "SEER"; setpoint default upper band
- **DHW** — efficiency single overall figure; setpoint = storage temp; **extra fields**: tap outlet temp, cold supply temp, demand (L/m²/day); diagnostic shows tap-mix delta
- **Ventilation** — energy group becomes "SFP (W per l/s)" + "Recovery sensible %" + "Recovery latent %"; control group becomes "Flow rate" + "Flow basis"; no setpoint group
- **Lighting (thin)** — only Identity + Control (control mechanism dropdown drives control factor; control factor shown read-only as derived)
- **Small power (thin)** — only Identity (control factor editable; default 1.0)

The "Follow comfort" radio is the default and visually quieter than "Custom"; most users won't override.

3.4 **"+ Add" affordance per service.** Button per service section. Opens a small modal: pick from library OR start blank. Blank inserts a system with sensible defaults for the type. Defaults at insert time per service (and per source where applicable):

- Heating: GSHP/ASHP → source = ambient_air, SCOP 3.0; gas boiler → source = gas, η 0.92; electric → source = electricity, η 1.0
- Cooling: source = electricity, SEER 3.0
- DHW: source = electricity, η 0.95 (immersion); gas boiler → η 0.85 combined; heat pump → SCOP 2.5
- Ventilation: SFP 1.5, recovery 0% (MEV); SFP 1.8, recovery 82% (MVHR)
- Lighting: control mechanism = constant, control factor 1.0
- Small power: control factor 1.0

3.5 **Library save/load.** Each `SystemEditorCard` has "Save to library" in its Library section. Each `+ Add` modal has a "Load from library" tab. Library entries are namespaced by service (a heating system can't be loaded into a cooling section — surface clearly in the modal). Persistence reuses Brief 37's library pattern with `'systems'` namespace and `library_systems` collection in `params`.

3.6 **Share validation.** When a service's systems' share_pct sum ≠ 100%, show a warning inline at the section header (and on each system card if helpful). Quick-fix buttons: "Distribute remaining X% to last system" or "Normalize all systems (proportional)." The engine errors on ≠ 100% (Part 2's validation), but the UI prevents the user reaching that state.

3.7 **`SystemsDiagnosticPanel`.** Dedicated panel (could be a tab on the centre canvas, or a section beneath the Sankey). Shows comfort-vs-setpoint diagnostic across all services in table form:

| Service | Demand at comfort | Delivered at setpoint | Delta | % over |
|---------|-------------------|----------------------|-------|--------|
| Heating | 87 MWh | 87 MWh | 0 | 0% |
| Cooling | 42 MWh | 56 MWh | +14 MWh | +33% (overcool: setpoint 20°C vs comfort 24°C) |
| DHW | 60 MWh | 99 MWh | +39 MWh | +65% (no tap-mix: tap at setpoint 60°C) |

Highlight rows with significant delta. Clicking a row drills into the per-system breakdown.

3.8 **Colour discipline per Brief 37.** Each service has its colour. System editor cards' accents follow service colours. Sankey ribbon colours already follow this per Brief 38 polish — no change required.

3.9 **Schedule editor.** When a system has `control_mechanism === 'scheduled'`, the Control group's "Open schedule editor →" button opens the existing Brief 37 UnifiedScheduleEditor with the system's `control_schedule_id`. Same component as Internal Gains and Operation. Exception periods support continues to work.

**Commit message:**
```
Brief 40 Part 3: Systems module UI rebuild

Per-service sections (Heating, Cooling, DHW, Ventilation, Lighting,
Small power) with add-a-system flow. SystemEditorCard renders
service-aware fields per the template (SCOP for heating, SEER for
cooling, SFP+recovery for ventilation, tap-mix fields for DHW,
thin for lighting/small power).

Library save/load reuses Brief 37 pattern with 'systems' namespace.

Comfort-vs-setpoint diagnostic visible inline on each system card
(when setpoint differs from comfort) and in a dedicated
SystemsDiagnosticPanel showing per-service summary.

Share validation: UI prevents sum ≠ 100% per service; quick-fix
buttons for normalize/distribute. Colour discipline per Brief 37
service palette preserved.

UnifiedScheduleEditor (Brief 37) wired into scheduled control
mechanism — same component shared across Internal Gains, Operation,
and Systems.
```

STATUS.md update in same commit.

---

### Part 4 — Lighting and small power thin Systems entries

**Goal:** Lighting and small power gains continue to be sourced from Internal Gains for the heat-balance integrand. The delivered electrical energy is accounted in Systems with optional controls applied.

This is a small Part because the engine work was done in Part 2 and the UI work was done in Part 3. Part 4 confirms the wiring, adds default systems to DEFAULT_PARAMS, and ensures the cross-module accounting is clean.

**Files touched:**
- `frontend/src/context/ProjectContext.jsx` — DEFAULT_PARAMS includes default lighting and small_power systems
- `frontend/src/utils/systemsEngine.js` — verify lighting/small_power calc paths (should be implemented in Part 2 already)
- `docs/audit/40_systems_library_schema.md` — append a "Thin Systems entries" section documenting the wiring

**Steps:**

4.1 **DEFAULT_PARAMS defaults.** New projects get:
- One lighting system: control_mechanism = constant, control_factor = 1.0, share_pct = 100
- One small power system: control_mechanism = constant, control_factor = 1.0, share_pct = 100

4.2 **Wiring verification.** Confirm the engine pipeline for lighting:
- Internal Gains computes the lighting gain (W into zone) — unchanged
- Systems reads that gain × control_factor × share/100 = delivered electrical kWh
- The Internal Gains "heat" line item (purple in the Sankey) and the Systems "lighting electrical" end-use are not the same number — the heat reflects the gain INTO the zone (post-controls), the electrical reflects the consumption (which for lighting is the same value because all light becomes heat eventually)
- Document this in the audit doc so the conceptual model is clear

Same for small power.

4.3 **Bridgewater default migration adds.** Lighting and small_power systems entries added to Bridgewater with control_factor = 1.0 (no controls — baseline-as-found).

**Commit message:**
```
Brief 40 Part 4: Lighting and small power thin Systems entries

Gain remains sourced from Internal Gains (heat balance integrand
unchanged). Systems module accounts the delivered electrical energy
with optional controls (daylight dimming, occupancy sensors for
lighting; rarely-used for small power).

DEFAULT_PARAMS: new projects get a lighting system and a small_power
system at control_factor 1.0 share 100%.

docs/audit/40_systems_library_schema.md updated with "Thin Systems
entries" section documenting cross-module accounting (Internal Gains
heat vs Systems delivered electricity).
```

STATUS.md update in same commit.

---

### Part 5 — Bridgewater migration + reconciliation

**Goal:** Bridgewater's existing systems config migrates cleanly to the new schema. Pre/post numbers documented. Any movement explained from first principles.

**Files touched:**
- `scripts/40_bridgewater_systems_migration.py` (new)
- `docs/audit/40_systems_library_schema.md` — append "Part 5 — Bridgewater migration" section

**Steps:**

5.1 **Read Bridgewater's existing systems config.** This is currently in some shape under `params.systems_config_v25` or equivalent. Map each entry to the new schema:
- Each existing heating entry → `systems.heating[]` with source/efficiency/share/control inherited; setpoint = null (follow comfort) unless an explicit setpoint exists
- Same for cooling, DHW, ventilation
- Lighting + small_power: added per Part 4 defaults

5.2 **DHW migration includes tap-mix defaults.** Bridgewater DHW gets `tap_outlet_temp_c = 40` (hotel default), `cold_supply_temp_c = 10`, `setpoint = 60`. This is the principal source of the expected ~40% reduction in DHW thermal vs pre-migration.

5.3 **Migration script is idempotent.** Re-running is a no-op. Per CLAUDE.md Process Rule 11: stop the dev server before running.

5.4 **Capture pre/post.** For each service, headline numbers (delivered, source energy, fuel split if applicable):
- Pre-migration: from current engine (Brief 38 polish output)
- Post-migration: from new engine

5.5 **Document movements.** For each service, the delta is explained:
- Heating: expected ~unchanged (proportional split for n=2 already shipped in Brief 38; generalisation doesn't change Bridgewater's existing config)
- Cooling: expected ~unchanged for same reason
- DHW: expected ~40% reduction from tap-mix correction. Documented as the deliberate fix from Principle 8.
- Ventilation: depends on whether fan electrical was previously computed; if newly exposed, the magnitude is documented
- Lighting + small power: previously may have been implicit in EUI but not as separate systems entries; if their delivered electrical is new in the breakdown, document
- Totals (EUI, carbon): the net of the above

Any movement >2% in any service that *cannot* be explained from first principles is a finding logged in `29_open_issues.md` and pauses the brief.

5.6 **Comfort-vs-setpoint check.** If Bridgewater has any system with setpoint ≠ comfort band (e.g. cooling setpoint at 20°C while comfort upper is 24°C — the case Chris flagged as a useful diagnostic example), the diagnostic surfaces the overcool magnitude. This is not an error; it's the diagnostic doing its job. Document the magnitude.

5.7 **Walkthrough preparation.** Document what Chris should see when he opens the Systems module post-migration:
- Six service sections visible
- Each section showing Bridgewater's systems with share/efficiency/setpoint
- Diagnostic visible inline where setpoint ≠ comfort
- `SystemsDiagnosticPanel` showing per-service deltas
- Total EUI and fuel split visible (Sankey unchanged from Brief 38 polish; numbers may have shifted per the documented movements)

**Commit message:**
```
Brief 40 Part 5: Bridgewater migration

scripts/40_bridgewater_systems_migration.py maps existing
systems_config_v25 to new Brief 40 schema. Idempotent.

Pre/post comparison documented in
docs/audit/40_systems_library_schema.md § "Part 5 — Bridgewater
migration". DHW thermal reduction of ~40% explained by Principle 8
(tap-mix correction). All other service movements documented from
first principles per Principle 6 (no calibration).

Comfort-vs-setpoint diagnostic active. Bridgewater's [specific
setpoint vs comfort case captured at migration time] surfaces the
expected magnitude.

Awaits Chris's walkthrough before Part 6 close.
```

STATUS.md update in same commit. Brief stays open until walkthrough confirms; then Part 6.

---

### Part 6 — Walkthrough sign-off + close

**Goal:** Chris's walkthrough confirms the Systems module works as intended. Brief 40 archived. STATUS.md final.

**Files touched:**
- `docs/briefs/active/40_systems_library_architecture.md` → `docs/briefs/archive/40_systems_library_architecture_COMPLETED.md`
- `docs/briefs/current.md`
- `STATUS.md`
- `CLAUDE.md` Rule 14 reminder text in close-out commit (no rule-text change — the parity rule was applied in Part 2 already)

**Walkthrough checklist Chris runs:**

1. Stop dev server. Run `python scripts/40_bridgewater_systems_migration.py`. Confirm first-run + idempotent re-run NO-OP.
2. Restart dev server.
3. Open Systems module. Verify six service sections visible.
4. Heating: confirm existing systems migrated with correct shares + efficiencies. Add a second heating system at 30% share, redistribute the first to 70%. Confirm blended efficiency reasonable.
5. DHW: confirm thermal demand visibly lower than pre-Brief-40 (~40% reduction per Principle 8). Confirm tap-mix fields (tap temp 40°C default) visible and editable.
6. Cooling: change setpoint from default (follow comfort 24°C) to custom 20°C. Confirm:
   - Diagnostic appears on the card
   - `SystemsDiagnosticPanel` row for cooling shows positive delta (overcool)
   - Headline EUI moves accordingly
7. Lighting: switch control mechanism to "daylight dimming." Confirm control factor changes to 0.70 (default) and delivered electrical drops accordingly.
8. Library: save the modified heating system to library. Add a new heating system, load from library. Confirm fields populate.
9. Sankey: confirm the diagram still renders correctly with the new systems data; per-branch labels (Brief 38 polish) still working.
10. UnifiedScheduleEditor: open any system's schedule (when control_mechanism = scheduled). Confirm the pop-out behaves identically to Internal Gains / Operation.

If all 10 pass cleanly: commit Part 6 close.

If anything anomalous: brief stays open, finding logged, diagnose before close.

**Commit message (after Chris's go-ahead):**
```
Brief 40 close: Systems library architecture live

Six services (heating, cooling, DHW, ventilation, lighting, small
power) on the new schema. Proportional-split engine generalised
from Brief 38's n=2 heating to N systems across all services.
Comfort-vs-setpoint diagnostic in inline + dedicated panel form.
DHW tap-mix model corrects the pre-Brief-40 overestimate.

Bridgewater migrated; pre/post numbers documented in
docs/audit/40_systems_library_schema.md.

Renewables and heat networks remain out of scope (queued for
follow-up). Cross-module audit and engine constants review queued.

CLAUDE.md "Module scopes" Systems section expanded from stub to
full statement (landed in Part 1).
```

---

## Final report (paste in chat after Part 6)

1. New origin/main HEAD SHA
2. Bridgewater post-migration headline numbers per service:
   - Heating delivered, cooling delivered, DHW delivered (thermal + source), ventilation electrical, lighting electrical, small power electrical
3. Movement vs pre-migration for each, with reason if >2%. DHW expected ~−40% from tap-mix correction; others expected ~unchanged.
4. Comfort-vs-setpoint diagnostic numbers for Bridgewater's example setpoint mismatches (cooling at 20°C vs 24°C comfort, if that's how Bridgewater is configured).
5. EUI and fuel split totals pre- and post-migration.
6. Any new issues logged in `29_open_issues.md`.
7. Confirmation that `docs/briefs/active/` contains only Brief 30 (paused).
8. CLAUDE.md "Module scopes" Systems section confirmed expanded.

---

## What MUST NOT happen in this brief

- No code changes to `sql_parser.py`, `epjson_assembler.py`, simulation API endpoints (Dynamic remains paused)
- No renewables (PV, solar thermal)
- No heat-network-level modelling beyond `district_heating` as a source with efficiency + loss factor
- No priority+capacity or lead/lag stacking — proportional split only
- No calibration of Bridgewater post-migration numbers to match pre-migration — any movement is explained, not calibrated
- No invented mechanisms to defend unexpected numbers
- No partial commits — each Part is one commit including STATUS.md + audit-doc updates
- No skipping the DHW tap-mix correction on the grounds that it's a "physics change" rather than an "architecture change" — it's both, and Part 2 owns both
- No introduction of inheritance patterns ("follow comfort band" is a per-system null setpoint, not an inheritance link — same shape as Brief 42's per-opening C_d default)
- No reintroduction of `balanced_mechanical` or any other systems concept into the envelope path (per the CLAUDE.md Module scopes Building section)

---

## When to escalate

Pause and escalate to Chris ONLY if:

- Part 2's setpoint parameterisation in `_calculateState2` requires changes outside `instantCalc.js` and the new `systemsEngine.js` (e.g. shape changes to `ProjectContext` that affect multiple modules' read paths beyond what Part 2 already does)
- Part 2's Rule 14 sweep reveals that State 1 or inline-legacy compute demand against the comfort band in a way that materially affects per-system delivered calculations, AND the change to port the override is non-trivial
- Part 5's Bridgewater migration produces movements >10% on any headline number that cannot be explained from first principles
- A service can't be expressed cleanly in the proposed schema (suggests the schema needs refinement before code lands)
- The Brief 37 library save/load pattern turns out not to be reusable for systems for genuine reasons (not just "different fields")
- The DHW tap-mix correction produces a number that disagrees with hand-calc by more than ~5% — suggests another bug in the DHW path that needs investigation
- A consumer outside the Systems module reads system efficiency directly from a pre-Brief-40 path that the migration would break (similar to the LiveResultsPanel issue from Brief 39 Part 1)
- At any point a non-Systems concept appears in scope
- Documentation hygiene starts slipping

Otherwise, plough through Parts 1–5. Walkthrough sign-off after Part 5 before Part 6 close. Final report at end of Part 6.

---

## Notes for Claude Code on the discipline pattern

This brief follows the pattern that's worked for Briefs 36, 39, 41, 42:

- **Read everything before starting.** The BEFORE-DOING-ANYTHING checklist is not bureaucracy; missing one of those checks (especially the stale-plan check) is how earlier-session briefs accumulated context errors.
- **Each Part is one commit.** Don't split a Part across multiple commits. Don't bundle Parts.
- **Audit doc updates land in the same commit as the code.** Per Process Rule 7.
- **Diagnose before fixing.** If a sanity test fails in Part 2, the response is to add a finding to the audit doc and pause for diagnosis — not to tweak the engine until the number looks right.
- **Plough through but don't expand scope.** New issues that surface are logged to `29_open_issues.md` for follow-up briefs, not absorbed into this brief.
- **The CLAUDE.md "Module scopes" Systems expansion is the durable deliverable.** Even if the code work hits friction, the scope statement landing in Part 1 prevents future Systems-related work drifting outside the boundary.

Standing by for authorisation to begin Part 1.
