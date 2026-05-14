# Brief 28b — Physics Overhaul

**Scope:** Solar model upgrade (isotropic → HDKR/Perez) and Static engine thermal mass model overhaul (lumped two-node → multi-layer CTF or equivalent).

**Estimated time:** 3 weeks.

**Dependencies:** Brief 28a complete. Brief 28 prereq's findings reviewed.

---

## CRITICAL PREAMBLE — Read before any work

The physics audit (`docs/physics_audit_2026_05.md`) invalidated several assumptions from the original Brief 28 scope:

- The "23.5% conduction divergence" was an artefact of HVAC-clamped vs free-running comparison. Brief 28 prereq has now addressed the comparison methodology. The new divergence picture in `docs/state_1_engine_divergence_investigation.md` (as updated by the prereq) is the current source of truth.

- The "38% solar over-count" was overstated by ~10×. Real per-facade deviation is +19% NNE / −10% SSW, aggregate +1%. The HDKR/Perez fix is still warranted but smaller in impact than originally believed.

- The dominant cause of Static's summer max divergence appears to be the lumped two-node mass model, not the sky model. This is the substantive physics work in this brief.

**Before starting work, re-read the prereq's findings and confirm Brief 28b's premise still holds.** If the prereq found something different — e.g., the engines actually agree well now, or a different physics issue is dominant — halt under HH4 before any code work and report.

**Halt liberally in this brief.** Physics re-architecture is high-stakes. If a finding suggests the multi-layer CTF approach is wrong, or another physics fix should come first, halt and flag. The intent is not to "complete Brief 28b at all costs" — it is to do the right physics work.

---

## Reading list (read before starting)

1. `docs/physics_audit_2026_05.md` — especially audits 1, 3, 4, and recommendations
2. `docs/state_1_engine_divergence_investigation.md` (updated by prereq)
3. Brief 28 prereq's progress notes and findings
4. `docs/state_contracts.md`
5. `frontend/src/utils/instantCalc.js` (especially the thermal mass model code from Brief 26.1)
6. EnergyPlus engineering reference on CTF (Conduction Transfer Functions) and Perez/HDKR sky models (open-source documentation)

---

## Part 0 — Re-validate the brief's premise

**Files:** Read-only.

**Goal:** Before any code, confirm Brief 28b is still the right work.

**Steps:**

1. Read the prereq's updated divergence picture.
2. Read the physics audit's findings.
3. Answer these questions in a short document (`docs/brief_28b_premise_check.md`):
   - Is the multi-layer CTF mass model still the dominant fix needed for Static engine divergence?
   - Is the HDKR/Perez solar model fix still warranted?
   - Are there other physics issues that should take priority over these?
   - What's the expected magnitude of improvement if both fixes land?
4. If the answers point to "proceed as planned," continue.
5. If the answers point to "different physics work needed," halt under HH4 and write a halt report.
6. If the answers are ambiguous, document the uncertainty and proceed conservatively (smaller scope, more validation).

**Verify:**
- Premise check document written
- Decision (proceed / halt / proceed-with-reduced-scope) is explicit

**Commit message:** "Brief 28b Part 0: Premise re-validation"

---

## Part 1 — State contract update (v2.5 if needed)

**Files:** `docs/state_contracts.md`

**Goal:** If Brief 28b changes the physics in ways that affect contract behaviour, update the contract first.

**Steps:**

1. Review whether the multi-layer CTF mass model changes:
   - State 1 output shape (probably not — same metrics, different internal calculation)
   - Engine agreement expectations (likely improvements)
   - BREDEM expected ranges (almost certainly — better Static accuracy means tighter ranges)
2. Review whether the HDKR/Perez solar model changes:
   - State 1 output shape (no)
   - Per-orientation solar values (yes, especially NNE / SSW)
3. Update the contract to v2.5 if needed:
   - Note the physics model upgrades
   - Update expected engine agreement tiers if appropriate
   - Update BREDEM expected ranges based on Part 0's expected magnitude of improvement

If no contract changes are needed (the physics affects internal calculation but not contract-level behaviour), skip this part and document why.

**Verify:**
- Contract reflects physics changes if any are contract-relevant
- BREDEM expected ranges updated (or unchanged with rationale)

**Commit message:** "Brief 28b Part 1: Contract v2.5 — physics model upgrades"

---

## Part 2 — Solar model upgrade

**Files:** `frontend/src/utils/instantCalc.js` (solar model section), possibly `nza_engine/...` if Dynamic engine needs adjusting

**Goal:** Replace isotropic sky model in Static engine with HDKR (Hay-Davies-Klucher-Reindl) or Perez. HDKR is simpler and probably sufficient; Perez is more accurate but more complex.

**Steps:**

1. Decide HDKR vs Perez:
   - HDKR: simpler, captures circumsolar component, well-documented
   - Perez: more accurate especially for clear-sky conditions, more complex
   - My lean: HDKR. The audit found aggregate solar deviation was only +1% — improving this by half would be diminishing returns. HDKR is enough.
   - Document the decision.
2. Implement HDKR (or chosen model) in `instantCalc.js`:
   - Hourly direct + diffuse from EPW
   - Anisotropic transposition by orientation
   - Replace existing isotropic calculation
3. Verify on Bridgewater:
   - Per-orientation solar comparison: Static (new) vs Dynamic — should be much closer than before
   - Aggregate annual solar — should land within ±5% of Dynamic
4. Update divergence investigation doc with the new solar comparison.

**Verify:**
- HDKR (or Perez) implemented and tested
- Per-orientation solar deviation reduces significantly
- Aggregate solar within ±5% of Dynamic
- State 1 isolation regression still byte-identical (this changes a calculation but shouldn't change the regression's structure)
- BREDEM expected ranges met (or contract updated to reflect new ranges)

**Commit message:** "Brief 28b Part 2: Solar model upgrade (HDKR/Perez)"

**Decision points:**
- HDKR vs Perez: see above, default HDKR.
- Whether to keep isotropic as a comparison mode: probably not — adds complexity without clear benefit. Just replace.

**Halt triggers:**
- Per-orientation solar after the upgrade is still wildly off (>20%) from Dynamic → HH4. Premise wrong somehow.
- Implementation introduces non-determinism or instability → HH6.

---

## Part 3 — Multi-layer CTF mass model

**Files:** `frontend/src/utils/instantCalc.js` (thermal mass model section)

**Goal:** Replace the lumped two-node capacitance model with a multi-layer Conduction Transfer Function (CTF) approach, matching EnergyPlus's algorithm where reasonable.

**Steps:**

1. Read the existing two-node model code. Understand exactly what it does and where its limitations lie.
2. Decide implementation approach:
   - **Option A: Full CTF.** Implement matrix exponential method or RC-network approximation per layer. Most accurate, most complex.
   - **Option B: Multi-node simplified.** N nodes (e.g., 4-5) per construction with explicit time integration. Less accurate than CTF but better than two-node.
   - **Option C: Phase-matched lumped.** Stay lumped but tune coefficients to match EnergyPlus's effective thermal mass for typical constructions. Easiest, less generalisable.
   - My lean: **Option B**. CTF is genuinely complex; phase-matched lumped is a hack. Multi-node simplified is a reasonable middle ground that's debuggable.
   - Document the decision with rationale.
3. Implement the chosen approach:
   - For each construction in the building, decompose into layers
   - Assign nodes per layer (each layer gets at least one node; thick layers get more)
   - Compute the heat balance at each node hourly
   - Surface temperatures used for the convective coupling
4. Calibrate against EnergyPlus reference:
   - Run a single-zone test case in both engines
   - Compare hourly interior surface temperatures
   - Compare hourly heat flux through the construction
   - Compare annual indoor T trace
5. Update Bridgewater's results:
   - Run Static with new mass model
   - Compare summer max, winter min, annual mean to Dynamic free-running output
   - Update divergence investigation doc

**Verify:**
- Multi-node mass model implemented
- Hourly interior surface temperatures match EP within ±2°C for a test construction
- Bridgewater summer max divergence reduces materially (target: from ~14°C divergence to <5°C)
- Annual mean indoor T agrees within ±2°C
- BREDEM expected ranges met
- State 1 isolation regression still byte-identical (the calculation changes; the regression should still pass byte-identically because forbidden inputs still don't reach the calculation)

**Commit message:** "Brief 28b Part 3: Multi-layer thermal mass model"

**Decision points:**
- Implementation approach (A/B/C): see above, default B.
- Number of nodes per layer: starting point 1 node per layer with 2 nodes for thick (>100mm) layers. Adjust if validation reveals issues.

**Halt triggers:**
- The mass model implementation reveals issues with how thermal properties are stored (constructions library inconsistencies) → SH2 / HH3 depending on severity.
- After implementation, summer max divergence with Dynamic *increases* → HH4. Something's wrong with the model.
- Multi-node implementation produces numerical instability (oscillations, blow-up) → HH6.

---

## Part 4 — Validate against multiple constructions and weather conditions

**Files:** Test scripts, possibly multiple test buildings

**Goal:** Make sure the new mass model works generally, not just for Bridgewater.

**Steps:**

1. Build a small test matrix:
   - Lightweight construction (steel frame, thin insulation) — common UK office
   - Medium construction (Bridgewater — cavity wall PIR)
   - Heavyweight construction (solid masonry, thermal mass throughout)
2. For each, run Static (new model) vs Dynamic free-running:
   - Summer hot week (high mass should damp peak T more than light mass)
   - Winter cold week (high mass should slow cool-down overnight)
3. Verify the new mass model captures the qualitative differences correctly.
4. Document results in `docs/state_1_mass_model_validation.md`.

If any construction type produces poor agreement, document and decide:
- Is it within acceptable bounds?
- Does the model need refinement?
- Is it a constructions library data issue (wrong density, c_p, λ)?

**Verify:**
- Three construction types tested
- Qualitative behaviour correct (heavier mass → smaller swings)
- Quantitative agreement with Dynamic within stated tolerances
- Validation doc written

**Commit message:** "Brief 28b Part 4: Mass model multi-construction validation"

---

## Part 5 — Engine agreement re-baselining

**Files:** `docs/state_1_divergences.md`, `scripts/state1_engine_agreement.mjs` if needed

**Goal:** With the new solar and mass models, re-run the full engine agreement assessment.

**Steps:**

1. Re-run engine_agreement script on Bridgewater (and ideally the test buildings from Part 4).
2. Update divergence catalogue:
   - Mark previously-documented divergences as resolved where they are
   - Record any new divergences that emerge from the model upgrades
   - Update expected magnitudes
3. Update `docs/state_1_expected_ranges.md` and `docs/state_2_expected_ranges.md` to reflect new physics:
   - Tighter ranges where engines now agree better
   - Same ranges where physics improvements don't affect a particular metric
4. Update the State 1 contract's engine agreement tier definitions if needed.

**Verify:**
- Engine agreement on Bridgewater significantly improved
- Divergence catalogue current
- Expected ranges current
- BREDEM ranges met on Bridgewater for both engines

**Commit message:** "Brief 28b Part 5: Engine agreement re-baselining post physics overhaul"

---

## Part 6 — Completion checklist + close-out

**Files:** `docs/module_checklists/state_1_physics_brief_28b.md`, STATUS.md, archive

**Steps:**

1. Fill in completion checklist for Brief 28b:
   - Physics changes documented
   - Validation results recorded
   - Confidence rating /10
2. Update STATUS.md with what shipped.
3. Archive `docs/briefs/active/28b_physics_overhaul.md` → `docs/briefs/archive/28b_physics_overhaul_COMPLETED.md`.
4. Update `current.md` to point at Brief 29.

**Verify:**
- Completion checklist filled in
- STATUS.md current
- Archive done

**Commit message:** "Brief 28b Part 6: Close-out + completion checklist"

---

## Close-out

After all parts complete:

1. Full regression suite green.
2. Pre-flight checks pass for Brief 29.
3. Proceed to Brief 29 without pause.

**Confidence target:** 8/10 (physics work has inherent uncertainty; 8/10 is honest given the scoping-blind concern flagged at brief authoring).

**Halt triggers specific to this brief:** Re-read the preamble. Halt liberally. Better to halt and reassess than complete physics that doesn't address the real problem.
