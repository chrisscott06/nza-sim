# Brief 42 — Per-opening C_d and flow_mode

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott (chat-form authorisation 2026-05-19 — "Lets go").
**Status:** Active. Part 1 begins this commit-chain.
**Date opened:** 2026-05-19
**Target outcome:** Every envelope opening (permanent vent OR operable door/window/vent) declares its own discharge coefficient and flow mode. The building-wide `openings.cd` and `openings.flow_mode` fields are removed. Site exposure (C_w) remains building-wide because it's a property of building setting, not of an individual opening. UI for both Building (permanent openings) and Operation (operable openings) shows per-opening controls. Sensible defaults are applied based on opening type when a new opening is added.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md, particularly the "Module scopes" Building module section and Rule 14 (envelope physics parity across three locations — extended by Brief 41 to call out operable openings and the mirror-vs-physics-correctness rule).
3. Read STATUS.md as currently on disk; confirm last entry is Brief 41 close (this commit's housekeeping chunk).
4. Confirm working tree clean: `git status --short` (apart from the pre-existing untracked validation files).
5. Confirm `origin/main == local main`.
6. Do not begin Part 2 until Part 1's commit lands.

---

## Scope statement

This brief touches the Building module (Permanent Openings panel) and the Operation module (operable openings panel). It's a data-model and UI change. The engine reads new per-opening fields instead of the current building-wide ones. No new physics; same flow correlations.

Per CLAUDE.md "Module scopes" Building section, permanent vents are passive envelope features. Per Brief 41's resolution, operable openings use the same flow correlations as permanent vents (single_sided / cross dispatch). This brief unifies their configuration model.

Site exposure (C_w) stays building-wide and stays in the Building module — it's a property of where the building sits, not of an individual opening.

---

## Operational mode — keep ploughing through

Plough through Parts 1–6 without per-Part sign-off. Walkthrough sign-off after Part 5 before Part 6 close. Same pattern as Briefs 39 and 41.

---

## Principles

1. **Each opening declares what it is.** No inheritance from building-wide defaults. When you add a vent, you set its C_d. When you add a door, you set its C_d. Same for flow_mode.
2. **Sensible per-type defaults at creation time, not as inheritance.** When the user clicks "+ Door", the new opening is created with C_d 0.60 and flow_mode 'cross'. When they click "+ Window," C_d 0.55 and 'single_sided'. When they click "+ Vent," C_d 0.40 and 'single_sided'. The defaults are seed values, not live links — changing them later doesn't propagate.
3. **Site exposure stays building-wide.** Site exposure is a property of building setting. Trickle vent and door on the same façade see the same wind. One control, building-wide.
4. **No physics changes.** Same flow correlations. Brief 39 and Brief 41 left the engine in the right shape; this brief changes the *source* of the C_d and flow_mode values the engine reads, not the calculation itself.
5. **Migration must preserve current behaviour.** Existing buildings have a single `openings.cd` and `openings.flow_mode`. Migration writes those values onto every existing opening so behaviour is unchanged at migration time. After migration the user can edit per-opening.
6. **Rule 14 parity.** Engine changes touch State 1, State 2, and inline-legacy in the same commit per CLAUDE.md Rule 14.
7. **Documentation hygiene per Process Rule 7.**

---

## Parts

### Part 1 — Data model: per-opening fields

**Files touched:**
- `frontend/src/context/ProjectContext.jsx` — DEFAULT_PARAMS for both permanent openings (per-facade `openings.{north,south,east,west}` entries) and operable openings (`operable_openings`)
- `frontend/src/utils/instantCalc.js` — `withMode` allowlist updates for the new per-opening fields; `synthesiseOperableOpeningsFromLegacy` and `newOpening` factory defaults

**Steps:**

1.1 Add per-opening `cd` and `flow_mode` fields to the permanent-opening schema. Existing per-facade structure stays (F1/F2/F3/F4 with `louvre_area_m2`); each facade entry gains:
- `cd: number` (default per type — 0.40 for louvres at creation)
- `flow_mode: 'single_sided' | 'cross'` (default `'single_sided'`)

1.2 Add per-opening `cd` and `flow_mode` fields to the operable-opening schema. Each opening entry gains the same two fields.

1.3 Define default values per opening type at creation time:
- **Trickle vent / louvre / fixed grille:** cd 0.40, flow_mode 'single_sided'
- **Door:** cd 0.60, flow_mode 'cross'
- **Window:** cd 0.55, flow_mode 'single_sided'
- **Vent (operable, non-trickle):** cd 0.40, flow_mode 'single_sided'

These defaults are seed values used by "+ Door / + Window / + Vent" buttons in the UI. They are not inheritance links — once an opening exists, its values are independent of these defaults.

1.4 Update `withMode`'s allowlist to pass `cd` and `flow_mode` through on each opening (both permanent and operable). Per the ALLOWLIST DRIFT WARNING comment from Brief 33 Finding 1.

1.5 Remove the building-wide `openings.cd` and `openings.flow_mode` fields from DEFAULT_PARAMS. Site exposure (`openings.site_exposure`) stays.

**Commit message:**
```
Brief 42 Part 1: Per-opening cd and flow_mode in schema
```

STATUS.md update in same commit.

---

### Part 2 — Engine: read per-opening values across three locations

**Files touched:**
- `frontend/src/utils/instantCalc.js` — three locations per Rule 14: State 1 (permanent + operable loops), State 2 (mirrored), inline-legacy 'full' path

**Steps:**

2.1 In State 1's permanent vent loop, replace `building.openings.cd` reads with the per-opening `opening.cd` value. Same for `flow_mode` — `resolveFlowMode(opening)` operates on the opening, not the building.

2.2 Same change in State 1's operable opening loop.

2.3 Mirror the changes in State 2's two loops.

2.4 Mirror in inline-legacy.

2.5 `resolveFlowMode` helper refactored to take an individual opening: `resolveFlowMode(opening) → 'single_sided' | 'cross'`. Same validation logic.

2.6 `computeCd` calculator from Brief 33 Part 2's `openingCoefficients.js` — currently retained as a utility — stays in place but is not called from the engine. Users set C_d directly via the slider; the lookup tables remain as a reference.

2.7 Site exposure (C_w) still read from `building.openings.site_exposure` — no change. All three locations.

**Commit message:**
```
Brief 42 Part 2: Engine reads per-opening cd and flow_mode (Rule 14)
```

STATUS.md update in same commit.

---

### Part 3 — Migration script

**Files touched:**
- `scripts/42_per_opening_cd_flowmode_migration.py` (new)
- `docs/audit/42_per_opening_migration.md` (new) — Bridgewater pre/post

**Steps:**

3.1 The migration reads each project's current `building.openings.cd` and `building.openings.flow_mode`. For each opening (permanent and operable), writes those values onto the opening. Then removes the building-wide fields.

3.2 Idempotent. Re-running is a no-op.

3.3 Stop-dev-server discipline per CLAUDE.md Process Rule 11.

3.4 Document Bridgewater's pre/post state in `docs/audit/42_per_opening_migration.md`.

**Commit message:**
```
Brief 42 Part 3: Per-opening cd/flow_mode migration
```

STATUS.md update in same commit.

---

### Part 4 — UI: Building module Permanent Openings panel

**Files touched:**
- `frontend/src/components/modules/building/BuildingDefinition.jsx`
- `frontend/src/components/modules/building/BuildingWideOpeningsControls.jsx` — **deleted** (superseded by per-facade controls; was Brief 41 Part 7's shared component)

**Steps:**

4.1 Remove the `BuildingWideOpeningsControls` invocation from the Permanent Openings panel. Delete the file. Brief 41 Part 7's shared-component approach is superseded — building-wide `cd` and `flow_mode` no longer exist as shared state.

4.2 For each facade row (F1/F2/F3/F4) that has a non-zero opening area, add per-opening controls:
- **Cd** slider, range 0.15–0.65, default 0.40 (louvre seed). Anchor labels remain (trickle / louvre / open window).
- **Flow mode** dropdown (single_sided / cross), default 'single_sided'.

4.3 The "Site exposure" dropdown stays where it is — it's the only remaining building-wide control in the panel.

4.4 Layout: compact per-facade row. Area slider stays on its current row; add a collapsible "Physics" sub-row that expands to show C_d + flow_mode for that facade. Or inline both controls in a tighter layout — implementation detail, no strict prescription.

4.5 Tooltip on each per-facade C_d slider links to the methodology doc: "See lookup table in `docs/audit/29_permanent_vent_methodology.md` for typical values."

**Commit message:**
```
Brief 42 Part 4: Building permanent-openings UI per-facade
```

STATUS.md update in same commit.

---

### Part 5 — UI: Operation module operable-openings panel

**Files touched:**
- `frontend/src/components/modules/OperationModule.jsx`

**Steps:**

5.1 Remove the `BuildingWideOpeningsControls` "Building-wide ventilation physics" section at the top of the openings panel (Brief 41 Part 7 added this; Brief 42 supersedes). Replace with a slim "Site exposure" reference pointing at Building.

5.2 Add per-opening controls to each opening editor card:
- **Cd** slider, range 0.15–0.65. Default per type via the "+ Door / + Window / + Vent" buttons.
- **Flow mode** dropdown (single_sided / cross). Default per type.

5.3 The "+ Door / + Window / + Vent" buttons in the Add Opening section seed the new opening with the type-appropriate defaults from Part 1 step 1.3.

5.4 Footer notes the site exposure stays in Building: "Site exposure (C_w) is configured in the Building module — it applies to all openings on this building."

5.5 Per-opening UI verification: changing one opening's C_d or flow_mode doesn't affect any other opening.

5.6 Bridgewater walkthrough check: with the operable door's C_d at 0.60 and flow_mode 'cross', vs C_d 0.29 and flow_mode 'single_sided' (migration default), the door's loss should increase substantially. The physics catches up with the user's intent ("this is a reception door, not a trickle vent"). Capture both values in the audit doc.

**Commit message:**
```
Brief 42 Part 5: Operation operable-openings UI per-opening
```

STATUS.md update in same commit. Awaits Chris's walkthrough before Part 6.

---

### Part 6 — Walkthrough sign-off, CLAUDE.md update, close

**Files touched:**
- CLAUDE.md
- `docs/briefs/active/42_per_opening_cd_flowmode.md` → `archive/42_per_opening_cd_flowmode_COMPLETED.md`
- `docs/briefs/current.md`
- STATUS.md
- `docs/audit/42_per_opening_migration.md` — final Bridgewater post-edit numbers

**Steps:**

6.1 Walkthrough confirms (Chris reports):
- Building module: per-facade C_d and flow_mode controls visible and reactive
- Operation module: per-opening C_d and flow_mode controls visible and reactive
- Site exposure still building-wide in Building
- Bridgewater: changing one opening doesn't affect any other
- The reception door at cd 0.60 / cross produces visibly different heat loss to the trickle vents at cd 0.25–0.40 / single_sided

6.2 Update CLAUDE.md "Module scopes" Building module note about permanent vents to reflect that C_d and flow_mode are per-opening, not building-wide. Single sentence update.

6.3 Archive Brief 42; repoint current.md; final STATUS.md close-out.

6.4 Single push, verify origin == local.

**Commit message:**
```
Brief 42 close: Per-opening Cd and flow_mode live
```

---

## Final report (paste in chat after Part 6)

1. New origin/main HEAD SHA
2. Bridgewater per-opening post-migration values (one line per opening: name, type, cd, flow_mode)
3. Bridgewater heat balance with door at cd 0.60 / cross vs cd 0.29 / single_sided — the magnitude of the change
4. Confirmation that changing one opening's values doesn't affect any other
5. Confirmation that Site exposure still building-wide and only in Building module
6. Confirmation `docs/briefs/active/` contains only Brief 30 (paused)

---

## What MUST NOT happen in this brief

- No reintroduction of building-wide `openings.cd` or `openings.flow_mode`
- No new physics; same correlations as Brief 41
- No per-opening site exposure / C_w
- No changes to `sql_parser.py`, `epjson_assembler.py`, simulation API (Dynamic remains paused)
- No "follow building default" inheritance pattern — defaults are seed values at creation only
- No partial commits — each Part is one commit including STATUS.md update

## When to escalate

- If Part 2's three-location parity uncovers a fourth code path that touches opening physics (drift since Brief 41)
- If the migration produces opening-level values that don't match what the building-wide value was pre-migration (suggests a read-side bug)
- If a consumer outside the Building/Operation modules reads `openings.cd` directly from the building-wide level (would break with the schema change)
- Documentation hygiene starts slipping

## Authorisation status

**Chat-form authorisation by Chris Scott 2026-05-19** ("Lets go" after dropping the brief file). Brief 41 close folded into Part 1's commit chain — Brief 41 walkthrough verification rolls into Brief 42's walkthrough (Brief 42 supersedes Brief 41 Part 7's building-wide UI design and validates the engine work from Brief 41 Parts 1–5 by exercise of the per-opening UI).
