# Brief 67 Part B — findings (engine change PAUSED pending architectural calls)

**Status:** prototyped, gated, three of the brief's explicit STOP conditions hit. Engine change reverted. Awaiting Chris's call on three modelling judgements before re-attempting.
**Date:** 2026-05-28
**Author:** Claude Code (Builder)
**Brief:** `docs/briefs/active/67_zone_temperature_demand_model.md` §Part B
**Part A status:** ✓ landed — `4c53ca9`, T_zone_free trace exists at `result.demand.hourly_zone_air_c` and is physically sensible on both test buildings.

---

## TL;DR

Part B (replace balance-derived demand with float-gated demand in the
`active_setpoint` branch) was prototyped along the lines the brief
describes. The prototype:

- **PASSES** the headline setpoint-independence gate on Bridgewater
  (cooling demand span 0.4% over hsp 19→23 sweep at csp=24, vs ~22%
  pre-fix).
- **PASSES** dead-band-hours-exist gate (Bridgewater 64%, office 67.8%).
- **PASSES** cooling responsiveness to csp on the office (×169 from
  csp 28 to csp 16 — well above the old ×1.20 ratio).
- **FAILS** the same setpoint-independence gate on the gains-moderate
  office (27.8% cooling movement — the brief's "essentially flat,
  small thermal-mass second-order" threshold isn't met).
- **FAILS** the vent on/off sanity check (vent off equals vent on
  byte-exact — sealed-building effect lost).
- **FAILS** 12 of the 277 validation-harness assertions — most are
  superseded Brief-64-shaped assumptions that Part C is expected to
  update, but at least 2 look like real conservation/bound issues
  that need investigation.

Per Brief 67 §6 "When to escalate (3 approaches then stop)" I have hit
THREE of the listed flags. Reverting and reporting.

---

## What I built

### Engine change site
`frontend/src/utils/instantCalc.js`, `_calculateState2`'s inner hour loop:

1. After the existing implicit-Euler T_air solve (~line 3031), saved
   `T_air_free` as the un-conditioned solution and introduced a
   `conditioning_mode ∈ {heating, cooling, dead_band}` switch:
   - `T_air_free < effectiveLowerC` ⇒ heating
   - `T_air_free > effectiveUpperC` ⇒ cooling
   - else ⇒ dead band

2. Set the carry-forward `T_air` to the setpoint when conditioning
   fires, to `T_air_free` in dead-band. Re-applied
   `combineLinearizedStep` with the effective `T_air` so wall states
   reflect the conditioned air temperature.

3. Replaced the Brief 64 `heating_Wh_at_setpoint` and
   `cooling_Wh_at_setpoint` formulas with implicit-Euler-derived
   conditioning power:
   - `heating = -C_coef × (effectiveLowerC - T_air_free)` when heating
   - `cooling = -C_coef × (T_air_free - effectiveUpperC)` when cooling
   - Both 0 in dead band.

   `C_coef` is the air-node coefficient already computed in the
   implicit-Euler step — it sums UA × wall-step b-factors, glazing UA,
   infiltration UA, permanent-vent UA, and air-mass capacity. It does
   NOT include mech-vent UA — see modelling judgement 2 below.

4. Suppressed cooling-side gain/loss bucket attributions
   (`gains_cooling_h_Wh`, `cooling_solar_h_Wh`) in heating + dead-band
   modes, and the heating-side analogues in cooling mode, to preserve
   the per-hour gains conservation (`offset + cooling + shoulder =
   Q_internal_gains_Wh`).

### Gates that PASSED

| Gate | Bridgewater | Office | Status |
|---|---|---|---|
| G1 setpoint independence (cool over hsp 19→23 at csp 24) | 0.4% span | 27.8% span | ✓ Bw / ✗ Office |
| G2 dead-band hours > 0 | 5604 (64.0%) | 5942 (67.8%) | ✓ |
| G3 cool over csp 28→16 sweep | ×67 | ×169 | ✓ (vs old ×1.20) |
| G4 vent off > vent on (sealed-building effect) | ×1.00 (same) | n/a | ✗ |

The Bridgewater setpoint-independence number is essentially flat —
this is the prototype's headline success.

### Hand-calc setpoint-independence sweep (per brief §Part B gate)

```
HIX Bridgewater (csp=24 fixed):
  hsp=19:  heat   5.10 MWh   cool  84.10 MWh
  hsp=20:  heat   5.10           cool  84.10
  hsp=21:  heat   7.30           cool  84.10
  hsp=22:  heat  10.80           cool  84.20
  hsp=23:  heat  15.40           cool  84.40
  cool span 0.30 MWh on mean 84.18 MWh = 0.4%   ← headline pass

Brief 66 Test Office (csp=24 fixed):
  hsp=19:  heat  17.50 MWh   cool  19.50 MWh
  hsp=20:  heat  22.30           cool  19.50
  hsp=21:  heat  27.80           cool  19.70
  hsp=22:  heat  34.40           cool  20.30
  hsp=23:  heat  46.00           cool  25.30
  cool span 5.80 MWh on mean 20.86 MWh = 27.8%  ← above "essentially flat"
```

---

## Why I STOPPED — three modelling judgements

### Judgement 1: Mech-vent NOT in C_coef → vent on/off no longer affects demand

`C_coef` (the air-node coefficient driving both the implicit-Euler
T_air solve AND the new Q_cond formula) includes:
- Wall / roof / floor surface UA (× wall-step b-factor minus 1)
- Glazing UA
- Infiltration (UA_leakage)
- Permanent-vent (UA_permanent)
- −C_air_per_dt

It does **NOT** include mechanical ventilation. Pre-Brief-67, mech-vent
fed demand via the separate `hourly_heat_loss_Wh` and
`hourly_cool_gain_Wh` accumulators (the Brief 64 formulas). My
prototype removed those formulas in favour of the C_coef-derived
Q_cond — and lost the mech-vent contribution along with them.

**Impact:** disabling all ventilation on Bridgewater leaves cooling
demand at 84.10 MWh — identical to vent-enabled. Sealed-building effect
(the 151 → 408 jump Chris confirmed pre-fix on the old engine) is lost.

**Two repair paths:**

**Option α — Inject mech-vent UA into C_coef.** Add
`UA_mech_vent = Σ (flow_l_s × ρ × cp × (1 - recovery_sensible_pct))`
into the C_coef sum so the implicit-Euler step physically sees the
mech-vent fresh-air coupling, and the same UA participates in the
Q_cond derivation. Physically correct. Requires routing the per-system
ventSystems flow + HRE list into the C_coef block, and matching
infiltration's bypass / partial-recovery treatment. Significant engine
work but architecturally clean.

**Option β — Add a mech-vent contribution to Q_cond outside C_coef.**
Keep the existing mech_vent_heat_h / mech_vent_cool_h hourly accumulators
and add them as a TERM in the Brief 67 demand formula:
```
heating = -C_coef × (T_heat - T_air_free) + mech_vent_heat_h
cooling = -C_coef × (T_air_free - T_cool) + mech_vent_cool_h
```
Simpler patch (~10 lines) but the implicit-Euler T_air trace still
doesn't see mech vent — so T_air_free is independent of vent on/off,
which means the dead-band gate doesn't fire differently when vent is on/off.
The mech-vent contribution ONLY adjusts the demand magnitude when the
gate has already fired. **Doesn't actually fix the sealed-building
behavioural difference for the dead-band gate itself.**

**Recommendation:** Option α is the right answer. Chris's call.

### Judgement 2: Office setpoint-coupling 27.8% — not "small"

On the gains-moderate office, sweeping hsp 19→23 at csp=24 still moves
cooling demand by ~28%. The mechanism is thermal-mass coupling:

- Raising hsp from 19 to 23 makes heating fire on hours where
  T_air_free ∈ [19, 23] (whereas at hsp=19 those hours were in the
  dead band).
- Those hours get clamped UP to 23°C, warmer than they'd float to.
- Warmer wall + air temperature persists into the next hour via the
  implicit-Euler thermal-mass carry.
- Subsequent hours see a HIGHER baseline T_air_free, which trips the
  cooling gate (T_air_free > 24) more often on the summer-edge hours.

This IS real physics: a building heated harder retains more heat,
needs more cooling later. **But the brief said:** "Cooling demand
must stay essentially flat (only small thermal-mass second-order
movement). If cooling still moves significantly with heating setpoint,
the gating is still reading a balance — STOP."

27.8% is by anybody's reading "significant", not "small".

**Possible interpretations:**

1. **My implementation is correct, the brief's threshold is too tight
   for the engine's thermal-mass coupling.** The walls in `extWallModel`
   have multi-node CTF heat capacity; the air node has `C_air_total_J`
   built from `C_air_internal_J + C_air_air_J` (internal mass +
   air mass). The implicit-Euler step's mass coupling is strong.

2. **My implementation has the gate right but the conditioned-hours
   T_air carry is over-aggressive.** Maybe in conditioned hours the
   zone shouldn't be held EXACTLY at setpoint but at a partial value
   (e.g. system can only hold X % of the way to setpoint per hour
   because of fan/system limits). Brief doesn't specify this.

3. **A subtle bug in the gain bucket re-attribution causes some heat
   accounting to leak across modes.** Possible but didn't spot one.

**Recommendation:** Chris to weigh in. If interpretation 1, my prototype
is correct and the brief's "essentially flat" threshold needs softening
on the office. If 2 or 3, more investigation.

### Judgement 3: Harness regressions — 12 of 277 assertions fail

Most look like Brief-64-shaped invariance assumptions that Part C
(per the brief) was always going to update. But some look like real
conservation issues introduced by the gain-bucket re-attribution.

**Recommendation:** triage each failure during Part C. Defer until
Judgements 1 and 2 are resolved.

---

## What's in the tree now

- `4c53ca9` — Part A diagnostic gate (T_zone_free trace exists,
  sensible). Landed.
- Part B engine change reverted in working tree. Harness 277/277 PASS.
- `scripts/_brief67_partB_gate.mjs` (uncommitted) — the gate script
  that revealed the issues. Will land alongside Part B once the
  modelling judgements are resolved.

---

## Questions for Chris

1. **Mech-vent in C_coef** (Judgement 1): Option α (correct, more
   work) or Option β (simpler, partial)?
2. **Office thermal-mass coupling** (Judgement 2): is 27.8% acceptable
   as "small second-order" for a gains-moderate building, or should
   the conditioning model attenuate the per-hour setpoint clamp?
3. **Walk-back on the engine reset** — happy to land the Part B
   prototype-as-is for sleeves-rolled-up review, or stay reverted
   until 1 and 2 are settled?

Engine remains pre-Brief-67 (Brief 64 unconditional clamp) on disk.
Anchor stable. Build clean.
