# Brief 27 (revised): Internal Gains Module — State 2

**Status:** Updated plan after Part 5 walkthrough. Parts 0–5 complete. Remaining parts replanned to incorporate three architectural decisions taken during walkthrough.

**What changed:** The schedule editor moves from the left panel into the centre canvas. Exception periods become first-class authoring (each gets its own editable curves, not just date ranges). Lighting and Equipment become arrays of load-type profiles, not single quantities.

**Implications:** Brief 27 grows from 9 parts to 11. State contract updates to v2.4 to reflect multi-profile output shape. Probably 3–4 more sessions of work than originally planned. The result is Internal Gains genuinely complete rather than needing a Brief 27.1 follow-up.

---

## VERIFICATION RULES

Unchanged from original Brief 27. Walkthrough on production-like config required. Contract conformance is the bar. BREDEM expected ranges drive verification. State isolation byte-identical.

The module completion checklist (`docs/module_completion_checklist.md`) explicitly applies. Brief close-out fills it in.

---

## What's already done (Parts 0–5)

| Part | Status | Commit |
|------|--------|--------|
| Part 0 — Contract v2.3 + BREDEM expected ranges | ✓ Shipped | 39e4855 + e5e0ebf |
| Part 1 — Data model migration | ✓ Shipped | 6289b10 |
| Part 2 — Live engine State 2 path | ✓ Shipped | 4b0f40d |
| Part 3 — EnergyPlus State 2 generation | ✓ Shipped | acd70ca |
| Part 4 — UI scaffold (two-column, tabs, accent) | ✓ Shipped | 1f98845 + bfe15c7 |
| Part 5 — Occupancy section + ScheduleEditor component | ✓ Shipped | b878d64 |
| (out of order) Part 8 — State 2 isolation regression | ✓ Shipped | efa7024 |

The state isolation regression shipped early — that's fine. It will need updating in the new Part 11 when multi-profile fields land.

---

## What's coming (Parts 6–11)

### PART 6: Contract v2.4 — multi-profile + centre-canvas editor architecture

**File(s):** `docs/state_contracts.md`

Update the contract before any code work begins. Three things:

1. **Lighting and Equipment become arrays of profiles.** The output shape for State 2 gains changes:

```js
// Was (v2.3):
gains: {
  lighting: { kwh, effective_lpd_w_per_m2, peak_kw, hours_active },
  equipment: { kwh, peak_kw, hours_active, baseload_kwh, active_kwh },
}

// Is (v2.4):
gains: {
  lighting: {
    profiles: [
      {
        id: 'bedroom_lighting',
        label: 'Bedroom lighting',
        kwh: number,
        peak_kw: number,
        hours_active: number,
      },
      // ... more profiles
    ],
    total_kwh: number,
    total_peak_kw: number,
    effective_lpd_w_per_m2: number,  // sum of profiles
  },
  equipment: {
    profiles: [
      {
        id: 'guest_equipment',
        label: 'Guest equipment',
        kwh: number,
        peak_kw: number,
        baseload_kwh: number,
        active_kwh: number,
      },
      // ... more profiles
    ],
    total_kwh: number,
    total_peak_kw: number,
    total_baseload_kwh: number,
    total_active_kwh: number,
  },
}
```

Each profile has its own magnitude, relationship_to_occupancy, schedule (or derivation parameters). Total gain is the sum across profiles.

2. **Exception periods are full schedules, not date ranges with inheritance.** Specification update:

```js
schedule: {
  weekday: [...24 values],
  saturday: [...24 values],
  sunday: [...24 values],
  monthly_multipliers: [...12 values],
  exceptions: [
    {
      id: 'exc_christmas',
      name: 'Christmas shutdown',
      icon: '🎄',
      start_date: '12-22',
      end_date: '01-05',
      // Each exception has its OWN editable curves (not inherited):
      weekday: [...24 values],
      saturday: [...24 values],
      sunday: [...24 values],
      ignore_monthly_multipliers: true,
    },
  ],
}
```

3. **Schedule editor location: centre canvas, not left panel.** The contract specifies that for any module where schedule editing is a primary activity (Internal Gains, future Operation v2), the schedule editor lives in the centre canvas. Left panel holds magnitude and structural inputs; centre canvas holds workspace activities.

4. **Load-type library:** Define the building-type-aware default load type splits:

```js
LIGHTING_LOAD_TYPES = {
  hotel: ['bedroom_lighting', 'corridor_lighting', 'exterior_lighting', 'back_of_house'],
  office: ['workstation_lighting', 'general_lighting', 'corridor_lighting', 'server_room'],
  school: ['classroom_lighting', 'corridor_lighting', 'sports_hall', 'catering'],
  retail: ['sales_floor', 'display_lighting', 'back_of_house', 'exterior_lighting'],
  // ... others
}

EQUIPMENT_LOAD_TYPES = { /* similar */ }
```

Each load type has sensible defaults (LPD share, default relationship, default schedule preset). User can rename, add custom profiles, or use "Custom" for non-standard splits.

**Commit message:** "Contract v2.4: multi-profile gains, full exception schedules, centre-canvas editor placement, load-type library"

**Verify:**
1. Contract on disk at v2.4
2. Output shape spec updated
3. Schedule shape with full exception schemas
4. Load-type library structure documented
5. Report: "Contract v2.4 committed. Multi-profile output shape specified. Exception periods now full schedules. Schedule editor placement specified as centre canvas. Load-type library structure defined for 4+ building types."

---

### PART 7: Centre-canvas schedule editor

**File(s):** `frontend/src/components/modules/gains/canvas/ScheduleEditorCanvas.jsx` (new), refactor `frontend/src/components/modules/gains/OccupancySection.jsx`, update tab strip

Move the ScheduleEditor from the left panel's Occupancy section to the centre canvas. The left panel's Occupancy section keeps the magnitude inputs and a small read-only mini-profile of the current schedule.

**Tab strip becomes context-sensitive:**

The centre canvas tab strip changes based on which gain section is "active" (most recently expanded/clicked):

- When Occupancy is active: `[Schedule: Occupancy] [State 1 → State 2] [Heat balance] [Free-running] [Hourly profile] [Annual breakdown] [3D Model]`
- When Lighting is active: `[Schedule: Lighting] [State 1 → State 2] [Heat balance] [Free-running] [Hourly profile] [Annual breakdown] [3D Model]`
- When Equipment is active: `[Schedule: Equipment] [State 1 → State 2] [Heat balance] [Free-running] [Hourly profile] [Annual breakdown] [3D Model]`

The first tab is always the schedule editor for the currently-active gain. The rest are always-available diagnostic views.

Default tab on landing: `Schedule: Occupancy` (because occupancy is the foundation).

**Schedule editor (centre canvas, full readable width):**

Now has room to breathe. Layout:

```
┌── Schedule: Occupancy ─────────────────────────────────────────┐
│                                                                 │
│  Preset:  [Apply preset...        ▾]  [Reset to default]        │
│                                                                 │
│  ┌─ Weekday ─ Saturday ─ Sunday ─┐                              │
│                                                                 │
│  ┌────────────────────────────────────────────────────┐         │
│  │                                                     │         │
│  │        ▆▆ ▆▇▇▆▂                                    │         │
│  │  ▆▆▆▆▆▆▆▆▆▆▆▆ ▂▂   ▂▂  ▂▂▃▂▆▆▆▆▇▇▇▆▆▆▆▆▆          │         │
│  │  00         06          12         18          23  │         │
│  │  Drag bars to set fraction. Drag horizontally to    │         │
│  │  paint multiple hours.                              │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                 │
│  Quick set:  [Flat 0.5 ▸] [Copy weekday → weekend]              │
│              [Invert] [Shift ← →] [Apply shape preset ▾]        │
│                                                                 │
│  Modifiers:  [× Weekend factor] [× Daylight dimming]            │
│              [+ Always-on baseload] [× Holiday weeks]           │
│                                                                 │
│  ─── Monthly variation ────────────────────────────────         │
│  ▇▇▇▆▆▆▆▆▆▆▇▇   Jan ▇ Feb ▇ Mar ▇ Apr ▆ May ▆ Jun ▆            │
│                  Jul ▆ Aug ▆ Sep ▆ Oct ▆ Nov ▇ Dec ▇            │
│                                                                 │
│  ─── Statistics ────────────────────────────────────────        │
│  Peak fraction: 100%  ·  Average fraction: 62%                  │
│  Annual operating hours: 5,431 h/yr                             │
│                                                                 │
│  ─── Annual heatmap ────────────────────────────────────        │
│  [year × hour heatmap showing all 8,760 hours]                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The drag-paint UX from Part 5 carries through unchanged — just at canvas width instead of 288px.

**Left panel Occupancy section simplified:**

The schedule editor is removed. Replaced with:
- A small read-only mini-profile (the weekday curve at thumbnail size)
- A "Edit schedule" link/button that focuses the centre canvas on the Schedule tab
- Existing magnitude inputs unchanged (density, occupancy rate, sensible/latent heat)

The left panel becomes structurally focused: "what's the input?" The centre canvas becomes workspace: "how does it behave?"

**Commit message:** "Part 7: Centre-canvas schedule editor with context-sensitive tab strip"

**Verify:**
1. Open /gains, Occupancy section expanded in left panel
2. Centre canvas shows Schedule: Occupancy as first tab, with editor at canvas width
3. Drag-paint works at the larger size
4. Click Lighting section in left panel → centre canvas tab strip changes to Schedule: Lighting
5. Left panel Occupancy section shows mini-profile + magnitude inputs (schedule editor not duplicated)
6. State isolation regression still passes (38/38 + 21/21)
7. Report: "Centre-canvas schedule editor working. Context-sensitive tab strip switches based on active gain. Left panel simplified to magnitude inputs + mini-profile. Drag-paint UX preserved at canvas width."

---

### PART 8: Exception period authoring

**File(s):** Update `frontend/src/components/modules/gains/canvas/ScheduleEditorCanvas.jsx`, add exception edit mode

Make exception periods properly authorable — each gets its own editable weekday/Saturday/Sunday curves, not just a date range.

**Workflow:**

1. In the schedule editor, an "Exception periods" panel lists current exceptions (or shows "+ Add exception" if none).

2. Clicking "+ Add exception" creates a new exception with:
   - Name (e.g., "Christmas shutdown")
   - Icon (optional emoji or preset icons)
   - Start date and end date (MM-DD format, year-wraparound supported)
   - "Ignore monthly multipliers within this period" toggle (default: on for short periods)
   - Curves initialised to a copy of the default schedule's curves (user then edits to make them different)

3. Clicking an exception in the list enters "edit mode" for that exception:
   - The schedule editor's canvas switches to show the exception's curves
   - A prominent banner at the top: "✏ Editing: Christmas shutdown · weeks 51–52 · [Save & return to default ▸]"
   - The banner's background uses a distinct colour to signal you're in exception mode (not the default schedule)
   - All editing tools (drag-paint, preset, quick-set, modifiers) work the same way but on the exception's curves
   - The Annual heatmap shows the exception's weeks highlighted

4. "Save & return to default" exits exception edit mode and returns to default schedule editing.

5. Each exception can be:
   - Edited (enter edit mode)
   - Renamed (inline edit)
   - Date range adjusted (inline edit)
   - Duplicated ("Copy this exception")
   - Deleted (with confirmation if it has non-default curves)

**Annual heatmap reflects all exceptions:**

The annual heatmap (8760-hour view) shows the composite of the default schedule + monthly multipliers + all exception periods, so the user sees the final assembled pattern.

**Exception presets:**

A small set of common patterns the user can apply as one click:
- "Christmas shutdown" (weeks 51–52, minimal)
- "Summer holidays" (weeks 31–34, school pattern)
- "Bank holidays" (handful of single-day exceptions across the year)
- "Custom" (blank exception, user defines everything)

**Commit message:** "Part 8: Exception period authoring with full editable curves per period"

**Verify:**
1. In the schedule editor, click "+ Add exception"
2. Create "Christmas shutdown" with date range 12-22 to 01-05
3. Exception appears in list
4. Click the exception → edit mode activates
5. Banner shows "Editing: Christmas shutdown" with distinct colour
6. Drag the weekday curve to near-zero → the exception's curve changes (not the default)
7. Save & return → default schedule editor restored
8. Annual heatmap shows weeks 51–52 as distinctly different (lower fraction)
9. Apply "Christmas shutdown" preset on a fresh schedule → exception auto-populates with sensible date range and minimal curves
10. Year-wraparound (Dec → Jan) works correctly in the heatmap and engine output
11. State isolation regression still passes
12. Report: "Exception periods now properly authorable. Christmas shutdown test: weeks 51–52 show distinct curves in annual heatmap. Live engine respects exception curves (verify hourly output for a sample exception day). Exception presets functional."

---

### PART 9: Multi-profile architecture — data model + live engine

**File(s):** `frontend/src/context/ProjectContext.jsx`, `frontend/src/utils/instantCalc.js`, migration script

Restructure Lighting and Equipment from single quantities into arrays of profiles.

**Data model (v2.4):**

```js
building_config: {
  // occupancy unchanged (single object, no profiles)
  occupancy: { /* as before */ },

  gains: {
    lighting: {
      profiles: [
        {
          id: 'bedroom_lighting',
          label: 'Bedroom lighting',
          magnitude: { value: 5, unit: 'w_per_m2' },
          relationship_to_occupancy: 'proportional_with_spill',
          spill_minutes: 15,
          daylight_factor: 0.6,
          area_share: 0.6,  // fraction of GIA this profile applies to (sum across profiles = 1.0)
          // OR if relationship is 'independent':
          schedule: { ... },
          _provenance: { ... },
        },
        {
          id: 'corridor_lighting',
          label: 'Corridor lighting',
          magnitude: { value: 2, unit: 'w_per_m2' },
          relationship_to_occupancy: 'always_on',
          area_share: 0.3,
          _provenance: { ... },
        },
        // ... more
      ],
      // Aggregates computed on demand
    },

    equipment: {
      profiles: [
        // Similar structure
      ],
    },
  },
}
```

**Area share semantics:**

Each profile applies to a fraction of the building's GIA. Sum across profiles = 1.0. Bedroom lighting at 5 W/m² × 0.6 area share = 3 W/m² building-average contribution. Corridor lighting at 2 W/m² × 0.3 area share = 0.6 W/m² building-average. Effective building LPD = sum of (profile_LPD × profile_area_share).

For single-zone modelling (current), area_share is just a weighting factor. When multi-zone lands later, area_share could become "applies to which zones."

**Live engine update:**

`_calculateState2` now iterates over Lighting profiles and Equipment profiles, computing each profile's hourly contribution independently and summing. The output shape per the v2.4 contract: each profile has its own kwh/peak/etc., plus aggregates.

**Migration from v2.3 to v2.4:**

For existing projects, the single Lighting becomes a single-profile array:

```js
// v2.3:
lighting: { magnitude: 8 W/m², relationship: 'proportional_with_spill' }

// v2.4:
lighting: {
  profiles: [
    {
      id: 'default_lighting',
      label: 'Lighting',
      magnitude: { value: 8, unit: 'w_per_m2' },
      relationship_to_occupancy: 'proportional_with_spill',
      spill_minutes: 15,
      daylight_factor: 0.6,
      area_share: 1.0,
    }
  ]
}
```

Idempotent, preserves user data, sensible defaults. Engine output for migrated projects is byte-identical to v2.3 behaviour.

**Load-type defaults:**

When a building type is set, "Add profile" offers the building-type-appropriate load types as quick options. For Bridgewater (hotel), Lighting "Add profile" offers: Bedroom lighting / Corridor lighting / Exterior lighting / Back-of-house / Custom.

**Commit message:** "Part 9: Multi-profile data model and live engine for Lighting and Equipment"

**Verify:**
1. Migration runs on Bridgewater — Lighting becomes single profile with area_share 1.0
2. Engine output for Bridgewater unchanged from Part 5 (migration preserves behaviour)
3. Add a second profile programmatically (corridor lighting 2 W/m², area share 0.3, always-on) and Bridgewater's lighting kWh increases sensibly
4. State isolation regression updated for new schema, passes byte-identical
5. Report: "Multi-profile data model in place. Bridgewater single-profile lighting equivalent to v2.3 behaviour (engine output unchanged). Second-profile test confirms additive behaviour. Migration idempotent."

---

### PART 10: Multi-profile UI + Lighting + Equipment + EnergyPlus generation

**File(s):** `frontend/src/components/modules/gains/LightingSection.jsx`, `frontend/src/components/modules/gains/EquipmentSection.jsx`, `nza_engine/generators/epjson_assembler.py`

The Lighting and Equipment sections in the left panel become profile lists. Each profile can be added, edited, removed.

**Left panel Lighting section:**

```
┌── Lighting ────────────────────────────────┐
│                                             │
│  Effective LPD: 8 W/m²                      │
│  Total annual: 70 MWh  ·  Peak: 22 kW       │
│                                             │
│  ── Profiles ──                             │
│                                             │
│  ● Bedroom lighting                  [⋯]    │
│    5 W/m² × 60% area · ⤵ proportional+spill│
│    ▆▇▆▆▇▆ (mini-profile)                    │
│                                             │
│  ● Corridor lighting                 [⋯]    │
│    2 W/m² × 30% area · ⏵ always-on          │
│    ▇▇▇▇▇▇ (mini-profile)                    │
│                                             │
│  ● Exterior lighting                 [⋯]    │
│    1 W/m² × 10% area · 🌙 night-only        │
│    ▁▁▁▆▇▇▆▁ (mini-profile)                  │
│                                             │
│  [ + Add profile ]                          │
│                                             │
└─────────────────────────────────────────────┘
```

Clicking a profile makes it the "active" profile for the section. The centre canvas then shows that profile's schedule editor (Schedule: Lighting / Bedroom lighting).

The [⋯] menu on each profile: Edit · Rename · Duplicate · Delete.

[+ Add profile] offers building-type-appropriate options as a dropdown, plus "Custom".

**Equipment section follows the same pattern.**

For Bridgewater hotel, after Part 10 a typical config might be:
- Lighting: Bedroom (5 W/m² × 60% area, proportional with spill) + Corridor (2 W/m² × 30% area, always-on) + Exterior (1 W/m² × 10% area, night-only)
- Equipment: Guest equipment (5 W/m² × 60% area, proportional) + Refrigeration (2 W/m² × 10% area, always-on baseload) + Back-of-house (3 W/m² × 30% area, proportional)

**EnergyPlus generation:**

Each profile generates its own `Lights` or `ElectricEquipment` object with its own schedule. The EP generation iterates over profiles. Schedule:Compact emitted per profile per relationship type as before.

EP output is summed back into aggregates by the parser for the State 2 contract output shape.

**Commit message:** "Part 10: Multi-profile UI + EnergyPlus generation for Lighting and Equipment"

**Verify:**
1. Open /gains, expand Lighting section
2. Single default profile visible
3. Click "+ Add profile" → load-type options appear
4. Add "Corridor lighting" → new profile added with sensible defaults
5. Click the corridor profile → centre canvas switches to Schedule: Lighting / Corridor lighting
6. Edit the corridor schedule → different from bedroom schedule
7. Trigger State 2 EP simulation → epJSON contains multiple Lights objects, each with own schedule
8. EP output total lighting kWh matches live engine total
9. Bridgewater with 3-profile lighting config: total LPD = 8 W/m² (same as before), total kWh in expected range
10. Report: "Multi-profile UI working for Lighting and Equipment. Building-type-aware load-type defaults. EP generation iterates profiles correctly. Bridgewater 3-profile config: total lighting 70 MWh (matching single-profile equivalent), EP and live engine within 5%."

---

### PART 11: Canvas views update + close-out

**File(s):** `frontend/src/components/modules/gains/canvas/*.jsx`, all final wiring

The remaining canvas tabs (State 1 → State 2 Delta, Heat balance, Free-running, Hourly profile, Annual breakdown, 3D Model) are built out properly, accounting for the multi-profile architecture.

**State 1 → State 2 Delta view** (the headline diagnostic):

Bar-pair view showing how internal gains modify envelope demand:

```
┌── Internal gains shift the envelope's energy balance ─┐
│                                                        │
│  HEATING DEMAND                                        │
│   State 1 (envelope only):  ████████████ 207 MWh      │
│   State 2 (with gains):     ████████░░░░ 155 MWh      │
│                             ▼ −52 MWh from gains       │
│                                                        │
│  COOLING DEMAND                                        │
│   State 1 (envelope only):  ███░ 47 MWh               │
│   State 2 (with gains):     █████░ 78 MWh             │
│                             ▲ +31 MWh from gains       │
│                                                        │
│  OVERHEATING HOURS                                     │
│   State 1: 1,728 hours                                 │
│   State 2: 2,418 hours  ▲ +690 hours from gains        │
│                                                        │
│  ── What gains contribute ──                           │
│  People:    +57.9 MWh   (free heat all year)           │
│  Lighting:  +62.4 MWh   (3 profiles)                   │
│   ├ Bedroom:    +37.4 MWh                              │
│   ├ Corridor:   +18.6 MWh                              │
│   └ Exterior:    +6.4 MWh                              │
│  Equipment: +134.1 MWh  (3 profiles)                   │
│   ├ Guest:      +75.2 MWh                              │
│   ├ Refrig:     +35.1 MWh                              │
│   └ BoH:        +23.8 MWh                              │
│                                                        │
└────────────────────────────────────────────────────────┘
```

The per-profile breakdown is what multi-profile enables — users can see which load types contribute most.

**Heat balance, Free-running, Hourly profile, Annual breakdown, 3D Model** — built out per the original Brief 27 spec, all accounting for multi-profile data.

**State isolation regression update (was Part 8, now updated):**

Update `FORBIDDEN_ENVELOPE_GAINS_INPUTS` to include all the new multi-profile paths (`gains.lighting.profiles[*]`, `gains.equipment.profiles[*]`, etc.). Re-run regression — should still be 21/21 byte-identical for Internal Gains, 38/38 for State 1.

**Delete /profiles:**

After full multi-profile working and verified, delete the standalone /profiles route. Migration script ensures any orphaned profile library content is preserved in `SCHEDULE_PRESETS` if useful.

**Module completion checklist:**

Fill in `docs/module_checklists/internal_gains_brief_27.md` against the canonical checklist. Every section answered honestly. Confidence rating /10.

**End-to-end walkthrough on Bridgewater:**

The mandatory verification per process lesson #5. Detailed checklist in original Brief 27 Part 9, now applied here.

**Commit message:** "Part 11: Canvas views, multi-profile aggregation, state isolation update, /profiles deleted, brief close-out"

**Verify:** Full module completion checklist filled in. All seven canvas views render with multi-profile data. Bridgewater walkthrough clean. State isolation regression passing on both states. /profiles deleted, no orphan routes. Confidence rating ≥8/10.

---

## Summary of changes from original Brief 27

| Aspect | Original (v9-part) | Revised (v11-part) |
|--------|-------------------|---------------------|
| Schedule editor location | Left panel | Centre canvas, context-sensitive |
| Exception periods | Date ranges, inheriting default curves | Full editable schedules per exception |
| Lighting/Equipment | Single quantity each | Arrays of load-type profiles |
| State contract | v2.3 | v2.4 (multi-profile output shape) |
| Parts remaining | 4 (Parts 6, 7, 9, 8 already done) | 6 new parts (6, 7, 8, 9, 10, 11) |
| Brief size | 9 parts total | 11 parts total |
| Expected sessions | ~4 more | ~6–7 more |

---

## What comes next

Tell Claude Code: "Brief 27 plan updated. Resume with new Part 6 — contract v2.4 update."

The pause from Part 5 just becomes "shift Parts 6–9 onto the new plan." Parts 0–5 work is unaffected; the regression Part 8 is preserved.
