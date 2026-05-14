# Brief 29 — Building Module Completion

**Scope:** Finish what State 1 / Building module was meant to be. State 1 diagnostic views deferred since Brief 26.1. UI principles conformance. Hardcoded constants cleanup. Building-type-aware BREDEM phasing.

**Estimated time:** 2 weeks.

**Dependencies:** Brief 28a and Brief 28b complete.

---

## Reading list

1. `docs/state_contracts.md` (current version)
2. `docs/ui_principles.md`
3. `docs/module_completion_checklist.md`
4. `docs/hardcoded_constants_audit.md`
5. `docs/state_1_divergences.md` (updated by Brief 28)
6. `docs/state_1_expected_ranges.md` (updated by Brief 28)
7. `docs/ux_audit_2026_05.md` — Building module sections
8. `docs/briefs/archive/26_State_1_envelope_only_COMPLETED.md` — for original scope context
9. `docs/briefs/archive/26_1_State_1_finalisation_COMPLETED.md`

---

## Part 1 — State 1 diagnostic views

**Files:** `frontend/src/components/modules/building/canvas/` (new views)

**Goal:** Build the two diagnostic views originally scoped for Brief 26.1 that never landed.

### View 1: Free-running Temperature (or Load shape — Building module's variant)

A dedicated temperature diagnostic for State 1, separate from Heat Balance.

Layout:
- Stat panel: annual mean, winter min, summer max, hours below 20°C, hours above 26°C, hours in band (using the comfort band)
- Time-series chart using the Pablo Load shape pattern (ported in Brief 28a Part 4-5):
  - Outdoor temperature
  - Indoor free-running temperature (Static engine)
  - Indoor free-running temperature (Dynamic engine) — using Brief 28 prereq's free-running EP data
  - Comfort band shading
- Time zoom (Year / Quarter / Month / Week / Day)
- Engine toggle in top-right (Static / Dynamic / Both)

This is a substantive diagnostic — lets the user see "how does this building behave on its own, before any conditioning?" Useful for understanding overheating risk, comfort hours composition, and how envelope changes affect the unconditioned trace.

### View 2: Heat Loss Breakdown

A dedicated heat loss diagnostic showing per-element annual contributions.

Layout:
- Horizontal stacked bar at the top: total annual heat loss split by element category (External wall / Roof / Ground floor / Glazing / Fabric leakage / Infiltration / Ventilation if present)
- Per-element table below, sortable by contribution:
  - Element name (e.g., "F2 SE glazing")
  - Area (m²)
  - U-value (W/m²K)
  - Annual heat loss (MWh)
  - Annual heat loss per m² of element area (kWh/m²·yr)
  - Annual heat loss as % of total
- Engine toggle (Static / Dynamic)
- Unit toggle for the bars (MWh vs %)

This is the "where does the heat actually go?" diagnostic. Genuinely useful for retrofit prioritisation.

**Steps:**

1. Build `FreeRunningView.jsx` (or `LoadShapeView.jsx` for Building) using the Pablo components.
2. Build `HeatLossBreakdownView.jsx` with the stacked bar + table.
3. Add both as tabs in the Building module canvas (alongside Heat Balance, 3D Model).
4. Wire engine toggles consistently with Internal Gains module pattern from Brief 28a Part 5.
5. Verify on Bridgewater:
   - Free-running view shows reasonable trace, both engines (Brief 28 should have brought them close)
   - Heat loss breakdown shows per-element contributions matching the existing Heat Balance Sankey

**Verify:**
- Both views render on Bridgewater
- Both views update on input changes (Static engine recomputes live)
- Engine toggle works
- Numbers match Heat Balance view's totals (cross-validation)
- BREDEM expected ranges met

**Commit message:** "Brief 29 Part 1: State 1 diagnostic views (Free-running + Heat Loss Breakdown)"

**Decision points:**
- Tab placement: my lean is to put them between Heat Balance and 3D Model in the Building canvas.
- Naming: "Free-running" vs "Load shape" — use whatever Brief 28a Part 3 decided. Consistency across modules.

---

## Part 2 — Building module UI principles conformance

**Files:** `frontend/src/components/modules/building/`

**Goal:** Bring Building module into conformance with `docs/ui_principles.md` and the patterns established in Internal Gains.

**Steps:**

1. Audit current Building module against the five UI principles:
   - **Card width matches content** — find cards stretched to full width unnecessarily
   - **Related items in same card** — find separated stats that should be grouped
   - **Centre canvas max ~1000px** — check current width handling
   - **Section bounding boxes** — already mostly there, verify
   - **Vertical stacking default** — find horizontal sprawl
2. Identify specific changes needed:
   - Stats grouped into single cards (e.g., free-running annual mean / winter min / summer max in one card, not spread)
   - Demand pair (heating / cooling) in one card
   - Engine toggle placement consistent with Internal Gains
3. Make the changes:
   - Use existing components where possible
   - Don't introduce new patterns; conform to existing ones
   - Preserve all functionality
4. Cross-module visual check: stand at /building and /gains side by side. Do they feel like the same tool?

**Verify:**
- Building module follows UI principles
- Visual consistency with Internal Gains
- All existing functionality preserved
- No regressions in tests or walkthrough behaviour

**Commit message:** "Brief 29 Part 2: Building module UI principles conformance"

**Decision points:**
- Where layout changes risk breaking existing user expectations (e.g., the comfort band editor placement), default to least-disruptive change.
- Don't expand scope into Operation or Systems modules — those are out of scope.

---

## Part 3 — Hardcoded constants cleanup

**Files:** Per `docs/hardcoded_constants_audit.md`

**Goal:** Resolve the ~10 duplicated constants flagged across files. Move each to its appropriate home (library / config / clearly-documented constant).

**Steps:**

1. Read the audit document.
2. For each constant in the audit, decide:
   - Is it a physics constant? (Stefan-Boltzmann, air properties) → keep as constant with reference value and source documentation
   - Is it an algorithm parameter? (numerical tolerance, iteration limit) → keep as constant with rationale comment
   - Is it configurable? (h_am, daylight factor, spill_minutes defaults) → move to library/config, expose as user input or library entry where appropriate
   - Is it ambiguous? → make a decision per the closest analogous case, document
3. For each duplicated constant, ensure there's a single source of truth:
   - One file owns the definition
   - All consumers import from that file
   - No silent drift possible
4. Add tests that verify constants are sourced from the canonical location (or at least documentation explaining the pattern).
5. Update the audit doc with resolution status.

**Verify:**
- Each constant in the audit has a documented resolution
- Duplicated constants now have a single source
- No new duplications introduced
- All affected files still pass their existing tests
- State isolation regressions still byte-identical (constants moving shouldn't change calculated values)

**Commit message:** "Brief 29 Part 3: Hardcoded constants cleanup"

**Decision points:**
- Where to put physics constants: my lean is a `nza_engine/constants/physical.py` (and equivalent JS) with clearly-named exports.
- Where to put algorithm parameters: closer to the code that uses them, with documenting comments.

---

## Part 4 — Building-type-aware BREDEM phasing factors

**Files:** `docs/state_1_expected_ranges.md`, `docs/state_2_expected_ranges.md`, possibly a new `docs/bredem_phasing.md`

**Goal:** The BREDEM-style expected ranges currently use uniform offset assumptions. Real buildings have building-type-specific phasing (hotel gains concentrated overnight; office gains concentrated weekday daytime; school gains absent in holidays). This was queued from Brief 27.

**Steps:**

1. Document the issue:
   - BREDEM is a useful sanity check but assumes uniform daily gain distribution
   - Hotel-style overnight occupancy concentrates gains during heating-dominated hours, increasing the heating offset and decreasing the cooling addition compared to BREDEM
   - Office-style weekday occupancy concentrates gains during cooling-dominated hours, opposite effect
   - School term/holiday produces zero-gain weeks that BREDEM doesn't represent
2. Define building-type-specific phasing factors:
   - Hotel: phasing factor for heating offset (e.g., 1.3× BREDEM uniform), cooling addition (e.g., 0.7× BREDEM uniform)
   - Office: opposite
   - School: separate term vs holiday handling
   - Residential: similar to hotel
   - Retail: pattern-dependent
3. Update `state_1_expected_ranges.md` and `state_2_expected_ranges.md` with the phasing factors per building type.
4. Update the BREDEM verification logic (if any) to apply phasing factors when checking expected ranges.
5. Re-validate Bridgewater (hotel) under the new phasing factors — should land cleanly in the hotel-phased expected range.

**Verify:**
- Phasing factors documented per building type
- Expected ranges updated
- Bridgewater verification clean under new ranges
- Tool behaviour unchanged (this is documentation/verification work, not engine changes)

**Commit message:** "Brief 29 Part 4: Building-type-aware BREDEM phasing factors"

**Decision points:**
- Where to source phasing factors: from the building physics literature (CIBSE Guide A, NCM), or from analytical derivation on representative profiles. Use analytical derivation where literature doesn't cover, document either way.
- How rigorously to validate: at minimum Bridgewater + one office archetype. More is better but not required.

---

## Part 5 — Building module completion checklist + close-out

**Files:** `docs/module_checklists/building_brief_29.md`, STATUS.md, archive

**Steps:**

1. Fill in completion checklist for Building module:
   - All sections answered honestly
   - Specific Bridgewater verification numbers
   - Confidence rating /10
2. Cross-check against state contracts — Building module now meets all v2.5 (or whatever current version) requirements
3. Update STATUS.md with batch completion summary
4. Archive `docs/briefs/active/29_building_completion.md` → `docs/briefs/archive/29_building_completion_COMPLETED.md`
5. Update `current.md` to point at next brief (probably Brief 30 — Operation v2 / State 2.5)

**Verify:**
- Completion checklist filled in
- STATUS.md reflects batch close
- Archive done

**Commit message:** "Brief 29 Part 5: Close-out + completion checklist + batch close"

---

## Close-out — End of batch

After Brief 29 completes:

1. Run full regression suite.
2. Update `docs/batch_progress_2026_05.md` to state `complete_pending_walkthrough`.
3. Write a batch summary document `docs/batch_summary_2026_05.md`:
   - What shipped in each brief
   - Total commits across the batch
   - Regression history (start vs end byte-identity counts)
   - Confidence ratings per brief
   - Open questions / deferred items
   - Specific things to look for in the walkthrough
4. HALT.

Do not start any new work after Brief 29 closes. The next step is Chris's walkthrough on all the changes.

**Confidence target for Brief 29:** 9/10 (substantive completion of State 1, but the phasing factors work has some judgement calls).

**Halt triggers specific to this brief:**
- State 1 diagnostic views reveal issues with Brief 28b's physics (e.g., new mass model produces unexpected results in the dedicated view) → SH2
- Constants cleanup uncovers subtle bugs (e.g., one consumer was using a different value than another, and the difference was intentional but undocumented) → SH3
- UI conformance work breaks existing tests in unexpected ways → HH1 / HH6

---

## End of batch

After Brief 29's close-out:
- All 5 briefs in the batch are complete
- ~7-8 weeks of focused work delivered
- Batch summary document ready
- Walkthrough queued for Chris
- No further work starts until Chris reviews

The batch ends here. Subsequent state progression (Brief 30 Operation v2 / State 2.5, Brief 31+ for Systems, Weather, Reconciliation) is scoped after the walkthrough.
