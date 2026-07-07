# Brief 94 — Library/Strategy Decoupling + Apply-Gated Recalc — audit

Physics-invariance anchor + diagnostics for Brief 94. This brief touches **zero physics**;
the baseline below must reproduce **byte-identical** at close (Part 7).

## §1 — Baseline anchor (Part 1)

**Method:** `scripts/_brief93_anchor.mjs` (unchanged), Bridgewater `12cf7cc4`, read live from the
backend, `engine:'v2.5'` + `_skipInterventions:true` → State 3. Raw JSON:
`docs/audit/94_baseline_anchor.json`. Branch `chris/interventions-decoupling` off `main` `533db7e`.

### ⚠️ Baseline is 132.6, not the brief's 126.0 — superseded, Chris-confirmed 2026-07-07

The brief (BEFORE-DOING-ANYTHING #6, Part 7 #1) expects **EUI 126.0**, the post-aux-strip figure from
Brief 93 follow-up item 3 (`0117d65`, `gains.auxiliary.profiles → []`). Between that commit (~11:18) and
Brief 94 Part 1 (~12:20), the live DB **diverged**:

- My item-3 aux strip (`profiles: []`) was **overwritten** by a state carrying a new
  **"External lighting" 1.5 W/m²** auxiliary profile (`id aux_external_lighting_mraj09kw_1`, provenance
  `load_type_library`), `updated_at 2026-07-07 10:50:12`.
- Mechanism: a full app session (backend PID 94514 + vite 5176, started 11:38) autosaved a client-side
  state that predated the strip back over the DB — the CLAUDE.md process-rule-11 autosave-race hazard.
  The 5 W/m² debug "Custom auxiliary" load remains gone; External lighting is a **net-new, legitimate**
  load, not the debug junk.

**Decision (Chris, 2026-07-07):** *keep* External lighting — it's a real load. Brief 94's baseline is the
current settled state, **EUI 132.6**. The brief's "126.0 / must be identical at close" is superseded by
**132.6 / must be identical at close**. No DB write was made; Brief 94 works with the state as-is. The
invariance guarantee (this brief changes no physics) is unaffected — only the absolute anchor number moved,
and only because of an auxiliary electricity load added outside this brief.

Delta vs the 126.0 state: External lighting 1.5 W/m² (schedule ~0.5 avg) → +27.7 MWh electricity
(+6.6 kWh/m²); `gain_fraction: 0` so **zero** zone-heat contribution — envelope demand identical.

### Baseline metrics (must be byte-identical at close)

| Metric | Value |
|---|---|
| **EUI kWh/m²** | **132.6** |
| electricity MWh | 401.544 |
| gas MWh | 157.428 |
| heating demand MWh | 87.7 |
| cooling demand MWh | 101.1 |
| DHW demand MWh | 257.335 |
| mech-vent fan MWh | 40.613 |
| GIA m² | 4216 |
| dispatch | State 3, mode `full` |

**Heat balance:** losses 486754.1 kWh · gains 493345.1 kWh. Per-element losses (kWh): external_wall 23653.8,
roof 12563.0, ground_floor 10850.3, glazing 88931.4, thermal_bridging 24006.2, fabric_leakage 30622.9,
permanent_vents 18912.2, mech_ventilation 277214.3. Internal gains (kWh): people 120409.1, lighting 39014.3,
equipment 186136.3, auxiliary 0 (External lighting has gain_fraction 0).

**12-month heating-loss shape (kWh):**
`[24307, 20131, 21130, 16993, 12862, 8739, 5932, 7274, 9589, 12787, 18695, 21879]`

## §1b — Reorder diagnostic (Part 1b) — **PRE-EXISTING**, cause: Brief 87 `a106438` drop-gap rework

**Fork answer: PRE-EXISTING, not a merge regression.** Proven structurally, not by guesswork:
the interventions UI is **byte-identical** between `main` and the parked `chris/interventions-rework-ux`.
`git diff chris/interventions-rework-ux HEAD -- frontend/src/` shows the **only** frontend delta is
`instantCalc.js` (28/-3 — the envelope-fix Brief 86 heat-balance auto-merge, physics, unrelated to drag).
`InterventionStackView.jsx`, `InterventionRow.jsx`, `InterventionsModule.jsx`, `ProjectContext.jsx` — zero
diff. A bug in code common to both branches cannot be a consolidation-merge regression; if reorder is broken
on `main` it is equally broken on the parked branch.

**Faulty file/mechanism:**
`frontend/src/components/modules/interventions/InterventionStackView.jsx` — the
`handleDragOver`/`handleDrop`/`dropGap` state machine + the `<DropIndicator>` sibling (lines ~247–281, 314–342).

**Root cause — commit `a106438` "Brief 87: rework Strategy drag-reorder UX (pink drop indicator + landing
flash)".** That commit changed the drop contract from *target-id* to *transient hover-state*:

- **Before (worked):** `handleDrop(e, targetId)` computed `toIdx = interventions.findIndex(i => i.id ===
  targetId)` — the id of the row the drop fired on. `targetId` is always valid at release because it comes
  from the drop-target element itself, so the reorder always had a well-defined destination.
- **After (broken):** `handleDrop(e)` drops the `targetId` arg and depends **entirely** on `dropGap` state:
  `if (d === -1 || dropGap == null) { resetDrag(); return }`. `dropGap` is set only by `handleDragOver`, and
  is **force-nulled** whenever the cursor is adjacent to the dragged item's own slot
  (`setDropGap(gap === d || gap === d + 1 ? null : gap)`).

**Why it no-ops:** when `dropGap` becomes non-null, a `<DropIndicator>` is inserted as a **sibling at the live
gap** (`{draggingId && dropGap === i ? <DropIndicator /> : null}`). That insertion reflows the list under the
cursor, and the indicator carries **no** `onDragOver`/`onDrop`/`preventDefault`. So at the moment of release
the pointer frequently sits over the indicator or in the shifted gap, `dragover` on the row has stopped
updating `dropGap`, and `dropGap` is `null` → `handleDrop` early-returns via `resetDrag()` **without calling
`onReorder`**. The drag animates but the order silently reverts. The downstream chain is otherwise sound:
`onReorder → handleReorder → updateParam('interventions', next)` persists correctly when it is reached, and
the list renders in `params.interventions` array order (the `strategies[0].ordered_intervention_ids` field is
written but **read nowhere** except the strategy *name* — vestigial half-decoupling from Brief 87 P3, which
is exactly what Brief 94 finishes).

**Confidence & method:** diagnosed by (a) full static read of the drag chain, (b) the `main`-vs-parked byte
diff, (c) the `a106438` before/after diff quoted above. In-browser confirmation was **not** run: Chris's dev
server occupies port 5176 and the preview tool won't adopt a non-preview server — I won't commandeer his live
session for a diagnostic-only Part. The evidence is specific enough to fix in Part 3 (where the brief places
the fix): restore a target-id-based drop (or give the `<DropIndicator>` proper drag pass-through), so drop
never depends on hover-state that the indicator itself invalidates.

**No fix applied in Part 1** (per brief).

## Session-start reconciliation notes

- **Checklist #5 (untracked `Brief_09–17` stubs):** already **tracked** on `main` (`git ls-files` confirms) —
  the interventions merge (Brief 93 P3) brought them in, so the premise "missed in Brief 93 P1, still
  untracked" is already resolved. Nothing to commit. The session-start git snapshot was stale.
- `active/` before Brief 94: only `91` + `91b` (Brief 93 follow-up item 4 archived the rest).

## §2 — Data model + lossless migration (Part 2)

**Model.** `frontend/src/utils/strategyModel.js` (pure, node-importable):
- **Library** = `building_config.interventions[]` — definitions; order not meaningful; each `id` IS its
  `library_id`; owns all params (patches/label/theme/notes/capex/cost/schema_version).
- **Strategy** = `building_config.strategies[0] = { id, name, refs: [{ library_id, enabled, order }] }` —
  ordered, parameter-free selection carrying per-membership `enabled`.
- Exports: `migrateStrategyRefs(bc)` (idempotent migrate-on-read), `resolveStrategyInterventions(bc)`
  (Rule 11 canonical read path → ordered, enabled-annotated library items for Parts 3–5),
  `hasStrategyRefs`, `makeStrategyRef`, `STRATEGY_REFS_SCHEMA`.

**Wiring.** `ProjectContext` `_applyProject` now calls `migrateStrategyRefs(bc)` (replacing the dead
Brief-87 `migrateStrategies`/`makeDefaultStrategy`, removed). **Additive & non-breaking:** the migration only
*adds* `strategies[0].refs`; the engine still reads `interventions` + per-item `enabled` until Parts 3–5
switch consumers over — so Part 2 moves **zero** engine numbers. The anchor is unaffected (it bypasses
ProjectContext, building config directly from the API).

**Canonical order = `interventions` array order, NOT legacy `ordered_intervention_ids`.** The fixture proved
why: real Bridgewater's `ordered_intervention_ids` is **stale** — it lists 6 ids including a ghost `int_led`
(absent from the 8-item library) and omits 3 current interventions. Trusting it would lose data. The
migration ignores it entirely and derives refs from the array order the engine actually stacks. Old shape is
never written back.

**Test.** `scripts/_brief94_migration_test.mjs` against fixture
`docs/audit/fixtures/94_bridgewater_interventions.json` (real 8-intervention Bridgewater state):
**24/24 pass** — N→N lossless, order + enabled preserved, zero data loss, stale legacy list ignored
(ghost dropped, omitted interventions retained), idempotent (load-twice-migrates-once; already-refs returns
same reference), library untouched, read-path resolves in order, + edge cases (empty / disabled / duplicate /
enabled normalisation). Full frontend `npm run build` clean.

_Parts 3–5 (UI wiring: strategy view reads refs, library edits, Apply-gating) require browser verification —
pending Chris freeing port 5176 or preview autoPort._

## §3 — Strategy view = select / order / toggle; reorder FIXED (Part 3)

**Rewire.** The engine + Strategy stack now consume the **resolved strategy**
(`resolveStrategyInterventions(params)` — library items in ref order, `ref.enabled` applied), not the raw
library. `InterventionsModule`: `strategyInterventions` feeds `paramsForEngine.interventions` and the stack
view; `handleReorder`/`handleToggleEnabled`/`handleStrategyRemove`/`handleAddFromLibrary` mutate
`strategies[0].refs` via the pure helpers, never the library array. Post-migration the resolved list equals
`interventions`, so numbers are byte-identical until the user acts (verified: baseline card reads 132.6).

**Reorder fix (P1 root cause a106438).** `handleDrop(e, targetId)` no longer depends solely on the transient
`dropGap`; it recomputes the destination from the drop-target row + cursor-Y at release when `dropGap` is
null. Robust against the `<DropIndicator>` reflow that was invalidating the hover state.

**Row affordances.** Strategy rows are selection/order/toggle/**remove** only — the edit + duplicate buttons
were removed from `InterventionRow` (editing is the Library's job). "Remove" (X) drops the ref; the library
item survives. New `AddFromLibraryPicker` (grouped by theme; items already in the strategy shown disabled as
"In strategy" — Decision 2 dup guard).

**Browser verification (Bridgewater, preview 5176):**
- ✓ **Reorder persists after reload** — dragged "Widen setpoints" (#3 → #1); `strategies[0].refs` persisted to
  DB with new order; `ordered_intervention_ids` gone (old shape not written back); full page reload shows the
  new order. (Falsifiable #1.)
- ✓ **No parameter inputs anywhere in the strategy pane** — DOM query: 0 `input`/`textarea`/`select`.
  (Falsifiable #2.)
- ✓ **Duplicate add impossible** — with all 8 items in the strategy, the picker shows all 8 as disabled
  "In strategy". (Falsifiable #3.)
- ✓ **Remove keeps the library item** — X on a row: stack 8→7, library still 8, removed item becomes addable
  in the picker; re-add appends it at the end. Original order restored after testing.
- ✓ No console errors. `npm run build` clean. Cost layer untouched (Brief 91b quarantine — £215k capex card
  still renders).

_Note: `handleDuplicate` in InterventionsModule is now unused by the strategy view; it is retained to be
wired to the Library "clone" button in Part 4._

## §Anchor-method amendment (pre-P4, 2026-07-07) — fixture-based regression reference

**132.6 is explained, not drift.** Chris was testing the auxiliary toggle; the "External lighting" 1.5 W/m²
load is a **live-DB input change**, not engine drift. No escalation. But it exposed a method flaw: the anchor
read the **mutable live DB**, so Chris's normal editing moved the "regression reference". Fixed here.

**Amendment:**
1. **Frozen fixture** `validation/fixtures/bridgewater_anchor_v2.yaml` (committed) — a one-time export of the
   current Bridgewater config (building_config + construction_choices + comfort_band 21/24 + resolved library
   constructions; weather stays the on-disk EPW). Captures the aux=External-lighting input verbatim.
2. **`--fixture` mode** in `scripts/_brief93_anchor.mjs` — runs the engine **directly** against the fixture,
   **no API/DB**. (Node has no YAML parser and the repo has no node project, so it parses the YAML via the
   validation venv's pyyaml — a clear error fires if that venv is absent.)
3. **Verified byte-identical to the live-DB baseline:** `--fixture` → EUI 132.6, elec 401.544, gas 157.428,
   heat 87.7, cool 101.1, dhw 257.335, monthly shape `[24307,20131,…,21879]` — exactly §1. Frozen reference:
   `docs/audit/94_fixture_anchor_p3.json` (git_head excluded from the compare).

**P7 invariant (REPLACES the §1 live-DB check):** `node scripts/_brief93_anchor.mjs --fixture` output must be
**byte-identical (ignoring `git_head`) between the P3 commit and the close commit**. The live DB is Chris's
playground — **never a regression reference again**.

## §4 — Library = the sole editing surface; clone + guarded delete (Part 4)

`InterventionsModule`: the Library catalogue rows gain a **Clone** button; delete is now guarded.
- **`handleClone`** — one click → new library item `"Copy of X"` with deep-cloned patches (fresh UUIDs),
  selected + editor opened ("ready to edit"). A clone is a new *definition*; it does **not** create a strategy
  ref (Decision 4 / Part 4.3).
- **`handleLibraryDelete`** — deletes the definition; if it is referenced by the strategy the confirm names
  that impact ("it will also be removed from your strategy") and, on confirm, `removeStrategyRef` drops the
  ref too. `updateParam` is functional (`setParams(p => …)`), so the two sequential key updates compose.
- **Create** (`handleAdd`, unchanged) appends a library item only — never touches the strategy.

**Browser verification (Bridgewater, preview 5176):**
- ✓ **Clone → strategy unchanged** — cloned "Occupancy 2": library 8→9, "Copy of Occupancy 2" created + editor
  opened, strategy stayed 8 (clone not in stack). (Falsifiable: create/clone doesn't touch strategy.)
- ✓ **Clone is independent** — fresh library entry with fresh patch UUIDs; source "Occupancy 2" untouched
  throughout the add/reference/delete cycle.
- ✓ **Guarded delete of a referenced item** — added the clone to the strategy (8→9), deleted it from the
  Library: confirm read *"1 patch will be permanently removed; it will also be removed from your strategy."*;
  on confirm, library 9→8 AND strategy 9→8 (ref dropped). (Falsifiable #3.)
- ✓ DB clean after test (8 interventions / 8 refs, order preserved, no "Copy of" leftovers). No console
  errors. `npm run build` clean.

_Editing itself already lived on the Library page (the existing editor mounts from the catalogue's edit
pencil → PerInterventionView / InterventionEditorPopout); Part 3 removed edit from the Strategy view, so the
Library is now the single editing surface._

## §5 — Apply-gated recalc (Part 5)

**The only coupling causing live global recompute was `editor → onLivePatchesChange → parent livePatches →
paramsForEngine swap`.** Removed:
- `InterventionsModule`: deleted `livePatches` state + `handleLivePatchesChange`; `paramsForEngine` is now
  `{ ...params, interventions: strategyInterventions }` (deps `[params, strategyInterventions]`) — the global
  engine depends **only on committed params**, so global numbers are frozen while editing and recompute
  **once** when params change (Apply / add / reorder / toggle). Removed the `onLivePatchesChange` prop + the
  three `setLivePatches(null)` calls.
- `InterventionEditorPopout`: input/slider changes update **local** state only (`handleCapturedPatchesChange`
  no longer relays upward). A new `debouncedPatches` (300 ms) is the sole driver of the editor's OWN preview
  engine → **zero engine runs mid-drag**; the preview updates once ~300 ms after the gesture settles. Added an
  **Esc** handler → discards via the unsaved-changes guard (same as Cancel).
- `EditorFooter`: commit button relabelled **"Save intervention" → "Apply"**.

**Browser verification (Bridgewater, preview 5176) — via the label field (reliably dirties the editor) + DB:**
- ✓ **Frozen during edit** — changed the label in the open editor; the DB (global source of truth) stayed
  unchanged (no marker) while editing.
- ✓ **Apply commits once** — clicked Apply → DB label updated in a single write.
- ✓ **Esc discards** — changed the label again, pressed Esc → "Discard unsaved changes?" guard → confirm →
  editor closed, DB unchanged (the Esc edit never persisted).
- ✓ **Global panels frozen** — the Library catalogue's isolated deltas did not move during an in-editor change.
- ✓ Editor preview is debounced (300 ms) by construction → gesture-smooth, no per-tick global recompute.
- Test marker reverted; DB clean (8 interventions / 8 refs). Fresh reload: module renders, no ErrorBoundary,
  page healthy. (Transient `livePatches is not defined` errors earlier in the console were mid-edit HMR states
  while the removals landed incrementally — absent after reload; `npm run build` clean.)

_Cost fields in the editor use the separate, non-gated `updateInterventionCost` path (Brief 91b quarantine) —
untouched by P5; confirmed a stray cost-field poke did not persist._

## §6 — Walkthrough polish (Part 6)

Two cosmetic fixes:
1. **Auxiliary service pill colour.** `SERVICE_COLOURS` (SystemEditorCard.jsx) had no `auxiliary` key, so the
   Systems auxiliary pill fell back to `#00AEEF` (the cooling blue). Added `auxiliary: '#4B5563'` (gray-600) —
   matches the internal-gains auxiliary colour (`DEMAND_COLOURS`/`INTERNAL_COLOURS.auxiliary`). Browser-verified:
   aux pill now `rgb(75,85,99)`, cooling still `rgb(0,174,239)`.
2. **Systems Energy Flows explainer.** Removed the long explainer paragraph ("Each demand on the left passes
   through its system…") above the energy-flow Sankey. The header title + **Σ elec / Σ gas** chips and the
   Sankey are retained. Browser-verified: paragraph gone, chips + Sankey present.

`npm run build` clean.

## §7 — Close (Part 7)

**Physics invariant — PASS.** `node scripts/_brief93_anchor.mjs --fixture` at the close commit is
**byte-identical** (ignoring `git_head`) to the frozen P3 reference `docs/audit/94_fixture_anchor_p3.json`:
EUI 132.6, elec 401.544, gas 157.428, heat 87.7, cool 101.1, monthly
`[24307,20131,21130,16993,12862,8739,5932,7274,9589,12787,18695,21879]`. Brief 94 touched zero physics, as
scoped (data-model + UI only).

**Migration test:** `node scripts/_brief94_migration_test.mjs` → **37/37 pass**.

**Independent review PENDING** (mandatory, data-model migration). Claude Chat reads on GitHub: the migration
code + fixture test (`strategyModel.js`, `_brief94_migration_test.mjs`), the strategy data model, the P5 diff
removing live recalc, and the P1 diagnostic. Merging agent does not grade. PR opened to `main`; **not merged**
pending Chris's walkthrough + independent review.

## §3b — Reorder fix follow-up (walkthrough feedback, 2026-07-07)

Chris's Brief 94 walkthrough refined the reorder symptom: **down-and-right drags succeeded, straight-up /
leftward drags failed** — the P3 `handleDrop`/`handleDragOver` resolved the destination from *which row
element the pointer was over* (x-sensitive), so a pointer drifting left of a row's box (or over a narrow
child) resolved to the wrong gap or none.

**Fix (`InterventionStackView.jsx`):** destination is now resolved from the pointer's **Y only**, measured
against every row's mid-line across the whole list column (`gapFromPointerY`, keyed off `[data-row-id]`
elements). Drag-over/drop moved from per-row to **container-level** handlers — any X within the list yields
the same gap for a given Y. The pink `<DropIndicator>` behaviour is unchanged (still driven by `dropGap`);
drop lands where the pink gap showed, with a y-only recompute as fallback.

**Async-persist feedback:** a small `Loader2` spinner replaces the drag handle on the moved row (`pending`)
until the reorder round-trips through the parent (cleared on the order-signature change).

**Deterministic fallback:** per-row **↑/↓ arrow buttons** (keyboard-accessible; end-stops disabled) that move
a row one slot via the same `onReorder` path.

**Browser-verified (isolated scratch instance — vite 5177 → backend 8003 → scratch DB copy, so Chris's live
walkthrough on 5176/8002 was untouched):**
- ✓ Arrows via **real clicks**: ↓ moved a row 0→1, ↑ returned it 0; scratch DB persisted the round-trip. End-stops disabled correctly.
- ✓ **Y-only drag**: dragging a row UP with the pointer pinned to the **far-left** edge landed it at the Y-determined gap (the exact leftward/upward case that failed before).
- ✓ No console errors; `npm run build` clean.

**Flagged for Chris:** re-test the *human* mouse drag — straight-up, leftward, and down-right must all land where the pink gap showed. **Nothing merges until that re-test passes.**
