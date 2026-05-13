# NZA-Sim Module Completion Checklist

**Status:** Canonical. Every brief that builds or substantially modifies a module must complete this checklist before close-out. "Tests pass" alone is no longer sufficient.

**Owner:** Chris.

**Background:** Brief 26 closed with all automated tests passing, but visual inspection of the running tool revealed four substantial issues that the tests had missed. Brief 26.1 was then needed to address them. This checklist exists to prevent recurrence — to ensure modules are genuinely complete, not just test-complete.

---

## Purpose

A module is complete when:
- Its data model conforms to the state contract
- Its calculations produce numbers within physically-derived expected ranges
- Its UI follows established layout principles and conventions
- Its inputs and outputs are honest about what they represent
- Its state isolation is enforced byte-identically
- A real user can walk through it on a real building configuration and find nothing broken, missing, or confusing

This checklist captures all of those. Every brief close-out fills it in. Any failed item blocks close-out until addressed.

---

## How to use this checklist

1. At brief close-out, fill in each section below for the module(s) the brief affected
2. For each item: mark ✓ (passes), ✗ (fails), or N/A (legitimately doesn't apply) with explanation
3. Any ✗ either gets fixed before close-out, or gets explicitly queued as a follow-up brief with the rationale documented
4. The completed checklist is committed alongside the brief as `docs/module_checklists/{module_name}_{brief_id}.md`
5. STATUS.md references the completed checklist in the brief close-out summary

---

## Section A: Data model

| Item | Status | Notes |
|------|--------|-------|
| All inputs from the state contract are represented in `building_config` (or relevant config blob) | | |
| Schema migrations from any previous state run cleanly on production-like data (Bridgewater minimum) | | |
| Migrations are idempotent — running twice produces the same result as running once | | |
| Existing user values preserved during migration (defaults only fill genuine gaps) | | |
| Provenance fields populated per the v2.1+ contract specification | | |
| No fields lost or corrupted compared to the previous schema | | |
| Backward compatibility maintained for any field still referenced by other parts of the system | | |

---

## Section B: Live engine

| Item | Status | Notes |
|------|--------|-------|
| `withMode(building, mode)` filter includes exactly the inputs the state contract specifies | | |
| Setting forbidden inputs to absurd values produces byte-identical State N output (regression script passes) | | |
| Output shape matches the state contract exactly (no extra fields, no missing fields) | | |
| Calculation honours the state contract's mathematical specification | | |
| Backward compatibility: calling without `{ mode }` option produces the same result as before this brief | | |
| Engine produces results for a representative production-like config (Bridgewater) | | |

---

## Section C: EnergyPlus engine

| Item | Status | Notes |
|------|--------|-------|
| `assemble_epjson(..., mode='state-name')` emits exactly the objects the state contract requires | | |
| Suppresses objects forbidden by the state (no operable window airflow in State 1, no real systems in State 2, etc.) | | |
| Schedules emitted correctly with any new mechanisms (e.g., exception periods, derived schedules) | | |
| Simulation runs without fatal errors on Bridgewater | | |
| SQL parser correctly extracts the state's output for `mode` parameter | | |
| Output shape matches live engine's output shape (parity verified) | | |

---

## Section D: Engine agreement

| Item | Status | Notes |
|------|--------|-------|
| Live and EP outputs compared via the state's `engine_agreement` script | | |
| Headline contract-significant metrics (heating demand, etc.) within ±5% silent tolerance | | |
| Any divergence > 10% documented in `state_N_divergences.md` with root cause | | |
| Engine disagreement flag UI behaves per the contract's three-tier system | | |
| Disclosure visible to user when one engine is canonical for a specific metric and the other isn't | | |

---

## Section E: BREDEM expected ranges

| Item | Status | Notes |
|------|--------|-------|
| Expected ranges for Bridgewater derived analytically in the brief's Part 0 | | |
| Each range has a stated assumption (sources for densities, efficiencies, etc.) | | |
| Live engine outputs land within the expected ranges | | |
| EP engine outputs land within the expected ranges | | |
| Any range miss is investigated (the direction of the miss diagnoses what to look for) | | |
| Out-of-range results are not silently accepted | | |

---

## Section F: State isolation

| Item | Status | Notes |
|------|--------|-------|
| `FORBIDDEN_*_INPUTS` list updated with this state's forbidden inputs | | |
| Live engine isolation regression script tests all forbidden inputs with absurd values | | |
| EP path isolation regression tests all forbidden inputs via end-to-end simulation | | |
| Regression iterates the forbidden list programmatically (not hand-listed) | | |
| Regression asserts minimum list length (defense against silent reformat breakage) | | |
| All scenarios produce byte-identical output | | |
| Previous states' isolation regressions still pass (no regression in lower-state work) | | |

---

## Section G: UI principles conformance

Reference: `docs/ui_principles.md`

| Item | Status | Notes |
|------|--------|-------|
| Card widths match content, not container — no cards stretched to fill horizontal space unnecessarily | | |
| Related items grouped in single cards (not spread across the screen) | | |
| Centre canvas content respects the ~1000px max width unless content earns full width | | |
| Section bounding boxes used consistently around grouped inputs | | |
| Vertical stacking is the default; horizontal layouts only where data is genuinely parallel | | |
| Tab strips for multi-view canvases use established pattern | | |
| Engine toggle (Live / Simulation) placed near the data it controls | | |

---

## Section H: Visual coherence

| Item | Status | Notes |
|------|--------|-------|
| Colour theming consistent (gain colours threaded through inputs, charts, balance flows) | | |
| No mystery numbers — every displayed value has a clear definition (tooltip, label, or context) | | |
| Disclosure visible for known limitations (e.g., engine disagreement caveats, model simplifications) | | |
| Loading states handle gracefully (no flicker, no jump) | | |
| Empty states (no data, fresh project) render sensibly | | |

---

## Section I: Hard-coded values audit

Reference: `docs/hardcoded_constants_audit.md` (if exists)

| Item | Status | Notes |
|------|--------|-------|
| No magic numbers in calculation code that should be inputs or library entries | | |
| Physics constants documented with reference value and source | | |
| Algorithm parameters (tolerances, iteration limits) documented with rationale | | |
| Configurable defaults exposed as user inputs or library entries, not hard-coded | | |
| Any new constants introduced by this brief reviewed against this principle | | |

---

## Section J: Walkthrough on production-like config

Test scenario: open the app, load Bridgewater, walk through every panel and tab of the module(s) this brief affected. Touch every input. Watch every output. Use the engine toggle. Save, reload, verify persistence. Set absurd values in unrelated modules and verify isolation.

| Item | Status | Notes |
|------|--------|-------|
| Walkthrough completed on Bridgewater (or other equivalent production config) | | |
| Every input touched and verified responsive | | |
| Every tab visited and verified renders | | |
| Engine toggle used; both engines produce results | | |
| Save and reload — all values preserved | | |
| Console clean of red errors throughout | | |
| Cross-module isolation tested visually (set forbidden values elsewhere, return to module, verify unchanged) | | |
| Bridgewater results within state's expected ranges | | |

---

## Section K: Documentation and close-out

| Item | Status | Notes |
|------|--------|-------|
| State contract updated to current version if any contract details changed | | |
| `state_N_divergences.md` updated with any new limitations | | |
| `state_N_expected_ranges.md` updated if expected ranges refined | | |
| Brief archived to `docs/briefs/archive/` with COMPLETED suffix | | |
| `current.md` points at the next brief | | |
| STATUS.md updated with deliverables (not just "Brief X complete" — actual outcomes) | | |
| This checklist filled in and committed | | |

---

## Section L: Known gaps and follow-ups

For each ✗ that's been deferred rather than fixed:

| Item | Deferred to | Rationale |
|------|------------|-----------|
| | | |
| | | |

Anything in this table must be queued explicitly in STATUS.md, not just noted here.

---

## Section M: Brief-specific items

(Add any additional verification items specific to this brief that don't fit the standard sections above.)

| Item | Status | Notes |
|------|--------|-------|
| | | |

---

## Sign-off

**Module(s) covered:** _______________

**Brief:** _______________

**Bridgewater verification numbers (key contract-significant outputs):**

| Metric | Live | EP | Expected range | Status |
|--------|------|----|--------------- |--------|
| Heating demand | | | | |
| Cooling demand | | | | |
| Overheating hours | | | | |
| Underheating hours | | | | |
| (other state-specific metrics) | | | | |

**Date completed:** _______________

**Issues that remain (queued as follow-up briefs):**

1. ...
2. ...

**Confidence that the module is genuinely complete (not just test-complete):** ___/10

If less than 8/10, document why and what would raise it.
