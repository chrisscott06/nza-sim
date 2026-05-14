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

### Part 3 ship log

- **Part 3 v1 (commit `1d6fc79`, 2026-05-14):** multi-node implicit RC model + sol-air boundary + distributed glazing solar + zone-air internal mass. Summer max gap 8.8 K → 1.3 K. Net pass count 14/21 → 10/21 (4 loss-side rows regressed because zone T mean dropped below EP's).
- **Part 3 v2 (this commit, 2026-05-14):** tuning values from response-surface sweep — `solar_radiative_fraction = 0.30`, `internal_mass_kJ_per_K_per_m2 = 100`. Summer max gap 1.3 K → 0.1 K (essentially exact). Same pass count (10/21), but PASS magnitudes improved across the board (heating demand within ±10%, all temperature trace within ±10%).

Response surface evidence: `docs/validation/state1_part3_response_surface_2026_05.md`.
Canonical baseline: `docs/validation/bridgewater_state1_engine_outputs_2026_05_post_part3_v2.md`.

---

## Part 3 v3 — Glazing inside-surface solar absorption (immediate follow-up)

**Files:** `frontend/src/utils/instantCalc.js::_calculateEnvelopeOnly`, `frontend/src/utils/wallModel.js` (possibly), engine output schema (if needed).

**Goal:** Close the persistent **1.7 K mean-T undershoot** (Static 18.1 °C vs EP 19.8 °C) that the Part 3 v2 tuning sweep proved cannot be closed by the three existing knobs.

**Hypothesis:** EnergyPlus's glazing model absorbs ~5-10% of incident solar AT the inside glazing surface (it's not all transmitted to interior). The absorbed energy heats the glazing inside surface, which convects directly to T_air with no transit loss through wall mass. My current model transmits 100% to interior surfaces — missing this air-side heating term.

**Implementation:**

1. Add a `glazing_inside_absorption_fraction` parameter (default ~0.07 — typical for double-low-e per ASHRAE Handbook Fundamentals Ch 15).
2. Modify `_calculateEnvelopeOnly`:
   - Total incident on glazing per facade = `hourlySolar.f<n>[h] × glazing.<face>` (already computed).
   - **New term:** `Q_solar_absorbed_at_glazing_inside = sum_facades(incident × glazing_inside_absorption_fraction × (1 − frame_fraction))`.
   - Add `Q_solar_absorbed_at_glazing_inside` directly to the zone air balance D_coef (alongside the existing convective fraction of transmitted solar).
   - **Reduce transmitted solar accordingly:** `Q_solar_glaz_zone = sum_facades(incident × g_value × (1 − frame_fraction) × shading) × (1 − absorption_fraction)`.
   - Keep the 30/70 radiative/convective split applied to the transmitted fraction.
3. Re-run the response surface (or at least a focused sweep on `absorption_fraction = [0.03, 0.05, 0.07, 0.10, 0.15]`) to confirm monotonic mean-T response.
4. Pick the value that best matches EP's mean T (target ±0.5 K).
5. Re-run Static vs Dynamic on Bridgewater. Document.

**Verify:**

- Monotonic response of mean T with absorption fraction.
- Best-match value brings mean T within ±0.5 K of EP.
- Summer max stays within ±1 K of EP (Part 3 v2 win not regressed).
- Cooling demand gap reduces meaningfully (target: from −35% to within ±15%).
- Loss-side rows (ext_wall, glazing, fabric_leakage) move toward EP (less under-prediction because Static now warms toward EP's mean).
- Aggregate pass count improves from 10/21 toward 15+/21.

**Commit message:** "Brief 28b Part 3 v3: glazing inside-surface solar absorption"

**Halt triggers:**

- Absorption fraction sweep is non-monotonic → SH2 (model bug).
- Best-match value gives mean T match but summer max regresses materially → HH4 (the win on summer max is the headline; don't trade it away).
- Absorption fraction needed to close mean T exceeds 15% (physically implausible for double-low-e) → SH2 (model lacks another physics element).

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

## Part 5 — Construction-stack-aware mass derivation

**Files:** `frontend/src/utils/wallModel.js`, `frontend/src/utils/thermalMass.js` (or a sibling), `frontend/src/utils/instantCalc.js`

**Goal:** Remove the **per-building manual tuning** of `internal_mass_kJ_per_K_per_m2`. Currently a fixed default (100 kJ/(K·m²)) calibrated to Bridgewater. Compute it from the library construction stack using CIBSE thermal admittance (Y-value) or ASHRAE response factors so the engine generalises across building types without per-project tuning.

**Background:** The Part 3 response-surface sweep proved internal mass is a real lever, but the optimal value is construction-stack-dependent:
- Lightweight (steel frame, partition-walled office): ~30-50 kJ/(K·m²)
- Medium (cavity wall with masonry inner leaf, like Bridgewater): ~100 kJ/(K·m²)
- Heavyweight (concrete frame, exposed concrete slabs): ~200+ kJ/(K·m²)

A fixed default mis-predicts for non-Bridgewater buildings.

**Steps:**

1. Read CIBSE Guide A § thermal admittance method:
   - Each construction layer has a Y-value (admittance, W/m²K at 24h period)
   - Y-values can be combined into a whole-construction Y
   - Sum across inside surface areas gives whole-building effective dynamic mass
2. Decide between CIBSE Y-method vs ASHRAE response factor method (latter more accurate, more complex). Default: CIBSE Y.
3. Implement `deriveInternalMass(constructions, libraryData, geo)` in `thermalMass.js` (extend the existing `resolveCmass` or add a new helper).
4. Replace the hardcoded 100 kJ/(K·m²) default in `_calculateEnvelopeOnly` with a call to the derived value. Keep the override path for tuning experiments.
5. Validate on the three Part 4 test cases (lightweight cube, medium cube, heavy cube). Each should now produce summer max ±1 K of EP without manual tuning.
6. Re-run Bridgewater to confirm the derived value lands near 100 kJ/(K·m²) (the empirically-tuned best fit).

**Verify:**

- Derived internal mass values are reasonable across the three test cases:
  - Lightweight: 20-60 kJ/(K·m²)
  - Medium (Bridgewater): 80-120 kJ/(K·m²) — must match Part 3 v2 tuning within ~20%
  - Heavyweight: 150-300 kJ/(K·m²)
- Summer max prediction stays within ±1 K of EP across all three after switching to derived mass.
- No per-building tuning required for typical UK construction types.

**Commit message:** "Brief 28b Part 5: Construction-stack-aware internal mass derivation"

**Halt triggers:**

- Derived value for Bridgewater is wildly different from 100 kJ/(K·m²) (e.g. 30 or 300) — suggests Y-method implementation bug or construction library data issue → SH2.
- Derived values fail to discriminate between lightweight and heavyweight test cases → HH4.

---

## Part 6 — Engine agreement re-baselining

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

**Commit message:** "Brief 28b Part 6: Engine agreement re-baselining post physics overhaul"

---

## Part 7 — Completion checklist + close-out

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

**Commit message:** "Brief 28b Part 7: Close-out + completion checklist"

---

## Close-out

After all parts complete:

1. Full regression suite green.
2. Pre-flight checks pass for Brief 29.
3. Proceed to Brief 29 without pause.

**Confidence target:** 8/10 (physics work has inherent uncertainty; 8/10 is honest given the scoping-blind concern flagged at brief authoring).

**Halt triggers specific to this brief:** Re-read the preamble. Halt liberally. Better to halt and reassess than complete physics that doesn't address the real problem.
