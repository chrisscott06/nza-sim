# Brief 28 Prerequisite — Free-Running EnergyPlus Simulation

> **⚠ STATIC ENGINE NUMBERS PREDATE `5f890c2` — RE-BASELINING QUEUED IN BRIEF 29 PART 5 (2026-05-14)**
>
> The "corrected comparison" State 2 demand figures cited in this brief
> (Static 103.4 MWh heating, 108.6 MWh cooling, 4,430 underheating hours,
> 21.2 °C annual mean T) were captured **before** the `decomposeHour
> day=1` fix (commit `5f890c2`, 2026-05-14). That bug zeroed gains across
> 5 of 12 months, so the Static numbers under-counted heating offset and
> cooling drive substantially.
>
> The structural conclusions in this brief — envelope-only mode is the
> honest baseline; both engines now compare like-for-like at the
> free-running level; parser hooks; persisted-run pipeline — stand.
> Numeric divergence between Static and Dynamic at envelope-only level
> is unaffected by the bug (gains are off for both states). But any
> State 2 numbers in the "corrected comparison" section need re-running
> against post-fix Static. Queued as Brief 29 Part 5.


**Scope:** Add a true free-running EP simulation pathway so Static and Dynamic engines can be compared apples-to-apples.

**Estimated time:** 3 days.

**Why this is a prerequisite:**

The physics audit found that previous engine comparisons were not honest: Static was running free-running (no setpoints, ideal loads at -60/+100°C), while the EP runs being compared were HVAC-clamped (18°C night / 21°C day setpoint). This made the engines look like they were diverging on physics when in fact they were doing different jobs.

The assembler already supports `mode='envelope-only'` with wide setpoints (`epjson_assembler.py:1358`). What's missing is a persisted simulation run using that mode whose output the comparison scripts and UI can consume.

Without this, Brief 28a Part 5 (engine toggle wiring) would show divergence that isn't physically meaningful — the toggle would actively mislead users about engine agreement.

**Dependencies:** Brief 27 cleanup complete.

---

## Part 1 — Verify the assembler's free-running mode

**Files:** `nza_engine/generators/epjson_assembler.py`, scripts as needed

**Goal:** Confirm that `mode='envelope-only'` produces an epJSON that EP will run as genuinely free-running.

1. Read `epjson_assembler.py` around line 1358 and surrounding context.
2. Confirm that envelope-only mode:
   - Sets ideal loads HVAC to -60°C heating setpoint and +100°C cooling setpoint (or equivalent wide band)
   - Does NOT emit People / Lights / ElectricEquipment objects (it's State 1, envelope only)
   - Does NOT emit operable windows (those are State 2.5)
   - Does NOT emit any systems (those are State 3)
3. Build a Bridgewater envelope-only epJSON and inspect it for:
   - Schedule setpoints (should be wide-band, no real conditioning)
   - HVAC objects (should be ideal loads or equivalent)
   - Internal gain objects (should be absent)
4. Document findings in `docs/state_1_free_running_verification.md`.

If anything is missing or unclear, halt under HH4 — the assembler's behaviour isn't matching what the audit assumed.

**Verify:**
- Envelope-only epJSON contains wide setpoints
- No gain objects present
- Single-zone or multi-zone shape matches the building config
- File compiles and is valid EnergyPlus syntax

**Commit message:** "Brief 28-prereq Part 1: Verify assembler envelope-only mode produces free-running epJSON"

---

## Part 2 — Run free-running EP simulation for Bridgewater and persist results

**Files:** `nza_engine/runners/` (simulation runner code), API routes if needed, persistence layer

**Goal:** Run a Bridgewater envelope-only EP simulation and persist the results in a form the API and UI can consume.

1. Use the existing simulation infrastructure to trigger a Bridgewater simulation with `mode='envelope-only'`.
2. Confirm it runs cleanly (no fatal errors; warnings expected and OK if they match the pattern from existing runs).
3. Persist the results following the existing pattern for State 1 / State 2 sim run records. Use a clearly-labelled `simulation_type` (e.g., `'state_1_envelope_only_free_running'`) so it's distinct from existing State 1 runs that may have been HVAC-clamped.
4. Verify the SQL parser can extract the relevant fields from the new run:
   - Hourly free-running zone temperature
   - Hourly per-element heat loss/gain
   - Hourly solar transmitted by orientation
   - Hourly demand against any reference comfort band (computed post-hoc)
5. If any of these don't work cleanly, fix the parser to handle the free-running mode correctly.

**Verify:**
- Bridgewater free-running EP simulation completes successfully
- Run is persisted with a clearly distinct simulation_type
- SQL parser extracts hourly free-running temperature trace
- Trace is plausible (not flatlined at setpoint, varies with weather + envelope dynamics)
- Annual mean free-running T, winter min, summer max all extractable as discrete values

**Commit message:** "Brief 28-prereq Part 2: Free-running EP simulation pipeline for Bridgewater"

---

## Part 3 — Update engine_agreement script to use free-running EP run

**Files:** `scripts/state1_engine_agreement.mjs` (and any related)

**Goal:** Re-run the engine comparison using Static free-running vs Dynamic free-running. Update the divergence picture honestly.

1. Read the current script.
2. Identify which EP run it's currently pulling. If it's pulling an HVAC-clamped run, change it to pull the free-running run created in Part 2.
3. Re-run the script on Bridgewater.
4. Compare new results to the previous results:
   - Did the 23.5% conduction divergence change magnitude or character?
   - Did the summer max divergence change?
   - Did the winter min divergence change?
   - Did the heating demand and cooling demand divergence change?
5. Update `docs/state_1_engine_divergence_investigation.md` with the new findings as a clearly-dated addendum.
6. If the new findings significantly change the picture (e.g., engines actually agree well once compared properly, or they disagree differently), update `STATUS.md` and flag for review at the batch walkthrough.

**Verify:**
- engine_agreement script runs without error
- Output shows Static free-running vs Dynamic free-running specifically
- Updated divergence picture documented
- Magnitudes of divergence are clearly stated with attribution

**Commit message:** "Brief 28-prereq Part 3: Update engine_agreement to compare free-running outputs"

---

## Part 4 — Close-out and re-scope check

**Goal:** Decide whether Brief 28b's scope still holds.

1. Read the updated divergence picture from Part 3.
2. Compare to Brief 28b's planned scope (`docs/briefs/active/28b_physics_overhaul.md`).
3. If the new divergence picture suggests:
   - Multi-layer CTF mass model is still the dominant fix needed → Brief 28b proceeds as planned.
   - Some other physics is now the dominant divergence cause → halt under HH4, write a halt report explaining what's needed, and wait.
   - Engines actually agree well now → halt under HH4, flag that Brief 28b's scope may be wrong, wait.
4. Either way, update `docs/batch_progress_2026_05.md` with the re-scope assessment.

This is the explicit safety valve. The premise of Brief 28b is that the dominant Static engine divergence is the mass model. If Part 3's data invalidates that premise, don't proceed.

**Verify:**
- Re-scope assessment documented
- Decision (proceed / halt) is explicit
- If halting, halt report is comprehensive

**Commit message:** "Brief 28-prereq Part 4: Re-scope assessment for Brief 28b"

---

## Close-out

After all parts complete:

1. Run full regression suite (should all still be green — this brief adds capability, doesn't change existing physics).
2. Update STATUS.md.
3. Update progress doc.
4. Archive brief: `docs/briefs/active/28_prereq_free_running_ep.md` → `docs/briefs/archive/28_prereq_free_running_ep_COMPLETED.md`.
5. Update `current.md` to point at Brief 28a (visible polish).
6. Proceed to Brief 28a if Part 4 said proceed; halt if Part 4 said halt.

**Confidence target:** 9/10 (real work, but mostly leveraging existing infrastructure).

**Halt triggers specific to this brief:**
- Free-running EP simulation fails repeatedly with no clear cause → HH5
- Parser changes break existing State 1 or State 2 parsing → HH1
- Part 4 finds Brief 28b's premise invalidated → HH4
