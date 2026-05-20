# Brief 42 — Systems UX: service-level fields + system editor pop-out

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Multi-Part schema-reorganisation + UX brief.
**Date opened:** 2026-05-20
**Target outcome:** The Systems module's schema correctly distinguishes between building-level fields (demand, setpoints, DHW temperatures) and system-level fields (source, efficiency, share, control). Building-level fields live in service-section headers in the left panel. System-level fields live in a draggable pop-out editor. After this brief lands: Chris can no longer enter contradictory demand values across multiple DHW systems, no longer enter contradictory setpoints across heating systems serving the same zone, and edits a system in a properly-sized pop-out rather than the cramped left panel.

This brief addresses three pre-existing Brief 40 issues surfaced during Brief 41 walkthrough — captured in Issues #21 (DHW demand → service-level), #22 (system editor pop-out), and the setpoint structural problem noted in the Brief 42 design note.

---

## BEFORE DOING ANYTHING

0. **Run the session-start documentation reconciliation pass (mandatory).** Per amended Process Rule 8 (landed in Brief 41 Part 1):
   - `ls docs/briefs/active/` — list everything in active
   - `cat docs/briefs/current.md` — read what current.md claims
   - `tail -50 STATUS.md` — read most recent STATUS entries
   - `git log --oneline -20` — read the last 20 commits
   - **Cross-check:** Brief 41 should be archived (commit `2bf8f42`); `docs/briefs/active/` should currently be empty (Brief 30 is paused so lives in archive); `current.md` should reflect no active brief.
   - **If any check fails, the first commit of the session is the cleanup commit.**

1. Read this entire brief.
2. Read CLAUDE.md end to end. Particularly Module Scopes Systems section (will be amended in this brief), Process Rules 7 (documentation hygiene with brief-file-on-disk), 8 (session reconciliation), 10 (scope statement), 11 (stop dev server before migrations).
3. Read the Notion design note: **NZA-Sim — Systems UX (Brief 42): service-level vs system-level fields** (URL: https://www.notion.so/366d645e05cc81cbb576ce33b0a22208). This is the canonical reference. The brief implements what the design note specifies; if there's any disagreement, the design note wins.
4. Read `docs/audit/40_systems_library_schema.md` end to end. This is what's being reorganised. Pay particular attention to §1 (generic system shape), §1.2 (per-service schemas — DHW currently has `tap_outlet_temp_c`, `cold_supply_temp_c`, `demand_litres_per_m2_day`, `demand_litres_per_person_per_day`, `demand_basis` AT PER-SYSTEM LEVEL — these all move to service-level), and the heating/cooling per-system `setpoint` field (also moves to service-level).
5. Read `docs/audit/29_open_issues.md` — confirm #21 and #22 are logged. This brief resolves them.
6. Read the interventions module's patch-application code in `frontend/src/utils/interventionsEngine.js`. Patches authored against the pre-Brief-42 schema (e.g. `building_config.systems_config_v40.heating[id=ashp_1].setpoint`) need migration to the post-Brief-42 paths (e.g. `building_config.systems_config_v40.heating_setpoint`). Part 1's schema-flexibility discipline covers this; Part 4's migration script implements it for Bridgewater.
7. Confirm working tree clean: `git status --short`.
8. Confirm `origin/main == local main`.
9. **Part 1's first commit must include this brief file landed at `docs/briefs/active/42_systems_ux.md`.** Per Process Rule 7 amendment. No code work begins until that commit lands.
10. Do not begin Part 1 until checks 0–9 pass.

---

## Scope statement

This brief reorganises the Systems module's schema and rebuilds the systems editor UI. It touches the Building (no), Internal Gains (no), Operation (no), and Interventions (yes — for patch migration). Per CLAUDE.md Module Scopes pattern, the Systems module's scope is unchanged in substance — it still computes the energy delivered by installed equipment to serve service demands. What changes is **the distinction between building-level fields (a property of the project's hot water needs, zone target temperatures) and system-level fields (a property of the specific kit installed)**.

This brief delivers four substantive Parts plus close.

---

## Operational mode — keep ploughing through

Per Chris's authorisation: this brief runs end-to-end without phase-by-phase sign-off pauses. Authorisation granted up-front for all Parts. Walkthrough sign-off after Part 3 before Part 4 close.

Stop and escalate only for the conditions in "When to escalate" below. Final report at end of Part 4.

---

## Principles

1. **No physics changes.** This brief is a schema reorganisation and a UX refactor. Bridgewater post-Brief-42 numbers must reproduce pre-Brief-42 numbers within rounding. Any movement >0.5% on any service is an escalation. Per Brief 40 Principle 6 (no calibration).

2. **Building-level vs system-level — the core distinction.**
   - **Building-level (service-level):** fields that describe the *project's needs* or *zone targets*. Heating setpoint, cooling setpoint, DHW storage temperature, DHW tap outlet temperature, DHW cold supply temperature, DHW demand quantity, DHW demand basis.
   - **System-level (per-system):** fields that describe the *specific kit*. Source, efficiency metric, share %, control mechanism, control schedule, enabled, label.
   - When the engine encounters a per-system instance of a building-level field (stale data, hand-edited config), it errors loudly. No silent fallbacks.

3. **No new fields. Only structural moves.** This brief moves fields between schema levels. It does not introduce new concepts (e.g. activation thresholds for the UFH + radiator backup case). New concepts come later if real client need surfaces.

4. **Pop-out editor reuses Brief 37 SchedulePopout pattern.** Draggable, persistent-position via localStorage (`nza-system-editor-popout-position`), non-blocking, Esc-to-close, reset-position affordance. Same shape as Brief 41's interventions editor pop-out.

5. **Path-addressed patches with schema-version migration.** Brief 41's schema-flexibility discipline applies. Patches authored against pre-Brief-42 paths (e.g. `systems_config_v40.heating[id=ashp_1].setpoint`) get migrated to the post-Brief-42 paths (`systems_config_v40.heating_setpoint`) by the patch-migration function landing in Part 1. Bridgewater's library_interventions stay valid post-migration.

6. **Browser verification mandatory.** Per Brief 40 Part 5b and Brief 41's lessons. Boot dev server, load Bridgewater, click through Part 3's walkthrough checklist, capture findings in audit doc.

7. **Documentation hygiene per Process Rule 7.** Each Part's commit includes STATUS.md + audit-doc update. Brief file landed in `docs/briefs/active/` as Part 1's first commit.

---

## Parts

### Part 1 — Schema move + audit doc + patch migration scaffold

**Goal:** Define the new schema. Document the move. Implement the patch-migration function. No engine or UI changes yet — Part 1 lays the foundation on disk.

**Files touched:**
- `docs/audit/42_systems_ux_schema.md` (new) — canonical reference for the schema move with before/after examples
- `docs/audit/40_systems_library_schema.md` — append a "Superseded by Brief 42" note at the top of relevant sections pointing to the new audit doc
- `frontend/src/context/ProjectContext.jsx` — `DEFAULT_PARAMS` shape updated; `schema_version` bumped from 41 to 42
- `frontend/src/utils/interventionsEngine.js` — `migratePatch(patch, from_version, to_version)` gains a real implementation for the v41 → v42 transition (was stub in Brief 41)
- `CLAUDE.md` — Module Scopes Systems section amended with the service-level vs system-level distinction
- `docs/briefs/active/42_systems_ux.md` — this brief file folded in
- `docs/briefs/current.md` — pointer updated

**Steps:**

1.1 **Define the new schema** in `docs/audit/42_systems_ux_schema.md`:

```javascript
// systems_config_v40 (post-Brief-42 shape)
systems_config_v40: {
  // === Heating service ===
  heating_setpoint_c: 21,              // Building-level: zone target temperature
  heating_setpoint_mode: 'follow_comfort' | 'custom',  // null effectively = follow_comfort
  heating: [                            // System-level array
    {
      id, label, source, efficiency_metric,
      share_pct, control_mechanism, control_schedule_id,
      enabled
      // NO setpoint field — building-level now
    }
  ],

  // === Cooling service ===
  cooling_setpoint_c: 24,
  cooling_setpoint_mode: 'follow_comfort' | 'custom',
  cooling: [ /* same system shape */ ],

  // === DHW service ===
  dhw_storage_setpoint_c: 60,           // Building-level
  dhw_tap_outlet_temp_c: 40,            // Building-level
  dhw_cold_supply_temp_c: 10,           // Building-level
  dhw_demand_basis: 'per_person' | 'per_m2',  // Building-level
  dhw_demand_litres_per_person_per_day: 80,   // populated when demand_basis === 'per_person'
  dhw_demand_litres_per_m2_per_day: 1.1,       // populated when demand_basis === 'per_m2'
  dhw: [                                 // System-level
    {
      id, label, source, efficiency_metric,
      share_pct, control_mechanism, control_schedule_id,
      enabled
      // NO setpoint, tap_outlet, cold_supply, demand_basis, demand_litres fields — building-level now
    }
  ],

  // === Ventilation, Lighting, Small power ===
  // No building-level fields. Per-system arrays unchanged from Brief 40.
  ventilation: [ /* unchanged */ ],
  lighting: [ /* unchanged */ ],
  small_power: [ /* unchanged */ ]
}
```

1.2 **Document before/after examples** for Bridgewater in the audit doc:

```
PRE-Brief-42 (current):
systems_config_v40.heating[0] = {
  id: 'ashp_1', label: 'ASHP', source: 'ambient_air',
  efficiency_metric: { scop: 2.8 }, share_pct: 90,
  setpoint: null,                        // ← moves to building level
  enabled: true,
  ...
}

POST-Brief-42:
systems_config_v40.heating_setpoint_mode = 'follow_comfort'
systems_config_v40.heating_setpoint_c = null   // resolved from comfort band at compute time
systems_config_v40.heating[0] = {
  id: 'ashp_1', label: 'ASHP', source: 'ambient_air',
  efficiency_metric: { scop: 2.8 }, share_pct: 90,
  enabled: true,
  ...
}
```

Same shape for cooling and DHW.

1.3 **Implement `migratePatch(patch, 41, 42)`** in `interventionsEngine.js`:

Map old paths to new paths:
- `building_config.systems_config_v40.heating[id=*].setpoint` → `building_config.systems_config_v40.heating_setpoint_c` (value preserved; `heating_setpoint_mode` set to `'custom'` if value non-null)
- `building_config.systems_config_v40.cooling[id=*].setpoint` → `building_config.systems_config_v40.cooling_setpoint_c` (same logic)
- `building_config.systems_config_v40.dhw[id=*].tap_outlet_temp_c` → `building_config.systems_config_v40.dhw_tap_outlet_temp_c`
- `building_config.systems_config_v40.dhw[id=*].cold_supply_temp_c` → `building_config.systems_config_v40.dhw_cold_supply_temp_c`
- `building_config.systems_config_v40.dhw[id=*].demand_basis` → `building_config.systems_config_v40.dhw_demand_basis`
- `building_config.systems_config_v40.dhw[id=*].demand_litres_per_person_per_day` → `building_config.systems_config_v40.dhw_demand_litres_per_person_per_day`
- `building_config.systems_config_v40.dhw[id=*].demand_litres_per_m2_per_day` → `building_config.systems_config_v40.dhw_demand_litres_per_m2_per_day`
- `building_config.systems_config_v40.dhw[id=*].storage_setpoint_c` → `building_config.systems_config_v40.dhw_storage_setpoint_c` (if the storage setpoint was per-system in Brief 40; check the schema)

**Edge case — same field patched by multiple interventions targeting different systems.** If pre-Brief-42 had Intervention A setting `heating[id=ashp_1].setpoint = 19` and Intervention B setting `heating[id=boiler_1].setpoint = 21`, migration collapses both to `heating_setpoint_c`. The last-write-wins rule from the interventions design note §10 applies — Intervention B (lower in stack) wins, Intervention A's patch is marked deprecated with a UI warning. Same shape as the "two interventions patching the same field" boundary condition.

1.4 **Update `DEFAULT_PARAMS`** in `ProjectContext.jsx` to the new shape. Default values from the existing Brief 40 defaults (heating_setpoint mode='follow_comfort', cooling_setpoint mode='follow_comfort', dhw_tap_outlet 40, dhw_cold_supply 10, dhw_storage 60, dhw_demand_basis 'per_person', dhw_demand_litres_per_person_per_day 80).

1.5 **Update CLAUDE.md Systems Module Scopes** to capture the distinction:

```markdown
### Systems Module — service-level vs system-level fields

The Systems module schema distinguishes:

**Building-level fields** (in `systems_config_v40` directly, not per system):
- Heating setpoint (heating_setpoint_c + heating_setpoint_mode)
- Cooling setpoint (cooling_setpoint_c + cooling_setpoint_mode)
- DHW storage setpoint, tap outlet temp, cold supply temp
- DHW demand basis (per_person | per_m2) and demand quantity

These describe the project's targets and needs. They are NOT per-system,
because two systems serving the same zone cannot have contradictory
zone targets.

**System-level fields** (in per-system entries):
- Source, efficiency_metric, share_pct, control_mechanism,
  control_schedule_id, enabled, label, capacity_kw, notes

These describe the specific kit installed. Multiple systems share the
service's building-level fields by their share_pct.

If a per-system entry contains a building-level field, the engine errors
loudly — no silent fallbacks.
```

1.6 **Commit.** Brief file folded in. STATUS.md updated.

**Commit message:**
```
Brief 42 Part 1: Systems UX schema move + patch migration scaffold

Schema reorganisation: building-level fields (setpoints, DHW
demand+temps) lift from per-system entries to direct fields on
systems_config_v40. System-level entries retain only fields that
describe the specific kit (source, efficiency, share, control,
enabled, label).

Documented in docs/audit/42_systems_ux_schema.md with before/after
examples for Bridgewater.

interventionsEngine.js migratePatch() now has a real v41→v42
implementation. Stale patches addressing per-system setpoint/demand
fields auto-migrate to building-level paths.

CLAUDE.md Module Scopes Systems section amended with the
service-level vs system-level distinction.

schema_version bumped to 42. DEFAULT_PARAMS reshaped.

No engine or UI changes yet. Part 2 implements engine; Part 3
implements UI; Part 4 migrates Bridgewater.
```

STATUS.md update in same commit.

---

### Part 2 — Engine update + Bridgewater sanity tests

**Goal:** The engine reads building-level fields from `systems_config_v40` directly (not from per-system entries). Bridgewater post-Brief-42 produces identical numbers to pre-Brief-42 (within rounding) — verifying that this is structural, not physical.

**Files touched:**
- `frontend/src/utils/systemsEngine.js` — `_computeDhw`, `_computeHeatingOrCooling`, share validation logic
- `frontend/src/utils/instantCalc.js` — minor; the v40 displacement adapters from Brief 40 Part 5b need to pass building-level setpoint through to `_calculateState2`'s setpointOverride correctly
- `frontend/src/utils/withMode.js` — allowlist updated for new building-level field names per Brief 33 Finding 1 ALLOWLIST DRIFT discipline
- `docs/audit/42_systems_ux_schema.md` — append "Engine implementation + Bridgewater sanity tests" section

**Steps:**

2.1 **`_computeDhw` reads service-level demand + temps.** Replace per-system reads with single building-level reads:

```javascript
// Pre-Brief-42 (wrong shape):
const tapOutlet = dhwSystem.tap_outlet_temp_c ?? DEFAULTS.tap_outlet
const demandBasis = dhwSystem.demand_basis ?? 'per_person'

// Post-Brief-42:
const tapOutlet = systems_config_v40.dhw_tap_outlet_temp_c ?? DEFAULTS.tap_outlet
const demandBasis = systems_config_v40.dhw_demand_basis ?? 'per_person'
```

Per-system entries that still contain these fields (from un-migrated configs) trigger an engine error. Per Principle 2.

2.2 **`_computeHeatingOrCooling` reads service-level setpoint.** Replace per-system setpoint resolution with single building-level read:

```javascript
// Pre-Brief-42:
const setpoint = heatingSystem.setpoint ?? comfortBand.lower_c

// Post-Brief-42:
const setpoint = systems_config_v40.heating_setpoint_mode === 'custom'
  ? systems_config_v40.heating_setpoint_c
  : comfortBand.lower_c
```

Same logic for cooling using upper_c.

Critical: the existing `setpointOverride` parameter on `_calculateState2` (Brief 40 Part 2 work) still functions — it's the mechanism by which a custom setpoint flows back to demand recomputation. That contract is unchanged; what changes is where the setpoint *originates* before being passed in.

2.3 **Share validation unchanged.** Per-service share_pct sum must equal 100 across enabled systems. The Brief 40 Part 5b engine-side validation continues to apply.

2.4 **withMode allowlist updated.** Building-level fields added to the allowlist passed to State 3 in `mode === 'full'`. Per Brief 33 Finding 1.

2.5 **Bridgewater sanity tests (CRITICAL).** Boot dev server. Load Bridgewater. Per Principle 1, post-Brief-42 numbers must match pre-Brief-42 within rounding.

Before running the migration in Part 4, Bridgewater is still on the pre-Brief-42 schema — so Part 2 tests will use a hand-migrated test copy or a snapshot. Process:
- Save pre-Brief-42 Bridgewater numbers (EUI, heating delivered, cooling delivered, DHW thermal, fuel split, carbon) from a fresh load
- Hand-migrate a temporary copy of Bridgewater to the new schema using migratePatch() logic
- Load the hand-migrated copy and compare against the saved numbers
- All numbers must match within 0.5%

If any movement >0.5%, escalate. The migration is either losing data or the engine logic has been changed unintentionally.

2.6 **Document the sanity tests** in audit doc § "Engine implementation + Bridgewater sanity tests" with the actual numbers.

**Commit message:**
```
Brief 42 Part 2: Engine reads service-level fields + Bridgewater sanity

_computeDhw and _computeHeatingOrCooling read building-level fields
(setpoints, DHW temps, demand basis+quantity) directly from
systems_config_v40, not from per-system entries.

Engine errors loudly if a per-system entry contains a building-level
field (catches stale/un-migrated data).

setpointOverride contract on _calculateState2 (Brief 40 Part 2) is
preserved — what changes is where the setpoint originates before
being passed in.

withMode allowlist updated for new building-level field names.

Bridgewater sanity tests: hand-migrated copy reproduces pre-Brief-42
numbers within 0.5% across all services. [actual numbers documented
in audit doc]. Verified that this is a structural reorganisation,
not a physics change.
```

STATUS.md + audit doc updated in same commit.

---

### Part 3 — UI rebuild: service-level headers + system editor pop-out

**Goal:** The Systems module's left panel shows service-level headers with building-level fields editable inline. Each service section lists its systems as summary rows. Clicking edit opens a draggable pop-out with only the per-system fields.

**Files touched:**
- `frontend/src/components/modules/systems/SystemsModule.jsx` — major rework to introduce service-level headers
- `frontend/src/components/modules/systems/ServiceSectionHeader.jsx` (new) — building-level fields editor per service
- `frontend/src/components/modules/systems/SystemSummaryRow.jsx` (new) — compact per-system row
- `frontend/src/components/modules/systems/SystemEditorPopout.jsx` (new) — draggable pop-out for per-system editing
- `frontend/src/components/modules/systems/SystemEditorCard.jsx` — content of the pop-out (refactored from existing Brief 40 Part 3 card; building-level groups removed)

**Steps:**

3.1 **`ServiceSectionHeader` per service.** At the top of each service section in the left panel, show the service-level fields editable inline:

- **Heating section header:**
  - Heating setpoint: radio Follow comfort (21°C) / Custom [slider/input °C]
- **Cooling section header:**
  - Cooling setpoint: radio Follow comfort (24°C) / Custom [slider/input °C]
- **DHW section header:**
  - Storage setpoint: [60 °C]
  - Tap outlet: [40 °C]
  - Cold supply: [10 °C]
  - Demand basis: dropdown Per person / Per m²
  - Demand: [80 L/person/day] OR [1.1 L/m²/day] depending on basis
- **Ventilation, Lighting, Small power section headers:** no building-level fields. Just a count and add-system button.

Tap-mix correction note (current Brief 40 inline copy) stays visible under the DHW header — it's read-only documentation, not data.

3.2 **`SystemSummaryRow` per system within each service section.** Below the service header, each system shows a compact row:

```
┌─────────────────────────────────────────────────────────┐
│ ● ASHP                          90% | SCOP 2.8 | [⚙ Edit] │
└─────────────────────────────────────────────────────────┘
```

- Coloured dot (service colour from Brief 37 Part 1 palette)
- Label
- Share %
- Headline efficiency (SCOP / SEER / combustion η — service-specific)
- On/off toggle (existing Brief 40 Part 5b pattern)
- Edit button → opens pop-out

3.3 **`SystemEditorPopout`.** Draggable pop-out reusing the Brief 37 `SchedulePopout` pattern. LocalStorage position key: `nza-system-editor-popout-position`. Reset position affordance. Esc-to-close. Non-blocking (main view stays interactive).

Header: "Editing system: {label}" plus drag handle, reset position, close button.

3.4 **`SystemEditorCard` content (refactored).** The pop-out's body. Groups:

- **IDENTITY** — Label, Share %
- **ENERGY** — Source, Efficiency metric (service-specific shape — SCOP for heat pumps, η for combustion, SFP+recovery for ventilation, etc.)
- **CONTROL** — Mechanism dropdown, control schedule link if scheduled
- **LIBRARY** — Save / Load
- **DIAGNOSTIC** — Only appears when service-level setpoint mode is 'custom' and the comfort-vs-setpoint delta is non-zero. Shows the diagnostic per Brief 40 §1.5.

Removed from the card (now in service header):
- Setpoint (heating/cooling)
- Tap outlet, Cold supply, Demand basis, Demand quantity (DHW)
- Storage setpoint (DHW)

3.5 **+ Add system button.** Per service section. Opens a small modal: pick from library OR start blank. Defaults at insert time per service (unchanged from Brief 40 Part 3).

3.6 **Share validation indicator.** In each service section header (alongside the building-level fields), the existing "Shares sum to X% (of enabled)" badge. Normalise quick-fix button. Behaviour unchanged from Brief 40 Part 5b — only enabled systems counted.

3.7 **Per-service batch enable toggle.** Existing Brief 40 Part 5b pattern. In the service section header, alongside the share-validation badge.

3.8 **Lighting + small power thin-card treatment.** With building-level fields none, the section is just a list of summary rows + Add button. The pop-out for lighting/small_power systems shows only Identity (label, share) + Control (mechanism, control_factor) + Library + Diagnostic. The "Reads from: Internal Gains" link (added in Brief 40 standalone commit `d3a7f5a`) stays.

3.9 **UnifiedScheduleEditor.** When control_mechanism === 'scheduled', the Control group's "Open schedule editor →" button opens the existing Brief 37 UnifiedScheduleEditor with the system's control_schedule_id. Pattern unchanged.

3.10 **Walkthrough preparation.** Document what Chris should see when he opens Systems post-rebuild:
- Six service sections in the left panel
- Each section header showing the relevant building-level fields (or just count + Add for ventilation/lighting/small power)
- System summary rows below each header
- Clicking Edit on any system opens the pop-out
- Pop-out is draggable; position persists across edits
- Sankey + Live Results unchanged from pre-Brief-42 (numbers reproduced per Part 2's sanity tests)

**Commit message:**
```
Brief 42 Part 3: Service-level headers + system editor pop-out

ServiceSectionHeader per service shows building-level fields inline:
- Heating: setpoint (follow comfort / custom)
- Cooling: setpoint
- DHW: storage + tap outlet + cold supply temps, demand basis + quantity
- Ventilation/Lighting/Small power: count + Add only

SystemSummaryRow shows compact per-system info: dot, label, share,
headline efficiency, on/off toggle, edit button.

SystemEditorPopout — draggable, persistent-position via
nza-system-editor-popout-position localStorage key, non-blocking,
Esc-to-close. Pattern matches Brief 37 SchedulePopout and Brief 41
intervention editor.

SystemEditorCard (refactored): groups Identity, Energy, Control,
Library, Diagnostic. Building-level field groups removed.

Share validation, enable toggles, Normalise quick-fix, library
save/load all preserved from Brief 40 Part 5b.

Awaits Chris's walkthrough sign-off before Part 4 close.
```

STATUS.md + audit doc updated in same commit.

---

### Part 4 — Bridgewater migration + walkthrough + close

**Goal:** Bridgewater migrates cleanly to the new schema. Walkthrough confirms the UI works as intended. Brief 42 archived.

**Files touched:**
- `scripts/42_systems_ux_migration.py` (new) — Bridgewater migration script
- `docs/audit/42_systems_ux_schema.md` — append "Part 4 — Bridgewater migration + walkthrough" section
- `docs/briefs/active/42_systems_ux.md` → `docs/briefs/archive/42_systems_ux_COMPLETED.md`
- `docs/briefs/current.md` — pointer updated
- STATUS.md — close-out

**Steps:**

4.1 **Migration script.** `scripts/42_systems_ux_migration.py`:
- Reads Bridgewater's existing `systems_config_v40`
- For each service, lifts building-level fields from the first per-system entry that has them (or computes from defaults if missing) to the new building-level location
- Removes the building-level fields from all per-system entries
- Idempotent + `--force` flag per Brief 40 Part 5b precedent
- Migrates `library_interventions` entries' patches via `migratePatch(patch, 41, 42)` (or the Python equivalent)
- Stop dev server before running per Process Rule 11

4.2 **Run the migration.** `python scripts/42_systems_ux_migration.py`. Confirm first-run + idempotent re-run NO-OP. Restart dev server.

4.3 **Walkthrough checklist Chris runs (12 items):**

1. Stop dev server. Run migration. Confirm idempotent NO-OP. Restart dev server.
2. Systems left panel: six service sections visible with the new shape.
3. Heating section header shows "Setpoint: Follow comfort (21°C)". Toggle to Custom 19°C — confirm engine output changes (heating demand drops), Live Results EUI moves, Sankey heating ribbon narrows.
4. Cooling section header shows "Setpoint: Follow comfort (24°C)". Toggle to Custom 20°C — confirm diagnostic appears on cooling system card(s); EUI rises.
5. DHW section header shows storage 60 / tap 40 / cold 10 / demand basis Per person / 80 L/person/day. Change tap outlet to 30°C — confirm DHW thermal drops (further tap-mix reduction).
6. DHW section header: change demand from 80 to 100 L/person/day — confirm DHW thermal scales linearly.
7. Click edit on a heating system. Pop-out opens. Draggable. Position persists across close/reopen.
8. Pop-out shows ONLY system-level fields (Identity, Energy, Control, Library, Diagnostic). No setpoint, no demand, no DHW temps.
9. Change heat pump SCOP from 2.8 to 4.0 in the pop-out. Live Results updates within the same render cycle.
10. Per-system enable toggle (in summary row, not pop-out) — toggle a heating system off. Share validation updates. Normalise works.
11. Library save/load: save the modified ASHP from the pop-out, add a new heating system from library. Confirm round-trip.
12. Bridgewater EUI compared to pre-Brief-42 baseline (`5835d21`): must match within 0.5%. Per Principle 1.

4.4 **Capture findings** in audit doc § "Part 4 — Bridgewater migration + walkthrough."

4.5 **Close commit.** `git mv` brief to archive. Update current.md. STATUS.md close-out.

**Commit message (after Chris's sign-off):**
```
Brief 42 close: Systems UX — service-level fields + pop-out editor live

Building-level fields (setpoints, DHW demand + temps) now live in
service section headers in the left panel. System-level fields
(source, efficiency, share, control, enabled) live in a draggable
pop-out editor.

The schema reorganisation is structural, not physical: Bridgewater
post-Brief-42 EUI matches pre-Brief-42 [SHA 5835d21] within 0.5%
across all six services.

Patch-migration scaffold (Brief 41 schema-flexibility discipline)
exercised in production: existing library_interventions patches
auto-migrated from per-system setpoint paths to building-level
setpoint paths.

Issues #21 (DHW demand → service-level) and #22 (system editor
pop-out) resolved. UFH-vs-radiator activation-threshold case
remains deferred for a future brief if real client need surfaces.

Bridgewater migrated; scripts/42_systems_ux_migration.py idempotent
+ --force.

Brief 42 archived. docs/briefs/active/ now empty (Brief 30 remains
paused in archive).
```

---

## Final report (paste in chat after close commit)

1. New origin/main HEAD SHA
2. Bridgewater pre-Brief-42 vs post-Brief-42 numbers per service (EUI, heating delivered, cooling delivered, DHW thermal + source, ventilation electrical, lighting electrical, small power electrical). All must match within 0.5%.
3. Confirmation that `library_interventions` patches migrated cleanly. Any deprecation warnings logged.
4. Walkthrough 12-item pass/fail capture. Anomalies + resolutions.
5. Issue #21 and #22 marked resolved in `29_open_issues.md`.
6. Confirmation that `docs/briefs/active/` is empty.
7. CLAUDE.md Module Scopes Systems section confirmed amended.
8. Any new issues logged in `29_open_issues.md` from the rebuild.

---

## What MUST NOT happen in Brief 42

- No code changes to `sql_parser.py`, `epjson_assembler.py`, simulation API endpoints (Dynamic remains paused).
- No envelope-physics changes. Rule 14 unlikely to fire; if it does (because share validation refactoring somehow touches a State 2 helper), the parity rule applies.
- No new fields. Only structural moves. Activation-threshold case (UFH + radiator backup) stays deferred.
- No physics changes. Bridgewater post-Brief-42 numbers reproduce within 0.5%.
- No calibration of post-migration numbers to match pre-migration. They match because the engine logic is unchanged, not because they've been tuned.
- No interventions module functional changes. Brief 41 closed. The interventions patches change addressing (per the patch-migration scaffold) but their semantics are unchanged.
- No deferred Brief 40 Part 5c lighting/small-power source-of-truth fix creeping back in. If surfaced during Brief 42, log to issues and continue.
- No partial commits — each Part is one commit including STATUS.md + audit-doc updates.
- No skipping browser verification on grounds of "the code looks right" — Part 3's walkthrough is mandatory per Principle 6.
- No expanding scope to absorb new issues — found issues go to `29_open_issues.md` for follow-up.

---

## When to escalate

Pause and escalate to Chris ONLY if:

- Part 2 Bridgewater sanity tests show >0.5% movement on any service. This means migration is losing data or engine logic has changed unintentionally.
- The migratePatch() function can't handle the v41 → v42 transition cleanly for any of Bridgewater's existing library_interventions (suggests a deeper issue with the schema-flexibility discipline).
- Part 3's UI rebuild reveals that `SystemEditorCard` had hidden dependencies on building-level fields that can't be cleanly extracted (suggests a refactor depth that warrants its own brief).
- Part 4 walkthrough surfaces an interaction (e.g. pop-out + live preview from intervention editor competing for the same screen real estate) that's structurally broken, not just a polish issue.
- Bridgewater's existing data turns out to have inconsistent values across DHW systems (one says demand=80, another says demand=100). The migration script's behaviour here needs explicit policy — likely "take the value from the first enabled system; log warnings for the others; surface in walkthrough finding."
- Documentation hygiene starts slipping.

Otherwise, plough through Parts 1–3, walkthrough sign-off after Part 3, Part 4 close. Final report at end.

---

## Notes for Claude Code on the discipline pattern

This brief follows the pattern that's worked for Briefs 36, 39, 40, 41, 41a, 42 (the per-opening one):

- **Read everything before starting.** BEFORE-DOING-ANYTHING checklist mandatory. Particularly the Notion design note (https://www.notion.so/366d645e05cc81cbb576ce33b0a22208) — it's the canonical reference.
- **Each Part is one commit.** Audit doc updates land in the same commit per Process Rule 7.
- **Browser verification is mandatory at Part 3** — boot dev server, load Bridgewater, click through the 12-item walkthrough checklist, capture results.
- **Diagnose before fixing.** If Part 2's sanity tests fail, the response is to add a finding to the audit doc and pause for diagnosis — not to tweak the engine until the number looks right. Per Principle 1.
- **Reuse existing patterns, don't invent new ones.** The pop-out reuses Brief 37 SchedulePopout pattern. The library save/load reuses Brief 37 + Brief 40 patterns. The service-section-header + summary-row + edit-button pattern reuses widespread UI conventions.
- **The CLAUDE.md Module Scopes Systems amendment is the durable deliverable.** Even if code work hits friction, the scope statement landing in Part 1 prevents future Systems-related work drifting back to per-system building-level fields.

Standing by for authorisation to begin Part 1.
