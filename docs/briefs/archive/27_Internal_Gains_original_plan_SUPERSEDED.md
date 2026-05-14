# Brief 27: Internal Gains Module — State 2

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read `docs/state_contracts.md` (latest version on disk) — this brief implements State 2 per the contract
4. Read `docs/briefs/archive/26_State_1_envelope_only_COMPLETED.md` and `26_1_State_1_finalisation_COMPLETED.md` for context
5. Read `docs/state_1_divergences.md` for the known limitations carried forward
6. Read this ENTIRE brief before writing a single line of code
7. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser walkthrough on a production-like config is required at brief close-out.** This is non-negotiable per process lesson #5 in divergences. "Tests pass" is necessary but not sufficient.

**Contract conformance is the bar.** This brief implements State 2. Output shape, UI rules, engine agreement — all per `state_contracts.md`. If something works in a script but doesn't appear in the UI on Bridgewater, it's not done.

**BREDEM expected ranges drive verification.** Part 0 derives the expected Bridgewater State 2 numbers analytically. Subsequent parts verify against those numbers. If the model produces numbers outside the expected ranges, stop and investigate before continuing — don't assume the contract is approximately right.

**State isolation is non-negotiable.** State 2 must produce identical output regardless of any value in `systems.*`, `openings.f*.openable_fraction`, `operation.*`. The regression in Part 8 enforces this byte-identically.

---

## Context

State 1 (envelope only) is done. Both engines render the State 1 contract output, distribution metrics silent vs EP, peak honestly divergent and disclosed, state isolation regression passing, shading working in the canonical channel.

State 2 adds **internal gains** to State 1: people, lighting, equipment, all with schedules. The headline diagnostic is the State 1 → State 2 delta — how much do internal gains modify the envelope's demand?

For Bridgewater (134-room hotel, ~75% occupancy rate, 1.5 ppl/room) we expect internal gains to materially reduce heating demand (overnight occupancy provides "free heat") and modestly increase cooling demand.

This brief takes a meaningful architectural step: **occupancy becomes a first-class building property**, not just one of three gains. Lighting and Equipment derive from occupancy by default with explicit relationship parameters. Each gain can still be configured independently if the user has reason to break the relationship.

The existing `/profiles` standalone route is deleted. Schedule editing moves inline into the Internal Gains module — same editing power, but in the same place as the gain magnitude and the live impact view.

**Critical scope discipline:** This brief is State 2 only — People, Lighting, Equipment as gains. Hot water demand, cooking energy, ventilation demand, etc. are all downstream services that live in State 3 (systems) and are out of scope here. They will reference the occupancy profile established in this brief when they land.

9 parts. Do them in order.

---

## PART 0: BREDEM-style sanity check + contract v2.3 update

**File(s):** `docs/state_contracts.md`, new `docs/state_2_expected_ranges.md`

Before any code, derive what Bridgewater's State 2 numbers should be analytically. Brief 26 closed with the wrong contract ranges because I authored them from gut feel; we don't repeat that mistake.

**Bridgewater State 2 BREDEM-style derivation:**

For each gain type, compute the annual energy contribution and the expected impact on demand:

1. **People sensible gain:**
   - Density: 1.5 ppl/room × 134 rooms × 0.75 occupancy rate = ~151 average occupants
   - Sensible heat: 75 W/person (typical at rest, hotel bedroom context)
   - Hours of presence per day: ~14 (overnight + evening + early morning, based on typical hotel guest presence pattern)
   - Annual sensible gain: 151 × 75 × 14 × 365 = ~57.9 MWh/yr

2. **Lighting:**
   - LPD: 8 W/m² (LED-typical for hotel bedrooms with corridor lighting averaged in)
   - Operating hours: ~5 hrs/day with occupancy + spill, plus 24/7 corridor/exit at ~25% LPD equivalent
   - Annual lighting energy: ~3,457 m² × 8 W/m² × (effective hours) ≈ 50–70 MWh/yr

3. **Equipment:**
   - Baseload: 3 W/m² (TVs in standby, mini-bars, network gear, smoke detectors)
   - Active: 7 W/m² × occupancy-driven fraction
   - Annual equipment energy: 3,457 m² × (3 × 8760 + 7 × ~1500) ≈ 130–150 MWh/yr

4. **Expected State 1 → State 2 delta:**
   - Heating demand reduction: probably 30–60 MWh (people + lighting + equipment provide ~150–180 MWh of free heat annually, of which maybe a third reduces heating demand in heating-season hours)
   - Cooling demand increase: probably 15–35 MWh (gains during cooling-season hours add to demand)
   - Overheating hours: should increase from State 1's ~1,728 to maybe 2,200–2,800

5. **Expected absolute State 2 numbers:**
   - Heating demand: 145–175 MWh (was 207 in State 1; gains offset 30–60)
   - Cooling demand: 65–95 MWh (was 47 in State 1; gains add 15–35; note Live engine over-predicts cooling due to divergence #1, so expect Live higher than EP)
   - Overheating hours: 2,200–2,800
   - Comfort hours: ~1,500–1,800
   - Annual mean indoor T: 19–22°C (gains shift this up from State 1's 18.3)

**Contract update — v2.3:**

Add to `state_contracts.md`:
- State 2 expected ranges section for Bridgewater (as above)
- Discipline rule: "Every state's expected ranges must be derived analytically with stated assumptions before the state's implementation brief begins. Process lesson #5 in divergences applies."
- Occupancy as a first-class building property (not nested under gains) — add to Cross-cutting concepts
- Schedule preset library specification (open question #5 resolved) — see Part 1 for the schema
- Exception period mechanism — schedules may have 0-3 named date-range exception periods that override the default pattern

Commit the contract update as v2.3 in its own commit before any code work begins.

**Commit messages:**
- "Contract v2.3: State 2 expected ranges, occupancy first-class, preset library schema, exception periods"
- "Part 0: Bridgewater State 2 expected ranges derived"

**Verify:**
1. `state_2_expected_ranges.md` committed with derivation
2. Contract v2.3 on disk
3. Each expected range has a stated assumption (occupancy density source, LPD source, etc.)
4. Report: "BREDEM-style State 2 expected ranges derived for Bridgewater. Expected heating demand 145–175 MWh (State 1 was 207, gains offset ~30–60). Expected cooling demand 65–95 MWh. Expected overheating hours 2,200–2,800. Contract v2.3 committed. Discipline rule for future state expected ranges added."

---

## PART 1: Data model — occupancy first-class, gains restructured

**File(s):** `nza_engine/models.py`, `frontend/src/context/ProjectContext.jsx`, migration script

Restructure `building_config` to put occupancy as a top-level building property and add the relationship-to-occupancy fields for derived gains.

**New shape:**

```js
building_config: {
  // ... existing geometry, glazing, fabric, etc. unchanged

  // NEW: top-level occupancy
  occupancy: {
    // Annual modulation
    occupancy_rate: 0.75,  // 0..1, fraction of rooms/units typically occupied

    // Density
    density: {
      value: 1.5,
      basis: 'per_room',  // or 'per_m2', 'total', 'per_workstation'
    },

    // Metabolic
    sensible_w_per_person: 75,
    latent_w_per_person: 55,

    // Presence pattern (when room IS occupied, when is the occupant present)
    schedule: {
      weekday: [...24 values 0..1],
      saturday: [...24 values 0..1],
      sunday: [...24 values 0..1],
      monthly_multipliers: [...12 values],
      exceptions: [
        // 0-5 entries
        {
          id: 'exc_1',
          name: 'Christmas shutdown',
          icon: '🎄',
          start_date: '12-22',  // MM-DD
          end_date: '01-05',
          weekday: [...24 values],
          saturday: [...24 values],
          sunday: [...24 values],
          ignore_monthly_multipliers: true,
        }
      ],
    },

    _provenance: { source: 'user_entered', confidence: 'medium' },
  },

  // RESTRUCTURED: gains
  gains: {
    lighting: {
      magnitude: { value: 8, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional_with_spill',  // or 'independent' | 'proportional' | 'always_on'
      spill_minutes: 15,
      daylight_factor: 0.6,  // multiplier during daylight hours; 1.0 = no dimming
      // Only if relationship_to_occupancy === 'independent':
      schedule: { ... same shape as occupancy.schedule ... },
      _provenance: { ... },
    },

    equipment: {
      baseload: { value: 3, unit: 'w_per_m2' },
      active: { value: 7, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional',
      standby_factor: 0.10,  // fraction of active that runs when unoccupied
      // Only if relationship_to_occupancy === 'independent':
      schedule: { ... },
      _provenance: { ... },
    },
  },
}
```

**Migration:**

For existing projects (especially Bridgewater), migrate any current `gains.*` data and `/profiles` library content into the new shape:
- If Bridgewater currently has occupancy density somewhere, move it to `building_config.occupancy.density`
- If there's a "Hotel Occupancy" profile in the standalone library, attach its schedule to `building_config.occupancy.schedule`
- Apply sensible defaults where data is missing: occupancy rate 0.75, hotel-bedroom schedule, sensible_w_per_person 75, latent 55

The migration must be idempotent (running it twice doesn't double-apply) and must preserve any explicit user values.

**Schedule preset library schema (Open contract question #5 resolved):**

```js
// schedules/preset_library.js
export const SCHEDULE_PRESETS = {
  occupancy: [
    {
      id: 'hotel_bedroom_overnight',
      name: 'Hotel bedroom (overnight)',
      description: 'Guest present overnight + evening, away during day',
      schedule: { weekday: [...], saturday: [...], sunday: [...], monthly_multipliers: [...] },
    },
    {
      id: 'office_mon_fri',
      name: 'Office Mon-Fri',
      // ...
    },
    // ~6-8 presets for occupancy
  ],
  lighting: [ /* similar */ ],
  equipment: [ /* similar */ ],
}
```

Presets are starting points — applying one populates the schedule, then user edits from there. Presets are not first-class library objects; they materialize into the gain when applied.

**Commit message:** "Part 1: Data model — occupancy first-class, gains restructured, exception periods, preset library schema"

**Verify:**
1. DB migration runs cleanly on Bridgewater
2. `GET /api/projects/{id}` returns the new shape
3. Old fields gone or moved appropriately
4. ProjectContext exposes `occupancy`, `gains.lighting`, `gains.equipment` per the new shape
5. SCHEDULE_PRESETS importable in frontend
6. Report: "Data model restructured. Bridgewater migrated cleanly with occupancy.density=1.5 per_room, occupancy_rate=0.75. Schedule preset library scaffold in place with [N] occupancy presets, [M] lighting, [K] equipment."

---

## PART 2: Live engine — State 2 path with derivation logic

**File(s):** `frontend/src/utils/instantCalc.js`, `frontend/src/utils/stateMode.js`

Add `mode: 'envelope-gains'` to the live engine, implementing State 2 per the contract.

**`withMode('envelope-gains', building)` filter:**

Includes everything from State 1, plus `occupancy.*` and `gains.*`. Excludes `openings.f*.openable_fraction`, `openings.schedule`, `openings.control_mode`, `operation.*`, `systems.*`.

Add corresponding entries to `FORBIDDEN_ENVELOPE_GAINS_INPUTS` list for the state isolation regression in Part 8.

**`_calculateState2(building, weather, options)` function:**

1. Run State 1 calculation first (envelope only) to get the baseline.
2. For each hour, compute total internal gain:

```js
function computeHourlyGains(building, hourOfYear) {
  const { dayType, hourOfDay, month, dateMMDD } = decomposeHour(hourOfYear);

  // Occupancy fraction at this hour, with exception logic
  const occSchedule = building.occupancy.schedule;
  const activeException = findActiveException(occSchedule.exceptions, dateMMDD);
  let presence;
  if (activeException) {
    presence = activeException[dayType][hourOfDay];
    if (!activeException.ignore_monthly_multipliers) {
      presence *= occSchedule.monthly_multipliers[month];
    }
  } else {
    presence = occSchedule[dayType][hourOfDay] * occSchedule.monthly_multipliers[month];
  }

  // Effective occupant count
  const totalOccupants = computeTotalOccupants(building.occupancy.density, building);
  const effective_occupants = totalOccupants * building.occupancy.occupancy_rate * presence;

  // People sensible gain (stock-based)
  const Q_people = effective_occupants * building.occupancy.sensible_w_per_person;

  // Lighting gain (per relationship_to_occupancy)
  const lighting = building.gains.lighting;
  const lightingFraction = computeLightingFraction(lighting, presence, hourOfDay, /* daylight model */);
  const Q_lighting = building.GIA * lighting.magnitude.value * lightingFraction;

  // Equipment gain (per relationship_to_occupancy)
  const equipment = building.gains.equipment;
  const equipmentFraction = computeEquipmentFraction(equipment, presence);
  const Q_equipment_baseload = building.GIA * equipment.baseload.value;
  const Q_equipment_active = building.GIA * equipment.active.value * equipmentFraction;

  return {
    people: Q_people,
    lighting: Q_lighting,
    equipment: Q_equipment_baseload + Q_equipment_active,
    total: Q_people + Q_lighting + Q_equipment_baseload + Q_equipment_active,
  };
}
```

3. Add hourly internal gains to the energy balance from State 1 (gains side, alongside solar).
4. Re-solve free-running temperature with internal gains added.
5. Re-derive heating/cooling demand against comfort band (or Systems setpoints if configured — per contract setpoint cross-state dependency).

**Output shape (per contract State 2):**

State 1 shape plus:

```js
{
  state: 2,
  mode: 'envelope-gains',
  gains: {
    // State 1 solar gains, plus:
    people: { sensible_kwh, latent_kwh, total_kwh, peak_kw, hours_active },
    lighting: { kwh, effective_lpd_w_per_m2, peak_kw, hours_active },
    equipment: { kwh, peak_kw, hours_active, baseload_kwh, active_kwh },
  },
  state1_delta: {
    heating_demand_change_mwh: number,  // typically negative
    cooling_demand_change_mwh: number,  // typically positive
    overheating_hours_change: number,
    comfort_hours_change: number,
    free_running_temp_change_annual_mean_c: number,
  },
  occupancy_summary: {
    average_occupants: number,
    peak_occupants: number,
    annual_occupant_hours: number,
  }
}
```

**Critical state isolation requirement:** setting `gains.lighting.magnitude.value = 100` (absurd LPD) must change State 2 output. Setting `systems.heating.cop = 99` (absurd, forbidden in State 2) must NOT change State 2 output. The `withMode` filter enforces this mechanically.

**Commit message:** "Part 2: Live engine State 2 path with occupancy-driven gain derivation"

**Verify:**
1. Call `calculateInstant(bridgewater, weather, { mode: 'envelope-gains' })`
2. Output matches State 2 contract shape
3. `gains.people.sensible_kwh` ≈ 50–70 MWh annually (per Part 0 expectation)
4. `gains.lighting.kwh` ≈ 50–70 MWh
5. `gains.equipment.kwh` ≈ 130–150 MWh
6. `state1_delta.heating_demand_change_mwh` negative, magnitude 30–60
7. `state1_delta.cooling_demand_change_mwh` positive, magnitude 15–35
8. State 2 heating demand 145–175 MWh, cooling demand 65–95 MWh (within Part 0 expected ranges)
9. Isolation test: set `systems.heating.cop = 99` → State 2 output unchanged
10. Calling without options returns full-mode behaviour unchanged (backward compat)
11. Report: "State 2 live engine working. Bridgewater results: people gain [X] MWh, lighting [Y] MWh, equipment [Z] MWh. State 1 → State 2 delta: heating −[A] MWh, cooling +[B] MWh. Final State 2: heating [C] MWh, cooling [D] MWh. All within Part 0 expected ranges. State isolation verified."

---

## PART 3: EnergyPlus State 2 generation

**File(s):** `nza_engine/generators/epjson_assembler.py`, `api/routers/simulations.py`

Add `mode='envelope-gains'` to `assemble_epjson()`. When set:

- People: emit `People` objects per zone with the right occupancy density, schedule, and sensible/latent splits
- Lights: emit `Lights` objects with LPD and schedule (derived from occupancy if relationship is proportional)
- ElectricEquipment: emit `ElectricEquipment` objects with EPD and schedule
- Schedules: emit the occupancy schedule, plus derived lighting/equipment schedules if their relationship_to_occupancy is set
- IdealLoads: keep wide-setpoint ideal loads (State 2 still has no real system)
- Operable windows: still suppressed (State 2.5 territory)

**Schedule emission with exception periods:**

EnergyPlus supports date-ranged schedules natively via `Schedule:Year` and `Schedule:Compact`. Emit the default schedule for the year, with exception periods replacing the relevant date ranges. The EP schedule should produce the same hourly values as the live engine's `computeHourlyGains` — verify this with a per-hour comparison for a sample week.

**Derived schedule generation:**

If `gains.lighting.relationship_to_occupancy === 'proportional_with_spill'`, generate a lighting schedule that:
- Equals the occupancy schedule, shifted right by `spill_minutes / 60` hours
- Reduced by `(1 - daylight_factor)` during daytime hours (e.g., 09:00–17:00 local)

If `gains.equipment.relationship_to_occupancy === 'proportional'`, generate an equipment schedule that:
- Equals the occupancy schedule for the active component
- Plus a constant baseload component

The derivation logic is shared between live engine and EP — extract to a common helper if practical (Python and JS implementations of the same logic).

**State 2 simulation type:**

Add `simulation_type: 'state_2'` to the SimulationRun table per the two-tier persistence model from Brief 26. State 2 runs are stored separately from State 1 and full runs.

**API endpoint:**

`GET /api/projects/{id}/simulations/{run_id}/balance?mode=envelope-gains` returns the State 2 output shape, matching the live engine.

**Commit message:** "Part 3: EnergyPlus State 2 generation with derived schedules and exception periods"

**Verify:**
1. Trigger State 2 simulation on Bridgewater
2. epJSON contains People, Lights, ElectricEquipment objects with correct densities and schedule references
3. Schedules emitted include the occupancy + derived lighting + derived equipment
4. Exception periods (if any defined) emit as Schedule:Year overrides
5. Simulation runs without fatal errors
6. `GET /balance?mode=envelope-gains` returns State 2 shape
7. Per-hour comparison: live engine and EP gain values agree within 5% for a sample summer day and sample winter day
8. State 2 EP heating demand within 5–10% of live engine's heating demand for Bridgewater
9. Report: "EP State 2 generation working. Bridgewater: EP heating [X] MWh vs live [Y] MWh ([Z]% delta). EP cooling [A] MWh vs live [B] MWh. Per-hour gain agreement: [C]% mean error on sample days. Exception period emission verified with test case."

---

## PART 4: Internal Gains module — UI scaffold

**File(s):** `frontend/src/components/modules/InternalGains.jsx` (new), `frontend/src/App.jsx` (routing), sidebar config

Build the Internal Gains module scaffold. Follow the established left-panel-inputs / right-canvas-visualiser pattern.

**Routing:**
- New route `/gains`
- Sidebar entry between Building and Operation
- Module label: "Internal Gains" with appropriate icon (people or similar)

**Layout (left panel):**

Three sections, vertically stacked:

1. **Occupancy** (purple-themed, most prominent — it's the foundation)
2. **Lighting** (gold-themed)
3. **Equipment** (orange-themed)

Each section is a collapsible card with a bounding box (per the existing Building module pattern). Sections start expanded for visibility.

**Layout (centre canvas):**

Tab strip at the top: `[3D Model] [Heat Balance] [State 1 → State 2 Delta] [Gain Profile] [Annual Breakdown]`

Default tab: Heat Balance (so the user sees impact immediately).

This part is the scaffold only. Parts 5–7 build out each section's contents and the canvas views.

**Commit message:** "Part 4: Internal Gains module scaffold with left-panel-right-canvas layout"

**Verify:**
1. Navigate to `/gains` — module loads cleanly
2. Sidebar shows new entry between Building and Operation
3. Three collapsible cards visible on left (Occupancy, Lighting, Equipment) with correct colour theming
4. Centre canvas tab strip visible with five tabs (placeholders for now)
5. No console errors
6. Report: "Internal Gains module scaffold in place. Left panel three cards, centre canvas five-tab strip. Routing and sidebar updated."

---

## PART 5: Occupancy section — inputs + inline schedule editor

**File(s):** `frontend/src/components/modules/gains/OccupancySection.jsx` (new), `frontend/src/components/modules/gains/ScheduleEditor.jsx` (new — reusable component)

The Occupancy section in the left panel and a comprehensive inline schedule editor.

**Occupancy inputs:**

```
┌── Occupancy ──────────────────────────────┐
│                                            │
│  Density: [1.5]      [per room ▾]          │
│    → 201 average occupants                 │
│      (134 rooms × 1.5 ppl/room)            │
│                                            │
│  Occupancy rate: [───●───] 75%             │
│    Fraction of rooms typically occupied    │
│    → 151 effective average occupants       │
│                                            │
│  Sensible heat: 75 W/person  [edit]        │
│  Latent heat: 55 W/person    [edit]        │
│                                            │
│  ─── Schedule ───────────────────────────  │
│                                            │
│  Preset: [Hotel bedroom (overnight) ▾]     │
│                                            │
│  { ScheduleEditor component embedded here }│
│                                            │
└────────────────────────────────────────────┘
```

**Density unit options:** `per_room`, `per_m2`, `total`, `per_workstation`. Each requires different metadata to convert (rooms count, GIA, etc.). The live conversion ("→ 201 average occupants") should always be visible and update as inputs change.

**ScheduleEditor component (new, reusable):**

This is the inline schedule editor that replaces `/profiles`. It must include all the existing functionality plus the new things:

1. **Day-type tabs:** Weekday / Saturday / Sunday
2. **Drag-bar 24-hour editor** (port from existing Profile Editor)
3. **Quick-set actions:** Flat / Apply value / Copy weekday to weekend / Invert / Shift (port)
4. **Shape presets row:** small button row at top of editor — `[Office 9-5]` `[Hotel evening]` `[School term]` `[Bell curve]` `[Flat]`. Clicking a preset transforms the current day's curve. Saves the previous curve to a one-step undo.
5. **Modifier toggles row:** quick parametric actions — `[× Weekend factor]` `[× Daylight dimming]` `[+ Always-on baseload]` `[× Holiday weeks]`. Each opens a small parameter input below the row.
6. **Monthly multipliers:** 12 sliders (port from existing)
7. **Exception periods section:**
   ```
   Exception periods   [ + Add exception ]
   ─────────────────────────────────────
   { 0-5 exception cards, each editable }
   ```
   Each exception card shows name, icon, date range, mini-profile, and edit/delete. Clicking "edit" swaps the schedule editor to the exception's curves.
8. **Annual heatmap preview** (port from existing — 8760-hour visualization)
9. **Statistics panel:** Peak fraction, Average fraction, Annual operating hours, with values updating live

The editor must support saving as a preset (button: "Save as preset...") that adds the current schedule to the preset library for future use.

**Commit message:** "Part 5: Occupancy section with inline schedule editor + exception periods"

**Verify:**
1. Navigate to /gains, Occupancy section expanded
2. Density inputs work — change between per_room / per_m2 / total / per_workstation — live conversion updates
3. Occupancy rate slider works
4. Schedule editor renders with all features: day-type tabs, drag bars, quick-set, shape presets, modifier toggles, monthly multipliers, exception periods, heatmap, statistics
5. Click "Hotel bedroom (overnight)" preset → schedule populates
6. Apply "Weekend factor × 110%" modifier → weekend curves scale
7. Add an exception period "Christmas shutdown" weeks 51-52 → appears in heatmap as different region
8. Save current as preset → appears in preset dropdown
9. All changes persist on save and reload
10. Report: "Occupancy section working with inline schedule editor. Density unit switching verified. Shape presets, modifier toggles, exception periods all functional. Schedule changes persist. Annual heatmap updates live."

---

## PART 6: Lighting + Equipment sections with relationship-to-occupancy

**File(s):** `frontend/src/components/modules/gains/LightingSection.jsx`, `frontend/src/components/modules/gains/EquipmentSection.jsx`

The Lighting and Equipment sections, with the relationship-to-occupancy toggle as the key UX feature.

**Lighting section:**

```
┌── Lighting ───────────────────────────────┐
│                                            │
│  LPD: [8]            [W/m² ▾]              │
│    → 27.7 kW peak total                    │
│                                            │
│  Relationship to occupancy:                │
│    [●] Follow occupancy (with spill)       │
│    [ ] Manual (independent schedule)       │
│    [ ] Always on (24/7 at full)            │
│                                            │
│  ── Derivation parameters ──               │
│    Spill: lights on [15] minutes after     │
│           occupancy ends                   │
│    Daylight dimming: [─●──] 60%            │
│           reduces LPD by 40% in daylight   │
│           hours (09:00–17:00)              │
│                                            │
│  Annual: 62.4 MWh  ·  Peak: 27.7 kW        │
│                                            │
└────────────────────────────────────────────┘
```

When `relationship_to_occupancy === 'independent'`, the derivation parameters area is replaced by an inline ScheduleEditor (the same component built in Part 5).

LPD unit options: `w_per_m2`, `w_per_room`, `total_w`.

**Equipment section:**

```
┌── Equipment ──────────────────────────────┐
│                                            │
│  Baseload: [3]       [W/m² ▾]              │
│    → 10.4 kW continuous (24/7)             │
│                                            │
│  Active load: [7]    [W/m² ▾]              │
│    → 24.2 kW peak                          │
│                                            │
│  Relationship to occupancy:                │
│    [●] Active follows occupancy            │
│    [ ] Independent schedule                │
│                                            │
│  Standby factor: [───●───] 10%             │
│    Active equipment running at 10% when    │
│    unoccupied (chargers on standby)        │
│                                            │
│  Annual: 134.1 MWh  ·  Peak: 34.6 kW       │
│                                            │
└────────────────────────────────────────────┘
```

Equipment unit options: `w_per_m2`, `kw_per_room`, `total_w`.

**Live preview cascade:**

When the user changes the occupancy schedule, the lighting and equipment annual energy numbers must update live (because they derive from occupancy). When the user changes lighting LPD, the lighting annual updates. When the user switches relationship to `independent`, the lighting magnitude continues to multiply against the lighting's own schedule.

**Commit message:** "Part 6: Lighting and Equipment sections with relationship-to-occupancy toggle"

**Verify:**
1. Lighting section: change LPD, see annual update live
2. Lighting: switch to "Manual (independent)" → schedule editor appears
3. Lighting: switch back to "Follow occupancy" → derivation parameters reappear, schedule editor disappears
4. Lighting: adjust spill minutes from 15 to 60 → annual energy increases slightly (more spill hours)
5. Lighting: adjust daylight dimming from 60% to 40% → annual energy decreases (more dimming)
6. Equipment: baseload and active inputs both functional, units switchable
7. Equipment: standby factor slider works
8. Change occupancy schedule (in Occupancy section) → lighting and equipment annuals update live (derivation cascades)
9. Persistence: all changes save and reload correctly
10. Report: "Lighting and Equipment sections working. Relationship-to-occupancy toggle functional. Derivation cascade verified: occupancy schedule change propagates to lighting and equipment annuals. Independent schedule mode reveals inline editor. All persistence verified."

---

## PART 7: Centre canvas views

**File(s):** `frontend/src/components/modules/gains/canvas/*.jsx`

Build out the five centre canvas views:

**View 1: 3D Model**
Existing BuildingViewer3D embedded. No new functionality required for State 2.

**View 2: Heat Balance (State 2 mode)**

The HeatBalance component mounted with `mode='envelope-gains'`. From the previous mode-threading work, this should be a small wiring task — the component already handles the State 2 output shape via `loadOrderFor(mode)` etc.

- "Envelope + Internal Gains — no systems, no operable windows" badge
- Gains side: solar (by orientation) + people + lighting + equipment
- Losses side: same as State 1 (conduction by element, ventilation split)
- Demand rows: heating, cooling, comfort hours bar, free-running stats
- Comfort band editor remains
- Engine toggle Live / Simulation works

**View 3: State 1 → State 2 Delta**

This is the headline diagnostic. A focused visualization of how internal gains modify the envelope's demand.

Layout:

```
┌─ Internal gains shift the envelope's energy balance ─┐
│                                                       │
│  HEATING DEMAND                                       │
│   State 1 (envelope only):  ████████████ 207 MWh     │
│   State 2 (with gains):     ████████░░░░ 155 MWh     │
│                             ▼ −52 MWh from gains      │
│                                                       │
│  COOLING DEMAND                                       │
│   State 1 (envelope only):  ███░ 47 MWh              │
│   State 2 (with gains):     █████░ 78 MWh            │
│                             ▲ +31 MWh from gains      │
│                                                       │
│  OVERHEATING HOURS                                    │
│   State 1: 1,728 hours                                │
│   State 2: 2,418 hours  ▲ +690 hours from gains       │
│                                                       │
│  ── What gains contribute ──                          │
│  People:    +57.9 MWh  (free heat all year)           │
│  Lighting:  +62.4 MWh                                 │
│  Equipment: +134.1 MWh (largest single contributor)   │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Updates live as inputs change. This is the "play with it and see what happens" diagnostic.

**View 4: Gain Profile**

Stacked area chart (Pablo-inspired) showing the three gain types combined over time:

- People (purple) + Lighting (gold) + Equipment (orange) as stacked area
- Time scale toggle: `[Year] [Month] [Week] [Day]`
- Default: Week (representative typical week shows daily patterns)
- Y-axis: kW or W/m² (toggle)
- Below the chart: legend with annual MWh per gain type

**View 5: Annual Breakdown**

Horizontal stacked bar showing annual energy split by gain type, with percentages:

```
People 22%  ████  Lighting 24%  █████  Equipment 53%  ████████████
```

Plus a small table below with per-gain annual MWh, peak kW, hours active.

**Commit message:** "Part 7: Internal Gains centre canvas — five views"

**Verify:**
1. All five tabs render
2. 3D Model: same as Building module
3. Heat Balance: State 2 mode, gains side includes people/lighting/equipment, badge correct, demand rows derived
4. State 1 → State 2 Delta: shows heating demand reduction, cooling demand increase, gain breakdown
5. Gain Profile: stacked area chart with time scale toggle working
6. Annual Breakdown: horizontal bar with percentages, table with details
7. All views update live as inputs change
8. Report: "All five canvas views working. State 1 → State 2 delta shows Bridgewater heating drops by [X] MWh, cooling rises by [Y] MWh. Gain breakdown: people [A]%, lighting [B]%, equipment [C]%. Live update verified."

---

## PART 8: State 2 state isolation regression

**File(s):** `scripts/state2_isolation_live.mjs`, `scripts/state2_isolation_epjson.py`, update `frontend/src/utils/stateMode.js`

Mirror the State 1 regression pattern for State 2.

Define `FORBIDDEN_ENVELOPE_GAINS_INPUTS` in `stateMode.js`:
- All entries from `FORBIDDEN_ENVELOPE_ONLY_INPUTS` except `gains.*` and `occupancy.*` (those are now allowed in State 2)
- Still forbidden: `openings.f*.openable_fraction`, `openings.schedule`, `openings.control_mode`, `operation.*`, `systems.*`

Build the regression scripts:

1. **Live engine regression** — baseline scenario + N absurd-value scenarios (operable fractions at 99%, systems COPs at 99, setpoints at 5/50, etc.). State 2 output must be byte-identical to baseline for every absurd scenario.

2. **EP path regression** — same approach via epJSON byte-identity check, plus at least one full end-to-end EP simulation run with all forbidden inputs set to absurd values, confirming the resulting State 2 SQL produces byte-identical parser output.

The regression should iterate `FORBIDDEN_ENVELOPE_GAINS_INPUTS` programmatically, with the assertion-on-minimum-list-length safety net per Brief 26 divergence #4.

**Commit message:** "Part 8: State 2 state isolation regression — live + EP both 100% byte-identical"

**Verify:**
1. Live engine regression: N scenarios, all byte-identical to baseline
2. EP path regression: epJSON byte-identical across scenarios, parser output byte-identical
3. Forbidden list assertion in place (refuses to silently pass if regex parse breaks)
4. Both scripts exit 0 on success, 1 on failure
5. Run State 1 isolation regression too — confirm no regression
6. Report: "State 2 isolation regression in place. Live: [N]/[N] byte-identical. EP path: [M]/[M] byte-identical. State 1 regression unchanged: 22/22 + 23/23. Total: [Total] scenarios across both states."

---

## PART 9: Delete /profiles, end-to-end walkthrough, close-out

**File(s):** Delete `frontend/src/components/modules/Profiles.jsx` (or wherever it lives), remove route, remove sidebar entry, clean up any lingering imports.

**End-to-end walkthrough on Bridgewater:**

This is the mandatory manual verification per process lesson #5.

1. Open the app, load Bridgewater
2. Navigate to /building — confirm State 1 still works exactly as before (no regression from Brief 26.1)
3. Navigate to /gains — Internal Gains module loads
4. Occupancy section:
   - Density at 1.5 per_room → confirms 201 average occupants displayed
   - Occupancy rate 0.75 → confirms 151 effective average occupants
   - Schedule preset "Hotel bedroom (overnight)" loaded
   - Add a Christmas shutdown exception period
   - Heatmap shows Christmas as different region
5. Lighting section:
   - LPD 8 W/m², following occupancy
   - Annual energy displayed ~60–70 MWh
6. Equipment section:
   - Baseload 3, Active 7 W/m²
   - Annual displayed ~130–150 MWh
7. Centre canvas:
   - 3D Model: same as Building
   - Heat Balance: State 2 mode, all gain types visible, comfort band editable
   - State 1 → State 2 Delta: shows heating drops ~30–60 MWh, cooling rises ~15–35 MWh
   - Gain Profile: stacked area visible, time scale switchable
   - Annual Breakdown: three-way split visible
8. Engine toggle: Live and Simulation both produce State 2 numbers, within tolerance
9. Live editing: change occupancy density from 1.5 to 2.0 per_room → watch annual gain numbers and heat balance update live
10. Live editing: change occupancy schedule (drag a bar) → lighting and equipment annuals update live (derivation cascading)
11. Re-run Simulation → fresh EP run produces matching State 2 numbers
12. Persistence: reload page → all values preserved
13. State isolation visual test: go to /operation, set absurd operable window values, return to /gains → State 2 numbers unchanged
14. /profiles route no longer exists, sidebar entry gone, no console errors

**Bridgewater expected final numbers** (within Part 0 ranges):
- Heating demand: 145–175 MWh
- Cooling demand: 65–95 MWh
- Overheating hours: 2,200–2,800
- People gain: 50–70 MWh
- Lighting gain: 50–70 MWh
- Equipment gain: 130–150 MWh
- State 1 → State 2 heating reduction: 30–60 MWh
- State 1 → State 2 cooling increase: 15–35 MWh

If any number falls outside its range, stop and investigate before reporting complete.

**Final report:**

| Item | Status |
|------|--------|
| Occupancy first-class building property | ✓/✗ |
| Three gain sections with relationship-to-occupancy | ✓/✗ |
| Inline schedule editor in module | ✓/✗ |
| `/profiles` deleted, no orphan routes | ✓/✗ |
| Schedule preset library functional | ✓/✗ |
| Exception periods working (default + 0-3 exceptions) | ✓/✗ |
| Metric unit switching working | ✓/✗ |
| State 1 → State 2 delta visible and live | ✓/✗ |
| Live + Simulation engines agree on State 2 within tolerance | ✓/✗ |
| Bridgewater numbers within Part 0 expected ranges | ✓/✗ |
| State 2 isolation regression passing | ✓/✗ |
| State 1 isolation regression unchanged | ✓/✗ |
| Walkthrough on Bridgewater clean (no console errors) | ✓/✗ |

Update STATUS.md with the close-out summary, including:
- Brief 27 complete with all 9 parts
- Occupancy now a first-class building property; gains derive from it
- Standalone /profiles deleted, schedule editing inline in /gains
- Exception periods supported (0-5 per schedule)
- Schedule preset library schema implemented
- Bridgewater State 2 numbers as the reference baseline
- Process lesson #5 (walkthrough discipline) honoured
- Suggested next: Brief 28 (Operation v2, State 2.5) or Brief 29 (Systems Inspectors, State 3) — depends on Chris's call on sequencing

Archive this brief to `docs/briefs/archive/27_Internal_Gains_State_2_COMPLETED.md` and point `current.md` at the next brief.

Push to GitHub. Confirm push succeeded.

Tell Chris:

> Brief 27 complete. Internal Gains module in place with State 2 contract implementation. Occupancy is now a first-class building property; lighting and equipment derive from it by default. Schedule editing moved inline — `/profiles` deleted. Exception periods supported. Bridgewater State 2: heating demand [X] MWh (State 1 was 207, gains offset [Y] MWh), cooling demand [Z] MWh (State 1 was 47, gains add [W] MWh). All within Part 0 BREDEM-derived expected ranges. Live and Simulation engines agree on State 2 within tolerance. State isolation regression passing on both states. Walkthrough verified end-to-end on Bridgewater.
