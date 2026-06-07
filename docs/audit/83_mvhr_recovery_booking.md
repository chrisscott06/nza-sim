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

### §4.1 — What was instrumented

- **Engine (additive, diagnostic-only):** `instantCalc.js` now emits
  `result.demand.mech_vent_loss_hourly_w` / `mech_vent_gain_hourly_w` — the per-hour post-recovery net
  mech-vent loss/gain (W), the same values summed into `losses.mech_ventilation`. Verified the hourly
  loss sums **exactly** to `losses.mech_ventilation` (1.2820 MWh) and heating/cooling demand are
  unchanged (2.4917 / 1.4070 MWh). No physics/demand change.
- **EnergyPlus (output-only IDF edit):** added Hourly `Output:Variable` for OA Sensible
  Heating/Cooling + Heat Recovery Sensible Heating/Cooling (`generate_idf.py` → regenerated IDF →
  re-ran EP). Annual totals unchanged (heating 3.2775, cooling 0.6768 MWh, EUI 166.6) — confirms
  output-only.
- **Extractors:** `validation/energyplus/extract_mvhr_hourly.py` and `extract.mjs --mvhr-hourly` →
  two parallel 8760-row CSVs at `validation/{engine}/results/bridgewater_box_v1_mvhr_hourly.csv`.

### §4.2 — Headline totals

| Net mech-vent (MWh/yr) | EnergyPlus | NZA-Sim |
|---|---|---|
| Heating side | 0.6596 | 1.2820 (+94.4 %) |
| Cooling side | 0.0052 | 0.0051 |

The cooling side is **identical** — the entire mech-vent divergence is the heating side. (EP annual
`oa_sensible 3.6882 − heat_recovery 3.0286`; recovery ratio 0.821.)

### §4.3 — The decisive decomposition (gap = 0.6224 MWh)

Classifying every hour by whether EnergyPlus's heating coil actually ran
(`supply_air_heating > 0`):

| Bucket | NZA net heat | EP net heat |
|---|---|---|
| **Shared EP-coil-heating hours (4426 h)** | 0.9139 | 0.8816 |
| EP coil OFF (free-float / cooling hours) | **0.3681** (100 % NZA free-float) | **−0.2220** |
| **Total** | **1.2820** | **0.6596** |

`gap 0.6224 = shared-hour diff 0.0323 + NZA-books-in-EP-off-hours 0.3681 + EP-negative-in-off-hours 0.2220`

- **Shared coil-heating hours: NZA and EP agree to 3.7 %** (ratio 1.037). **The per-hour recovery
  fraction is ~75 % in both** — there is no 54 %-recovery shortfall.
- **+0.3681 MWh (59 % of the gap):** NZA books a heating-side vent loss in hours EP's coil is off — and
  **100 % of those are NZA free-float hours** (`heating_demand = 0`). NZA accrues
  `ventUA·(21 − T_out)` in *every* hour `T_out < 21`; EP only books an OA coil load when the coil runs.
- **−0.2220 MWh (36 % of the gap):** in cooling/shoulder hours EP's sensible HX *warms* incoming OA
  (T_zone 24 > T_out), reported as `Heat Recovery Sensible Heating` with zero OA coil load → EP's net
  heating goes *negative*. NZA does not carry an equivalent negative term.
- Hour counts: NZA books a vent loss in **8409 h** (≈ all hours `T_out < 21`); EP net-heating > 0 in
  only **4282 h**.

### §4.4 — Spot check (10 hours)

| h | T_out | EP T_z | NZA T_z | EP net | NZA net | EP coil-heat | NZA demand |
|---|---|---|---|---|---|---|---|
| 10 | 10.7 | 21.0 | 21.1 | 0.158 | 0.149 | 0.314 | 0 |
| 11 | 10.7 | 21.0 | 21.1 | 0.158 | 0.156 | 0.294 | 0 |
| 12 | 10.8 | 21.0 | 21.1 | 0.156 | 0.147 | 0.270 | 0 |
| 4001 | 20.5 | 24.0 | 24.0 | 0.000 | 0.013 | 0.000 | 0 |
| 4002 | 19.2 | 24.0 | 24.0 | 0.000 | 0.036 | 0.000 | 0 |
| 5000 | 17.2 | 24.0 | 24.0 | 0.000 | 0.049 | 0.000 | 0 |
| 5001 | 18.5 | 24.0 | 24.0 | 0.000 | 0.030 | 0.000 | 0 |

Hours 10-12: EP coil heats, both zones ≈ 21, **NZA demand = 0 (floats at 21.1)** yet NZA's vent loss
≈ EP's (per-hour recovery agrees). Hours 4001-5001: EP zone pinned at 24 (cooling), EP net = 0, but
NZA still books a heating-side vent loss because `T_out < 21`.

### §4.5 — Falsifiability outcome (premise-check CONFIRMED)

The brief's P4 falsifiability expected NZA per-hour effective recovery ≈ **0.54**. **That expectation is
REFUTED.** NZA's per-hour recovery fraction is **~0.75** (by construction `recovery/(net+recovery) =
3/(1+3) = 0.75`, and the shared-coil-hour net agrees with EP to 3.7 %). The "0.54" was never a
per-hour recovery fraction — it was the Brief-82 ratio `recovery_offset/(loss+recovery_offset)`, which
mixes the State-2 all-hours net loss with the State-3 demand-capped display offset (P2 §2.6). **The
data confirms the P2/P3 premise-check: there is no recovery-fraction bug.**

**No hard-STOP on "gap worse" (no fix yet) — but this triggers the brief's premise hard-STOP:** the
operative mechanism is *not* any of the four predicted recovery-booking candidates. It is an
**accounting-domain mismatch** (NZA reports vent loss as a zone-balance "loss at setpoint" over all
heating-degree hours; EP reports a coil OA load over coil-run hours), and it is **coupled to Finding
A** — 100 % of NZA's excess sits in free-float hours, the very hours Brief 82 attributed to the
solver/float convention. The P5 verdict carries this to its conclusion.

---

## §5 — P5: MVHR booking discrepancy verdict + proposed fix

### §5.1 — Verdict: the premise is refuted — there is no recovery-fraction bug

> **PREMISE-CHECK ESCALATION (Brief 76 authority).** The brief and design note frame Brief 83 as
> "NZA shows ~54 % effective recovery vs EP's ~82 %, both nominally 75 % — fix the recovery integration
> so effective recovery reaches 75 %." **The P2-P4 evidence refutes this.** NZA's per-hour MVHR
> recovery is **~75 %**: in the 4426 hours where EnergyPlus's heating coil actually runs, NZA's net
> mech-vent loss agrees with EnergyPlus's to **3.7 %** (0.9139 vs 0.8816 MWh, ratio 1.037). The "54 %"
> was never an engine recovery fraction — it is the Brief-82 artifact
> `recovery_offset/(loss+recovery_offset)`, which divides the State-3 demand-capped *display* offset by
> a denominator built from the State-2 all-hours net loss (P2 §2.6). Two different formulas over two
> different hour domains; their ratio is not an effectiveness.

### §5.2 — Which candidate mechanism is operative? — none of the four

| Brief candidate | Operative? | Evidence |
|---|---|---|
| 1. Recovery as zone gain vs supply preheat | No | NZA uses `(1−HRE)` loss-UA reduction (net-equivalent to supply preheat) — P2 §2.2 |
| 2. Recovery applied to extract vs supply | No | Net `(1−HRE)` formulation; per-hour net matches EP to 3.7 % in coil-run hours |
| 3. Wrong ΔT (T_zone vs T_supply) | Marginal | Setpoint-vs-actual-zone ΔT explains only the 0.032 MWh (5 %) shared-hour difference |
| 4. Missing zone-temperature feedback | Marginal | Same setpoint-vs-actual issue; small |

**The operative mechanism is a fifth one the brief did not predict: an accounting-domain mismatch.**
NZA's `losses.mech_ventilation` is a **zone-balance "loss at setpoint"** term accrued in *every* hour
`T_out < 21` (the same convention used for fabric/glazing/leakage losses); EnergyPlus's
`oa_sensible − heat_recovery` is a **coil OA load** accrued only when the heating coil runs. The +94 %
gap decomposes (P4 §4.3) as 59 % "NZA books vent loss in free-float hours EP's coil is off" + 36 %
"EP's HX warms incoming OA in cooling-season hours (negative net) which NZA has no analogue for" + 5 %
shared-hour ΔT-reference. **100 % of NZA's excess is in free-float hours — the Finding A hours.**

### §5.3 — Is it single or coupled? — coupled to Finding A, by construction

The excess is not an independent ventilation error. It lives entirely in the hours where NZA's zone
free-floats (Finding A). The mech-vent "loss at setpoint" booking and the free-float warmth are **two
views of the same phenomenon**: NZA books a setpoint-referenced vent loss in hours the zone is actually
floating above the setpoint with no system running. You cannot move this number without engaging how
the float is treated.

### §5.4 — What is the minimum fix? — there is no in-scope fix; all paths hit a hard-STOP

Three candidate "fixes" were considered against the brief's hard-STOPs:

1. **Gate the reported loss to heating-mode hours.** Would drop ~free-float hours from
   `losses.mech_ventilation`. **Rejected:** (a) violates CLAUDE.md Rule 9 — the vent loss in free-float
   hours genuinely enters the zone energy balance (it sets `T_air_free` via `C_coef`), so it must
   appear in the breakdown; (b) it is tuning the report to match EP's domain, which the brief forbids.
2. **Re-reference the loss ΔT from setpoint (21) to the actual zone temp `T_air`.** **Rejected:** (a)
   reads the air-node solver's `T_air` — Finding A / Brief 84 territory (explicit hard-STOP); (b) in
   free-float hours `T_air > 21`, so the loss would grow — it makes the gap **worse** (hard-STOP "P7
   makes gap worse"); (c) it would break the "loss at setpoint" convention shared by all envelope-loss
   lines (a cross-cutting architectural change, >30 lines).
3. **Add an EP-style negative heat-recovery term in cooling/shoulder hours.** **Rejected:** new
   ventilation physics entangled with summer behaviour, not a "booking" fix, and again couples to the
   float.

**Every gap-closing change either touches the solver (Finding A), violates Rule 9, makes the gap
worse, or tunes the report to pass — all forbidden.** This is precisely the brief's hard-STOP: *"P5
verdict requires touching the air-node solver to fix MVHR booking. STOP. The two are coupled in ways
Brief 82 didn't anticipate."*

### §5.5 — Recommendation (no engine fix in Brief 83; options for Chris)

**Land NO engine fix.** Brief 83 resolves as a **diagnostic-only outcome** (the brief explicitly
sanctions this: *"A diagnostic-only outcome … is still valuable — Brief 83 becomes 'Finding B
diagnosis'."*). The recovery booking is correct; the gated metric was comparing non-analogous
quantities. Options, for Chris to decide (none are Brief 83 engine changes):

- **(A) Harness fix (recommended).** Make `compare.py` compare like-for-like for mech-vent: restrict
  NZA's loss to EP-coil-run hours (or compare NZA's *coil-domain* loss). The per-hour data shows this
  agrees with EP to ~4 %. A validation-harness change, not an engine change — clean and honest.
- **(B) Re-frame the metric.** Document that NZA's `losses.mech_ventilation` is a complete
  zone-balance loss (Rule 9) and EP's is a coil load; the +94 % is a definitional difference, not a
  defect. Keep both numbers, stop gating on their direct difference.
- **(C) Fold into Brief 84.** Since 100 % of the excess is in free-float hours, the mech-vent
  "loss at setpoint" convention and the free-float warmth are the same phenomenon; address the
  reporting convention alongside the solver characterisation.

The diagnostic instrumentation added in P4 (per-hour arrays + EP hourly outputs + extractors) stays —
it is the evidence base and will serve Brief 84.

---

## §6 — P6: Implement the fix — NO ENGINE FIX LANDED (premise corrected)

Per the P5 verdict, **no engine fix is landed in Brief 83.** The brief explicitly sanctions this:
*"A diagnostic-only outcome (Parts 1-5 complete, Part 6 fix not landed) is still valuable — Brief 83
becomes 'Finding B diagnosis'."*

**Why no fix is the correct outcome, not a failure to find one:**

1. **There is nothing to fix in the recovery booking.** The recovery fraction is ~75 % in both engines;
   per-hour net mech-vent loss agrees with EnergyPlus to 3.7 % in coil-run hours (P4 §4.3). The "54 %
   effective recovery" was a Brief-82 artifact, not an engine value (P2 §2.6, P5 §5.1).
2. **The +94 % gated gap is a comparison-of-different-objects artifact**, coupled to Finding A — 100 %
   of the excess is in free-float hours. Closing it would require one of the changes ruled out in P5
   §5.4, each of which trips a brief hard-STOP (touch the air-node solver / violate Rule 9 / make the
   gap worse / tune the report to pass).
3. **Landing a wrong fix is worse than landing none.** The brief is explicit: *"If the harness doesn't
   pass after the fix, the fix is wrong — diagnose, don't tune."* The diagnosis says the harness
   metric is mis-paired; the disciplined response is to correct the premise, not the engine.

**What did change (P4, diagnostic instrumentation — retained):** the opt-in per-hour mech-vent arrays
in `instantCalc.js`, the hourly OA/recovery `Output:Variable` lines in `generate_idf.py` + regenerated
IDF, and the two extractors. These are additive, off the critical path, change no demand/physics value
(verified: heating 2.4917 / cooling 1.4070 MWh, EP EUI 166.6 unchanged), and form the evidence base
Brief 84 will reuse. They are **not** a fix; they are the diagnosis's instruments.

**No commit for P6** beyond this audit note (folded into the P7/P8 commits) — there is no code fix to
commit. Branch unchanged in engine behaviour; `main` untouched at `d8a6207`.

---

## §7 — P7: Post-fix Bridgewater-Box re-validation

Re-ran the full harness (`run.py` → `extract.mjs` → `compare.py`). **Because no engine fix was landed
(P5/P6), the gated comparison is byte-for-byte the Brief 81 verdict — this is the expected and correct
outcome, not a failed fix.**

| Gated metric | Brief 81 | Brief 83 (no fix) | EnergyPlus | Result |
|---|---|---|---|---|
| EUI (kWh/m²) | 160.4 | 160.4 | 166.6 | PASS (−3.7 %) |
| Heating demand (MWh) | 2.492 | 2.492 | 3.278 | FAIL (−24.0 %) |
| Cooling demand (MWh) | 1.407 | 1.407 | 0.677 | FAIL (+107.9 %) |
| Fabric conduction (MWh) | 5.454 | 5.454 | 4.909 | PASS (+11.1 %) |
| **Mech-vent net loss (MWh)** | **1.282** | **1.282** | **0.665** | **FAIL (+92.9 %)** |
| Monthly heating r | 0.993 | 0.993 | — | PASS |
| Monthly cooling r | 0.945 | 0.945 | — | PASS |

### §7.1 — The brief's expected post-fix outcomes vs reality

| Brief P7 expectation | Outcome | Honest reading |
|---|---|---|
| Mech-vent closes to ±15 % | **NOT closed** (+92.9 %) | Correct — there was no recovery bug to fix; the gap is a comparison-of-objects artifact (P5) |
| Cooling reduces substantially | Unchanged (+107.9 %) | Cooling is Finding A (free-float), untouched here |
| Heating widens slightly | Unchanged (−24.0 %) | No fix, so no Finding-A coupling movement to observe |
| Effective recovery ~75 % | **Confirmed ~75 %** (per-hour, P4 §4.3) | The one expectation the data meets — and it was already true |
| EUI / fabric / monthly unchanged | **Confirmed unchanged** | No envelope/physics touched |

The brief's guard *"if mech vent doesn't close, the fix is wrong — go back to Part 5"* does **not**
apply: there is no fix. P5's re-diagnostic established that the mech-vent gap is not a fixable
recovery-booking defect. Re-running P5 would re-derive the same verdict.

### §7.2 — Like-for-like comparison (the metric that should have been gated)

When the mech-vent loss is compared *on the same domain* (EnergyPlus's coil-run hours), the engines
agree:

| Comparison | NZA-Sim | EnergyPlus | Delta |
|---|---|---|---|
| Net mech-vent loss, **all hours** (the current gated metric) | 1.282 | 0.660 | +94 % |
| Net mech-vent loss, **EP coil-run hours only** (like-for-like) | 0.914 | 0.882 | **+3.7 %** |
| Per-hour recovery fraction | ~0.75 | ~0.75 (0.82 mode-mixed annual) | ~match |

This is the evidence for P5 recommendation (A): a one-line harness change (restrict the mech-vent
comparison to coil-run hours) would move this metric from FAIL (+94 %) to PASS (+3.7 %) **without any
engine change** — because the engine was already right.

### §7.3 — Engine-behaviour invariants confirmed

`heating_demand 2.4917`, `cooling_demand 1.4070`, `losses.mech_ventilation 1.2820` (hourly sum ==
aggregate), EP RunPeriod heating 3.2775 / cooling 0.6768 / EUI 166.6 — all identical to Brief 81. The
P4 diagnostic instrumentation changed no physical value.

---

## §8 — P8: Close summary + Brief 84 handoff

**Status: Brief 83 CLOSED 2026-06-07 — diagnostic-only outcome (no engine fix; premise corrected).**
All work on `feat/energyplus-validation` (branch tip `d6f964c` at start). `main` never touched
(`d8a6207` throughout); branch verified before every commit.

### §8.1 — What Brief 83 delivered

| Part | Deliverable | Commit |
|---|---|---|
| P1 | Brief landing + branch verify + audit stub | `a25eb70` |
| P2 | Source read — NZA MVHR integration (+ premise-check flag) | `73da3c4` |
| P3 | Source read — EnergyPlus MVHR reference | `931bf2d` |
| P4 | Per-hour MVHR extraction both engines (engine diag arrays + EP hourly outputs + extractors + CSVs) | `b5129f8` |
| P5 | Discrepancy verdict — premise refuted, escalation | `9ee127e` |
| P6 | (No engine fix — diagnostic-only; folded into audit) | — |
| P7 | Re-validation — harness unchanged (correct); like-for-like agreement | `abea317` |
| P8 | This close + STATUS + Brief 84 handoff | _(this commit)_ |

### §8.2 — The finding in one paragraph

**Brief 83's premise is refuted: there is no MVHR recovery-booking bug.** Source reads (P2/P3) and the
per-hour heat-flow comparison (P4) show NZA-Sim applies ~75 % sensible recovery per hour, agreeing with
EnergyPlus to **3.7 %** in the hours EnergyPlus's heating coil actually runs. The "+92.9 % mech-vent
loss" gated failure and the "~54 % effective recovery" framing are artifacts of comparing two different
accounting objects: NZA's `losses.mech_ventilation` is a zone-balance **loss-at-setpoint** integrated
over *every* heating-degree hour (the same convention as all envelope-loss lines), while EnergyPlus's
`oa_sensible − heat_recovery` is a **coil OA load** that only accrues when the coil runs. **100 % of
NZA's excess sits in free-float hours** — making this divergence one face of Finding A, not an
independent ventilation defect.

### §8.3 — Status of the findings

- **Finding B (MVHR recovery booking): REFRAMED, not closed.** It is not a recovery-fraction bug. The
  recovery booking is correct. The gated metric is mis-paired (different domains). No engine change was
  warranted; landing one would have tripped a hard-STOP (solver touch / Rule 9 / gap-worse / tune).
- **Finding A (free-float warmth): unchanged.** The brief anticipated Finding A's delta *widening* as
  Finding B closed. **That did not happen** — because Finding B was not a bug and nothing closed. The
  two findings are even more tightly coupled than Brief 82 framed: the mech-vent "excess" *is* the
  free-float behaviour measured through the ventilation-loss line. Zone temp delta stays +0.49 °C; the
  Brief 82 numbers are unchanged.

### §8.4 — Recommended Brief 84 scope

1. **Harness like-for-like fix (small, separate, do first).** Restrict `compare.py`'s mech-vent
   comparison to EnergyPlus coil-run hours (or compare NZA's coil-domain loss). Moves the metric from
   +94 % FAIL to +3.7 % PASS **with no engine change** (P7 §7.2). This is the honest correction of the
   Brief-81 metric mis-pairing. Could ship as a tiny "Brief 83a" or Brief 84 Part 1.
2. **Finding A characterisation (the real remaining work).** Brief 84 as originally scoped: the
   free-float warmth (~+1 °C) from the implicit-Euler lumped-mass solver convention (Brief 82 §5.2).
   Quantitative NZA-lumped-mass (`C_thermal ≈ 31.7 MJ/K`) vs EnergyPlus CTF/timestep comparison.
   **Fold the mech-vent "loss at setpoint" reporting convention into this work** — since the excess is
   entirely free-float hours, the two are the same phenomenon viewed through two outputs.
3. **Do NOT** pursue an MVHR recovery-fraction "fix" — there is no such bug (this brief's evidence).

### §8.5 — Brief discipline / safety

No engine fix landed (diagnostic-only, brief-sanctioned). P4 added only additive, off-critical-path
diagnostic instrumentation (verified: no demand/physics/EUI change). No air-node solver change. No
tolerance re-tuning. No tuning to pass. Premise-check escalation documented per Brief 76 authority and
the brief's own hard-STOP. Only Brief-83 files staged each commit; pre-existing dirty working-tree
files left untouched. `main` stayed `d8a6207`; branch pushed to origin without merge.
