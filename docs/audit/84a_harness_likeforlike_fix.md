# Brief 84a — Harness like-for-like comparison fix (mech-vent on coil-run hours) — audit

**Branch:** `feat/energyplus-validation` (continuation of Briefs 81 + 82 + 83). **NEVER merged to `main`.**
**Brief:** [`docs/briefs/active/84a_harness_likeforlike_fix.md`](../briefs/active/84a_harness_likeforlike_fix.md).
**Design note:** [`docs/design-notes/84a_harness_likeforlike_fix.md`](../design-notes/84a_harness_likeforlike_fix.md).
**Companion:** Brief 84b (Finding A characterisation) — separate, parallel.

---

## §0 — Context and receipt

Brief 83 closed diagnostic-only: there is **no MVHR recovery-booking bug.** The "+92.9 % mech-vent net
loss" gated FAIL in Brief 81 is a **comparison-framework domain mismatch**, not an engine defect:

- NZA-Sim `losses.mech_ventilation` = a **zone-balance loss-at-setpoint** term, `ventUA·(21 − T_out)`
  accrued over *every* heating-degree hour (`ventUA = flow·ρCp·(1 − HRE)`, with the nominal 75 % HRE
  folded in).
- EnergyPlus = a **coil OA load** (`oa_sensible − heat_recovery`) accrued only over coil-run hours.

Brief 83 P4's per-hour data is decisive: in the **4426** hours EnergyPlus's heating coil actually runs,
NZA agrees with EP to **3.7 %** (NZA 0.914 vs EP 0.882 MWh; per-hour recovery ~75 % both sides). The
+92.9 % decomposes (Brief 83 §4.3): **59 %** NZA books a vent loss in free-float hours EP's coil is off,
**36 %** EP's HX warms incoming OA in cooling-season hours (negative net), **5 %** shared-hour ΔT
reference. **100 % of the excess lives in free-float hours** (Finding A territory).

**Brief 84a's job:** make `compare.py` pair the mech-vent metric like-for-like (coil-run hours, or
NZA's demand-domain number) so the gated comparison reads honestly (~+3.7 % PASS) — **harness only, no
engine/IDF change, no tolerance change.**

**Hard-STOPs:** no engine/IDF code; no tolerance re-tuning; only the mech-vent comparison; no merge to
`main`; escalate after 60 min on any sub-problem; if P4 mech-vent doesn't land near +3.7 %, one P2
refinement then STOP.

---

## §1 — P1: Brief + design note landing + branch verify

- Branch: `git branch --show-current` → `feat/energyplus-validation`. ✓
- Branch tip at landing: `b955d22` (Brief 83 P8 close). ✓ (brief expected `b955d22` or later)
- `main`: `d8a6207` (local and `origin/main`) — **unchanged since the branch cut.** ✓
- Brief landed at `docs/briefs/active/84a_harness_likeforlike_fix.md` (verbatim from authorised source).
- Design note landed at `docs/design-notes/84a_harness_likeforlike_fix.md` (verbatim; matches the
  canonical sibling). New `docs/design-notes/` directory created.
- This audit stub opened.

Commit: `Brief 84a P1: brief + design note landing`.

---

## §2 — P2: Like-for-like definition choice + implementation plan

_(to be written at P2)_

---

## §3 — P3: Like-for-like mech-vent comparison (the diff)

_(to be written at P3)_

---

## §4 — P4: Post-fix harness re-run + verification

_(to be written at P4)_

---

## §5 — P5: Close summary + STATUS update

_(to be written at P5)_
