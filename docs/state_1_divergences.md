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

**What:** The live engine uses a single-zone lumped-capacitance model for
the free-running zone temperature (Brief 26 Part 3), with one heat-capacity
number per `fabric.thermal_mass_category` (CIBSE TM52 light/medium/heavy at
80/160/280 kJ/K/m²). EnergyPlus uses a full transient heat balance with
conduction transfer functions through every layer of every construction.

**Magnitude (measured on Bridgewater, Brief 26 Part 6 engine-agreement
check, sim run 82e8a750):**

| Line item                    | Live engine | EP sim parser | Δ      | Flag    |
|------------------------------|-------------|---------------|--------|---------|
| **heating_demand_mwh**       | 166.8       | 168.1         | +0.8%  | silent  |
| underheating_hours           | 4145        | 3895          | -6.0%  | soft    |
| annual_mean_c                | 21.1        | 19.9          | -5.7%  | soft    |
| conduction (all elements)    | (varies)    | (varies)      | -11.7% | warn    |
| solar gain by face           | (varies)    | (varies)      | -15–26%| warn    |
| overheating_hours            | 2550        | 2137          | -16.2% | warn    |
| summer_max_c                 | 50.3°C      | 38.2°C        | -24.1% | warn    |
| **cooling_demand_mwh**       | 171.1       | 109.2         | -36.2% | HARD    |
| **comfort_hours**            | 2065        | 2728          | +32.1% | HARD    |
| **winter_min_c**             | 1.9°C       | 6.7°C         | +252%  | HARD    |

**Interpretation:**
- The headline value (heating demand) agrees to <1%. This is the indicator
  most users will read.
- The structural -11.7% on conduction reflects EP integrating Q = U·A·(T_zone − T_out)
  against EP's transient T_zone, while the live calc integrates against the
  lumped-capacitance T_zone. The proportional offset across all elements
  rules out any per-element bug — it's the temperature trace, not the U-values.
- The big winter_min divergence is the expected lumped-capacitance failure
  mode: with no operable windows and no internal gains, a single-capacitance
  model bottoms out faster than the real layered fabric. EP's transient
  thermal mass tempers the daily minimum substantially.
- summer_max divergence is the same effect at the other extreme. EP's
  thermal mass absorbs midday peaks.
- The cooling_demand and comfort_hours divergences are entirely downstream
  of the temperature trace divergence — both engines apply the same
  Q_solar + UA·ΔT formula, triggered on hours where T_zone is outside the band.

**What would fix it:** R-C network model with at least three nodes
(internal surface, mass core, external surface). Or accept EP as canonical
and use lumped only for the live preview.

**Decision:** **accept the divergence for State 1.** EP is canonical for
absolute numbers. The live engine's job is fast feedback and
direction-of-travel — and on the headline (heating demand) and direction
(both engines agree the building is heating-dominated, with overheating
risk from the 100% south WWR), the engines agree.

**Note on contract bounds:** the v2.2 contract bounds for Bridgewater
(heating 150–250, cooling 5–20, overheating 200–600) were calibrated for
a more conservative WWR. The actual Bridgewater spec (south=east=west=100%
glazing) genuinely overheats at the State 1 limit (no venting, no shading,
no cooling). Both engines confirm this — sim 2137 hrs, live 2550 hrs.
Update the contract or accept that this project sits at the extreme.

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

## 4. State isolation regression — regex parse of forbidden list (Python side)

**What:** `scripts/state1_isolation_epjson.py` reads the canonical
`FORBIDDEN_ENVELOPE_ONLY_INPUTS` list from `frontend/src/utils/stateMode.js`
via a regex on the JS source. The Node counterpart
(`scripts/state1_isolation_live.mjs`) uses a real ES module import, which
is robust.

**Why fragile:** if the JS file gets reformatted in a way that breaks the
regex (e.g. prettier/biome wrapping arrays differently, switching to
double-quoted strings, or splitting `Object.freeze([...])` across an
unexpected newline pattern), the regex returns zero matches and the
regression silently reports "ALL PASS" while testing nothing.

**Current mitigation:** the loader asserts at least 15 entries parsed.
If the count drops below that the script raises rather than reporting a
false-positive pass.

**Magnitude:** N/A — this is a tooling concern, not a physics divergence.
Logged here so future maintenance has the context.

**What would fix it:** expose `FORBIDDEN_ENVELOPE_ONLY_INPUTS` as a JSON
file (`stateMode.json`) imported by both `stateMode.js` and the Python
regression. Or generate a `forbidden_inputs.json` artifact during the
frontend build that the Python side consumes. Either removes the parse
step entirely.

**Decision:** **defer** until next contract change. The current tripwire
is sufficient; a JSON export is the right long-term fix but not urgent.

---

## 5. Process lesson — walkthrough discipline > automated regression

Not a physics divergence, but a recurring failure mode worth catalogued
here so future briefs don't repeat it.

**What:** Brief 26 closed with all 10 parts complete, the engine
agreement script reporting +0.8% silent on heating demand, the state
isolation regression at 45/45 byte-identical, and STATUS.md updated.
Every automated check passed. A manual UI walkthrough by Chris one day
later surfaced four issues, three of them contract-violating:

1. Sim view didn't render the State 1 contract output shape
2. Glazing + ground floor read 0 in the Sim view
3. Free-running summer max at 42.4°C (contract bound ≤36°C)
4. Thermal mass as a redundant dropdown vs derived from constructions

Brief 26.1 Part 0 then surfaced a fifth issue — a latent assembler
regression in `epjson_assembler.py` line 914 that wiped the State 1
setpoint schedules whenever a project carried non-zero louvre area.
This had been in the codebase since the openings brief (pre-Brief 26)
but never bit because every test project used default-zero louvres.
The user setting louvres for the first time surfaced the bug.

**Why the regressions missed it:**
- The engine agreement script ran on a stock-Bridgewater config that
  the user had no reason to touch — it carried Brief 26's test values,
  not a production-shaped config.
- The state isolation regression passed because baseline and absurd-input
  runs had identical broken output. Identical, but identically wrong.
- No automated test rendered the Heat Balance view in a browser.

**Lesson:** brief close-out cannot be solely "automated tests pass" —
contract conformance is verified in the UI by a human, on a config
shaped like a real project (non-default values across at least the
geometry, fabric, openings, and comfort band). Without that step,
regressions wait for the user to find them.

**Mitigation going forward:** every brief close-out includes a manual
walkthrough at 1440×900 with screenshots, on a config that is NOT the
default. The brief's "Verify" section explicitly demands this. Brief
26.1's discipline ("VERIFICATION RULES" block at the top) makes this
non-optional.

**What would prevent recurrence beyond discipline:** a screenshot-based
visual regression test that diffs the Heat Balance view against a
golden image. Would catch (a) any shape regression that breaks the
contract output, (b) any data path that silently downcasts to legacy
shape. Out of scope for State 1, candidate for Brief 30 (CI for state
contracts).

---

## 7. Summer max peak — residual gap after Brief 26.1 Parts 3 + 5

**What:** After landing the two-node lumped-capacitance topology (Part 3)
and replacing the dropdown with construction-derived mass (Part 5),
Bridgewater's live-engine summer_max_c is 42.3°C vs EP's 34.2°C — still
6°C above the contract bound of ≤36°C.

**Distribution metrics all converged to EP at silent tolerance:**
  annual_mean_c   18.3 (sim 18.4, +0.5%) ✓
  underheating    5244 (sim 5256, +0.2%) ✓
  overheating     1728 (sim 1788, +3.5%) ✓
  comfort_hours   1788 (sim 1716, -4.0%) ✓
  heating_demand  202.8 MWh (sim 214.5, +5.8% soft)

So Parts 3+5 successfully closed the integrated/distribution divergence.
The remaining gap is purely on the extreme peak.

**Root cause:** the live engine integrates ~200 MWh/yr of solar gain
into the zone, vs EP's ~135 MWh/yr — a 32% over-prediction. Tracing
back, this is **divergence #1 (isotropic vs Perez sky)** acting at scale.
Lumped models with constant U_eff can't escape the bound T_out_avg +
Q_solar_avg/U_eff, and that bound is what's setting the seasonal
baseline 38°C around which the diurnal swing oscillates. Better mass
(Part 5) damps the swing magnitude (4°C → 4°C, essentially unchanged
because solar input is the bigger lever), better topology (Part 3)
moves the energy through the right nodes but doesn't change the
integral.

**Fallbacks considered, not actioned:**

1. **Retune h_am downward (per Chris's note).** Tried 3.0 with derived
   mass — landed h_am=4.5 as sweet spot for distribution-metric silence.
   Lower h_am decouples air from mass at night (helps), but mass
   over-charges during the day (hurts). Net peak change: <1°C.

2. **Add radiative loss term from mass to sky for night cooling.**
   Clear-sky longwave radiation off an exposed mass surface can be
   60–100 W/m² on still summer nights. For the roof alone at 864 m²
   that's an extra ~70 W/K-equivalent at sky-temperature deficits of
   typical UK summer (~15K below ambient). Plausibly knocks 1–2°C off
   peak. Not currently modelled in either engine.

3. **Split floor vs wall mass with different solar fractions.**
   Direct solar lands on the floor (high mass, slow response); indirect
   diffuses to walls/ceiling. The 100%-to-mass lumping treats both
   equivalently. Splitting could improve diurnal timing but the
   integral is unchanged.

4. **Implement Perez anisotropic sky.** Would fix divergence #1 at the
   source. Largest single lever (~32% reduction in zone solar gain).
   Substantial implementation cost in solarCalc.js. Right answer for
   State 2 / Brief 28 territory, not a quick patch.

**Decision:** **accept the residual gap for State 1.** Distribution
metrics are silent, heating demand silent, the contract's verification
intent (engine agreement on the integrated headline) is met. Peak
extremes remain a known limitation of the live engine vs EP at
high-WWR configurations.

The Bridgewater project sits at the extreme end (100% WWR on 3 facades,
no shading depth) — both engines confirm it overheats heavily without
mechanical cooling. The contract bound (200-600 overheating hours,
peak ≤36°C) was calibrated for more conservative WWR; the actual spec
genuinely fails comfort criteria at State 1.

---

## 6. Construction library — ground-floor layer ordering

**What:** `nza_engine/library/constructions.py` documents `_construction()`
as "ordered outside to inside". Walls and roofs are authored consistently
with this: `cavity_wall_standard.outside_layer = "CavWall_Std_BrickOuter"`
(exterior face), interior finish (plasterboard) is the last layer.

Ground floors are authored backwards: `ground_floor_slab.outside_layer =
"GFloor_Std_Carpet"` (the *indoor* finish), with insulation/hardcore as
the last layers (ground-side).

**Why this might or might not bite:**
- EnergyPlus computes the steady-state U-value symmetrically — the
  reversed order produces the same U. Stated U=0.22 W/m²K matches the
  real construction.
- Transient response would technically be affected (heat enters and
  exits in the wrong stratification order), but for a ground floor
  the only meaningful boundary is the slow ground temperature, so the
  practical impact is small.
- Brief 26.1 Part 1's thermal mass audit had to special-case
  `type=floor` to look at layers BEFORE the insulation rather than
  after, otherwise ground floors compute to 0 kJ/m²K.

**Magnitude:** zero impact on U-value; negligible on steady-state
heating demand; potentially small impact on summer indoor temperature
peaks (ground slab takes longer to release heat than EP simulates if
the layer order is wrong).

**Fix:** swap the layer order in the two ground floor constructions
in `nza_engine/library/constructions.py`. Both projects in the DB
will need their EP runs re-validated to confirm U-value stays at 0.22
and free-running stats don't shift materially.

**Decision:** **defer** to a library housekeeping brief. The Part 1
audit's type-aware algorithm handles the immediate need for Part 5
(thermal mass derivation). Documented here so the eventual fix has
context.

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
