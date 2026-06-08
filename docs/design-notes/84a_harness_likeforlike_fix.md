# Brief 84a design note — Harness like-for-like comparison fix

## Where this came from

Brief 83 closed as a diagnostic-only outcome. The "MVHR recovery booking bug" the brief was sent to fix turned out not to exist. Brief 83 P4 instrumented per-hour MVHR heat flows on both engines and proved that, in the 4,426 hours where EnergyPlus's coil is actually active, NZA-Sim and EnergyPlus agree on effective recovery to within 3.7%. Both engines settle at the nominal 75% HRE.

The +92.9% "mech vent net loss" gap in Brief 81's comparison report wasn't an engine disagreement — it was a comparison-framework artifact. The framework was comparing two different physical quantities measured over two different hour sets and reporting the difference as if it were a recovery-fraction bug.

## What the actual divergence is

**Brief 81's mech-vent comparison was domain-mismatched:**

- NZA-Sim's number was a State-2 heat-balance-domain quantity: `ventUA × (T_setpoint − T_outdoor)` integrated over all heating-degree hours. This is the building's mech-vent heat loss term in the gains-vs-losses balance, computed for every hour where outdoor temperature is below the heating setpoint.

- EnergyPlus's number was a coil-domain quantity: the IdealLoads system's outside-air load minus HX recovery, computed only over hours where the coil is actively running.

Two engines, two different metrics, one comparison cell. The +93% wasn't a bug — it was the predictable result of comparing apples to oranges.

## What Brief 84a does

Pairs the two engines on a like-for-like basis for the mech-vent metric. Two implementation choices, both produce the same result given Brief 83 P4's evidence:

1. **Coil-run hours only.** Sum NZA's mech-vent over only the hours where EP's coil is active. Compare.
2. **Demand-domain on both sides.** Use NZA-Sim's State-3 demand-domain mech-vent number (which is already coil-run-hours-like in scope) rather than its State-2 heat-balance-domain number.

Either approach makes the comparison honest. Code chooses whichever is cleaner to implement.

## What Brief 84a deliberately does NOT do

- **Touch any engine code.** NZA-Sim's internal numbers are correct — they just mean different things in different contexts. State-2's "mech-vent loss-at-setpoint over all heating-degree hours" is a valid heat-balance term. State-3's "mech-vent in demand domain over coil-run hours" is a valid systems-energy term. Both are right. The fix is comparing the right one to EnergyPlus.

- **Touch tolerances.** The Brief 81 tolerances stay. The point is to make the metric honest, not the tolerance lenient.

- **Address Finding A.** The free-float warmth question (the ~+1 °C zone temperature delta in unconditioned hours) is the load-bearing structural finding. Brief 84b handles it separately. 100% of the original mech-vent excess that wasn't a domain mismatch lives in free-float hours — same physical phenomenon, just viewed through the mech-vent loss line rather than the zone-temp line.

## The architect track record

This is the fourth time in this cycle Code's source-read + per-hour evidence has caught an architect framing error. The pattern banked from Briefs 75, 76, 82, 83: when the architect proposes a fix based on a prior brief's summary number, the next brief's author has to verify the number is what it claims to be, not what the prior brief framed it as. Brief 82's "54% effective recovery" was a domain-mismatch artifact, not a fraction. Brief 83 caught this; Brief 84a implements the correction.

Going forward (per Chris's instruction 2 June 2026): the architect's job is to verify. Always. Source-read first, framing second.

## Branch

All work on `feat/energyplus-validation`. The harness change does eventually want to merge back to `main` (it's not engine code; it's the comparison framework), but not yet — wait until Brief 84b closes so the validation story is told consistently across the branch.

## Decision log

**2 June 2026:** After Brief 83's diagnostic-only close, Chris approves the like-for-like harness fix as Brief 84a (small, bounded, no engine change) and the Finding A characterisation as Brief 84b (separate investigation). The two are independent and can land in either order.
