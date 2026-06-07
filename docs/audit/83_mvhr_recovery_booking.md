# Brief 83 — MVHR recovery booking (Finding B fix) — audit

**Branch:** `feat/energyplus-validation` (continuation of Briefs 81 + 82). **NEVER merged to `main`.**
**Brief:** [`docs/briefs/active/83_mvhr_recovery_booking.md`](../briefs/active/83_mvhr_recovery_booking.md).
**Design note (canonical):** Notion "Brief 83 design note: MVHR recovery booking (Finding B fix)"
(`378d645e05cc81e2b01edd0e11836a80`).

---

## §0 — Context and receipt

Brief 82 closed outcome (b) — the four Brief-81 divergences are ≥2 findings:

- **Finding A — free-float warmth (~+1 °C, unconditioned).** Best fit candidate 2 (solver/lumped-mass
  convention). **Brief 84's territory — NOT touched in Brief 83.**
- **Finding B — same-setpoint magnitude.** At an agreed 24 °C setpoint NZA removes ~2× cooling and
  loses ~2× mech-vent heat; **~54 % effective recovery vs EP's ~82 %, both nominally 75 % HRE.**
  Real engine issue. **Brief 83's target.**

**Two findings partially cancel.** Finding B (NZA loses *more* vent heat → should be colder) and
Finding A (NZA floats warmer) move in opposite directions. **Closing Finding B is expected to widen
Finding A's float-warmth delta. That is anticipated, not regression** — honest reporting required.

**Premise-check authority (Brief 76 pattern):** if source-reading reveals the architect's framing is
wrong, push back via an audit comment, propose the actual fix shape, execute with divergence
documented.

**Hard-STOPs:** no touching the air-node solver (Brief 84); no fix > 30 lines; no tuning to make the
harness pass; no merge to `main`; escalate after 60 min on any sub-problem.

The design note and brief agree at landing — no premise conflict identified yet (re-checked at P2).

---

## §1 — P1: Brief landing + branch verify

- Branch: `git branch --show-current` → `feat/energyplus-validation`. ✓
- Branch tip at landing: `d6f964c` (Brief 82 P6 close). ✓ (brief expected `d6f964c` or later)
- `main`: `d8a6207` (local and `origin/main`) — **unchanged since the branch cut.** ✓
- Brief landed at `docs/briefs/active/83_mvhr_recovery_booking.md` (copied verbatim from the
  authorised source; matches the canonical Notion design note).
- This audit stub opened.

Commit: `Brief 83 P1: brief landing on feat/energyplus-validation`.

---

## §2 — P2: Source read of NZA-Sim's MVHR recovery integration

_(to be written at P2 — read-only; file + line refs; premise-check)_

Where recovery is applied · what form (extract-loss reduction / supply preheat / zone gain) · what ΔT
· per-hour vs annualised · how it maps to the 54 % effective-recovery observation.

---

## §3 — P3: Source read of EnergyPlus's MVHR recovery (reference)

_(to be written at P3)_

EP object handling MVHR · how recovery integrates into the zone heat balance · how effective recovery
is computed in EP outputs · what NZA should match (or why it can't).

---

## §4 — P4: Per-hour MVHR heat flow comparison

_(to be written at P4)_

Opt-in per-hour MVHR outputs both engines (supply/extract/outdoor temp, recovery W, zone temp) → two
8760-row CSVs. Falsifiability: per-hour effective recovery ≈ (T_supply − T_outdoor)/(T_extract −
T_outdoor), averaging ~0.75 EP / ~0.54 NZA (matching Brief 82). STOP if it doesn't.

---

## §5 — P5: MVHR booking discrepancy verdict + proposed fix

_(to be written at P5 — diagnostic + design only, NO code)_

Operative mechanism (which candidate) · single or coupled · minimum fix (54 %→75 %) · before/after
pseudocode.

---

## §6 — P6: Implement the fix

_(to be written at P6 — ≤ 30 lines; same file/region as P2; v25/v40 fallback preserved; air-node
solver untouched)_

---

## §7 — P7: Post-fix Bridgewater-Box re-validation

_(to be written at P7)_

Re-run harness; row-by-row delta table Brief 81 vs Brief 83 post-fix vs EP. Mech-vent within ±15 %;
cooling reduces; heating may widen (expected); effective recovery ~75 %; EUI/fabric/monthly unchanged.

---

## §8 — P8: Close summary + Brief 84 handoff

_(to be written at P8)_

Finding B status (closed / partial / open) · Finding A movement (unchanged / widened / surprising) ·
Brief 84 scope. STATUS.md updated. Push to origin. **No merge to `main`.**
