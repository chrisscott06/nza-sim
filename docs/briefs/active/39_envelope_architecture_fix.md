# Brief 39 — Envelope Physics Architecture Fix

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active.
**Date opened:** 2026-05-18
**Target outcome:** The permanent-vent calculation produces the same physical result in Building, Internal Gains, Operation, Systems, and the degree-day fallback (modulo the legitimate T_air integration difference per Brief 28c). The inline-legacy 'full' code path is rationalised. CLAUDE.md gains an architectural rule preventing recurrence of envelope-physics drift between State 1 and State 2.

Drives the headline finding from `docs/audit/39_calculation_flow_map.md`: the codebase is Pattern C (hybrid) intentionally, with parallel envelope reimpl in State 1 and State 2 by design per Brief 28c. Permanent-vent dispatch never made it from State 1 (where it was added in Brief 33/34) to State 2 or to the inline-legacy 'full' path. Bug exists in two places, not one.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md, particularly the "Module scopes" Building module section.
3. Read STATUS.md as currently on disk; confirm last entry is the audit close at `f59dc06` or later.
4. Read `docs/audit/39_calculation_flow_map.md` — this brief's findings doc, written by Audit 39.
5. Read `docs/audit/39_state2_permanent_vent_diagnosis.md` — Priority 1 diagnostic that triggered the audit.
6. Confirm working tree clean: `git status --short`.
7. Confirm `origin/main == local main`.
8. Do not begin Part 1 until all seven checks pass.

---

## Scope statement

This brief touches the Building module's calculation paths in `frontend/src/utils/instantCalc.js` only. Specifically the permanent-vent dispatch in three locations: State 2 (line 2247 + 2483), inline-legacy 'full' (line 5161 + 5213), and the verification that State 1 remains the only path doing it correctly.

Per CLAUDE.md "Module scopes," the Building module is envelope-only. Permanent vents are passive envelope features. This brief preserves that contract — no systems, operation, or gains concepts are introduced.

Per the Audit 39 findings: parallel State 1/State 2 envelope reimpl is intentional (Brief 28c). This brief does NOT extract a shared `computePermanentVents` helper, and does NOT combine State 1 and State 2 into a single parameterised calculator. It ports the existing two-branch flow_mode dispatch from State 1 into State 2 and inline-legacy, preserving the parallel-reimpl architecture.

**Part 1 adjustment (Chris, 2026-05-19):** the original Part 1 plan to convert inline-legacy into a thin router calling `_calculateState2` was set aside after the Part 1 consumer audit found that `LiveResultsPanel.jsx` reads systems-side fields (`eui_kWh_m2`, `carbon_kgCO2_m2`, `fuel_split`, `monthly`) that State 2 doesn't produce. Option (c) — patch inline-legacy in place — was chosen as the pragmatic ship-the-fix path. Inline-legacy's architectural cleanup is documented as deferred in `docs/audit/39_calculation_flow_map.md` and will be its own follow-up brief.

---

## Operational mode — keep ploughing through

Per Chris's authorisation: this brief runs end-to-end without phase-by-phase sign-off. Stop and escalate ONLY for the conditions in "When to escalate." Final report at end of Part 6.

---

## Principles

1. **Pattern C is honoured.** Parallel envelope reimpl in State 1 and State 2 (and inline-legacy until the follow-up cleanup brief) stays. Don't combine them. Don't introduce shared helpers for terms that integrate against state-specific T_air traces.
2. **Inline-legacy gets patched in place this brief** (Part 1 revised per Option (c)). Architectural rationalisation is deferred to a follow-up brief, documented in the audit doc.
3. **No pre-assumed numerical targets.** Bridgewater's post-fix permanent-vent number in Internal Gains/Operation is whatever the corrected single_sided correlation produces. Compare against Building's number (which is correct) for reconciliation, not against any prior expected value.
4. **CLAUDE.md addition is the durable deliverable.** Code fixes prevent today's drift; the rule prevents tomorrow's. The rule's wording names three locations explicitly (State 1, State 2, inline-legacy) and notes inline-legacy is known debt.
5. **Documentation hygiene per Process Rule 7.** STATUS.md and audit-doc updates in the same commit as the code changes.

---

## Parts

### Part 1 — Patch inline-legacy 'full' path in place (revised per Option (c))

**Goal:** The inline-legacy 'full' code path inside `calculateInstant` (lines 5087+) carries the same permanent-vent bug as State 2. Port the State 1 two-branch flow_mode dispatch into it. Don't rationalise the path — that's deferred to a follow-up brief.

**Files touched:**
- `frontend/src/utils/instantCalc.js` — ports `flow_mode` dispatch into the inline-legacy permanent-vent code (line ~5155 + 5213)
- `docs/audit/39_calculation_flow_map.md` — appends "Inline-legacy rationalisation — deferred" section documenting Option (a) as the eventual target, why Option (c) was chosen, the LiveResultsPanel field-read findings, and a pointer to the new Issue #16
- `docs/audit/29_open_issues.md` — logs Issue #16 for the ProjectDashboard latent dead-read (`instantResult?.eui` — field never existed)
- `docs/briefs/current.md` — repointed at Brief 39
- `STATUS.md` — Part 1 entry

**Steps:**

1.1 Read the inline-legacy body (lines 5087+) end to end. Confirm the audit's finding that it carries the same perm-vent bug. ✓ Confirmed.

1.2 Read the three live consumers (`LiveResultsPanel.jsx`, `HeatBalanceTab.jsx`, `ProjectDashboard.jsx`) and document what each consumes from `result`. ✓ Done — see audit doc deferred section.

1.3 Decide: rationalise (Option A) or patch in place (Option C). Decision: Option (c) per Chris's call after consumer audit revealed LiveResultsPanel's heavy reliance on inline-legacy's full output shape (eui, carbon, fuel_split, monthly, gia_m2). Option (a)'s extraction is the right architectural end-state but warrants its own focused brief.

1.4 Port the two-branch dispatch into inline-legacy. Add `resolveFlowMode(openings)` resolution above the hour loop, capture `single_sided_factor_dd = Math.min(1.0, cd_dd / 0.6)`. Replace the cross-flow-only `Q_louvre = cd_dd × A × √C_w × v_wind` with the two-branch dispatch. ~6 lines of code.

1.5 Audit doc: append "Inline-legacy rationalisation — deferred" section documenting the Option (a) target, the consumer-side coupling that pushed this brief to (c), and the LiveResultsPanel field-read findings so a future brief doesn't redo the work.

1.6 Issue log: append Issue #16 to `docs/audit/29_open_issues.md` for the ProjectDashboard latent dead-read (`instantResult?.eui` references a field that doesn't exist on any result shape; the read always returns undefined and the dashboard falls through to its other branch). Severity S1 (cosmetic — no behavioural impact).

**Commit message:**
```
Brief 39 Part 1: Patch inline-legacy perm-vent dispatch in place (Option (c))

Inline-legacy 'full' code path in calculateInstant carried the same
permanent-vent bug as State 2 (cross-flow only, no flow_mode dispatch
— see docs/audit/39_state2_permanent_vent_diagnosis.md). Per the Part 1
consumer audit, LiveResultsPanel reads systems-side fields that State 2
doesn't produce (eui_kWh_m2, carbon_kgCO2_m2, fuel_split, monthly), so
the audit's original "thin router → State 2" recommendation isn't
viable without a heavier consumer-side rewrite. Pragmatic ship-the-fix:
patch inline-legacy in place with the same two-branch dispatch State 1
has (Brief 33/34). Inline-legacy rationalisation documented as a
follow-up brief candidate in the audit doc.

Lands the brief file, an audit-doc "deferred" section, and Issue #16
in 29_open_issues.md for ProjectDashboard's dead instantResult?.eui
read (S1, cosmetic).
```

STATUS.md update in same commit.

---

### Part 2 — Port two-branch flow_mode dispatch from State 1 to State 2

**Goal:** State 2's permanent-vent path gets the same `single_sided` / `cross` dispatch that State 1 received in Brief 33/34. The ~6-line fix per the Audit 39 sketch. Pattern C preserved — no extraction, no parameterisation.

**Files touched:**
- `frontend/src/utils/instantCalc.js` — State 2 permanent-vent block at line 2247 + 2483

**Steps:**

2.1 Read State 1's flow_mode dispatch (the Brief 33/34 code). Note its exact shape: `resolveFlowMode(openings)` returning `'cross'` or `'single_sided'`, and the two branches with their respective flow correlations.

2.2 Read State 2's current permanent-vent block at line 2247 (the deferred-follow-up comment) and line 2483 (the cross-flow-only implementation). Confirm both are unchanged from the audit's findings.

2.3 Port the dispatch into State 2. Use the same `resolveFlowMode(openings)` helper (already module-scoped — `resolveFlowMode` at line 145 is a pure validator, not a state-trace integration; sharing it doesn't violate Brief 28c's parallel-reimpl rule).

2.4 The two branches in State 2 still compute their own flows against State 2's T_air trace. The single_sided correction factor `min(1.0, openings.cd / 0.6)` is applied identically to State 1. Confirm this — the user-set `openings.cd` from Brief 34 should drive both states through the same factor.

2.5 Remove the deferred-follow-up comment at lines 2236–2238. Replace with a marker that the dispatch is now active and that this state intentionally reimplements envelope physics per Brief 28c.

2.6 Browser-side reconciliation: with Bridgewater on `single_sided`, the Internal Gains module's permanent-vent number should be close to Building's 7.7 MWh — exact match not required (Brief 28c's T_air trace difference produces a legitimate small gap), but the 5.4× ratio that triggered this brief should be gone. Document the new ratio in the audit doc.

**Commit message:**
```
Brief 39 Part 2: Port flow_mode dispatch from State 1 to State 2

State 1's two-branch permanent-vent dispatch (Brief 33/34) ported
into State 2. State 2 now respects the user's flow_mode and applies
the Brief 34 user-set C_d. Bridgewater on single_sided: Internal
Gains' permanent vent number reconciles to Building's (modulo the
legitimate T_air integration difference per Brief 28c).

Parallel envelope reimpl preserved per Brief 28c — no shared helper
for the integration itself; only the resolveFlowMode validator and
computeCd lookup are module-scoped helpers (they're pure functions,
not state-trace integrations).

Closes the bug class that triggered Audit 39 in State 2. Inline-legacy
was patched in Part 1.
```

STATUS.md update in same commit. Audit doc updated with the Bridgewater reconciliation numbers.

---

### Part 3 — Sweep for other deferred follow-ups

**Goal:** The Audit 39 finding flagged the operable-openings "mirror" comment at line 2238 as same drift-risk class. Check whether it's current or stale. Sweep the same code regions for other deferred-follow-up comments and assess each.

**Files touched:**
- `frontend/src/utils/instantCalc.js` — read-only initially; modify only if a stale comment reveals an actual drift
- Q_window dispatch in State 1 and inline-legacy if a parallel single-sided treatment is justified (see 3.3)

**Steps:**

3.1 Grep `instantCalc.js` for comments containing "follow-up," "TODO," "deferred," "FIXME," "see also," "mirror," or other markers indicating a known-but-not-landed action. List all matches with file:line and surrounding context.

3.2 For each match, classify:
- **Current and active** (a real ongoing follow-up that's still planned) — leave alone, possibly add a brief reference if context has changed.
- **Stale but harmless** (the action either landed or became moot) — delete the comment.
- **Stale and indicating drift** (the action never landed and the code is now wrong) — fix in this Part if the fix is small and in-scope; otherwise log as a new issue in `29_open_issues.md` and defer.

3.3 The line 2238 operable-openings "mirror" comment specifically: read what it claims should mirror what, verify the claim against the current code, classify per 3.2. The operable-window Q_window formula in inline-legacy + State 2 is also cross-flow-only — assess whether it needs the same dispatch treatment as Q_louvre got in Parts 1+2.

3.4 Document the sweep in the audit doc.

**Commit message:**
```
Brief 39 Part 3: Sweep deferred-follow-up comments in instantCalc.js

Audit 39 flagged the line 2238 'mirror' comment as same drift-risk
class as the perm-vent bug. Full grep-and-classify sweep of
follow-up markers in instantCalc.js. Results: N current, N stale-
harmless (removed), N stale-indicating-drift (M fixed in this Part,
P logged as new issues #X-Y in 29_open_issues.md).

Documents the residual surface area of the parallel-reimpl pattern
that still needs human attention beyond CLAUDE.md's new rule.
```

STATUS.md update in same commit.

---

### Part 4 — CLAUDE.md architectural rule

**Goal:** Add a non-negotiable technical rule that envelope-physics changes to State 1 must be ported to State 2 AND to the inline-legacy 'full' code path in `calculateInstant` in the same commit. This is the durable deliverable that prevents future Brief-39 recurrences.

**Files touched:**
- `CLAUDE.md` only

**Steps:**

4.1 Re-read CLAUDE.md's "Non-negotiable technical rules" block. Use the next available rule number (Rule 14 unless a rule has been added since Audit 39).

4.2 Add the rule with this wording (three locations explicitly named per Chris's adjustment):

> **Envelope-physics changes to State 1 must be ported to State 2 and to the inline-legacy 'full' code path in `calculateInstant` in the same commit.** The Static engine intentionally maintains parallel envelope-physics implementations in State 1 and State 2 (Brief 28c — gains-warmed T_air trace makes the two states physically different, and combining them would re-introduce the bug class Brief 28c was designed to prevent). The inline-legacy 'full' code path in `calculateInstant` (line ~5087+) is a third parallel envelope implementation, known architectural debt — a follow-up brief will rationalise it via systems-block extraction (Option (a) in `docs/audit/39_calculation_flow_map.md`); until then, it must be kept in sync.
>
> This is Pattern C per `docs/audit/39_calculation_flow_map.md`.
>
> The risk of Pattern C is silent drift: a refinement lands in one state and the follow-up in the others never happens (e.g. Brief 33/34 added flow_mode dispatch to State 1; State 2 and inline-legacy received it eight briefs later via Brief 39).
>
> To prevent recurrence: any commit that changes the physics of an envelope-only term (conduction, thermal bridging, infiltration, permanent vents, solar transmission, glazing transmission) in State 1 MUST land the equivalent change in State 2 AND inline-legacy in the same commit. Not in follow-ups. Not as TODOs. The commit is incomplete until all three locations reflect the new physics.
>
> If a state genuinely requires different physics (e.g. the gains-warmed T_air trace produces a different integrand shape, or inline-legacy uses a simplified `sysDefaults` model), the commit message must explicitly state why the locations diverge and what the divergence means. Silent divergence is the failure mode.
>
> Helpers that are pure functions (validators like `resolveFlowMode`, lookups like `computeCd`) are module-scoped and shared across locations — those don't fall under this rule because they don't contain integration logic. The rule applies to integration-bearing code: the loops that walk hours/days/months and sum into demand integrals.

4.3 Browser/file-system verification:
- CLAUDE.md contains the new rule
- The rule references Audit 39 and Brief 28c for traceability
- The rule's wording is plain enough that a future Claude Code agent reading CLAUDE.md at session start can act on it
- Three locations explicitly named

**Commit message:**
```
Brief 39 Part 4: CLAUDE.md rule — State 1/2/inline-legacy envelope parity

Adds the architectural enforcement that prevents future Brief 39s.
Any commit touching State 1 envelope physics must touch State 2 AND
inline-legacy 'full' in the same commit. Silent divergence forbidden;
intentional divergence must be documented in the commit message.

Three locations explicitly named because the audit confirmed the bug
class exists in all three (State 1 has the fix; State 2 and inline-
legacy missed the Brief 33/34 sweep). Inline-legacy noted as known
debt; follow-up brief will rationalise via systems-block extraction.

This is the durable deliverable of Brief 39. The code fixes in
Parts 1–3 fix today's drift; this rule prevents tomorrow's.
```

STATUS.md update in same commit.

---

### Part 5 — Bridgewater verification and reconciliation

**Goal:** End-to-end verification that the four user-facing views (Building, Internal Gains, Operation, Systems) all show the same permanent-vent number for Bridgewater, modulo Brief 28c's legitimate T_air integration difference.

**Files touched:**
- `docs/audit/39_calculation_flow_map.md` — final "Part 5 reconciliation" section

**Steps:**

5.1 Claude Code performs code-side reconciliation by inspection: walk each module's Sankey/Heat-Balance source-of-data lookup, confirm each reads from State 1, State 2, State 2.5 (or State 3), and identify which state's permanent-vent number is displayed where.

5.2 Document the expected post-Brief-39 numbers:
- Building module (reads State 1): 7.7 MWh (unchanged from pre-Brief-39 baseline)
- Internal Gains module (reads State 2): close to 7.7 MWh, with a small legitimate delta from T_air trace difference
- Operation module (reads State 2 or State 2.5): close to 7.7 MWh, same delta basis
- Systems module (reads State 3): close to 7.7 MWh, same delta basis

5.3 Note in the audit doc: the exact post-fix numbers come from Chris's walkthrough. Document the ratios:
- Pre-fix Internal Gains : Building = 5.4× (the bug)
- Post-fix Internal Gains : Building ≈ 1.05–1.15× (legitimate T_air delta — actual ratio captured from walkthrough)

5.4 If the post-fix ratio is materially different from 1.05–1.15× (e.g. still >1.5×), that's a Severity 2 finding — investigate further, do not close Brief 39.

**Commit message:**
```
Brief 39 Part 5: Bridgewater reconciliation post-fix

Code-side walkthrough of which module reads which state's
permanent-vent output. Expected ratios documented in
docs/audit/39_calculation_flow_map.md "Part 5 reconciliation"
section.

Awaits Chris's walkthrough to capture actual post-fix ratios.
```

STATUS.md update in same commit.

---

### Part 6 — Close

**Files touched:**
- `docs/briefs/active/39_envelope_architecture_fix.md` → `docs/briefs/archive/39_envelope_architecture_fix_COMPLETED.md`
- `docs/briefs/current.md`
- `STATUS.md`

6.1 Rename + move Brief 39 to archive.

6.2 Update current.md: no active brief.

6.3 Final STATUS.md close-out.

6.4 Single push. Verify origin == local.

**Commit message:**
```
Brief 39 close: Envelope physics architecture fix complete

Inline-legacy patched in place (Part 1, Option (c)). State 2
flow_mode dispatch ported from State 1 (Part 2). Deferred follow-up
sweep completed (Part 3). CLAUDE.md rule prevents recurrence
(Part 4). Bridgewater reconciliation documented (Part 5).

Inline-legacy rationalisation documented as a follow-up brief
candidate. Brief 30 (Dynamic rebuild) remains paused.
```

---

## Final report (paste in chat after Part 6)

1. New origin/main HEAD SHA
2. Bridgewater post-Brief-39 permanent-vent numbers, per module:
   - Building (State 1): expected unchanged at ~7.7 MWh
   - Internal Gains (State 2): post-fix value
   - Operation: post-fix value
   - Systems: post-fix value
3. Confirmation that the 5.4× ratio is gone; new ratio reported
4. Sweep findings from Part 3 — how many follow-up markers found, how classified, what landed
5. Confirmation that CLAUDE.md's new rule is in place
6. Confirmation that `docs/briefs/active/` contains only Brief 30 (paused)
7. Any new issues logged in `29_open_issues.md`

---

## What MUST NOT happen in this brief

- No extraction of a shared `computePermanentVents` helper (against Pattern C / Brief 28c)
- No combining State 1 and State 2 into a single parameterised calculator
- No code changes to `sql_parser.py`, `epjson_assembler.py`, or simulation API endpoints (Dynamic remains paused)
- No reintroduction of `balanced_mechanical` or any systems concept into the envelope path
- No calibration of Bridgewater post-fix numbers to a target — they are what the physics produces
- No partial commits — each Part is one commit including its STATUS.md and audit-doc updates
- No conversion of inline-legacy to a thin router in this brief (deferred to a follow-up after consumer audit findings)

## When to escalate

Pause and escalate to Chris ONLY if:

- Part 2's port produces a Bridgewater Internal Gains number that's still materially >1.5× the Building number — suggests another bug beyond the dispatch
- Part 3's sweep uncovers a third class of bug beyond the dispatch comment + operable-window mirror — suggests the parallel-reimpl pattern has more drift than the audit found
- Part 4's CLAUDE.md rule wording needs nuance the brief didn't anticipate — pause and propose the refinement
- Documentation hygiene starts slipping

Otherwise, plough through to Part 6. Final report at the end.
