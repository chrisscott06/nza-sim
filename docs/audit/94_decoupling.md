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
