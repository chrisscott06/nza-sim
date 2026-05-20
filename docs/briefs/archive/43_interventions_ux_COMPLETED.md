# Brief 43 — Interventions UX: layout, structural ops, wider field coverage, summary enrichment

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Multi-Part UX brief addressing real-use feedback from Brief 41.
**Date opened:** 2026-05-20
**Target outcome:** The Interventions module works for genuine consultancy use. Stack lives in the main view; pop-out is draggable beside it (matching Schedule editor, System editor patterns). Each intervention can add, remove, replace, and field-edit systems and service-level fields — not just a handful of envelope and gain numbers. The stack rows show enough at-a-glance information that Chris doesn't need to open the editor to remember what each intervention does.

After this brief lands: Chris can build a real Net Zero retrofit study — "fabric strategy" (multi-patch envelope), "plant strategy" (swap gas DHW for ASHP), "demand strategy" (daylight dimming + occupancy reduction) — and see the marginal and cumulative impact of each, with intervention summaries visible in the stack and structural changes captured cleanly as patches.

This brief addresses Issues #20 (the lighter answer, not the full main-app-UI wrap), and the four new issues surfaced during Brief 41 walkthrough and Brief 42 Part 3 walkthrough (layout, structural ops, summary enrichment, service-level patches).

---

## BEFORE DOING ANYTHING

0. **Run the session-start documentation reconciliation pass (mandatory).** Per Process Rule 8:
   - `ls docs/briefs/active/` — list everything in active
   - `cat docs/briefs/current.md` — read what current.md claims
   - `tail -50 STATUS.md` — read most recent STATUS entries
   - `git log --oneline -20` — read the last 20 commits
   - **Cross-check:** Brief 42 should be archived; `docs/briefs/active/` should be empty (Brief 30 paused in archive); `current.md` should reflect no active brief.
   - If any check fails, the first commit of the session is the cleanup commit.

1. Read this entire brief.
2. Read CLAUDE.md end to end. Particularly Module Scopes Interventions section (landed Brief 41 Part 1), Module Scopes Systems section (amended Brief 42 Part 1), Process Rules 7, 8, 10, 11.
3. Read the Notion design notes — both are canonical references:
   - **NZA-Sim — Interventions module: architecture design note** (https://www.notion.so/365d645e05cc81b79160e49029d2158c) — Brief 41's reference; declarative patches, stack semantics, comparison view shape
   - **NZA-Sim — Interventions UX feedback + Brief 43 scope** (https://www.notion.so/366d645e05cc818b8653d51bdf8b4342) — this brief's specific scope; five issues identified during real use
4. Read `docs/audit/41_interventions_schema.md` for the patch model (set/add/remove/replace ops, path conventions, library refs, schema version stamps).
5. Read `docs/audit/42_systems_ux_schema.md` for the post-Brief-42 systems schema (service-level fields vs system-level fields). This determines what patch paths are valid post-Brief-42 — and several Brief 41 editor patches will need their paths updated.
6. Read `docs/audit/29_open_issues.md` — Issue #20 (curated editor scope deferral, owned by this brief). Other open issues remain deferred unless they touch interventions specifically.
7. Read the existing Brief 41 interventions module: `frontend/src/components/modules/interventions/*` — particularly `InterventionEditorPopout.jsx`, `InterventionEditorBuildingView.jsx`, `InterventionEditorPreview.jsx`, `PatchList.jsx`, `patchCapture.js`, `InterventionStackView.jsx`, `InterventionRow.jsx`. This brief refactors and extends these; understanding the current shape is mandatory before changing it.
8. Confirm working tree clean: `git status --short`.
9. Confirm `origin/main == local main`.
10. **Part 1's first commit must include this brief file landed at `docs/briefs/active/43_interventions_ux.md`** per Process Rule 7. No code work begins until that commit lands.
11. Do not begin Part 1 until checks 0–10 pass.

---

## Scope statement

This brief is **UX work on top of an unchanged data model and unchanged engine**. The patch shape (op/path/value/source/schema_version) is unchanged. The engine's `applyPatch`, `applyIntervention`, `runInterventionStack`, `computeDelta` functions are unchanged. What changes:

1. **Module layout** — stack in the main view, pop-out draggable beside (not full-screen)
2. **Editor UI** — wider field coverage in the curated editor; structural ops (add/remove/swap systems); affordance for service-level patches (post-Brief-42)
3. **Stack rows** — summary information enriched (patch count + plain-English summary of what changed)

Per CLAUDE.md Module Scopes pattern, the Interventions module's scope is unchanged. What changes is how the user authors and reviews interventions.

This brief delivers four substantive Parts plus close.

---

## Operational mode — keep ploughing through

Per Chris's authorisation: end-to-end run, no per-Part sign-off pauses. Walkthrough sign-off after Part 3 before Part 4 close. Stop and escalate only for the conditions in "When to escalate" below.

---

## Principles

1. **No data model changes.** The patch shape stays exactly as Brief 41 defined it. Patches authored by Brief 41 must continue to load and apply correctly post-Brief-43. Brief 41's library_interventions stay valid.

2. **No engine changes.** `applyPatch`, `applyIntervention`, `runInterventionStack`, `computeDelta` are unchanged. Brief 42's `migratePatch(patch, 1, 2)` continues to do its job. If a UI bug surfaces an engine issue, log it but don't fix in this brief.

3. **Reuse the pop-out pattern.** Brief 37 SchedulePopout + Brief 41 InterventionEditorPopout + Brief 42 SystemEditorPopout are three established precedents. Brief 43's repositioned intervention editor uses the same shape: draggable, persistent-position via localStorage (`nza-intervention-editor-popout-position` — unchanged from Brief 41), non-blocking, Esc-to-close, reset-position affordance.

4. **Widen the curated editor, don't wrap arbitrary main-app UI.** Issue #20's "wrap full main-app UI in patch capture context" stays deferred. Brief 43 takes the lighter answer: add the missing patch targets to the curated editor. If real use after Brief 43 reveals further gaps, full main-app wrap becomes a much larger future brief.

5. **Structural ops surface in the curated editor.** Per service section in the editor, the user can: add a system (op: 'add'), remove a system (op: 'remove'), replace a system (op: 'replace'). All three already work in the engine; Brief 43 adds the UI affordance.

6. **Service-level patches use post-Brief-42 paths.** Heating/cooling setpoints, DHW demand basis + quantity + temps are service-level after Brief 42. Brief 43's editor patches address them at the service level (`systems_config_v40.heating_setpoint_c`, `systems_config_v40.dhw_demand_litres_per_person_per_day`, etc.) — not at the per-system level which no longer exists.

7. **Stack rows show enough at-a-glance.** Same lesson as Brief 42's SystemSummaryRow fix: don't make the user open the editor to see what an intervention does. Patch count + short summary of what changed appears inline on each stack row.

8. **Visualisation-as-verification stays in force.** Every new patch type added to the editor must produce a predictable visible change in the live preview. Part 3's walkthrough verifies this; Part 4 verifies again with the real migrated Bridgewater state.

9. **Browser verification mandatory.** Per Brief 40 Part 5b's lesson and Brief 41 Part 4.1's confirmation. Boot dev server, load Bridgewater, click through the walkthrough checklist, document findings.

10. **Documentation hygiene per Process Rule 7.** Each Part's commit includes STATUS.md + audit-doc update. Brief file landed in `docs/briefs/active/` as Part 1's first commit.

---

## Parts

### Part 1 — Layout refactor: stack in main view, pop-out draggable

**Goal:** Open the Interventions module and see the stack in the main view. Click an intervention to edit — the editor opens as a draggable pop-out beside the stack, not as a full-screen overlay. The main view remains interactive while the editor is open.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` — layout refactor
- `frontend/src/components/modules/interventions/InterventionEditorPopout.jsx` — pop-out chrome unchanged, but mounted differently (no full-screen mode)
- `docs/audit/43_interventions_ux.md` (new) — captures the layout changes
- `docs/briefs/active/43_interventions_ux.md` — this brief file
- `docs/briefs/current.md` — pointer updated
- CLAUDE.md — Module Scopes Interventions section confirmed unchanged (no scope drift)

**Steps:**

1.1 **Layout change.** `InterventionsModule.jsx` renders:
- Header strip (existing) — title, subtitle, tabs (Stack / Comparison)
- Main content area — the stack view OR comparison view, full width of available canvas
- Editor pop-out — when open, sits as a draggable overlay (not full-screen). Default position: right side of canvas, not blocking the stack rows directly. Stack remains visible and live-updating.

1.2 **Pop-out chrome.** The existing draggable chrome from Brief 41 (header bar with drag handle, reset position, close) remains. Default initial position is the right half of the canvas; `nza-intervention-editor-popout-position` localStorage key preserves user-chosen position across edits. Esc closes the pop-out.

1.3 **Non-blocking interaction.** While the pop-out is open, the stack view remains clickable — clicking a different intervention's edit pencil switches the pop-out to that intervention (after confirming any unsaved changes — see 1.4).

1.4 **Unsaved-changes guard.** Before switching to a different intervention's edit, or before closing the pop-out without Save, prompt: "Discard X unsaved patches?" with Cancel / Discard buttons. Matches existing Brief 41 behaviour but now surfaced more visibly since the pop-out's smaller footprint makes it easier to accidentally close.

1.5 **Engine reactivity test.** Open the pop-out, capture a patch, watch the stack row's marginal Δ update in the background. The decoupling between editor and stack should be visible — patches captured but unsaved show in the live preview within the pop-out; saving propagates to the stack row.

1.6 **Audit doc.** `docs/audit/43_interventions_ux.md` § "Part 1 — Layout refactor" documents:
- The shape change (full-screen → draggable beside)
- Position key and default position
- Non-blocking interaction model
- Unsaved-changes guard behaviour

1.7 **CLAUDE.md Module Scopes Interventions section.** Re-read for accuracy. Confirm unchanged (Brief 43 doesn't drift scope, only refines UX).

1.8 **Commit.**

**Commit message:**
```
Brief 43 Part 1: Interventions layout refactor — stack in main view, draggable pop-out

InterventionsModule renders stack in main content area (full canvas
width). Editor opens as a draggable overlay positioned by default on
the right half of the canvas — not full-screen.

Stack remains visible and live-updating while pop-out is open.
Clicking a different intervention's edit pencil switches the pop-out
(after unsaved-changes guard).

Pop-out position persists via nza-intervention-editor-popout-position
localStorage key (unchanged from Brief 41 Part 4).

Matches the established pop-out pattern from Brief 37 SchedulePopout
+ Brief 42 SystemEditorPopout.

No data model changes. No engine changes. UI-only refactor.
```

STATUS.md + audit doc updated in same commit.

---

### Part 2 — Structural ops: add / remove / replace systems within an intervention

**Goal:** The intervention editor's curated UI lets the user add, remove, or replace a system within any service. The captured patches use the existing engine ops ('add', 'remove', 'replace') with the post-Brief-42 paths.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` — add structural op UI per service section
- `frontend/src/components/modules/interventions/patchCapture.js` — extend to capture 'add', 'remove', 'replace' patches in addition to 'set'
- `frontend/src/components/modules/interventions/PatchList.jsx` — render structural ops in plain English
- `docs/audit/43_interventions_ux.md` — append "Part 2 — Structural ops" section

**Steps:**

2.1 **Per service section — add system affordance.** Each service section in the editor (Heating / Cooling / DHW / Ventilation / Lighting / Small power) gains a "+ Add system" button. Clicking opens a small modal:
- Pick from library (existing `library_systems` namespace) OR start blank
- For blank: defaults per service (matching Brief 40 Part 3's defaults)
- On confirm: patch captured as `{ op: 'add', path: 'building_config.systems_config_v40.<service>', value: { ... }, source: 'library' | 'inline', schema_version: 2 }`
- The new system's UUID is generated client-side and included in the value

2.2 **Per service section — remove system affordance.** Each existing system in the service shows (in addition to the field-edit affordances) a "⊗ Remove" button. Clicking captures patch:
- `{ op: 'remove', path: 'building_config.systems_config_v40.<service>', match: { id: '<system_id>' }, schema_version: 2 }`
- Visual treatment: the removed system shows as crossed-out / muted in the editor until Save
- Live preview reflects the removal (system contribution drops; remaining systems' shares may need normalisation — engine validation will catch shares ≠ 100 and surface the error in the preview)

2.3 **Per service section — replace system affordance.** Each existing system shows a "⇄ Replace" button. Clicking opens the same modal as "Add" (library or blank). On confirm:
- `{ op: 'replace', path: 'building_config.systems_config_v40.<service>', match: { id: '<system_id>' }, value: { ... }, source: 'library' | 'inline', schema_version: 2 }`
- The old system's ID is preserved on the replacement (so the replacement effectively "takes over the slot" — share, enabled state defaulted from old system unless overridden)
- Visual treatment: old system crossed-out with new system shown beside it

2.4 **Patch ordering within an intervention.** Multiple structural ops on the same service in one intervention apply in patch-list order. If the user removes a system and then adds two, the resulting state has the original minus the removed plus the two new. The engine handles this via the existing `applyIntervention` loop; the editor just needs to track patches in capture order.

2.5 **PatchList plain-English rendering.** The patch list in the editor footer shows structural ops clearly:
- "Added Heating system: ASHP_Daikin_VRV_X (SCOP 3.2, 80% share) — from library"
- "Removed Heating system: gas_combi_1"
- "Replaced DHW system gas_combi_dhw with ASHP_DHW_300L (SCOP 2.8) — from library"
- "Wall U-value: 0.28 → 0.18" (set ops as before)

2.6 **Share validation in the editor.** After any structural op, the live preview computes the proposed config and runs the engine. If shares for any service don't sum to 100 across enabled systems, the preview shows an inline error: "Heating shares sum to 70% — add 30% to remaining systems or normalise." A "Normalise enabled shares" button appears alongside; clicking captures additional `set` patches to scale enabled shares proportionally to 100. Same pattern as Brief 40 Part 5b's Normalise quick-fix, applied here at intervention authoring time.

2.7 **Browser verification.** Boot dev server. Load Bridgewater. Open Interventions. Add a new intervention. In the editor:
- Add a heating system from library — confirm patch captured, live preview updates
- Remove the gas combi DHW system — confirm patch captured, preview shows error if shares broken, Normalise restores
- Replace a ventilation MEV with MVHR (from library) — confirm replacement captured, recovery credit visible in preview
- Save intervention, confirm stack row's marginal Δ reflects all captured patches

2.8 **Audit doc.** § "Part 2 — Structural ops" documents the three op types, the modal pattern for add/replace, the share validation behaviour, and the PatchList rendering rules.

**Commit message:**
```
Brief 43 Part 2: Structural ops in intervention editor — add/remove/replace systems

Per service section in InterventionEditorBuildingView:
- "+ Add system" button opens library/inline modal; captures
  op: 'add' patch
- Per existing system: "⊗ Remove" captures op: 'remove' with
  match by id
- Per existing system: "⇄ Replace" opens modal; captures
  op: 'replace' with match by id

patchCapture extended for non-'set' ops. Patches use post-Brief-42
service-level paths.

Share validation in live preview catches shares ≠ 100 across
enabled systems after structural ops; Normalise quick-fix scales
enabled shares proportionally (matching Brief 40 Part 5b pattern).

PatchList renders structural ops in plain English: "Added Heating
system: ASHP_Daikin_VRV_X", "Removed DHW system: gas_combi_dhw",
"Replaced ventilation MEV with MVHR — from library".

Browser-verified on Bridgewater: structural op flow captures
correctly, live preview reactive, save persists to stack.
```

STATUS.md + audit doc updated in same commit.

---

### Part 3 — Wider field coverage + service-level patches + summary row enrichment

**Goal:** The curated editor exposes lighting control mechanism, ventilation per-system fields, per-system enable toggle, schedule overrides, and post-Brief-42 service-level fields. Stack rows show patch count and a plain-English summary of what changed.

**Files touched:**
- `frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` — add field affordances
- `frontend/src/components/modules/interventions/patchCapture.js` — extend to capture service-level paths
- `frontend/src/components/modules/interventions/InterventionRow.jsx` — enrich summary
- `frontend/src/components/modules/interventions/InterventionStackView.jsx` — minor layout tweak for new column
- `docs/audit/43_interventions_ux.md` — append "Part 3 — Wider coverage + summary" section

**Steps:**

3.1 **Service-level patches in the editor.** Each service section header in the editor (mirroring the Brief 42 Systems module's ServiceSectionHeader) shows the building-level fields editable inline:

- **Heating section header:** Heating setpoint — radio Follow comfort / Custom °C
  - Patch path: `building_config.systems_config_v40.heating_setpoint_c` (and `..._mode`)
- **Cooling section header:** Cooling setpoint — same shape
- **DHW section header:** Storage setpoint, tap outlet, cold supply, demand basis, demand quantity
  - Patch paths: `building_config.systems_config_v40.dhw_storage_setpoint_c`, `dhw_tap_outlet_temp_c`, `dhw_cold_supply_temp_c`, `dhw_demand_basis`, `dhw_demand_litres_per_person_per_day`, `dhw_demand_litres_per_m2_per_day`

3.2 **Per-system field coverage — heating, cooling, DHW, ventilation, lighting, small_power.** Each existing system in the editor exposes:

- **Enabled toggle** — `{ op: 'set', path: 'building_config.systems_config_v40.<service>[id=<id>].enabled', value: false }`
- **Source dropdown** (per service: gas, electricity, ambient_air, ambient_ground, district_heat, district_cooling, etc.)
- **Efficiency metric** — SCOP / SEER / combustion η / SFP+recovery per service shape
- **Share %**
- **Control mechanism dropdown** — constant / weather_compensation / scheduled
- **Control schedule ref** (when scheduled) — opens UnifiedScheduleEditor to capture schedule patches as `{ op: 'set', path: '...control_schedule_id' }`

3.3 **Lighting + small_power-specific.** The curated editor adds:

- **Control mechanism dropdown** — constant / daylight_dimming / occupancy_sensors / both
  - Patch path: `building_config.systems_config_v40.lighting[id=<id>].control_mechanism`
  - Derived `control_factor` shown read-only as preview (matches Brief 40 Part 4 thin-entry pattern)
- Internal Gains link (read-only "Edit lighting load in Internal Gains →" cross-reference, per Brief 40 standalone commit `d3a7f5a`)

3.4 **Ventilation-specific.** Per-system fields:

- **Flow rate** — value + basis (per_person / per_m2 / constant)
- **SFP** — W/(l/s)
- **Recovery sensible %** (MVHR only)
- **Recovery latent %** (enthalpy-wheel MVHR only)

All as `{ op: 'set', path: 'building_config.systems_config_v40.ventilation[id=<id>].<field>', value: ... }`.

3.5 **Internal Gains coverage.** Verify all existing fields from Brief 41 Part 4 still work post-Brief-42. Add if missing:

- **Occupancy rate**
- **Density (per_room or per_m2)**
- **Lighting load (W/m²)** — Internal Gains source-of-truth
- **Equipment load (W/m²)** — same
- **Schedule overrides** for any of the above

3.6 **Envelope coverage.** Verify all existing fields from Brief 41 Part 4 still work. Confirm:

- Air permeability (q50)
- Wall U / Roof U / Glazing U — via construction picker (existing fix from Brief 41 Part 4.1's `{library_id, u_value_override}` shape)
- Ground floor U — was specifically called out as missing during Brief 41 walkthrough; if still missing, add
- Shading — overhang depths per orientation

3.7 **InterventionRow summary enrichment.** Each row in the stack now shows:

- Drag handle (existing)
- Coloured dot — derived from theme field if present (existing, optional)
- Label (existing)
- **NEW: Patch summary** — short plain-English summary of what changes. Examples:
  - "3 patches: wall U, infiltration, MVHR add"
  - "2 patches: ASHP DHW replace, gas DHW disable"
  - "1 patch: cooling setpoint"
  - "5 patches: fabric + plant + demand"
- Enabled toggle (existing)
- Marginal Δ — EUI + carbon (existing)
- Cumulative Δ — EUI + carbon (existing)
- Edit pencil (existing)

The summary is generated from the patch list using the same plain-English renderer as `PatchList.jsx` § 2.5, but condensed: first 3 patches by display priority (structural ops first, then field changes), truncated with "+N more" if longer.

3.8 **Walkthrough verification matrix.** Brief 41 §V matrix had 10 intervention types. Brief 43 widens coverage; re-walk each of the 10 to confirm they still capture cleanly with the new path structure. Plus six new structural ops:

| # | Intervention type | Patch shape |
|---|---|---|
| 11 | Add MVHR system to ventilation | `op: 'add', path: '...ventilation', source: 'library'` |
| 12 | Remove gas combi heating | `op: 'remove', path: '...heating', match: { id: 'gas_combi_1' }` |
| 13 | Replace gas DHW with ASHP DHW | `op: 'replace', path: '...dhw', match: { id: '...' }` |
| 14 | Change heating setpoint (service-level) | `op: 'set', path: '...heating_setpoint_c' + ..._mode` |
| 15 | Change DHW demand (service-level) | `op: 'set', path: '...dhw_demand_litres_per_person_per_day'` |
| 16 | Add daylight dimming (lighting control_mechanism) | `op: 'set', path: '...lighting[id=*].control_mechanism'` |

3.9 **Audit doc.** § "Part 3 — Wider coverage + summary" documents:
- Service-level patch paths
- Per-system field coverage
- Lighting + ventilation specifics
- Summary row generation rules
- Verification matrix (16 rows total, 10 from Brief 41 plus 6 new)

**Commit message:**
```
Brief 43 Part 3: Wider field coverage + service-level patches + summary enrichment

Service-level patches (Brief 42 schema): heating/cooling setpoints,
DHW demand basis + quantity + temps editable in service section
headers of the intervention editor. Patch paths address service-
level fields directly.

Per-system field coverage extended: enabled toggle, source, full
efficiency metric (SCOP / SEER / SFP+recovery), share, control
mechanism, control schedule ref.

Lighting + small_power: control_mechanism dropdown captures
daylight_dimming, occupancy_sensors, etc. Internal Gains link
maintained.

Ventilation: per-system flow rate, SFP, recovery sensible + latent.

Internal Gains: occupancy_rate, density, lighting_load, equipment,
all schedule overrides.

Envelope: confirmed coverage including ground floor U (added if was
missing).

InterventionRow now shows patch summary inline: "3 patches: wall U,
infiltration, MVHR add". Plain-English renderer condensed from
PatchList, truncated with "+N more" if long.

Walkthrough verification: 16-row matrix (10 from Brief 41 + 6 new
structural ops + service-level). All capture cleanly; live preview
reactive.

Awaits Chris's walkthrough sign-off before Part 4 close.
```

STATUS.md + audit doc updated in same commit.

---

### Part 4 — Bridgewater walkthrough + close

**Goal:** Chris's walkthrough confirms Brief 43 lands. Brief 43 archived. Issue #20 marked resolved. STATUS.md final.

**Files touched:**
- `docs/audit/43_interventions_ux.md` — append "Part 4 — Walkthrough" section
- `docs/audit/29_open_issues.md` — Issue #20 resolved
- `docs/briefs/active/43_interventions_ux.md` → `docs/briefs/archive/43_interventions_ux_COMPLETED.md`
- `docs/briefs/current.md` — pointer updated
- STATUS.md — close-out

**Walkthrough checklist Chris runs (15 items):**

1. Open Interventions module. Stack view in main canvas — full width. No full-screen takeover.
2. Add new intervention. Pop-out opens on right half of canvas; draggable; reset-position works.
3. Drag pop-out to left half of canvas, close, reopen — position preserved.
4. While pop-out is open, click a different intervention's edit pencil — unsaved-changes guard fires (if patches captured).
5. **Envelope:** change wall U via construction picker — patch captures correctly with `{library_id, u_value_override}` shape (Brief 41 Part 4.1 fix). Live preview reactive.
6. **Service-level setpoint:** in Heating section header, set Custom 19°C — patch captures at `heating_setpoint_c` + `_mode`; preview shows heating demand drop.
7. **DHW service-level:** in DHW section header, change demand from 80 to 100 L/person/day — patch captures at `dhw_demand_litres_per_person_per_day`; preview shows DHW thermal rise linearly.
8. **Structural op — add:** click "+ Add system" in DHW section, pick "ASHP DHW" from library — patch captured as `op: 'add'`; preview reflects added system.
9. **Structural op — remove:** click "⊗ Remove" on gas combi DHW — patch captured as `op: 'remove'`; preview reflects removal; shares validation surfaces if not 100; Normalise restores.
10. **Structural op — replace:** click "⇄ Replace" on a ventilation MEV system, pick MVHR from library — patch captured as `op: 'replace'`; preview shows recovery credit.
11. **Lighting control mechanism:** change to daylight_dimming — preview shows lighting electrical drop to ~70%; gain in Internal Gains unchanged.
12. **Save intervention.** Pop-out closes. Stack row shows patch count + summary ("5 patches: setpoint + DHW demand + ASHP DHW add + gas DHW remove + MVHR replace + daylight dimming"). Marginal Δ + cumulative Δ computed.
13. **Stack row summary** — confirm the summary reflects the patches accurately. Long lists truncate with "+N more".
14. **Reorder:** drag an intervention above another. Marginals change. Cumulative final unchanged. Summary rows preserved on each.
15. **Library save/load:** save the modified intervention to library_interventions; create a new intervention; load from library — all patches restore including structural ops.

If all 15 pass → Part 4 close commit.
If anything anomalous → log in 29_open_issues.md, diagnose, fix in follow-up commit within Part 4, re-verify.

**Audit doc § "Part 4 — Walkthrough":**
- Pass/fail per item
- Any anomalies + resolutions
- Bridgewater 3-intervention stack: pre-Brief-43 EUI deltas vs post-Brief-43 EUI deltas. Numbers must match within rounding (no engine changes).

**Commit message (after Chris's sign-off):**
```
Brief 43 close: Interventions UX live — layout + structural ops + wider coverage

Layout: stack in main view, pop-out draggable beside. Pattern matches
Brief 37/41/42 across the tool.

Structural ops in curated editor: add / remove / replace systems
within an intervention. Engine ops (op: 'add' / 'remove' / 'replace')
already supported; Brief 43 surfaces them in the UI.

Field coverage widened: service-level setpoints + DHW demand
(Brief 42 paths), lighting control_mechanism, ventilation per-system
fields, per-system enable, schedule overrides. Internal Gains and
envelope coverage verified including ground floor U.

Stack rows now show patch summary inline — user doesn't need to
open editor to remember what an intervention does.

16-row verification matrix all pass on Bridgewater (10 from Brief 41
matrix + 6 new structural / service-level ops). 3-intervention stack
deltas match pre-Brief-43 numbers within rounding (no engine changes).

Issue #20 (Interventions editor curated scope) resolved: lighter
answer — widen curated editor — turned out to be enough. Full
main-app-UI wrap stays deferred as Issue #20-deferred if ever needed.

Brief 43 archived. docs/briefs/active/ now empty.
```

---

## Final report (paste in chat after close commit)

1. New origin/main HEAD SHA
2. Confirmation that Bridgewater 3-intervention stack EUI deltas match pre-Brief-43 numbers within rounding (no engine changes; numbers preserved)
3. 16-row verification matrix pass/fail. Any anomalies + resolutions
4. Confirmation that `library_interventions` patches still load + apply correctly post-Brief-43 (no patch-shape changes)
5. Issue #20 marked resolved in `29_open_issues.md`
6. Any new issues logged in `29_open_issues.md` from real use during walkthrough
7. Confirmation `docs/briefs/active/` is empty
8. CLAUDE.md Module Scopes Interventions section confirmed unchanged

---

## What MUST NOT happen in Brief 43

- No data model changes. Patch shape, intervention shape, project shape all unchanged.
- No engine changes. `applyPatch`, `applyIntervention`, `runInterventionStack`, `computeDelta` are read-only references for this brief.
- No visualisation work. Waterfall, carbon trajectory, CRREM/pathway overlays are Brief 44's job.
- No wrap-arbitrary-main-app-UI work. Issue #20's "full main-app UI in patch capture context" stays deferred (now informally as Issue #20-deferred).
- No expanding scope to absorb new issues — found issues go to `29_open_issues.md`.
- No partial commits — each Part is one commit including STATUS.md + audit-doc updates.
- No skipping browser verification — Part 3's 16-row matrix and Part 4's 15-item walkthrough are mandatory.
- No drift back to per-system service-level fields (heating[id=*].setpoint, dhw[id=*].demand) — these are post-Brief-42 invalid paths; the editor must address them at service level.
- No regressions to Brief 40 Part 5b's share validation (engine-side blocking compute when shares ≠ 100 across enabled systems).
- No regressions to Brief 41's library_interventions — saved patches must load + apply identically post-Brief-43.

---

## When to escalate

Pause and escalate to Chris ONLY if:

- The layout refactor reveals that the existing pop-out chrome (drag handle, position persistence, reset, close) doesn't function cleanly in the new non-full-screen mode — would indicate a deeper Brief 41 Part 4 bug
- Structural ops in the editor reveal an engine bug (e.g. `applyPatch` mishandles 'remove' or 'replace' when match doesn't resolve) — log, but don't fix in this brief; Brief 43 is UI-only
- A walkthrough matrix row fails in a way that suggests a deeper engine bug beyond intervention scope (e.g. specific patch type breaks share validation)
- Library round-trip breaks (patches save but don't reload identically) — would indicate a patch-shape mismatch and is a serious regression
- The summary-row rendering can't be done concisely (e.g. patch labels grow unboundedly) — design refinement needed
- Documentation hygiene starts slipping
- Bridgewater post-Brief-43 numbers differ from pre-Brief-43 (would indicate a hidden engine change; not possible in principle but worth verifying)

Otherwise, plough through Parts 1–3, walkthrough sign-off after Part 3, Part 4 close.

---

## Notes for Claude Code on the discipline pattern

This brief follows the pattern that's worked for Briefs 36, 39, 40, 41, 41a, 42:

- **Read everything before starting.** Both Notion design notes (interventions architecture + Brief 43 scope) are mandatory.
- **Each Part is one commit.** Audit doc + STATUS.md updates land in the same commit per Process Rule 7.
- **Browser verification is mandatory at Part 3 (16-row matrix) and Part 4 (15-item walkthrough).** Code-side reasoning has consistently underestimated UX-layer issues; the matrix and walkthrough are how Brief 43 confirms its own success.
- **No data model or engine changes.** This is UI work on top of a stable foundation. If a UI bug surfaces an engine issue, log it; don't fix in this brief.
- **Reuse pop-out pattern.** Three established precedents (Brief 37, 41, 42) — Brief 43 follows the same shape.
- **The widened curated editor is the durable deliverable** — even if real use later surfaces gaps Brief 43 doesn't fill, the architecture supports adding more affordances as needed; the engine and data model are already capable.

Standing by for authorisation to begin Part 1.
