# Brief 41 — Operable openings: unified physics + visible scheduler

**Author:** Claude Chat (architect), revised by Chris Scott (three changes captured 2026-05-19).
**Authorised by:** Chris Scott (Part 0 only; Parts 1-6 pending Part 0 review).
**Status:** Active. Part 0 in flight (this commit).
**Date opened:** 2026-05-19
**Target outcome:** Operable openings (doors, windows, vents with control modes) use the same wind-driven flow correlation as permanent vents — Brief 33/34's two-branch `flow_mode` dispatch with building-wide `cd` and `Cw`. Temperature-mode openings additionally use an additive stack contribution via `height_m` and `(T_in − T_out)` — without stack, temperature-mode is gutted. The existing per-opening control modes (always / scheduled / temperature) gate WHEN the opening is open; the building-wide physics drives HOW MUCH flow when open. Schedule picker in the opening editor card surfaces the existing Brief 37 unified schedule mechanism prominently — no new schedule infrastructure, just better UX.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md, particularly the Building module scope section and Rule 14 (envelope-physics parity across State 1 / State 2 / inline-legacy).
3. Read `docs/audit/41_operable_openings_diagnostic.md` — the Part 0 audit findings.
4. Read `docs/audit/29_permanent_vent_methodology.md` — the methodology baseline for permanent-vent flow correlations.
5. Read STATUS.md as currently on disk; confirm last entry is the Part 0 commit.
6. Confirm working tree clean: `git status --short`.
7. Confirm `origin/main == local main`.
8. Do not begin Part 1 until Chris has reviewed Part 0 and authorised Parts 1-6.

---

## Scope statement

This brief touches the Building module's calculation paths in `frontend/src/utils/instantCalc.js` only. Specifically the per-opening operable-opening engine in three locations: State 1 lines 1339-1367, State 2 lines 2702-2740, inline-legacy `Q_window` at line 5255. Plus the opening-editor UI panel + a migration script for persisted state.

Per CLAUDE.md "Module scopes," the Building module is envelope-only. Operable openings (doors, windows, vents) are passive envelope features with control logic that gates when air flows through. This brief preserves that contract — no systems, operation-side scheduling, or gains concepts are introduced beyond what's already in place (Brief 28e Gate E2's `evaluateOpeningControl`).

Per CLAUDE.md Rule 14: envelope-physics changes to State 1 must be ported to State 2 and inline-legacy in the same commit. Brief 41 explicitly extends Rule 14's scope to call out operable openings alongside permanent vents.

---

## Operational mode

Plough through Parts 1-6 without per-Part sign-off pauses (matching Brief 39's pattern), AFTER Chris reviews Part 0. Final walkthrough sign-off by Chris after Part 5 before close. Brief 28e Gate E2 supersession noted in CLAUDE.md.

---

## Principles

1. **Pattern C is honoured.** Parallel envelope reimpl in State 1 and State 2 (and inline-legacy until the follow-up cleanup brief) stays. Don't combine. Don't introduce shared helpers for terms that integrate against state-specific T_air traces.
2. **No pre-assumed numerical targets.** Bridgewater's post-Brief-41 4 m² door is whatever the physics produces under single_sided dispatch with building-wide `cd=0.29`. Expected order of magnitude is single-digit to low-double-digit MWh, comparable to a 4 m² louvre treated identically. If the post-fix number is materially outside that range, Part 0's diagnostic flagged something — investigate from physics, do not adjust the engine to fit. (Per Brief 33 Principle 1.)
3. **Temperature-mode keeps the stack term.** Stack-driven natural cooling is the entire reason temperature-mode exists — opening a door when the building overheats relies on warm air rising and exiting through the high opening while cool air enters through low openings. Wind-only correlations don't capture this and would defeat the control mode.
4. **CLAUDE.md addition is the durable deliverable.** Rule 14 already establishes the three-location parity rule; Brief 41 amends it to call out operable openings explicitly so future envelope refinements sweep all three operable-opening paths.
5. **Documentation hygiene per Process Rule 7.** STATUS.md and audit-doc updates in the same commit as the code changes.

---

## Parts

### Part 0 — Diagnostic (read-only, this commit)

**Goal:** Confirm the operable-opening flow_mode bug before any code changes. Hand-calc reconciliation of Bridgewater's 646 MWh / 4 m² always-open door. Git-history trace of when the Brief 28e Gate E2 code shipped and what was known at the time. Single commit producing `docs/audit/41_operable_openings_diagnostic.md` + this brief file landed in `active/`.

**Files touched:**
- `docs/audit/41_operable_openings_diagnostic.md` (new) — Part 0 audit doc with TL;DR, the three paths, hand-calc reconciliation, git history, additional-bug ruled-out table, Issue #17 suggested for `29_open_issues.md`.
- `docs/briefs/active/41_operable_openings_unified_physics.md` (new — this file).
- `docs/briefs/current.md` repointed at Brief 41.
- `STATUS.md` Part 0 in-flight entry.
- `docs/audit/29_open_issues.md` — append Issue #17 (deferred to Part 6 close-out commit to keep Part 0 strictly read-only-audit-only; Part 6 closes Issue #17 against the fix).

**NO code changes in Part 0.**

**Outcome:** Audit confirms 646 MWh is engine output from State 2's per-opening engine applying the cross-flow EN 16798-7 formula to Bridgewater weather. No additional bug beyond the missing flow_mode dispatch. Same class as Issue #2 (Brief 33/34 → Brief 39) for permanent vents.

**Commit message:**
```
Brief 41 Part 0: Operable-opening diagnostic (read-only)

Bridgewater's 4 m² always-open door reports 646.3 MWh annual loss on
Operation Heat Balance Sankey. Read-only audit confirms the magnitude
is engine output of the Brief 28e Gate E2 cross-flow formula applied to
Bridgewater's UK coastal weather (avg wind ~5-6 m/s, ~8000 heating-
direction hours under permanent always-open mode, stack adds ~12%).
Engine output sits in the 583-700 MWh physically-defensible bracket;
the 646 MWh is correct given the inputs but the inputs imply a wrong
correlation for single-sided topology.

Same bug class as Issue #2 (Brief 33/34 → Brief 39 fixed for permanent
vents). Brief 39 Part 3 verified the State 1 → State 2 mirror but
didn't audit the correlation itself — that's the gap this brief
closes.

Hand-calc bracket analysis, additional-bug ruled-out table, git
history of Brief 28e Gate E2 → Brief 39 Part 3, suggested Issue #17
for 29_open_issues.md all documented in
docs/audit/41_operable_openings_diagnostic.md.

Brief file folded into active/ per the Brief 37/38/39 pattern.

NO code changes. Single read-only commit. Parts 1-6 await Chris's
review of Part 0 findings.
```

STATUS.md update in the same commit.

---

### Part 1 — Engine: port flow_mode dispatch into operable openings (Rule 14 parity, 3 locations)

**Goal:** State 1 + State 2 + inline-legacy operable-opening flow correlation becomes the same two-branch `single_sided` / `cross` dispatch the permanent vents use, gated by per-opening control mode. Temperature-mode keeps the additive stack term.

**Files touched:** `frontend/src/utils/instantCalc.js` only.

**Code change shape** (illustrative, exact line counts confirmed in Part 1's commit):

In State 1 (lines 1339-1367) and State 2 (lines 2702-2740) per-opening loops:

```js
for (const o of operableOpenings) {
  const decision = evaluateOpeningControl(...)
  if (!decision.is_open) continue
  const A   = Number(o.area_m2 ?? 0)
  const Hgt = Number(o.height_m ?? 1.0)
  // Building-wide flow inputs (replace per-opening Cd, Cw):
  const cd_op           = typeof openings.cd === 'number' ? openings.cd : 0.25
  const flow_mode_op    = resolveFlowMode(openings)
  const Cw_op           = ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })[openings.site_exposure] ?? 0.10
  const sqrtCw_op       = Math.sqrt(Cw_op)
  const single_sided_op = Math.min(1.0, cd_op / 0.6)

  // Wind dispatch — matches Brief 33/34 permanent vents
  let Q_wind
  if (flow_mode_op === 'single_sided') {
    Q_wind = 0.025 * single_sided_op * A * v_wind
  } else {  // 'cross'
    Q_wind = cd_op * A * sqrtCw_op * v_wind
  }

  // Stack — only for temperature-mode openings (Brief 41 design call)
  let Q_stack = 0
  if (o.control?.mode === 'temperature') {
    const dT_abs  = Math.abs(T_op_prev - T_out)
    const T_avg_K = 0.5 * (T_op_prev + T_out) + 273.15
    Q_stack = cd_op * A * Math.sqrt(Math.max(0, 2 * GRAVITY * Hgt * dT_abs / Math.max(T_avg_K, 1)))
  }

  const Q_open  = Math.sqrt(Q_wind * Q_wind + Q_stack * Q_stack)
  const UA_open = AIR_RHO * AIR_CP * Q_open
  ...
}
```

In inline-legacy (line 5255):

```js
const Q_window_per_opening = openings_w_total => {
  // openings_w_total = Σ operable-window area-fractions for simplified path
  if (flow_mode_dd === 'single_sided') {
    return 0.025 * single_sided_factor_dd * openings_w_total * v_wind
  } else {
    return cd_dd * openings_w_total * sqrtCw * v_wind
  }
}
const Q_window = windowsOpen ? Q_window_per_opening(openable_area_total) : 0
```

(Inline-legacy stays without stack — the simplified path doesn't model temperature-mode anyway; cleanup is the follow-up rationalisation brief's territory.)

**Steps:**

1.1 Confirm exact line ranges in State 1 (1339-1367), State 2 (2702-2740), inline-legacy (5243-5257) against current `HEAD`.

1.2 In State 1 + State 2: replace the existing `Q_wind = Cd × A × √(Cw × v²)` + unconditional `Q_stack = Cd × A × √(2 g h |dT|/T_avg)` with the dispatch above. Pull `cd_op` / `flow_mode_op` / `Cw_op` / `single_sided_op` from the building-wide openings config (already resolved at the top of each function for the permanent-vent path; reuse those constants).

1.3 In inline-legacy: replace the unconditional `cd_dd × openable_area_total × √Cw × v_wind` with the dispatch.

1.4 The `evaluateOpeningControl` helper at line 662 is **unchanged**. It still decides each hour whether the opening is open. The new dispatch only affects the flow magnitude when open.

1.5 Update Brief 28e Gate E2's audit-doc references (in source code comments at lines 1066-1074, 2482-2492, 5234-5242) to reflect the unified dispatch and link to this brief.

1.6 Methodology note appended to `docs/audit/29_permanent_vent_methodology.md` documenting the wind-only-vs-wind+stack distinction across always/scheduled/temperature control modes.

**Commit message:**
```
Brief 41 Part 1: Port flow_mode dispatch into operable openings (Rule 14 parity)

State 1 lines 1339-1367, State 2 lines 2702-2740, inline-legacy line 5255
all updated to dispatch on building-wide openings.flow_mode for the wind-
driven flow component:

  always / scheduled control mode → wind-only dispatch (single_sided | cross),
                                    matching permanent-vent correlation.
  temperature control mode        → wind dispatch + additive stack term using
                                    height_m and (T_in - T_out). Stack-driven
                                    cooling is the point of temperature-mode.

Building-wide cd (from openings.cd) replaces per-opening
discharge_coefficient. Building-wide Cw (from openings.site_exposure)
replaces per-opening wind_coefficient. Per-opening height_m retained for
temperature-mode stack.

Closes Issue #17 (logged in docs/audit/29_open_issues.md alongside this fix).
Same bug class as Issue #2 (Brief 33/34 → Brief 39 fixed for permanent
vents).

Methodology note in docs/audit/29_permanent_vent_methodology.md
documents the wind-vs-wind+stack physics split by control mode.

Bridgewater post-fix verification in Part 5.
```

STATUS.md update in same commit.

---

### Part 2 — Schema cleanup

**Goal:** Drop the per-opening `discharge_coefficient` and `wind_coefficient` from the operable-opening schema. Keep `height_m`. Update `withMode` allowlist accordingly.

**Files touched:**
- `frontend/src/context/ProjectContext.jsx` (DEFAULT_PARAMS.operable_openings shape)
- `frontend/src/utils/instantCalc.js` (`withMode` allowlist + `synthesiseOperableOpeningsFromLegacy` if it touches these fields)

**Steps:**

2.1 Locate the operable-opening schema in `DEFAULT_PARAMS` and remove `discharge_coefficient`, `wind_coefficient` defaults. Keep `area_m2`, `height_m`, `facade`, `parent_glazing_face`, `control`, `name`, `id`, `consumes_glazing_on_parent_facade`.

2.2 Update `withMode` allowlist (per Brief 33 Finding 1 ALLOWLIST DRIFT discipline) to remove the dropped fields. The withMode comment at lines 411-417 must mention this Brief-41 schema change for traceability.

2.3 `synthesiseOperableOpeningsFromLegacy` (line 581) — if it sets default Cd / Cw, remove those code paths.

**Commit message:**
```
Brief 41 Part 2: Schema cleanup — drop per-opening Cd + Cw, keep height_m

Per-opening discharge_coefficient and wind_coefficient removed from the
operable-opening schema. Building-wide openings.cd + openings.site_exposure
(→ Cw) now drive flow uniformly across permanent vents AND operable
openings under the Part 1 dispatch.

Per-opening height_m retained — needed for temperature-mode stack term.

withMode allowlist updated per the ALLOWLIST DRIFT discipline (Brief 33
Finding 1). synthesiseOperableOpeningsFromLegacy default-setting paths
for the dropped fields removed.
```

STATUS.md update in same commit.

---

### Part 3 — Migration script

**Goal:** Remove dropped fields (`discharge_coefficient`, `wind_coefficient`) from persisted state on Bridgewater + any other project. Idempotent.

**Files touched:**
- `scripts/41_operable_openings_schema_migration.py` (new)

**Steps:**

3.1 Mirror the Brief 34 `scripts/34_remove_per_facade_geometry.py` pattern — connects to the SQLite DB, iterates projects, strips the dropped fields from `operable_openings[*]`.

3.2 Idempotent: re-running is a no-op (entries already cleaned skip silently).

3.3 Stop-dev-server discipline per CLAUDE.md Process Rule 11. Script docstring states this.

3.4 Run on dev DB; confirm Bridgewater's `operable_openings` array post-migration has only the retained fields.

**Commit message:**
```
Brief 41 Part 3: Migration script for operable-opening schema cleanup

scripts/41_operable_openings_schema_migration.py removes
discharge_coefficient and wind_coefficient from all persisted projects'
operable_openings[*] entries.

Idempotent. Stop-dev-server discipline per CLAUDE.md Rule 11. Verified
on Bridgewater.
```

STATUS.md update in same commit.

---

### Part 4 — UI: surface the schedule picker

**Goal:** Update the operable-opening editor card to remove the (now-unused) Cd / Cw sliders and surface the schedule picker prominently when `control.mode === 'scheduled'`.

**Files touched:**
- The operable-opening editor UI file (located under `frontend/src/components/modules/` — likely `OperationModule.jsx` or a sub-component of the openings panel). To be confirmed in Part 4's first step.

**Steps:**

4.1 Locate the opening-editor card component (the panel shown in Chris's screenshot — "ADD OPENING", "OPENINGS", per-opening editor with Name / Facade / Opening type / Area / Height / Control Mode fields).

4.2 Remove the "Show Cd / Cw" expand link and the Cd / Cw sliders behind it.

4.3 When `control.mode === 'scheduled'`: surface a schedule picker — a select dropdown showing available project schedules from the Brief 37 schedule library, plus an "Edit ↗" link that opens the existing `UnifiedScheduleEditor` (Brief 37 Part 2 component).

4.4 When `control.mode === 'temperature'`: show the existing `open_above_c` / hysteresis / etc. inputs (currently exposed, just confirm they're still there).

4.5 When `control.mode === 'always'`: no extra UI — opening is permanent.

4.6 Add a "Related" footnote under the editor card pointing to "Building → Openings (C_d, site exposure, flow mode)" so users know where the building-wide flow inputs live. Brief 41's design moves flow physics to the building-wide level; the per-opening editor should make that visible.

**Commit message:**
```
Brief 41 Part 4: Surface schedule picker in operable-opening editor

Per-opening Cd / wind_coefficient sliders removed (those fields no
longer exist in the schema post-Part-2). When control.mode === 'scheduled',
the editor card surfaces a schedule picker reading from the Brief 37
project schedule library, with an "Edit" link opening the
UnifiedScheduleEditor (Brief 37 Part 2 component).

When control.mode === 'temperature', existing open_above_c / hysteresis
inputs remain. When 'always', no extra UI — opening is permanent.

Related footnote added under the editor card pointing to Building →
Openings for the building-wide C_d / site exposure / flow mode inputs
that now drive operable-opening flow.

No new schedule infrastructure — Brief 37's UnifiedScheduleEditor and
project schedule library are reused.
```

STATUS.md update in same commit.

---

### Part 5 — Bridgewater verification

**Goal:** End-to-end check that Bridgewater's 4 m² door reports a physically-reasonable annual loss under the new dispatch.

**Files touched:**
- `docs/audit/41_operable_openings_diagnostic.md` — append "Part 5 reconciliation" section with the actual post-fix number.
- `STATUS.md` Part 5 in-flight entry.

**Steps:**

5.1 Code-side walkthrough: confirm Operation module + Internal Gains module + Building module all read the same updated State 2 / State 1 output for the door (after Parts 1-3).

5.2 Order-of-magnitude check: expected post-fix Bridgewater 4 m² door under `single_sided` dispatch with `cd=0.29` is **single-digit to low-double-digit MWh**, comparable to a 4 m² louvre treated identically. No specific anchor — physically-defensible bracket only.

5.3 **Escalation:** if the post-fix number is **> 1.5 ×** what a comparable always-open 4 m² louvre (under permanent-vent dispatch) produces, that's a Severity 2 finding — Part 0's diagnostic flagged something — investigate from physics, do not adjust the engine to fit. Brief 41 does **not** close until reconciled.

5.4 Chris's walkthrough captures the actual number and updates the audit doc.

**Commit message:**
```
Brief 41 Part 5: Bridgewater post-fix reconciliation (code-side)

Code-side walkthrough of which module reads which state's operable-
opening output. Expected order of magnitude in
docs/audit/41_operable_openings_diagnostic.md "Part 5 reconciliation"
section.

Awaits Chris's walkthrough to capture the actual post-fix Bridgewater
4 m² door number. Escalation if > 1.5x a comparable always-open
4 m² louvre — Brief 41 does not close in that case.
```

STATUS.md update in same commit.

---

### Part 6 — Close

**Files touched:**
- `docs/briefs/active/41_operable_openings_unified_physics.md` → `docs/briefs/archive/41_operable_openings_unified_physics_COMPLETED.md`
- `docs/briefs/current.md`
- `STATUS.md`
- `CLAUDE.md` — amend Rule 14 to call out operable openings explicitly as a Rule-14 envelope-physics term (same parity required across S1 + S2 + inline-legacy).
- `docs/audit/29_open_issues.md` — Issue #17 marked FIXED with link to Brief 41's Part 1 commit hash.

6.1 Rename + move Brief 41 to archive.

6.2 Update `docs/briefs/current.md`: no active brief.

6.3 Amend CLAUDE.md Rule 14: add "operable openings (per-opening flow_mode dispatch including stack for temperature-mode)" to the list of envelope-physics terms covered.

6.4 Final STATUS.md close-out.

6.5 Single push. Verify origin == local.

**Commit message:**
```
Brief 41 close: Operable openings unified physics + visible scheduler

Brief 28e Gate E2 cross-flow-only operable-opening flow correlation
replaced with the building-wide single_sided / cross dispatch (Brief
33/34 → Brief 39 → Brief 41) gated by per-opening control mode.

  always / scheduled → wind-only dispatch.
  temperature       → wind + stack (height_m preserved).

Three-location parity per Rule 14 (State 1 + State 2 + inline-legacy).
Per-opening Cd / Cw dropped (building-wide replaces them); height_m
retained for stack. Migration script run on Bridgewater + persisted
state cleaned.

UI: schedule picker surfaced in opening editor; Cd / Cw sliders gone.
Brief 37 UnifiedScheduleEditor reused (no new schedule infrastructure).

CLAUDE.md Rule 14 amended to call out operable openings explicitly
alongside permanent vents. Issue #17 closed.

Bridgewater 4 m² door: 646 MWh -> [post-fix number from Part 5]. Order
of magnitude within physically-defensible bracket; no calibration
applied.

Inline-legacy operable-opening physics simplification still pending
the broader inline-legacy rationalisation follow-up brief
(docs/audit/39_calculation_flow_map.md §"Inline-legacy rationalisation —
deferred"). Brief 41 fixes the dispatch in inline-legacy without
collapsing the architectural duplication.

Brief 30 (Dynamic rebuild) remains paused.
```

---

## Final report (paste in chat after Part 6)

1. New origin/main HEAD SHA.
2. Bridgewater post-Brief-41 4 m² door loss (MWh).
3. Confirmation that order of magnitude is in the single-digit to low-double-digit MWh band, not > 1.5 × the comparable louvre figure.
4. Confirmation that all three code paths (S1, S2, inline-legacy) emit the same dispatch.
5. Confirmation that temperature-mode openings on existing projects still register stack contribution (regression test for temperature-mode preservation).
6. Confirmation that `docs/briefs/active/` contains only Brief 30 (paused).
7. CLAUDE.md Rule 14 confirmed amended.
8. Issue #17 marked FIXED.

---

## What MUST NOT happen in this brief

- No drop of `height_m` per-opening field (stack term needs it for temperature-mode).
- No pre-assumed numerical targets for Bridgewater post-fix.
- No extraction of a shared `computeOperableOpeningFlow` helper across State 1 / State 2 (against Pattern C / Brief 28c).
- No combining the per-opening engine + inline-legacy aggregate into a unified model (inline-legacy's stale-stub status is the inline-legacy rationalisation brief's territory).
- No introduction of mech-vent / DHW / heating system concepts into operable-opening physics.
- No code changes to `sql_parser.py`, `epjson_assembler.py`, or simulation API endpoints (Dynamic remains paused).
- No partial commits — each Part is one commit including its STATUS.md and audit-doc updates.

## When to escalate

Pause and escalate to Chris ONLY if:

- Part 1's three-location dispatch port turns out to require a refactor of `evaluateOpeningControl` (it shouldn't — control evaluation is orthogonal to flow magnitude).
- Part 2's schema cleanup uncovers a consumer of `discharge_coefficient` or `wind_coefficient` outside `instantCalc.js` (would need that consumer updated in the same commit).
- Part 3's migration script reveals temperature-mode openings on Bridgewater or other projects with non-default `height_m` (no problem; document and confirm height is preserved through the migration).
- Part 5's Bridgewater post-fix number is materially > 1.5 × a comparable louvre figure — investigate from physics; do not close Brief 41.
- Documentation hygiene starts slipping.

Otherwise, plough through Parts 1-6 after Chris reviews Part 0. Final report at the end.

## Standing by for authorisation to begin Part 1 — pending Chris's review of Part 0.
