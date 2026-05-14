# Brief 27 Cleanup — Heat Balance Bug + Divergence Doc Correction

**Scope:** Two small fixes flagged by the audits. Sets up clean state before Brief 28 starts.

**Estimated time:** 1 hour.

**Dependencies:** None.

**Pre-flight checks:** See batch orchestration doc.

---

## Part 1 — Heat Balance prop bug fix

**File:** `frontend/src/components/modules/gains/canvas/HeatBalanceView.jsx`

**Issue:** Line 45 passes `balance=` where the component expects `liveData=`. Result: Heat Balance tab in Internal Gains shows "no heat balance data available — load a project" even when Bridgewater is loaded.

Found by UX audit, flagged as BLOCKING.

**Fix:**

1. Open `HeatBalanceView.jsx`
2. Locate line 45 (or wherever the prop is being passed)
3. Rename `balance=` to match what the downstream component expects (`liveData=` per audit finding; verify by reading the component being passed to)
4. Verify the data shape matches what the consumer expects — if not, transform the data appropriately
5. Test: navigate to /gains on Bridgewater, click Heat balance tab, confirm data renders

**Verify:**
- Heat balance tab renders State 2 heat balance on first visit
- No "load a project" empty state on a loaded project
- State 1 isolation: 40/40 byte-identical
- State 2 isolation: 21/21 byte-identical (the fix is UI-only, shouldn't affect engine output)

**Commit message:** "Brief 27 cleanup Part 1: Heat balance prop name fix (HeatBalanceView.jsx)"

**Progress doc update:** Status `complete`, commit hash, any decisions made.

---

## Part 2 — Divergence doc correction

**File:** `docs/state_1_engine_divergence_investigation.md`

**Issue:** The doc states a "50 GWh phantom solar / 38% solar over-count" attributed to isotropic sky modelling. Physics audit found this is overstated by ~10×. Real per-facade deviation is +19% NNE / −10% SSW, aggregate +1%.

The doc was comparing pre-shading incident solar against post-shading transmitted total — different quantities.

**Fix:**

1. Read the current doc.
2. Identify every claim relating to the 38% number or 50 GWh figure.
3. Correct each instance with the audit's findings: per-facade deviation +19% NNE / −10% SSW, aggregate +1%.
4. Add a paragraph explaining the original measurement error (pre-shading incident vs post-shading transmitted).
5. Note that the HDKR/Perez fix is still warranted but smaller in magnitude than originally documented.
6. Update any references to the 23.5% conduction divergence — the audit found this was an artefact of HVAC-clamped vs free-running comparison. The fix here is to add a clarifying paragraph noting that the comparison wasn't apples-to-apples, and that the true free-running EP comparison is queued (Brief 28-prereq).
7. Add a dated audit attribution at the top: "Corrected {date} per docs/physics_audit_2026_05.md findings."

Do NOT delete the original content. Strike-through or annotate. The audit trail of "what we thought, what we found, what's correct" is more valuable than a clean rewrite.

**Verify:**
- Doc reads coherently
- All references to 38% and 50 GWh either struck through with correction or replaced
- 23.5% conduction divergence has a clarifying note about the comparison artefact
- HDKR/Perez fix mentioned as still warranted, magnitude revised

**Commit message:** "Brief 27 cleanup Part 2: Correct overstated solar / conduction divergence claims per physics audit"

**Progress doc update:** Status `complete`, commit hash, any decisions made.

---

## Close-out

After both parts complete:

1. Run full regression suite:
   - State 1 live: 40/40 byte-identical
   - State 1 EP: 40/40 byte-identical
   - State 2 live: 21/21 byte-identical
   - State 2 EP: 21/21 byte-identical
2. Update `STATUS.md` with one paragraph noting the cleanup is done.
3. Update `docs/batch_progress_2026_05.md` with Brief 27 cleanup marked complete.
4. Pre-flight check for next brief (Brief 28-prereq):
   - All regressions green
   - Build clean
   - Working tree clean
5. Update `current.md` to point at `docs/briefs/active/28_prereq_free_running_ep.md`
6. Proceed to next brief without pause.

**Confidence target:** 10/10 (these are bug fixes, no design decisions).

If anything in this brief takes more than 2 hours or surfaces unexpected complexity, halt under HH3 and report.
