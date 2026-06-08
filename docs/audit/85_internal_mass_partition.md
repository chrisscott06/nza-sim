# Brief 85 — Internal mass partition (Finding A resolution) — audit

**Branch:** `feat/energyplus-validation` (continuation of Briefs 81 + 82 + 83 + 84a + 84b). **NEVER merged to `main`.**
**Brief:** [`docs/briefs/active/85_internal_mass_partition.md`](../briefs/active/85_internal_mass_partition.md).
**Design note:** [`docs/design-notes/85_internal_mass_partition.md`](../design-notes/85_internal_mass_partition.md).

---

## §0 — Context and receipt

Brief 84b characterised the +1.10 °C free-float delta (2949 both-unconditioned hours, 97.5 % NZA
warmer) as a thermal-storage / transient-response solver-convention difference, but could not
**quantitatively partition** it between internal mass and residual solver convention because the
internal-mass calibration hook is dead via the production path (`calculateInstant` drops `opts.tuning`,
instantCalc.js ~L4961). Brief 85 wires that hook (Step 0), runs the partitioning sweep (Step 1), and
returns a verdict a/b/c (Step 2).

**Architectural decisions made upstream (NOT re-litigated here):** (1) construction-derived internal
mass is the long-term target; (2) the EP reference box stays physics-bare for validation (no EP-side
internal mass in this brief); (3) tolerance-vs-engine-change is evidence-gated on Step 1's residual.

**Staged with hard checkpoints.** Step 0.4 is a HARD CHECKPOINT: both the default-byte-identical test
AND the hook-activation-sensitivity test must pass before Step 1.

**Hard-STOPs:** hook drop more complex than 1-3 lines → STOP; Step 0.4 default byte-drift → STOP; Step
0.4 hook shows no sensitivity → STOP; Step 1 non-monotonic/chaotic vs mass → diagnose; construction-mass
obviously wrong → STOP; Step 2 points at a real engine bug → STOP; anything on `main` → STOP. No engine
change beyond the Step 0 plumbing fix; no EP IDF change; no fixture change; no tolerance re-tune; no
merge to `main`; escalate after 90 min on any sub-problem. Premise-check authority (Briefs 76/83/84):
if Step 0.2 shows the drop isn't where 84b located it, push back and reframe.

---

## §0.1 — P0.1: Brief + design note landing + branch verify

- Branch: `git branch --show-current` → `feat/energyplus-validation`. ✓
- Branch tip at landing: `85d47c9` (Brief 84b P7 close). ✓ (brief expected `85d47c9` or later)
- `main`: `d8a6207` (local and `origin/main`) — **unchanged since the branch cut.** ✓
- Brief landed at `docs/briefs/active/85_internal_mass_partition.md`; design note at
  `docs/design-notes/85_internal_mass_partition.md` (both verbatim from the authorised sources). Audit
  stub opened.

Commit: `Brief 85 P0.1: brief landing on feat/energyplus-validation`.

---

## §0.2 — P0.2: Source read of the dropped `opts.tuning` hook

_(to be written at P0.2)_

---

## §0.3 — P0.3: opts.tuning plumbing fix (the diff)

_(to be written at P0.3)_

---

## §0.4 — P0.4: Hook verification [HARD CHECKPOINT]

_(to be written at P0.4)_

---

## §1.1 — P1.1: Sweep design + construction-derived mass computation

_(to be written at P1.1)_

---

## §1.2 — P1.2: Internal mass sweep execution

_(to be written at P1.2)_

---

## §1.3 — P1.3: Sweep analysis + delta partition

_(to be written at P1.3)_

---

## §2.1 — P2.1: Outcome verdict + reasoning

_(to be written at P2.1)_

---

## §2.2 — P2.2: Bridgewater-Box validation state at mass_min

_(to be written at P2.2)_

---

## §2.3 — P2.3: Close summary + Brief 86 handoff

_(to be written at P2.3)_
