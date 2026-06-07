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

Read-only. All refs `frontend/src/utils/instantCalc.js` (the custom JS engine). Constant
`AIR_HEAT_CAPACITY = 0.33` kWh/(m³·K) (L168).

### §2.1 — Where recovery is applied (State 2)

The MVHR sensible recovery is folded into the **ventilation conductance** at build time (L2983-2987):

```js
const ventUA = ventSystems.map(v => {
  const Q_m3_h = v.flow_l_s * 3.6            // L/s -> m³/h  (50 -> 180)
  const sched_factor = v.hours / 8760
  return AIR_HEAT_CAPACITY * Q_m3_h * (1 - v.hre) * sched_factor   // W/K — recovery active
})
```

With `hre = 0.75`, `ventUA = 0.33 × 180 × 0.25 = 14.85 W/K`. This UA enters **two** places:

1. **The heat-balance solver** — `UA_mech_vent_h` accumulated into `C_coef` (L3188-3207), which sets
   `T_air_free` and hence the demand. **This is the air-node solver — Finding A / Brief 84 territory.
   DO NOT TOUCH.**
2. **The reported per-hour mech-vent loss** (L3407-3447):
   ```js
   const UA_eff = bypass_h ? ventUA_bypass[vi] : ventUA[vi]
   const heat_h = UA_eff * dT_heat_out
   acc_mech_vent_heat_per_system[vi] += heat_h
   ```
   `acc_mech_vent_heat_per_system` is summed into `losses.mech_ventilation` (L4210-4231) — **the gated
   metric** (`mech_ventilation_mwh.loss` in `extract.mjs` L203; Brief 81 = 1.282 MWh).

### §2.2 — What form does recovery take?

**Extract/supply-loss reduction**, not a separate zone gain. The `(1 − HRE)` factor scales the
ventilation loss UA down to its post-recovery value. This is net-equivalent to EnergyPlus's
supply-side preheat (recovered heat reduces the load), so **brief candidate 1 ("recovery as a separate
zone gain") is NOT what NZA does**, and **candidate 2 ("applied to extract loss")** is the right
description in net terms.

### §2.3 — What ΔT is used?

`dT_heat_out = max(0, T_heat − T_out)` (L3321) where **`T_heat` is the heating setpoint (21 °C)** — not
the actual (warmer, free-floating) zone temperature, and not the extract temperature. So the loss is
booked against `(21 − T_out)`, the **setpoint-to-outdoor** ΔT. (Brief candidate 3 "wrong ΔT" and
candidate 4 "missing zone-temp feedback" both touch this: NZA uses setpoint, not actual extract temp.)

### §2.4 — Per-hour vs annualised, and the critical gating point

The reported mech-vent loss is accumulated **per hour, over EVERY hour with `T_out < 21`** — the
accumulation at L3422 is inside the main hourly loop and is **NOT gated by `conditioning_mode`**. It
fires in heating hours, cooling hours, AND free-float hours alike. (The *demand*
`heating_demand_hourly_kwh` IS mode-gated at L3675-3729; the *reported vent loss* is not.) So on a
gain-dominated box that free-floats above 21 °C for ~1900 of its heating-degree hours (Brief 82:
EP-heats/NZA-free = 1912 h), NZA books a ventilation loss in those free-float hours too.

### §2.5 — The second (display-only) recovery path

`computeVentilationEnergy` (L4711-4878, State 3) separately computes an **effective recovery offset**:
theoretical `flow·ρCp·HRE·Σ(21−T_out)₊·sched`, then **capped per hour** at the building's heating
demand (`min(theoretical_h, demand_h)`, L4833). This yields `effectiveRecoveryMwh` →
`consumption.space_heating.recovery_offset_mwh` (1.531 MWh; `extract.mjs` L204).

**Crucially, this offset is DISPLAY-ONLY.** The engine comment is explicit (L5097-5104): *"AFTER
Brief 50: State 2 owns recovery exclusively via its (1 − HRE) factor… recovery_offset_mwh is still
surfaced on consumption.space_heating for the BreakdownPanel… its semantic role shifts from 'amount
subtracted at this boundary' to 'amount State 2 baked in', but the magnitude is unchanged."* It is
**not** subtracted from demand a second time (the Brief-18b double-subtraction bug is already fixed).

### §2.6 — How this maps to the "54 % effective recovery" observation

Brief 82 computed effective recovery as `recovery_offset / (loss + recovery_offset) = 1.531 / (1.282 +
1.531) = 54.4 %`. **This ratio is a definitional artifact, not the engine's recovery fraction:**

- The numerator (`recovery_offset`, 1.531) is the State-3 **demand-capped** integral using
  `HRE·Σ(21−T_out)₊`.
- The denominator term (`loss`, 1.282) is the State-2 **all-heating-degree-hours** integral using
  `(1−HRE)·Σ(21−T_out)₊`.
- They use different formulas over (effectively) different hour domains, so their sum is **not** a
  physical "gross", and their ratio is **not** the recovery effectiveness.

The recovery fraction the engine actually applies to the demand is the clean **75 %** baked into
`(1 − HRE)`. There is no 54 %-recovery bug in the demand path.

### §2.7 — Premise-check flag (Brief 76 authority) — provisional, P4 adjudicates

> **The architect's framing — "NZA shows ~54 % effective recovery, fix the recovery integration to
> reach 75 %" — appears to target a derived artifact, not the operative mechanism.** The source shows
> the recovery fraction is already 75 %. The gated-metric failure (net loss 1.282 vs EP 0.665, +92.9 %)
> is most plausibly an **hour-domain + ΔT-reference mismatch**, not a recovery-fraction error:
>
> 1. **Hour domain (leading hypothesis).** NZA reports the vent loss over *all* heating-degree hours
>    (incl. ~1900 free-float hours where the zone sits above 21 and no heating runs); EnergyPlus's
>    `oa_sensible_heating` only accrues when the ideal-loads heating coil actually runs. Magnitude
>    check: net UA 14.85 W/K ⇒ NZA's `Σ(21−T_out)₊ = 1.282 MWh / 14.85 W/K ≈ 86 300 K·h`; EP's implied
>    integral `0.665 MWh / 14.85 ≈ 44 800 K·h` — about half, consistent with EP booking over roughly
>    half the hours (actual-heating vs all-heating-degree).
> 2. **ΔT reference (secondary).** NZA books against the setpoint `(21 − T_out)`; EP nets recovery
>    against the extract/zone temperature. Likely small relative to (1).
>
> **This must be confirmed by P4's per-hour data before any fix.** The decisive test: in
> actual-heating hours, does NZA's per-hour net vent loss ≈ EP's? (If yes → recovery fraction is fine,
> gap is hour-domain.) In free-float hours, does NZA book a vent loss while EP books ~0? (If yes →
> hour-domain confirmed.)
>
> **Scope consequence (flagged early).** If the operative mechanism is hour-domain/reporting, the fix
> must change only the *reported* `acc_mech_vent_heat_per_system` accounting (e.g. align its domain to
> EP's heating-coil convention) and must **NOT** alter `UA_mech_vent_h`/`C_coef` — that is the air-node
> solver (Finding A / Brief 84). It must also respect CLAUDE.md Rule 9 (every heat-balance term still
> appears in the breakdown). P5 designs this against the P4 evidence; if the only correct fix turns out
> to require touching the solver, that is a hard-STOP per the brief.

**Not a hard-STOP at P2.** The hypothesis is strong but unconfirmed; the brief's flow routes the
adjudication through P3 (EP reference) + P4 (per-hour data) before the P5 verdict. Proceeding to gather
that evidence rather than escalating on a P2 hypothesis alone.

---

## §3 — P3: Source read of EnergyPlus's MVHR recovery (reference)

Refs `validation/energyplus/bridgewater_box_v1.idf` and `validation/energyplus/run.py`.

### §3.1 — Which object handles MVHR

There is **no** standalone ERV/HX object. MVHR is modelled *inside* the ideal-loads system (IDF
L656-683):

```
ZoneHVAC:IdealLoadsAirSystem, Box_IdealLoads,
    … NoLimit heating / NoLimit cooling …
    Box_MVHR_OA,   !- Design Specification Outdoor Air Object Name   (50 L/s, Flow/Zone)
    NoEconomizer,  !- Outdoor Air Economizer Type   (no summer bypass — matches fixture)
    Sensible,      !- Heat Recovery Type
    0.75,          !- Sensible Heat Recovery Effectiveness
    0.0;           !- Latent Heat Recovery Effectiveness
```

`DesignSpecification:OutdoorAir Box_MVHR_OA` = Flow/Zone 0.050 m³/s (IDF L614-620). So the MVHR is the
ideal-loads system's mandatory outdoor-air stream, with a sensible HX at ε = 0.75 and no economizer
(no bypass).

### §3.2 — How recovery integrates into the zone heat balance

The OA is drawn at `T_out` continuously (50 L/s). The sensible HX pre-conditions it against the
exhaust (zone) air: `T_oa_post_hx = T_out + 0.75·(T_zone − T_out)`. The ideal-loads coil then conditions
the air the rest of the way to meet whatever zone load remains. Recovery is a **supply-side preheat**
(winter) / pre-cool (summer): it reduces the coil's OA load. The OA exchange happens every hour the
system is available, but the **coil OA load is only the residual after recovery, and is only non-zero
when the coil actually conditions the zone.**

### §3.3 — How effective recovery is computed in EP outputs

`run.py` (L276-280) reads, per the RunPeriod (and Brief 82 added Hourly for some):

- `Zone Ideal Loads Outdoor Air Sensible Heating Energy` → `oa_sensible_heating` (3.688 MWh)
- `Zone Ideal Loads Heat Recovery Sensible Heating Energy` → `heat_recovery_sensible_heating` (3.029 MWh)
- cooling counterparts (`oa_sensible_cooling`, `heat_recovery_sensible_cooling`)

Brief 81 net mech-vent loss = `oa_sensible_heating − heat_recovery_sensible` (+ cooling side) =
**0.665 MWh**; the annual ratio `heat_recovery / oa_sensible ≈ 82 %`. The 82 % exceeds the nominal 75 %
ε because it is an annual mode-mixed ratio of two coil-domain integrals, **not** a per-hour
effectiveness (per-hour ε is exactly 0.75 by construction). The `run.py _note` is explicit:
`supply_air_sensible` is "the net zone+OA sensible demand the system meets (after heat recovery) — the
direct analogue of NZA-Sim heating/cooling demand," with "OA + heat-recovery terms reported separately
for the … mech-ventilation mapping."

### §3.4 — What NZA should match (or why it can't) — the structural difference

| | NZA-Sim `losses.mech_ventilation` | EP `oa_sensible_heating − heat_recovery` |
|---|---|---|
| Domain | **Zone-balance** loss term | **Coil** OA load (residual after recovery) |
| ΔT reference | `(T_setpoint 21 − T_out)` | `(T_supply≈T_zone − T_out)`, recovery vs `(T_zone − T_out)` |
| Hours booked | **every** hour `T_out < 21` (incl. free-float) | only hours the ideal-loads coil runs |
| Recovery fraction | 75 % (via `1−HRE`) | 75 % per-hour ε (82 % mode-mixed annual) |
| Brief 81 value | 1.282 MWh | 0.665 MWh |

The two numbers are **different accounting objects** (Brief 81 §10.3 already flagged "no clean
cross-engine analogue"). Both apply 75 % recovery per hour; the gap is the **hour domain** (NZA: all
heating-degree hours; EP: coil-run hours) and, secondarily, the **ΔT reference** (NZA: fixed setpoint
21; EP: the actual, warmer zone/extract temp). This is the EP-side confirmation of the P2 premise-check
hypothesis. **P4 quantifies the per-hour relationship to adjudicate decisively.**

### §3.5 — P4 wiring note (what the IDF still needs)

The IDF currently emits OA + heat-recovery sensible energies at **RunPeriod** frequency only (IDF
L710-714); hourly emits only Supply Air Sensible Heating/Cooling (L737-738) + zone mean air temp +
outdoor drybulb (Brief 82). **P4 must add `Hourly` `Output:Variable` for** `Zone Ideal Loads Outdoor
Air Sensible Heating Energy`, `… Sensible Cooling Energy`, `Zone Ideal Loads Heat Recovery Sensible
Heating Energy`, `… Sensible Cooling Energy`, and (for the supply/extract temp comparison the brief
asks for) `System Node Temperature` on the supply node `Box_Supply_Inlet` and OA node `Box_OA_Inlet_Node`
— then re-run EP. This is an additive output change to the IDF (the one narrow IDF edit P4 permits);
no model physics change.

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
