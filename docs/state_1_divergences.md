# State 1 — Live engine vs EnergyPlus known divergences

Per `state_contracts.md` § Engine agreement, the live engine and EnergyPlus
must produce comparable State 1 numbers within ±5% per line item to be silent,
5–10% to soft-flag, etc. This document records the known places where the two
engines deliberately diverge by more than the silent tolerance — i.e., simplifications
we've chosen to accept rather than fix.

Each entry: what diverges, why, magnitude, and "what would fix it" if we ever
want to tighten.

---

## 1. Sky-diffuse model — isotropic vs Perez anisotropic

**What:** `frontend/src/utils/solarCalc.js:facadeRadiation()` uses the
**isotropic-sky** model for diffuse radiation on vertical surfaces:
```
diffuse_on_vertical = diffuse_horizontal × 0.5
```
The 0.5 is the geometric view factor from a vertical surface to the upper sky
hemisphere, assuming the sky is uniformly bright.

**Why this diverges from EnergyPlus:** EnergyPlus defaults to the **Perez
anisotropic** model (1990, optionally HDKR or Reindl), which accounts for:
- A **circumsolar** brightness peak around the sun (boosts surfaces facing
  the sun's azimuth even when the geometric beam component is small)
- A **horizon brightening** band (boosts diffuse on south-facing surfaces in
  the morning/evening when the sun is low)

Isotropic over-predicts diffuse on surfaces NOT facing the sun (typically
north-leaning faces) and under-predicts on surfaces facing the sun.

**Magnitude:** ±10–15% per facade in absolute terms. Annual integrated
solar on a UK north facade comes out 30–80 kWh/m²/yr higher than EP would
give (over-prediction); south facades are 30–50 kWh/m²/yr lower.

**Bridgewater post-2.5 evidence:** N facade at 379 kWh/m²/yr vs UK norm
250–350. Roughly 30–80 high, consistent with this divergence.

**What would fix it:** implement Perez anisotropic in
`solarCalc.facadeRadiation`. Inputs needed beyond current: clearness index
`ε`, brightness index `Δ`, both computed from DNI/DHI/airmass. Standard
implementation referenced in ASHRAE Fundamentals 2021 Ch. 14 §13.

**Decision:** **accept the divergence for State 1.** Isotropic is the
canonical "feasibility / quick check" model. State 1 is envelope-only; the
absolute numbers feed into State 1 derived demand which is itself a
PHPP-style approximation. EnergyPlus is the canonical answer for absolute
solar; the live engine's job is fast feedback and direction-of-travel.

---

## 2. Thermal mass dynamics — lumped capacitance vs full transient

**What:** Brief 26 Part 3 will implement a single-zone lumped-capacitance
model for the free-running zone temperature, using one heat-capacity number
per `fabric.thermal_mass_category` (CIBSE TM52 light/medium/heavy at 80/160/280
kJ/K/m²).

**Why this diverges from EnergyPlus:** EP uses a full transient heat balance
with conduction transfer functions through each layer of every construction.
Wall thermal mass at the surface ≠ wall thermal mass at the centre ≠ at the
inside face. The lumped model averages everything into a single zone-level
capacitance.

**Magnitude:** TBD when Part 3 lands. Expected: hourly free-running
temperature within ±2°C peak-to-peak vs EP; annual mean within ±0.5°C; but
the *timing* of overheating peaks shifts by several hours because the
single capacitance can't model the diurnal damping correctly.

**What would fix it:** add an R-C network model with at least three nodes
(internal surface, mass core, external surface). Or — easier — just trust
EP for the temperature trace and use lumped only for the live preview.

**Decision:** **accept for State 1 live calc** if Part 3 verification holds.
EP is canonical. Lumped is the speed/feedback compromise.

---

## 3. Permanent openings flow — single-sided wind vs network

**What:** `_estimate_openings_share` (sql_parser.py) and `instantCalc.js`
openings logic both use the CIBSE AM10 single-sided wind formula
`Q = Cd · A · √Cw · v_wind`, no stack term.

**Why this diverges from EnergyPlus:** EP's `ZoneVentilation:WindandStackOpenArea`
uses the same formula but with a real stack term included. We deliberately
zero the stack term per Chris's "no crossflow, single-zone" constraint.

**Magnitude:** stack-driven flow at low wind speeds and large ΔT can be 30–50%
of total opening flow in real buildings. We're effectively ignoring it.

**Decision:** **accept** until multi-zone AFN lands (future brief). Documented
in Brief 25.

---

## How to add a divergence

When implementing any State 1 part where you choose a simplification:
1. Note it here with: what diverges, why, magnitude (or "TBD when measured"),
   what would fix it, decision (accept / future fix).
2. Reference the brief that made the choice.
3. Update when verification produces real magnitude numbers.

The contract's engine-agreement flag levels (silent / soft / persistent /
hard) refer to *aggregated* per-line-item disagreement at runtime. This
document is the static catalogue of *expected* divergences so they don't
get re-investigated every time someone notices the flag.
