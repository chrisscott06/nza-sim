# Brief 32 — Pause Dynamic, Complete Static, Audit Across Modules

> **Repo front matter (Brief 32 Part 1 commit 2026-05-18):**
> **Status:** ACTIVE. Replaces Brief 30 Phase 1+ in the active queue until Static is client-ready.
> **Authorised:** 2026-05-18 by Chris.
> **Progress:** Part 1 in flight (this commit).
> **Pattern across all Parts (per Chris's clarification):** each Part's commit includes brief-management updates (front matter, current.md if needed), the actual work, the STATUS.md update, build clean. Single commit per Part. No queued documentation follow-ups.

---

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Replaces Brief 30 Phase 1+ in the active queue until Static is client-ready.
**Date opened:** 2026-05-18
**Target outcome:** Bridgewater pre-retrofit baseline shippable as a client deliverable using the Static engine only, with every displayed number defensible from first principles.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md — note the new rules 7–13 (technical) and 7–9 (process) added in Brief 31.
3. Read STATUS.md as it currently sits on disk; confirm last entry is Brief 31 — Documentation Reconciliation.
4. Read `docs/audit/29_open_issues.md` end to end. The issues this brief acts on are sourced from there.
5. Read `docs/audit/29_permanent_vent_methodology.md`. The vent fix in Part 4 implements this methodology.
6. Confirm working tree clean: `git status --short`. If not clean, stop and report.
7. Confirm `origin/main == local main` at the HEAD set by Brief 31 (`54407e3`): `git fetch origin && git log origin/main..main && git log main..origin/main` both return empty. If not, stop and report.
8. Do not begin Part 1 until all seven checks pass.

---

## Context

Brief 29 audited Building module Static and Dynamic and surfaced 13 open issues. The Building Static integrand-vs-display invariant was closed at 251.5 MWh post-door-fix. Brief 30 was authorised to rebuild Dynamic but is paused pending a client deliverable cycle.

The client deliverable needs a Bridgewater pre-retrofit baseline plus CRREM trajectory. Static produces this today, post-door-fix, but with three known unresolved issues that affect the headline numbers (vent topology overstated 5×, C_d not geometry-aware, stack term missing) and one structural issue (integrand-vs-display invariant only enforced for State 1 Building, not across other states or modules).

Additionally, Brief 29 only audited Building. Internal Gains, Operation, Systems, Results, CRREM, Consumption, and the Intervention Model have not been audited with the same discipline. They may contain the same class of hidden-integrand-term bugs that Building had.

This brief: pauses Dynamic visibly and honestly; lands the queued Static fixes; runs the integrand-vs-display invariant across every Static path; audits every Static-side module against the Brief 29 method; documents Bridgewater's client-ready numbers with provenance.

When this brief closes, the tool's Static engine is the authoritative source for client-facing numbers, every displayed quantity is defensible from a one-page heat balance, and the Dynamic rebuild (Brief 30) can resume from a clean foundation.

---

## Principles — non-negotiable

These supplement CLAUDE.md's rules. If anything in this brief contradicts CLAUDE.md, CLAUDE.md wins.

1. **No code touches Dynamic-side paths.** `sql_parser.py`, `epjson_assembler.py`, and the simulation API endpoints stay frozen at HEAD. Brief 30 will rework them; do not preempt that work.
2. **Static fixes must be defensible from first principles before being landed.** Each fix has a hand calculation and a methodology reference in the commit message. No "tweak the constant until the number looks right."
3. **Every displayed number must close the integrand-vs-display invariant.** Σ terms entering the calculation = Σ terms displayed in the breakdown, across every view. Reconciliation rows in the UI must verify integrand-vs-display, not display-vs-display.
4. **Bridgewater is the test case.** Every Part has a Bridgewater verification step. Numbers move; the audit logs the movement with justification.
5. **No invented mechanisms.** Same rule as Brief 29 and 30: specifics with citation and magnitude, or silence.
6. **Documentation hygiene is part of the commit, not after it.** Per CLAUDE.md Process Rule 7. STATUS.md and `docs/audit/` updates land in the same commit as the code/finding, not as a queued follow-up.

---

## Parts

### Part 1 — Pause Dynamic visibly and honestly

**Goal:** Remove Dynamic-sourced numbers from the user-facing surface. Code stays. Pill, toggles, fabric-gap diagnostic, any Dynamic-derived display goes.

**Files touched:**
- `frontend/src/components/modules/balance/HeatBalance.jsx`
- `frontend/src/components/modules/balance/BuildingSummaryView.jsx` (or equivalent)
- Any other file where `EnginePill` appears with a Dynamic option
- `frontend/src/components/.../Sidebar.jsx` if there's a Dynamic-specific entry
- Any KPI or strip component that shows Dynamic numbers

**Steps:**

1.1 Find every place the `EnginePill` component is used. Grep for `EnginePill`, `engine === 'dynamic'`, `data.dynamic`, `useSimulationBalance`. List the locations.

1.2 For each location: either hide the Dynamic option from the pill (leaving Static as the only state) or remove the pill entirely if Static was the only meaningful option anyway. Default behaviour everywhere is Static.

1.3 Specifically remove from view:
- The POL-M1 "fabric gap" diagnostic in Summary (shows Static vs Dynamic delta). Pull the panel.
- Any "Dynamic" or "Simulation" tab/toggle in Heat Balance, Profiles, Monthly, Summary.
- Any Sankey, chart, or strip currently rendering Dynamic-derived numbers.

1.4 Add a single "Dynamic engine — under development" notice in an appropriate roadmap/about location (not on every screen). Wording:

> Dynamic engine (EnergyPlus-direct) is under reconstruction (Brief 30). Current displayed numbers are from the Static engine. The Dynamic engine will return in a future release with full per-element heat balance read directly from EnergyPlus outputs.

Place this in the Information module or a help/about overlay, not in any module's primary view.

1.5 Do **not** delete any backend code. `sql_parser.py`, `epjson_assembler.py`, the API endpoints, the diagnostic scripts — all stay. They're frozen, not deleted. Brief 30 resumes from this point later.

1.6 Run frontend build clean. `npm run build` returns zero errors. Browser-verify at 1440×900 that no Dynamic-derived number is visible anywhere a client could see it.

**Verification:**
- Grep returns no Dynamic-rendering paths in user-facing components (frozen backend code is allowed)
- Browser walkthrough: every module's primary screen shows Static numbers only
- Build clean
- The "under development" notice exists in exactly one location

**Commit:**
```
Brief 32 Part 1: Pause Dynamic engine in UI

Hide engine pill Dynamic option; remove POL-M1 fabric gap diagnostic;
default every view to Static. Backend Dynamic code (sql_parser.py,
epjson_assembler.py, simulation API) remains in place, frozen pending
Brief 30 resumption. Add single "under development" notice in Information
module.

No code changes to Dynamic-side backends. No changes to Static physics.
```

**STATUS.md update in same commit:** Add "Brief 32 Part 1 complete — Dynamic paused in UI" entry. Update "Current state" to note Static is sole engine surfaced. Update "Known issues" to remove anything referring to live Dynamic outputs.

---

### Part 2 — Fix permanent vent topology (Issue #2)

**Goal:** Add a `flow_mode` field to the operable_openings and permanent_vents data model; route each topology to the correct flow correlation; default Bridgewater to balanced-mechanical per its actual building topology.

**Files touched:**
- `frontend/src/utils/instantCalc.js` (the `_calculateEnvelopeOnly` permanent-vent block around line 957, and the `nv_heat_h_total` integrand around line 1337)
- Wherever the building config schema is defined (likely `frontend/src/data/buildingDefaults.js` or `ProjectContext.jsx`)
- The Building UI panel for Permanent Openings / Operable Openings
- `docs/audit/29_open_issues.md` (mark Issue #2 status)
- `docs/audit/29_permanent_vent_methodology.md` (verify the canonical methodology is followed)

**Methodology reference:** `docs/audit/29_permanent_vent_methodology.md`. Implement Step 0 (topology check) as a new code path.

**Steps:**

2.1 Add `flow_mode` field to the opening data model. Allowed values: `"cross"`, `"single_sided"`, `"balanced_mechanical"`. Default for existing openings on migration: see 2.4.

2.2 Implement the three flow correlations in Static:

- **Cross-flow:** wind-and-stack with combined ΔP between façades. Per the methodology doc Step 1 + Step 2.
- **Single-sided:** empirical `Q̇ ≈ 0.025 · A · v_wind` per BS EN 16798-7 §6.4.
- **Balanced mechanical:** flow rate = mechanical extract design rate (read from systems config); vent area only used to verify it's adequate to deliver makeup air without excessive pressure drop (target ΔP ≤ 10 Pa).

2.3 Refactor the existing wind-only permanent-vent block (around `instantCalc.js:957`) to dispatch on `flow_mode`. The pre-fix code is wind-only cross-flow with hard-coded C_d 0.6 — that becomes the "cross" branch with appropriate C_d (see Part 3 for C_d geometry awareness).

2.4 Migration defaults for existing buildings: if multiple openings exist on opposite façades, default to `"cross"`. If openings exist on only one façade, default to `"single_sided"`. **Bridgewater specifically:** override to `"balanced_mechanical"` based on its known cellular topology with continuous extract. Add this as a project-specific config setting if needed.

2.5 Add UI control in the Permanent Openings / Operable Openings panel: per-opening dropdown for `flow_mode` with the three options. Tooltip explains each.

2.6 Bridgewater verification:

- Pre-fix headline: vent loss 120.8 MWh (Case A — cross-flow with C_d 0.65 per methodology doc).
- Post-fix headline with `flow_mode: balanced_mechanical`: ~24 MWh per methodology doc Case C.
- Document the change in the commit message and in `29_open_issues.md`.

2.7 Hand-calc check: paste the three-case worked example from `29_permanent_vent_methodology.md` into a new file `docs/audit/32_vent_fix_verification.md`, with the actual post-fix engine output substituted in. Verify the engine matches Case C to within 20%.

**Verification:**
- Three flow_mode branches produce three different Bridgewater numbers; balanced_mechanical produces ~24 MWh
- Per-opening dropdown works in UI
- Hand-calc check file exists and reconciles
- Build clean
- Browser walkthrough: Building Heat Balance shows new vent loss number, Sankey reconciles, integrand-vs-display invariant still closes

**Commit:**
```
Brief 32 Part 2: Fix permanent vent topology (Issue #2)

Add flow_mode field to opening data model. Implement cross / single_sided /
balanced_mechanical correlations per docs/audit/29_permanent_vent_methodology.md.
Bridgewater defaults to balanced_mechanical: vent loss drops 120.8 → 24 MWh.

Methodology: CIBSE Guide A §4.6, BS EN 16798-7 §6.4, AIVC TN32.
Verification: docs/audit/32_vent_fix_verification.md.

Closes Brief 29 Issue #2.
```

**STATUS.md update in same commit:** Note Bridgewater headline movement (vent loss 120 → 24 MWh, expected heating demand will move proportionally in Part 6 once C_d and stack are also done).

---

### Part 3 — Make C_d geometry-aware (Issue #3)

**Goal:** Replace the hard-coded `C_d = 0.6` with a per-opening derivation based on geometry and resistance features.

**Files touched:**
- `frontend/src/utils/instantCalc.js`
- The opening data model
- The opening UI panel

**Steps:**

3.1 Extend the opening data model with:
- `width_mm`, `height_mm` (already may exist as dimensions)
- `type`: one of `"orifice"`, `"slot"`, `"louvre"`, `"trickle_vent"`, `"door"`, `"operable_window"`
- `internal_resistance`: array, subset of `["mesh", "flap", "acoustic_baffle"]`

3.2 Implement a C_d calculator function (call it `computeCd(opening)`):

- Base C_d from geometry (lookup table per `docs/audit/29_permanent_vent_methodology.md` Step 1):
  - Orifice (sharp edge): 0.61
  - Slot, aspect ratio interpolated: 0.61 (AR 1:1) → 0.58 (5:1) → 0.50 (10:1) → 0.42 (50:1) → 0.38 (100:1+)
  - Louvre (45° blades): 0.40
  - Trickle vent: base 0.42 then apply resistance multipliers
- Resistance multipliers:
  - Mesh: ×0.85
  - Flap: ×0.7
  - Acoustic baffle: ×0.6
  - Multiple resistances multiply together

3.3 In the UI panel, show the derived C_d as a read-only computed value. User can override with a manual value if needed (advanced users), but the default is the computed value. Show the inputs that determine it (type, dimensions, resistance features) inline.

3.4 Use the derived C_d in the flow calculations from Part 2. The hardcoded `0.6` goes away entirely.

3.5 Bridgewater verification:

- Trickle vents: 15 × 1300 mm slot, type `slot`, resistance `["mesh", "flap"]`.
- Derived C_d = 0.42 (AR 87:1) × 0.85 (mesh) × 0.7 (flap) = **0.25**.
- This affects Case A and Case B flow calculations. For Case C (balanced mechanical), C_d only affects the makeup-pressure check, not the headline flow rate.
- Document in `32_vent_fix_verification.md`.

**Verification:**
- C_d calculator produces 0.25 for Bridgewater trickle vents
- UI shows derived C_d, allows override
- Build clean
- Integrand-vs-display invariant still closes

**Commit:**
```
Brief 32 Part 3: Make C_d geometry-aware (Issue #3)

Replace hard-coded C_d=0.6 with computeCd(opening) function. Base C_d from
geometry (orifice/slot/louvre/trickle/door/window), resistance multipliers
for mesh/flap/baffle. Bridgewater trickle vents: 15×1300mm slot+mesh+flap
→ C_d = 0.25 (was 0.6 globally).

Methodology: CIBSE Guide A §4.6 Table 4.20, AIVC TN32.

Closes Brief 29 Issue #3.
```

**STATUS.md update in same commit.**

---

### Part 4 — Add stack term to permanent-vent flow (Issue #4)

**Goal:** Static currently calculates wind-only flow. Add the stack contribution and combine with wind per the methodology doc.

**Files touched:**
- `frontend/src/utils/instantCalc.js` — the flow calculation in the `"cross"` branch (Part 2's work)
- `docs/audit/29_open_issues.md`

**Steps:**

4.1 In the cross-flow branch from Part 2, replace the wind-only ΔP with combined wind+stack:

- ΔP_wind = 0.5 · ρ · C_p · v_wind² (per façade, with appropriate C_p)
- ΔP_stack = ρ · g · h · (T_in − T_out) / T_in (where h is vertical separation between high and low openings)
- ΔP_combined = √(ΔP_wind² + ΔP_stack²) when forces are orthogonal; sum when collinear

4.2 The stack term only contributes when there's a vertical separation between openings of meaningful magnitude (>25% of building height). Otherwise, stack ≈ 0 for that vent group.

4.3 For balanced_mechanical and single_sided branches: stack is implicitly handled in the empirical correlations; do not add a separate term.

4.4 Bridgewater verification: with vents all at roughly the same height per façade (above window heads), stack contribution is small. Cross-flow case would shift by perhaps 5–10%; balanced_mechanical case unchanged. Document.

**Verification:**
- Stack term present in cross-flow branch
- Bridgewater cross-flow case differs from Part 2's value by stack contribution
- Build clean
- Integrand-vs-display invariant still closes

**Commit:**
```
Brief 32 Part 4: Add stack term to permanent-vent flow (Issue #4)

Cross-flow branch now combines wind ΔP with stack ΔP per CIBSE Guide A §4.6.
Bridgewater (balanced_mechanical) unaffected; documented in verification doc.

Closes Brief 29 Issue #4.
```

**STATUS.md update in same commit.**

---

### Part 5 — Integrand-vs-display invariant across all Static modules

**Goal:** The check that closed for Building State 1 Static at 251.5 MWh — same check, all states, all modules, all displays. Failures land as findings in `29_open_issues.md`.

**Files touched:**
- `frontend/src/utils/instantCalc.js` (every `_calculateState*` and related aggregators)
- Every module's display layer (Heat Balance, Sankey, Stacked, Summary, Monthly, Profiles) for Building / Internal Gains / Operation / Systems / Results
- Whichever component currently hosts the existing reconciliation row (post-Brief 29 cleanup)
- `docs/audit/32_invariant_findings.md` (new)

**Steps:**

5.1 For each State (1, 2, 2.5, 3) and each affected module, walk the three-lists method:

- List every term that contributes to the integrand
- List every key written to the aggregate (`losses_at_setpoint`, `gains_at_setpoint`, `demand_*`, etc.)
- List every key iterated by the display layer

5.2 Build the matrix. Identify mismatches. Each mismatch is a finding logged in `32_invariant_findings.md`.

5.3 For each mismatch where the fix is small (display layer iteration update, missing key in aggregate), fix in place. Document the fix.

5.4 For each mismatch where the fix is structural (significant refactor needed), log as a new issue in `29_open_issues.md` (continue the numbering — Issue #14, #15, etc.), defer to a future brief, but ensure the term is at least visible in the integrand-vs-display reconciliation row even if not in the main display.

5.5 Add a single shared `verifyInvariant(state, module, integrandTerms, displayTerms)` helper in instantCalc.js (or a new utility file) that asserts integrand sum = display sum within 1%. Wire it into every result-return path. Failure logs loudly to console with the specific mismatch.

5.6 Update the existing reconciliation row component to call `verifyInvariant` for the current view. Display the result — ✓ closed at X MWh, or ✗ delta of Y MWh.

5.7 Bridgewater verification: for every state and module, the invariant closes. Snapshot the closure values in `32_invariant_findings.md`.

**Verification:**
- `32_invariant_findings.md` exists with the full matrix
- Every state/module/Static pair shows the invariant closing (or a numbered new issue logged)
- Bridgewater displays show ✓ reconciliation rows
- Build clean

**Commit:**
```
Brief 32 Part 5: Integrand-vs-display invariant across all Static modules

Walk three-lists method (integrand / aggregate / display iteration) for
every State × module. Findings in docs/audit/32_invariant_findings.md.
Small fixes in place; structural mismatches logged as Issues #14+ in
29_open_issues.md for future briefs.

Shared verifyInvariant() helper enforces Σ_integrand = Σ_display ±1%
at every result-return path; failures log loudly.

Implements Brief 29 Issue #6 systemically (was previously closed only for
Building State 1).
```

**STATUS.md update in same commit.**

---

### Part 6 — Audit pass on every Static-side module

**Goal:** Brief 29 audited Building only. This Part runs the same audit method on every other module that ships a number to the user, Static-side only.

**Files touched:** read-only across the codebase. Audit document creation.

**Modules to audit:**
- Internal Gains (State 2 Static)
- Operation (State 2.5 Static — operable openings)
- Systems (State 3 Static — HVAC, ventilation, DHW, lighting, small power)
- Results / Scenarios (aggregation layer)
- CRREM (trajectory, EUI, carbon)
- Consumption (modelled-vs-actual comparison)
- Intervention Model (baseline-vs-scenario diffing)

**For each module, produce a section in `docs/audit/32_static_audit_FINDINGS.md`** using the Brief 29 template:

- Heat balance / energy balance on this module (state the physics)
- Code traversal: every term in the integrand with file:line
- Display traversal: every term in the display with view names
- Reconciliation: Σ integrand vs Σ display, with delta if any
- Defended numbers (Bridgewater) — each headline with derivation
- Open issues found (number continuing from 29_open_issues.md)
- Cross-state consistency check where applicable

**Steps:**

6.1 Walk each module in order (Internal Gains first, then Operation, then Systems, then Results, then CRREM, then Consumption, then Intervention Model).

6.2 For each, complete the audit template. Bridgewater is the test case.

6.3 If a module surfaces fixable bugs of the same shape as the Building issues (hidden integrand terms, display ghosts, wrong-magnitude defaults), fix them in place in Part 6's same commit and log in the issues file.

6.4 If a module surfaces structural issues (e.g. Intervention Model baseline-vs-scenario diffing might inherit problems from Dynamic that we don't see today because Dynamic is paused — but might still affect Static-only IM use), log as new issues and defer to future briefs.

6.5 At the end of Part 6, produce a "Bridgewater client-ready numbers" section in `32_static_audit_FINDINGS.md`:

- Heating demand (Static, post-all-fixes)
- Cooling demand
- Annual mean T_zone (Static 2-node model)
- Summer max T_zone
- Winter min T_zone
- EUI
- Site energy by fuel
- CRREM trajectory: stranding year for 1.5°C and 2°C pathways
- Each with provenance (which engine, which formula, which inputs)

**Verification:**
- Every module has a template-conforming section in the findings doc
- Bridgewater client-ready numbers present with provenance
- New issues logged with severity
- Build clean (no code changes expected in audit, but if Part 6.3 fixes are made, build must pass)

**Commit (or commits — one per module is fine if scope warrants):**
```
Brief 32 Part 6: Static audit across modules

Audit-only sweep of Internal Gains, Operation, Systems, Results, CRREM,
Consumption, Intervention Model — Static side only. Findings document
template per Brief 29. Bridgewater client-ready numbers documented with
full provenance.

New issues logged as #14+ in 29_open_issues.md.
```

**STATUS.md update in same commit:** Final "Bridgewater client-ready" section showing the headline numbers and their provenance.

---

### Part 7 — Final review and client-ready snapshot

**Goal:** Produce a single document that summarises the current shippable state of the tool, suitable for showing the client or for forming the basis of a written report.

**Files touched:**
- `docs/client_ready/bridgewater_baseline_2026-05.md` (new)
- STATUS.md (close-out)

**Steps:**

7.1 Author `docs/client_ready/bridgewater_baseline_2026-05.md`:

- One-paragraph executive summary of the building
- Heat balance summary table (Σ losses by element, Σ gains by element, net)
- Headline numbers with provenance
- Methodology notes: every formula used, every standard cited (CIBSE Guide A, BS EN 16798, ASHRAE Guideline 14, CRREM V2.07, etc.)
- Explicit assumptions list: vent topology = balanced mechanical; C_d derived from slot geometry; q50 from air test; weather file source; occupancy schedule source; etc.
- CRREM trajectory output
- Known limitations: Dynamic engine paused, single-zone hotel_bedroom assumption, etc.

7.2 Final STATUS.md update: Brief 32 closed; Bridgewater client-ready; Brief 30 (Dynamic rebuild) queued for resumption when next development cycle starts.

7.3 Single push to origin/main. Verify origin == local.

**Verification:**
- Client-ready doc exists and is readable as a standalone deliverable
- STATUS.md reflects close
- Push verified

**Commit:**
```
Brief 32 close: Static engine client-ready for Bridgewater baseline

Bridgewater pre-retrofit baseline documented in
docs/client_ready/bridgewater_baseline_2026-05.md with full provenance.
Static engine is sole authoritative engine for displayed numbers.
Dynamic rebuild (Brief 30) queued for next development cycle.
```

---

## Final report (paste in chat after Part 7)

1. New origin/main HEAD SHA
2. Bridgewater headline numbers, post-all-fixes:
   - Heating demand (Static)
   - Cooling demand
   - Annual mean T_zone
   - Summer max T_zone
   - Winter min T_zone
   - EUI
   - CRREM stranding year (1.5°C, 2°C pathways)
3. Movement of each headline number from pre-fix to post-fix, with reason:
   - Heating demand: was 194.3 MWh post-door-fix; now ___ MWh because vent loss dropped from 120.8 to ~24 MWh and ___
   - Etc.
4. Confirmation that every state × module integrand-vs-display invariant closes (or list any that don't, with reason)
5. New issues logged in `29_open_issues.md` (numbers and one-line summaries)
6. Path to the client-ready document
7. Confirmation that Dynamic engine is invisible in user-facing UI

---

## When to escalate

- If Part 2's balanced_mechanical Bridgewater output is significantly different from the methodology doc's ~24 MWh (e.g. <10 MWh or >50 MWh) and the discrepancy cannot be explained by a citable mechanism
- If Part 5's invariant fails to close on a module and the fix is non-trivial — defer to a new issue, do not invent reconciliation
- If Part 6 surfaces a structural issue in Intervention Model or CRREM that means Bridgewater's CRREM trajectory cannot be defended
- If at any point Static produces a number that violates basic building physics — pause and escalate per Brief 29's discipline
- If documentation hygiene starts slipping (per CLAUDE.md Process Rule 7) — flag and reset

## What MUST NOT happen in this brief

- No touches to `sql_parser.py` or `epjson_assembler.py`
- No touches to the simulation API endpoints
- No new modules
- No calibration of Static to any external target
- No deletion of paused Dynamic code (just UI hide)
- No invented mechanisms to defend numbers
- No commit that closes work without updating STATUS.md and (where applicable) `29_open_issues.md`

---

## Standing by for authorisation to begin Part 1.
