# Brief 76 — v40-as-source for State 2 ventSystems builder + Brief 72 PB seeder backstop

**Author:** Code (this agent), from own diagnostic
**Authorised by:** Chris (1 June 2026, after rejecting the architect's prior Brief 76 draft)
**Provisional number:** 76. The architect's dispatch-gate draft (`docs/briefs/archive/76_v40_state3_dispatch_SUPERSEDED.md`) is the same number, superseded before landing. Door bug stays Brief 77; interventions diagnostic harness Brief 78; WWHR Brief 79.
**Design note:** none — this brief is written from a verified diagnostic, not from a design discussion. Where the diagnostic and this brief disagree, the diagnostic wins.
**Lineage:** Closes the regression where Bridgewater's Heat Balance Sankey lost its per-system ventilation extract ribbons after the Brief 72 PB DB-loss recovery (`b9ae15b`, 2026-05-28). Diagnostic at `docs/audit/76_premise_check.md` (commit `27dff4b`). Picks up the v40-data-not-flowing-through-engine corner of Brief 75 P2's outcome-(c) finding; the saturation question itself is a separate brief.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and first paragraph. State tip of `main` SHA (expected: `27dff4b` Brief 76 premise check).
2. **Read the diagnostic first.** `docs/audit/76_premise_check.md` Q1-Q4 is the load-bearing input for this brief. If it ever drifts out of agreement with this brief, the diagnostic wins.
3. **Confirm the architect's draft is archived.** `docs/briefs/archive/76_v40_state3_dispatch_SUPERSEDED.md` should exist with a banner explaining why.
4. **STATUS.md is fresh** (reconciled at Brief 74 close). Land this brief at `docs/briefs/active/76_v40_ventsystems_base_iterator.md` as P1's first commit. Open audit stub at `docs/audit/76_v40_ventsystems_base_iterator.md`.
5. **Anchor capture (P1).** Run Bridgewater clean, full anchor table. Capture vent-specific fields: `losses_at_setpoint.ventilation` (should be `[]`), `losses.mech_ventilation` aggregate (should be `0`), `consumption.brief40.ventilation.systems` (should be populated with 3 entries — that's the source data the engine ISN'T reading).
6. **Ports unchanged.** Frontend 5176, backend 8002.
7. **Browser verification is Code's job per the Bible.** Self-verify via MCP browser tools; Chris does the close walkthrough.

---

## Scope

**Single proximate cause; two parts:**

1. **P1 — Engine fix at `_calculateState2:2921`.** The base iteration of the per-system ventilation builder is `building?.systems_config_v25?.ventilation ?? []`. Bridgewater's `systems_config_v25` is `null` (v40-only post-Brief-72-PB), so the array is empty, and the v40 ENRICH overlays (Briefs 50 / 53 / 59 / 60) never fire because there's no v25 entry to overlay onto. Change the base iteration to read v40 directly, with v25 as fallback for not-yet-migrated fields (`hours`, `library_id`). Same v40-wins-with-v25-fallback pattern the surrounding code already uses for HRE / flow / SFP — just applied to the base iteration too.

2. **P2 — Backstop the Brief 72 PB seeder.** The 2026-05-28 re-creation script logged "vent still 0. Iterations exhausted" and accepted that as the new anchor. Either (a) document v40 as the source of truth and remove the implicit dependency on v25 mirror in any code path that still reads v25 ventilation as a base array (P1 covers `_calculateState2`; check any sibling consumers), or (b) tighten the seed contract so future re-seeds can't leave v25 in a partial state. P2 picks (a) — explicit deprecation tagged in code, no implicit dependency.

**Out of scope:**
- Inline-legacy `_calculateInstantBaseline` 'full' path. It has its own ventilation handling and crashes on `_buildHeatBalance:6553`'s free `building` reference if reached (Brief 76 premise-check audit §Q1 side-note). Separate concern; ANY engine call that doesn't pass `engine: 'v2.5'` opt-in would hit this. Outside Brief 76 scope.
- The State 3 dispatch gate at L6668. **Not the bug.** Architect's superseded draft addressed this; we are not.
- The Brief 75 P2 outcome-(c) saturation question. Brief 76's fix WILL make `losses_at_setpoint.ventilation` populate and `losses.mech_ventilation` aggregate go non-zero; whether that lifts Bridgewater's `heating_demand` off 0 is a downstream observation, NOT a target. Saturation logic is upstream of vent display.
- Door bug (Brief 77 territory).
- Interventions diagnostic harness (Brief 78).
- WWHR (Brief 79).
- Schema migration of `systems_config_v25` → drop entirely. Premature; out of scope.

---

## Principles

1. **Diagnose before fix.** Done in `docs/audit/76_premise_check.md`. P1 implements from that finding directly.
2. **Visualisation reads what engine emits — engine emits what the data carries.** The renderer (`HeatBalance.jsx:183-212`) is correct; the engine state 2 builder is reading the wrong field; the field exists in v40. Three independent layers; the fix is at the engine.
3. **v40 is the source of truth.** Briefs 40-42 established this; subsequent briefs (50 / 53 / 59 / 60) progressively migrated specific FIELDS to v40 while leaving the BASE iteration as v25. This brief closes the migration for the base iteration in this one builder.
4. **No double-counting.** Brief 74 P5 added the `losses.mech_ventilation` aggregate guard at `HeatBalance.jsx:194-195`. After P1 lands, that guard will FIRE on Bridgewater (aggregate will become non-zero), so the per-system loop will be skipped. The aggregate is the visible ribbon; per-system breakdown is still available via the Diagnostic panel that reads `losses_at_setpoint.ventilation` directly. **Verify this interaction in the walkthrough** — both must reflect the new data, but the Sankey shouldn't double-render.

   **Important reality check on this principle:** the brief Chris invoked Brief 73's per-system ribbons (MVHR GF / Extract Bedrooms / Extract WCs) as the expected outcome. The Brief 74 P5 guard means those per-system ribbons WILL NOT render on the Sankey itself once the aggregate goes non-zero — they'll only appear in the Rows view + the Diagnostic panel. If you want the per-system ribbons back on the Sankey specifically, the right move is to either (a) RELAX Brief 74 P5's guard (revert to per-system rendering when the aggregate is small or absent), or (b) accept the aggregate ribbon as the canonical Sankey rendering and keep per-system in the Rows view. P1 should make BOTH work — single aggregate ribbon on Sankey (Brief 74 P5 design); per-system breakdown elsewhere. P6 walkthrough will exercise both views.

5. **Boundary discipline.** Pure engine fix at L2921. No renderer changes. No new fields on the result schema (`losses_at_setpoint.ventilation` shape unchanged — just non-empty now).
6. **Anchor: capture, don't hardcode.** Bridgewater's `losses_kwh`, `total_heating_loss_kwh`, and downstream rollups will move when vent extract starts entering the heat balance. Document the deltas from first principles (`docs/audit/75_ventilation_heat_modelling.md` §1.7 gives 369 MWh ≈ rough net extract estimate). EUI will move too.
7. **State path coverage (Rule 14).** P1 lands at `_calculateState2`. State 3 inherits via spread (`...state2Result`). State 1 has no mech ventilation by scope. Inline-legacy 'full' is a separate engine (and a broken one — Brief 76 premise-check §Q1 side-note). Document in the commit message exactly which states see the change.

---

## Parts (each = one commit unless noted)

**Part 1 — Precondition + anchor capture (BEFORE the fix).**
Land brief on disk. Land audit stub. Re-run Bridgewater anchor with the existing `scripts/_brief75_p1_anchor.mjs` (already captures the right fields) — save output verbatim to `docs/audit/76_p1_anchor_before.json`. Document the values relevant to this brief in `docs/audit/76_v40_ventsystems_base_iterator.md` §1:
- `result.state` (expect 3)
- `losses_at_setpoint.ventilation` (expect `[]`)
- `losses.mech_ventilation` aggregate (expect `{kwh: 0, kwh_per_m2: 0}`)
- `consumption.brief40.ventilation.systems` (expect 3 entries — the SOURCE the engine isn't reading)
- `building.systems_config_v25` (expect `null` — the dead branch)
- `building.systems_config_v40.ventilation` (expect 3 entries — what P1 will read instead)
- Headline anchor (EUI 150.7, electricity 416.938, gas 204.698, heating_demand 0, cooling_demand 302.1, vent fan total 41.962, Σ losses kwh 221398.2, Σ gains kwh 488011.1)

Commit: `Brief 76 P1: STATUS reconcile + Bridgewater anchor (pre-fix) + brief landing`.

---

**Part 2 — Engine fix at `_calculateState2:2921`.**

**Implementation:**

Replace the L2921 base-iteration line with a unified v40-as-source / v25-as-fallback constructor. The existing v40 overlay block at L2897-2902 + L2913-2920 stays — but instead of being a Map keyed by v25 id used to enrich v25 entries, it becomes the SOURCE list, with v25 lookup keyed by v40 id for fallback fields.

Concretely:

```js
// Brief 76 P2 (2026-06-01): v40 is now the source of truth for vent
// systems. The pre-Brief-76 base iteration of `systems_config_v25
// .ventilation` left v40-only projects (Bridgewater post-Brief-72-PB)
// with empty ventSystems — every overlay below was a no-op. Now v40
// drives iteration; v25 is the fallback for fields v40 doesn't carry.
const v40List = (Array.isArray(building?.systems_config_v40?.ventilation)
  ? building.systems_config_v40.ventilation : [])
const v25List = (Array.isArray(building?.systems_config_v25?.ventilation)
  ? building.systems_config_v25.ventilation : [])
const v25Map  = new Map(v25List.map(v => [v?.id, v]))

// Source iteration. When v40 is present, use it. When ONLY v25 is
// present (no v40), fall back to v25 — preserves behaviour for any
// truly-legacy project that didn't migrate.
const sourceList = v40List.length > 0 ? v40List : v25List

const ventSystems = sourceList.map(entry => {
  // Identify v40 vs v25 base by which list we iterated.
  const isV40Base = v40List.length > 0
  const v40Match  = isV40Base ? entry : null
  const v25Match  = isV40Base ? v25Map.get(entry?.id) : entry

  // The existing field-level v40-wins-with-v25-fallback reads now use
  // the resolved v40Match / v25Match values. All fields below are
  // unchanged in semantics — they just have a non-null v40Match when
  // the project carries v40 data and an optional v25Match for fallback.

  const hreFromV40   = v40Match
    ? Number(v40Match?.efficiency_metric?.recovery_sensible_pct ?? 0) / 100
    : null
  const hre          = (hreFromV40 != null) ? hreFromV40 : Number(v25Match?.hre ?? 0)

  const v40EnabledOk = !v40Match || v40Match?.enabled !== false
  const v25EnabledOk = !v25Match || v25Match?.enabled !== false
  const enabled      = v25EnabledOk && v40EnabledOk

  const summer_bypass = (v40Match?.summer_bypass != null)
    ? (v40Match.summer_bypass === true)
    : (v25Match?.summer_bypass === true)

  const flowFromV40 = projectV40FlowToLps(v40Match)
  const flow_l_s    = (flowFromV40 != null) ? flowFromV40
                     : Number(v25Match?.flow_l_s ?? v25Match?.flow_L_s ?? 0)

  const sfpFromV40 = (v40Match?.efficiency_metric?.sfp_w_per_lps != null)
    ? Number(v40Match.efficiency_metric.sfp_w_per_lps) : null
  const sfp        = (sfpFromV40 != null) ? sfpFromV40
                     : Number(v25Match?.sfp_w_per_l_s ?? v25Match?.sfp ?? 0)

  const id   = v40Match?.id   ?? v25Match?.id   ?? null
  const name = v40Match?.label ?? v25Match?.name ?? v25Match?.id ?? v25Match?.library_id ?? '?'

  return {
    name,
    library_id: v25Match?.library_id,
    flow_l_s,
    hre,
    sfp,
    hours: Number(v25Match?.hours ?? 8760),   // v25-only field; default 8760 if neither carries it
    enabled,
    summer_bypass,
    // (preserve any other fields the existing builder constructed)
  }
})
```

The exact shape of the returned object must mirror the existing builder line-for-line — keep field names, defaults, and rounding identical. The point is to flip the source of iteration, not redesign the row shape.

**Reactivity note:** if the existing builder constructs other fields (id, schedule_ref, etc.) inside that same `.map()`, port them across with the same v40-wins-with-v25-fallback discipline.

**Files touched:**
- `frontend/src/utils/instantCalc.js` — lines ~2897-2982 (the existing builder block). One file change.

**Gates (verify in browser at `:5176` AND via re-running anchor probe):**
- (a) `result.heat_balance.losses_at_setpoint.ventilation` is a 3-entry array on Bridgewater. Each entry has non-zero `heat_loss_kwh` (subject to walking the hours/HRE multiplication — Brief 75 §1.7 estimates ~369 MWh net total; ~370 MWh / 3 = ~120 MWh per system average, distributed unevenly per HRE setting).
- (b) `result.heat_balance.annual.losses.mech_ventilation.kwh` (Brief 74 P5 aggregate) is non-zero, matches Σ over `losses_at_setpoint.ventilation[].heat_loss_kwh`.
- (c) Heat Balance Sankey on Bridgewater shows a Mech ventilation ribbon on the OUT-Losses side. **Per Principle 4** — it's the aggregate ribbon (Brief 74 P5 design), NOT three separate per-system ribbons. Per-system breakdown appears in the Rows view + Diagnostic panel.
- (d) Σ losses on Heat Balance has risen vs P1 anchor by the vent extract magnitude.
- (e) Net residual on Heat Balance changes accordingly. Document the new value.
- (f) **Heating demand may change OR may stay at 0.** Either outcome is acceptable for P2 — the brief's intent is to fix the vent loss display path, NOT to fix the saturation question. If heating_demand stays 0, Brief 75 P2 outcome-(c) saturation question is still open. If heating_demand moves to non-zero, Brief 75 P2 outcome-(c) is partially closed (vent feedback was the proximate cause). Document either way; do NOT alter the brief's scope based on which happens.
- (g) Cooling demand, DHW demand, fan electricity totals UNCHANGED.
- (h) **State path coverage:** State 1 still no-op (no vent in envelope scope). State 2 takes the new path. State 3 inherits via spread. Inline-legacy untouched. Document in commit message.

Commit: `Brief 76 P2: v40-as-source for ventSystems builder (closes b9ae15b regression)`.

---

**Part 3 — Brief 72 PB seeder backstop (P2 in the brief's outline; renaming as P3 for sequencing).**

Per Principle 3 + the diagnostic's §"What I think the right Brief 76 looks like" P2, the backstop is the explicit deprecation tag on v25 vent reads. Concretely:

1. Add a comment at the OLD L2921 site (now refactored to the v40-as-source pattern) explaining the migration history: "BEFORE Brief 76, base iteration was v25; the assumption was that all projects carry a v25 mirror. Brief 72 PB's recovery broke that assumption on Bridgewater. v40 is now the base; v25 fallback remains for fields v40 doesn't carry."
2. Grep the codebase for any OTHER consumer reading `systems_config_v25.ventilation` as a base array (not as a per-id lookup). If any are found, port them to the same pattern OR add a TODO comment marking them for migration. Likely candidates: `systemsEngine.js`, any other site in `instantCalc.js`, the `Brief 60 fan calc reconcile`, the Brief 50 P6 HRE source.
3. Document the grep results in audit §3 — sites found, ported now vs. left for later, with rationale per site.
4. **NO seed-script changes** — the script `_brief72_pb_recreate_bridgewater.mjs` is already gone from disk. The lesson is captured in the engine instead, where it can't drift.

Commit: `Brief 76 P3: deprecate v25 vent base-array reads (engine docs + grep sweep)`.

---

**Part 4 — Re-anchor + reconciliation.**

Re-run `scripts/_brief75_p1_anchor.mjs` (no script changes needed — anchor fields already include `losses.mech_ventilation`, `losses_at_setpoint`-related, and headline metrics). Save output to `docs/audit/76_p4_anchor_after.json`. Build §4 reconciliation table in audit doc comparing pre-fix vs post-fix:
- Σ losses (expect to rise by mech vent extract magnitude)
- losses.mech_ventilation (expect non-zero)
- losses_at_setpoint.ventilation[].heat_loss_kwh per system (expect populated)
- Heating demand (document the value either way — see P2 gate (f))
- Cooling demand, DHW demand, vent fan total, EUI — document any movement

First-principles cross-check: Σ losses_at_setpoint.ventilation[].heat_loss_kwh ÷ Σ losses.mech_ventilation should be 1.000 (the aggregate is the sum of per-system; they must agree per Rule 9). Any disagreement is a P2 implementation bug — STOP and fix.

This part is documentation-only. No code changes.

Commit: `Brief 76 P4: post-fix anchor + reconciliation`.

---

**Part 5 — Walkthrough + close. [HARD STOP for Chris's walkthrough]**

Code self-verifies via MCP browser tools at `:5176`; logs in audit §5. Then Chris's walkthrough:

1. Heat Balance Sankey OUT-Losses side: Mech ventilation ribbon visible in vent teal (the aggregate, per Brief 74 P5 design). ✓/✗
2. Sankey Σ losses on the badge has risen vs pre-fix by the vent extract magnitude. ✓/✗
3. Rows view: per-system ventilation entries appear ("mvhr_gf_public", "vent_bedroom_extract", "vent_public_toilet_extract"). ✓/✗
4. Net residual on Heat Balance — document the new value (no specific target, just must reconcile to Σ gains − Σ losses). ✓/✗
5. Diagnostic panel: `losses_at_setpoint.ventilation` shows 3 entries with non-zero `heat_loss_kwh`. ✓/✗
6. `losses.mech_ventilation.kwh` matches Σ over per-system `heat_loss_kwh` within rounding tolerance. ✓/✗
7. Disabling `mvhr_gf_public`'s HRE (set to 0%) increases that system's `heat_loss_kwh` (more loss when no recovery); restore. ✓/✗
8. Disabling all three vent systems collapses both the aggregate ribbon AND the per-system entries to zero; restore. ✓/✗
9. Cooling demand UNCHANGED at 302.1 MWh. ✓/✗
10. DHW demand UNCHANGED at 263.183 MWh. ✓/✗
11. Vent fan total UNCHANGED at 41.962 MWh. ✓/✗
12. Heating share validation still works (regression check — drag a heating share, warning fires). ✓/✗

If any item fails, treat as Tier-2 within the brief: short diagnostic, bounded fix, re-verify. Don't expand scope.

Commit: `Brief 76 P5: close + walkthrough + archive`. Archive `git mv docs/briefs/active/76_v40_ventsystems_base_iterator.md docs/briefs/archive/76_v40_ventsystems_base_iterator_COMPLETED.md`. Update STATUS.md. Repoint `current.md`.

Brief 75 stays open with status updated to "P2-only, superseded — saturation diagnostic was correct but the proximate cause was upstream of where it pointed. Revisit after Bridgewater has real ventilation flowing through the engine (Brief 76 lands first)."

---

## What MUST NOT happen

- Any change to the State 3 dispatch gate at `instantCalc.js:6668`. The architect's superseded draft proposed this; this brief explicitly rejects it.
- Any change to demand integrand math. P2 is a base-array source change, not a physics change. The integrand reads `ventSystems[].flow_l_s`, `.hre`, `.sfp` exactly as before — those values come from v40 already.
- Any new field on the result schema (`losses_at_setpoint.ventilation` shape unchanged, `losses.mech_ventilation` shape unchanged).
- A renderer change. The renderer reads `losses_at_setpoint.ventilation` correctly; no UI work needed beyond verification.
- A second engine field for "ventilation effect on heating" — Brief 75 P3 considered this and was cut by Brief 75 P2 STOP. P3 of THAT brief is not being resurrected in this brief.
- Schema migration to drop `systems_config_v25` from the building config. Premature; out of scope.
- Quiet scope expansion — Tier-3 notes go in audit §future.
- DHW volume default moved off 80 L/p/day.
- Heating/Cooling/DHW share validation weakened.

---

## Escalation triggers

- **P2's first-principles cross-check at P4 disagrees by >5%** (Σ per-system vs aggregate, OR engine output vs Brief 75 §1.7's 369 MWh net order-of-magnitude) → STOP. Either P2 implementation bug (integration not picking up enriched v40 values) or first-principles estimate is wrong. Diagnose.
- **Heating demand goes negative or DHW demand changes after P2 lands** → STOP. P2 should be a vent-display-only change; demand integrand math is untouched. If demand moves, something's coupled that shouldn't be.
- **State 3 stops reaching `_calculateState3` after P2** → STOP. Shouldn't happen (P2 doesn't touch dispatch) but if it does there's a state-routing coupling bug.
- **Three approaches tried on any single failure** → escalate.

---

## Final report (at close)

Commit SHAs per part. Anchor table P1 (before) vs P4 (after) with all changes from first principles. Walkthrough ✓/✗ table. Any Tier-3 items for future briefs. Notes on whether heating_demand moved or stayed at 0 (input to Brief 75 reopening).
