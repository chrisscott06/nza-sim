# Brief 84b — Finding A free-float characterisation (zone air-node solver convention) — audit

**Branch:** `feat/energyplus-validation` (continuation of Briefs 81 + 82 + 83). **NEVER merged to `main`.**
**Brief:** [`docs/briefs/active/84b_finding_a_freefloat.md`](../briefs/active/84b_finding_a_freefloat.md).
**Design note:** [`docs/design-notes/84b_finding_a_freefloat.md`](../design-notes/84b_finding_a_freefloat.md).
**Companion:** Brief 84a (harness like-for-like fix) — separate, parallel (CLOSED `359f079`).

---

## §0 — Context and receipt

Brief 82's "two findings" (A: zone +0.49 °C warmer; B: mech-vent +93 %) collapsed in Brief 83 into
**one** underlying phenomenon: **NZA-Sim's zone air node settles ~+1 °C warmer than EnergyPlus during
free-float (unconditioned) hours.** 100 % of the mech-vent "excess" lives in free-float hours (Brief 83
§4.3/§5.2); in coil-run hours the engines agree to 3.7 %. The warmer free-float reduces
below-21 °C hours (→ −24 % heating) and raises above-24 °C hours (→ +108 % cooling). Three of Brief
81's four FAILs trace to this single solver-convention difference.

**Brief 84b is diagnostic-only.** It characterises the free-float delta (constant vs conditional),
source-reads both solvers, localises the dominant mechanism, and recommends a Brief 85 scope
(a defensible-difference / b calibration / c bug / d ambiguous). **No engine change, no harness change
(that's 84a), no tolerance re-tuning, no `main`.** Premise-check authority (Briefs 76/83): if the
source read shows the framing is wrong, push back and reframe.

**Hard-STOPs:** P2 delta not concentrated in free-float → STOP/reframe; P3 source not where Brief 82
Appendix A located it → STOP; P5 needs to touch outside the air-node solver → STOP; P5 points at a real
bug → STOP (Brief 85 becomes a fix brief); any landing on `main` → STOP. Escalate after 90 min on any
sub-problem.

---

## §1 — P1: Brief + design note landing + evidence inventory

- Branch: `git branch --show-current` → `feat/energyplus-validation`. ✓
- Branch tip at landing: `359f079` (Brief 84a P5 close). ✓
- `main`: `d8a6207` (local and `origin/main`) — **unchanged since the branch cut.** ✓
- Brief landed at `docs/briefs/active/84b_finding_a_freefloat.md`; design note at
  `docs/design-notes/84b_finding_a_freefloat.md` (both verbatim from the authorised sources). Audit stub
  opened.

### §1.1 — Per-hour data already available (no new instrumentation needed)

| Source | File (×2, EP + NZA) | Columns relevant to 84b |
|---|---|---|
| Brief 82 P2 | `results/bridgewater_box_v1_hourly_temps.csv` | `hour_index, month, day, hour, zone_mean_air_temp_c, outdoor_drybulb_c, heating_demand_kwh, cooling_demand_kwh` |
| Brief 83 P4 | `results/bridgewater_box_v1_mvhr_hourly.csv` | + EP `supply_air_heating_kwh / supply_air_cooling_kwh` (coil-run flags), `net_mech_vent_*`, `heat_recovery_*`; NZA `net_mech_vent_*`, `recovery_heating_kwh`, `heating_demand_kwh`, `cooling_demand_kwh` |
| Weather (EPW) | `data/weather/current/GBR_ENG_Yeovilton...epw` | hourly direct-normal + diffuse-horizontal solar, wind — read-only via `load_fixture.mjs` `inputs.weatherData` |

All 8760-row, identically time-indexed (Brief 82 verified 0 calendar mismatches).

### §1.2 — Maps each P2 subordinate question to available data

| P2 question | Data | Notes |
|---|---|---|
| Free-float hour set (EP coil-off AND NZA setpoint-unbound) | EP `supply_air_*`/demand = 0 AND NZA `heating/cooling_demand` = 0 | both CSV families carry these |
| Delta stats (mean/median/std/min/max, %>0) | `zone_mean_air_temp_c` both engines | in free-float hours NZA's reported zone temp **is** its free-float temp (no clamp), so the delta = the free-float warmth directly |
| Conditional: external temp bands | `outdoor_drybulb_c` | in CSV |
| Conditional: time of day / season | `hour`, `month`, `day` | in CSV |
| Conditional: internal-gains magnitude | hour-of-day occupancy proxy | actual gains schedule not in CSV; hour-of-day proxy as Brief 82 §3.4 (occupied 08–18 vs not) |
| Conditional: solar incidence | EPW global horizontal (direct-normal·cosθ-free proxy: DNI + DHI) | derived read-only from the EPW; **not** new engine instrumentation |
| Conditional: ventilation on/off | n/a | Bridgewater-Box vent is constant 50 L/s (no schedule) — no on/off contrast (Brief 82 §3.4 Q2) |

### §1.3 — Verdict on instrumentation

**No new engine or extractor instrumentation is required.** The existing two CSV families answer
free-float identification, the delta statistics, and the temperature/time/season conditionals
directly; the solar conditional is derived read-only from the EPW. P2 will be a stdlib-only analysis
script (`validation/freefloat_diagnostic.py`) writing an ASCII report; matplotlib was unavailable in
Briefs 82/83 so CSV/ASCII output is the plan, plots only if matplotlib is present.

Commit: `Brief 84b P1: brief + design note landing + evidence inventory`.

---

## §2 — P2: Free-float delta characterisation + conditional analysis

**Script:** `validation/freefloat_diagnostic.py` (stdlib-only, read-only).
**Report:** `validation/reports/freefloat_diagnostic_2026-06-08T09-56-40Z.md`.
**Free-float definition (stricter than Brief 82's EP-mode classification):** EP heating+cooling
demand = 0 **AND** NZA heating+cooling demand = 0 — both engines genuinely unconditioned.

### §2.1 — The free-float subset and the delta

| Quantity | Value |
|---|---|
| EP unconditioned hours | 3161 (36.1 %) |
| NZA unconditioned hours | **5012 (57.2 %)** |
| Both unconditioned (the subset) | **2949 (33.7 %)** |
| Mean delta (T_NZA − T_EP) | **+1.099 °C** |
| Median / std / range | +1.052 / 0.673 / −0.86..+2.67 °C |
| Hours NZA warmer (delta > 0) | **97.5 %** |
| Hours |delta| < 0.1 | 3.6 % |

NZA free-floats in **1851 more hours** than EP (5012 vs 3161) — the direct consequence of settling
warmer (it crosses the 21 °C heating setpoint far less often). The 2949-hour both-unconditioned subset
matches Brief 82 §4b's EP-free∩NZA-free cell exactly. **Hard-STOP check (P2): the delta IS concentrated
in free-float hours** (97.5 % warmer, mean +1.10 °C; conditioned-hour delta ≈ 0 per Brief 82) — Brief
83's Finding-A framing is confirmed, no reframe needed.

### §2.2 — The delta is CONDITIONAL, and the conditionality is diagnostic

It is not a flat offset (CV = std/mean = 0.61). The conditional structure is the key evidence:

| Driver | Pattern | Pearson r |
|---|---|---|
| Outdoor drybulb | delta **grows as it gets colder**: 1.62 °C at [5,10) → 0.59 at [15,20) → −0.52 at ≥20 | **−0.568** |
| Indoor−outdoor ΔT | delta **grows with the loss-driving ΔT**: 0.21 at <5 → 1.03 at [5,10) → 1.55 at [10,15) → 1.81 at [15,20) | **+0.502** |
| Global horizontal solar | delta **larger at night** (1.36) than in sun (0.87 at ≥300 Wh/m²) | **−0.269** |
| Hour-of-day | **U-shaped, night-heavy**: ~1.41 at 00–06h and 22–24h, ~0.67 at 13–16h | — |
| Occupied (08–18h) vs not | **0.82 occupied vs 1.34 unoccupied** | — |
| Season | larger in shoulder months with many moderate-ΔT free-float hours (May 1.55, Jun 1.43, Sep 1.40); smaller deep-winter/high-summer | — |

### §2.3 — What the conditional signature means (and rules out)

The warmth **scales with the building's heat-loss rate** (ΔT-driven, colder-outdoor-driven) and is
**night-heavy and anti-correlated with solar/occupancy**. That is a **loss-side / thermal-storage**
signature: NZA sheds the building's stored heat *more slowly* than EnergyPlus during free-float, so the
zone settles warmer, and the gap is widest exactly when the loss rate is highest (cold nights) and
narrowest when fresh gains dominate (sunny occupied middays — both engines track the forcing).

This pattern **discriminates** between the four candidate mechanisms before the source read:

- **Consistent with thermal-mass / capacitance + timestep convention** (candidates 1 & 3): a
  mass-damped, single-hourly implicit-Euler zone relaxes toward the forcing more slowly than a
  distributed-CTF zone sub-stepped 6×/hour — producing exactly a ΔT-scaled, night-heavy warmth.
- **Inconsistent with a gains/solar-handling bug:** that would make the delta *grow* with solar and in
  occupied hours; the data shows the **opposite** (solar r = −0.27; occupied 0.82 < unoccupied 1.34).
- **Inconsistent with a flat solver offset** (a constant convention difference): CV 0.61, not ~0.
- **Convection-coefficient differences** (candidate 2) remain possible but would have to act through the
  same loss-rate channel; P3/P4 test whether NZA even uses surface convection explicitly.

### §2.4 — P2 answer to subordinate question 1

**The offset is conditional, not constant — and its conditionality is loss-rate-driven (ΔT, cold,
night), not gains-driven.** This is the fingerprint of a thermal-mass/timestep transient-response
difference between the two solvers. P3 (NZA source) and P4 (EP reference) localise the mechanism; P5
ranks the candidates against this signature.

Commit: `Brief 84b P2: free-float delta characterisation + conditional analysis`.

---

## §3 — P3: NZA-Sim air-node solver source read

All refs `frontend/src/utils/instantCalc.js`. The validation harness runs `engine:'v2.5'` → the State 2
path (`_calculateState2`, ~L2600–3300); the free-float trace Brief 82 used is `T_air_free_hourly`
(L2698). Read-only.

### §3.1 — Where the zone air-node temperature is integrated

State 2 hourly loop, **L3205–3222** — a one-step **implicit-Euler** solve of the single well-mixed air
node:

```js
const C_air_per_dt = C_air_total_J / dt          // dt = 3600 s (L3206)
const C_coef =
    UA_wall_eff*(stepWall.b_inside_node-1) + UA_roof_eff*(...) + UA_floor_eff*(...)   // surface RC coupling
  - UA_glaz - UA_leakage - UA_permanent - UA_mech_vent_h                              // direct air losses
  - C_air_per_dt                                                                      // capacitance
const D_coef =
    UA_wall_eff*stepWall.a_inside_node + ... (roof, floor)                            // surface RC drive
  + (UA_glaz + UA_leakage + UA_permanent + UA_mech_vent_h)*T_out                      // ambient drive
  + C_air_per_dt*T_air                                                                // PREVIOUS hour temp
  + Q_to_zone_air                                                                     // solar+internal gains
const T_air_free = -D_coef / C_coef               // L3222 (Brief 67's T_zone_free)
```

This is the implicit-Euler solution of `C_air·dT/dt = Σ surface + air-loss + gain terms`, solved for
`T^{n+1}` with the capacitance term `C_air_per_dt·T_air` carrying the **previous** hour's temperature.
**Single hourly step; no sub-stepping.** When conditioning fires the zone is clamped to setpoint and
that clamped value carries forward as `T_air` (L3234–3248); in free-float `T_air = T_air_free` carries
forward. All balance terms are present with correct signs (losses negative in `C_coef`, ambient + gains
positive in `D_coef`). Hard-STOP check (P3): **the source is exactly where Brief 82 Appendix A located
it** (the implicit-Euler `C_coef`) — no relocation, no STOP.

### §3.2 — The thermal capacitance `C_air_total_J` (the dominant term) — and how it is derived

State 2, **L2672–2674**:

```js
const C_air_air_J      = volume * 1.2 * 1005          // pure zone air: 300·1.2·1005 = 0.362 MJ/K
const C_air_internal_J = TUNE_INTERNAL_MASS_J_M2 * gia // 250_000 · 100 = 25.0 MJ/K
const C_air_total_J    = C_air_air_J + C_air_internal_J // 25.36 MJ/K  ⇒  C_air_per_dt = 7045 W/K
```

| Component | Value (box) | Share of `C_air_total` |
|---|---|---|
| Pure zone-air heat capacity (`volume·1.2·1005`) | 0.362 MJ/K | **1.4 %** |
| Lumped "internal mass" (`TUNE_INTERNAL_MASS_J_M2 · gia`) | **25.0 MJ/K** | **98.6 %** |
| **Total `C_air_total`** | **25.36 MJ/K** | (7045 W/K at dt=3600) |

So the zone-air capacitance is **almost entirely a single tuned parameter**,
`TUNE_INTERNAL_MASS_J_M2` (default **250 000 J/(K·m²)**, L2604; State 1 mirror L887). `C_air_per_dt`
(7045 W/K) is the dominant term in `−C_coef` (Brief 82 recovered ≈ 8793 W/K; the other ~1748 W/K is the
surface-RC + direct-loss UA). **Refinement of Brief 82 Appendix A:** it reported `C_thermal ≈
31.7 MJ/K` by treating the whole `−C_coef` as capacitance; the accurate figure is `C_air_total ≈
25.4 MJ/K`, of which 25.0 MJ/K is the tuned internal mass.

### §3.3 — Provenance of the tuning value (the load-bearing point)

The tuning block comment (**L869–883**) is explicit about how the internal-mass value was chosen:

> "internal_mass = 100 kJ/(K·m²) gives **EXACT summer max match** to EnergyPlus (35.5 °C vs EP 35.4 °C
> on Bridgewater) … Structural gaps remain (**mean T ~1.7 K cooler than EP, winter min 4 K cooler**) —
> these don't close with these knobs."

Two things matter for Finding A:

1. **The parameter was calibrated to a different target than Finding A measures.** It was swept to match
   EnergyPlus's *summer peak temperature* (overheating), **not** free-float winter/shoulder/night
   behaviour. A capacitance that nails the summer max can simultaneously be wrong for the night-time
   free-float relaxation rate — which is exactly the regime where Finding A's +1 °C lives (P2: ΔT-driven,
   night-heavy).
2. **The code default (250 000) does not match the comment's cited best value (100 000).** The comment
   block says 100 kJ matched summer max; the live default is **250 kJ** (L887, L2604). A 2.5× larger
   lumped mass over-damps the air node further — more heat retention overnight, warmer free-float. This
   discrepancy is itself a candidate contributor and a P5/P6 item (it is *not* an obviously
   physics-derived value — it is a tuning knob whose documented justification points at a smaller
   number).

### §3.4 — Surface convection, timestep, closure

- **Surface convection coefficients:** NZA does **not** use explicit `h_c` correlations in the air-node
  balance. Inside-surface coupling is via `R_si` (BS EN ISO 6946 constants `R_SI_WALL/ROOF/FLOOR`,
  L888–893 / 940–951) baked into each construction's RC model (`stepWallLinearized` → `U_eff`,
  `a_inside_node`, `b_inside_node`). The tuning comment (L879–880) found **"R_si has no measurable
  response at Bridgewater's R_total (insulation dominates)"** — so convection is a weak lever here
  (consistent with P2's signature not being convection-specific).
- **Construction mass:** separately from the lumped zone mass, opaque walls/roof/floor carry a
  **multi-node implicit RC** per stack (Brief 28b Part 3; `TS_wall/TS_roof/TS_floor`, `stepWallLinearized`)
  — distributed construction thermal mass that DOES respond dynamically. So NZA is *not* purely lumped:
  it is (distributed construction RC) + (lumped zone-air/internal-mass capacitance). The lumped internal
  mass is the larger, tuned, and less physically-grounded of the two.
- **Timestep:** single hourly implicit-Euler step (`dt = 3600`, one solve/hour). Implicit Euler at a
  coarse 1-hour step adds numerical damping to the transient response — a second mechanism that slows
  the modelled night-time cool-down relative to a finely sub-stepped scheme. (EnergyPlus default is 6
  steps/hour — confirmed in P4.)
- **Air-node closure:** one perfectly-mixed air node, no stratification. EnergyPlus is also single-zone
  well-mixed here, so closure is not a differentiator (candidate 4 weak).

### §3.5 — P3 summary (feeds P5)

NZA's free-float zone temperature is set by an implicit-Euler air-node solve whose capacitance is
**98.6 % a tuned lumped "internal mass"** (`TUNE_INTERNAL_MASS_J_M2` = 250 kJ/(K·m²), 25 MJ/K for the
box), stepped **once per hour**. The parameter was calibrated to EnergyPlus's **summer peak**, the
documented best value (100 kJ) is 2.5× below the live default (250 kJ), and the same tuning note already
recorded the engine running **mean ~1.7 K and winter-min ~4 K cooler than EP** — i.e. the free-float
*level* was a known open structural gap. Candidates entering P5, ranked by P2/P3 evidence: **(1)
lumped-internal-mass magnitude** [strong], **(3) 1-hour implicit-Euler numerical damping** [plausible
secondary], (2) convection [weak — R_si insensitive here], (4) closure [weak — both single-zone]. P4
quantifies EnergyPlus's effective mass + timestep to localise the dominant contributor.

Commit: `Brief 84b P3: NZA-Sim air-node solver source read`.

---

## §4 — P4: EnergyPlus solver convention source read

Refs `validation/energyplus/generated/bridgewater_box_v1.idf` (the Brief 81 P6 generated IDF, re-run in
84a P4). Read-only.

### §4.1 — EnergyPlus configuration (as authored)

| Object | Value (IDF line) |
|---|---|
| `HeatBalanceAlgorithm` | **ConductionTransferFunction** (CTF) (L38) |
| `Timestep` | **6 per hour** (L44) |
| `ZoneAirHeatBalanceAlgorithm` | **not specified → EnergyPlus default `ThirdOrderBackwardDifference`** |
| `SurfaceConvectionAlgorithm:Inside` | **TARP** (L32) |
| `SurfaceConvectionAlgorithm:Outside` | **DOE-2** (L35) |
| `InternalMass` | **0 objects** — EP models NO furniture/partition/content mass |
| `ZoneCapacitanceMultiplier:ResearchSpecial` | **0 objects** → zone-air capacitance multiplier = 1.0 |
| `Material` (construction layers) | 7 — distributed thermal mass via CTF |

### §4.2 — EnergyPlus's effective thermal mass vs NZA's

| Mass term | NZA-Sim | EnergyPlus (this IDF) |
|---|---|---|
| Pure zone air | 0.36 MJ/K (`volume·1.2·1005`) | 0.36 MJ/K (multiplier 1.0) |
| Construction mass (walls/roof/floor) | distributed implicit RC (`stepWallLinearized`, per stack) | distributed CTF (7 materials) |
| **Lumped internal mass (furniture/partitions)** | **25.0 MJ/K** (`TUNE_INTERNAL_MASS_J_M2` 250 kJ/K/m² × 100 m²) | **0** (no `InternalMass` object) |

**The differentiator is unambiguous.** Both engines model the zone air (identically, 0.36 MJ/K) and the
construction layers' mass (NZA via implicit RC, EP via CTF — different schemes, comparable physical
mass). The single large term NZA has that **EnergyPlus's reference box does not** is the **25.0 MJ/K
lumped internal mass** — 98.6 % of NZA's air-node capacitance (§3.2), with no EP counterpart. EP's box
is deliberately bare (constructions only); NZA's default bakes in 250 kJ/(K·m²) of furniture/partition
mass the box does not contain.

### §4.3 — The two structural differences, sized

1. **Internal-mass capacitance (dominant).** NZA's air node carries +25 MJ/K that EP's does not. A
   larger capacitance relaxes more slowly toward the (colder) night-time ambient, holding the zone
   warmer overnight and at high loss rates — **exactly the P2 signature** (ΔT-driven, night-heavy, gap
   shrinks under solar/occupancy when fresh gains dominate the transient).
2. **Integration order + timestep (secondary).** NZA: 1st-order implicit Euler, **1 step/hour**. EP:
   3rd-order backward difference, **6 steps/hour**. NZA's coarse, low-order step adds numerical damping
   to the transient, slowing the modelled cool-down on top of the mass effect. NZA cannot change its
   timestep without an engine-architecture change (out of 84b/85 calibration scope); it is noted as a
   contributor, not a knob.
3. **Convection (weak).** EP TARP(in)/DOE-2(out) dynamic correlations vs NZA's fixed `R_si`/`h_out`. The
   NZA tuning sweep already found R_si "no measurable response at Bridgewater's R_total" (§3.4); at this
   insulation level convection is not the lever.
4. **Closure (not a differentiator).** Both are single-zone, well-mixed.

### §4.4 — Is EnergyPlus's omission "right"? (framing for P5/P6)

Neither convention is universally correct. EP models exactly what the bare reference box specifies
(no internal mass). NZA bakes in a generic 250 kJ/(K·m²) internal mass — more realistic for a *furnished*
building, but an **over-modelling relative to this deliberately-bare EP reference**, and a flat tuned
default rather than a construction-derived value. So the free-float offset is, at root, a **modelling /
calibration difference in the lumped internal-mass term**, not a bug in either solver. P5 quantifies how
much of the +1.1 °C the internal-mass knob actually accounts for (read-only sensitivity probe via the
engine's existing `tuning.internal_mass_J_per_K_per_m2` hook — no engine change), and how much residual
is left to the integration-order/timestep difference.

Commit: `Brief 84b P4: EnergyPlus solver convention source read`.

---

## §5 — P5: Solver-convention localisation + ranked candidates

_(to be written at P5)_

---

## §6 — P6: Brief 85 recommendation

_(to be written at P6)_

---

## §7 — P7: Close summary + STATUS update + Brief 85 handoff

_(to be written at P7)_
