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

### §5.1 — The decisive experiment is blocked (a finding in itself)

The clean way to localise the internal-mass contribution is to vary it and re-measure. The engine has a
hook for exactly this — `opts.tuning.internal_mass_J_per_K_per_m2` (`_calculateState2` L2602, used by
unit tests). I built a read-only probe (`validation/nza_sim/internal_mass_probe.mjs`) sweeping
{250 000, 100 000, 50 000, 25 000, 0} J/(K·m²) and measuring the free-float delta over the fixed
EP-unconditioned reference set. **Result: ZERO change** — delta 1.061 °C and heating/cooling 2492/1407
kWh identical at every value, including 0.

Cause (source-confirmed): **`calculateInstant` does not forward `opts.tuning` to `_calculateState2`.**
At L4959-4962 it calls `_calculateState2(..., { setpointOverride: {...} })` — a fresh opts object with
no `tuning` key. So the internal-mass hook is **live only when `_calculateState2` is called directly
(unit tests); it is dead through the production entry point** the harness and app use. `_calculateState2`
is not exported, so it cannot be driven directly without an engine change either.

> **Premise-check note (Brief 76/83 authority).** This is a **real, minor defect** (a wired-but-not-
> forwarded parameter), distinct from — and not the cause of — the free-float delta. It is flagged
> because it **blocks both this brief's empirical sensitivity test and any Brief 85 calibration via the
> hook.** Wiring `opts.tuning` through the L4961 call (≈1 line) is the prerequisite for an
> evidence-based calibration. I did **not** make that change (84b is no-engine-change); it is a Brief 85
> step.

### §5.2 — What the physics says about the mass contribution (mean vs amplitude)

For the linear free-float air-node ODE `C·dT/dt = ΣUA·(T_drive − T) + Q_gains`, the equilibrium
`T_eq = [ΣUA·T_drive + Q_gains]/ΣUA` is **independent of the capacitance C**. C sets only the time
constant `τ = C/ΣUA` — it damps the diurnal **amplitude** (bigger C → warmer nights, cooler days) and
adds phase lag. So:

- The **night-heavy variation** in the delta (night +1.39 vs midday +0.72, a ~0.67 °C swing; §2.2) is
  **consistent with NZA's larger capacitance** (25 MJ/K internal mass vs EP's 0) over-damping the
  diurnal swing — the clearest mass fingerprint.
- The **mean offset** (~+1.06 °C) is **not** what capacitance produces in periodic steady state
  (mean-preserving). **However**, the real system is not periodic-steady: free-float segments are finite
  windows seeded by the carry-forward temperature from the preceding (clamped) hours, and a larger C
  relaxes more slowly from a warm clamp-seeded start — so C **can** lift the free-float-subset mean too.
  How much is exactly the quantity the blocked probe would have measured.

**Honest consequence:** the night-day *variation* is confidently mass/damping; the *mean* is partly mass
(finite-window, clamp-seeded relaxation) and partly a separate free-float-regime offset (ΣUA coupling
via the surface RC `b_inside_node` terms, the sol-air drive on opaque walls, the 70 %-to-air gains
split, and/or the 1st-order integration bias). I **cannot cleanly partition** the +1.06 °C mean within
scope, because the one decisive experiment is blocked (§5.1) and isolating the rest would require engine
instrumentation 84b forbids. Stating this rather than manufacturing a single-cause number (CLAUDE.md
Rule 10).

### §5.3 — Ranked candidates (against P2 signature + P3/P4 source)

| Rank | Mechanism | Evidence | Confidence |
|---|---|---|---|
| 1 | **Lumped internal-mass mismatch** — NZA 25.0 MJ/K (98.6 % of air capacitance) vs EP 0 (no `InternalMass`) | Dominant structural capacitance difference (P3/P4); over-damping explains the night-heavy amplitude (P2 §2.2); contributes to the mean via clamp-seeded slow relaxation (§5.2) | **High** that it is the primary driver of the diurnal/night-heavy component; **moderate/unquantified** for its share of the mean (probe blocked) |
| 2 | **Integration order + timestep** — NZA 1-step/hr 1st-order implicit Euler vs EP 6/hr 3rd-order backward difference | Coarse low-order implicit step adds numerical damping; compounds the mass effect (P4 §4.3) | **Plausible secondary**; cannot isolate without an engine change |
| 3 | **Free-float ΣUA / drive coupling** — surface RC `b_inside_node` terms, sol-air drive, 70 %-to-air gains split | A genuine ΣUA or drive difference is the only thing that can move the *mean* in steady state; ΔT-driven sign (P2 r=+0.50) is consistent | **Possible** contributor to the mean; not isolated this brief |
| 4 | Surface convection (`R_si` vs TARP/DOE-2) | Tuning sweep: "no measurable response at Bridgewater's R_total" (§3.4) | **Weak** here |
| 5 | Air-node closure (mixing/stratification) | Both engines single-zone, well-mixed | **Not a differentiator** |

### §5.4 — Verdict

The brief's working hypothesis — **"the +1 °C free-float offset is a structural solver-convention
difference, defensible on both sides, not a bug in either engine"** — is **SUPPORTED for the delta
itself.** The difference is dominated by a thermal-storage/transient-response mismatch: NZA carries a
large lumped internal mass (25 MJ/K, a *tuned* default of 250 kJ/(K·m²) calibrated to EP's *summer
max*, 2.5× its own documented best-match value) and integrates the air node once per hour at 1st order,
while the EP reference box models **no** internal mass and integrates 6×/hour at 3rd order. Both
conventions are individually defensible (real buildings have internal mass; the EP reference box
deliberately omits it). It is **not** a gains-handling bug (P2: delta falls under solar/occupancy) and
**not** a flat solver offset (CV 0.61).

**Two caveats kept honest:** (i) the dominant single knob's quantitative contribution is **not
measured** because the tuning hook is dead via the production path (§5.1) — a real, separate, ≈1-line
defect; (ii) the **mean** component is only partly attributable to mass and is **not cleanly
partitioned** within scope (§5.2). This is therefore **not** a clean outcome (a); it sits between
**(b) calibration** (reduce/derive the internal mass, after wiring the hook, and re-measure) and
**(d) coupled/ambiguous** (a residual mean offset may remain after the mass knob is exercised). P6
recommends the Brief 85 scope accordingly.

Commit: `Brief 84b P5: solver-convention localisation + ranked candidates`.

---

## §6 — P6: Brief 85 recommendation

**Recommended Brief 85 shape: a staged, evidence-gated calibration investigation — primarily outcome
(b), with (a) and (d) as live branches the Step-1 measurement selects between.** Not a single action,
and not pre-committed to a value.

### §6.0 — Step 0 (prerequisite, tiny engine fix): wire the dead tuning hook

Before anything can be measured or calibrated, forward `opts.tuning` from `calculateInstant` into the
`_calculateState2` call (instantCalc.js L4961: add `tuning: options.tuning` to the opts object — and to
the `state2Recompute` closure at L4972 for parity). ≈1–2 lines. This is a legitimate **bug fix** (a
wired-but-dropped parameter, §5.1), independent of the calibration decision, and is the prerequisite for
every later step. It must land under CLAUDE.md Rule 14 (State 1 / State 2 / inline-legacy parity if the
forward touches a shared path) and change **no** number at the default value (250 000) — verify the
harness is byte-identical with the hook wired but unchanged, then proceed.

### §6.1 — Step 1 (decisive measurement, read-only after Step 0)

Re-run `validation/nza_sim/internal_mass_probe.mjs` (now live) and measure how much of the **+1.10 °C
free-float delta** — and downstream, the **−24 % heating / +108 % cooling** gaps — closes as the
internal mass moves from 250 kJ/(K·m²) toward EP-box-like values (100 k / 50 k / 0). This is the single
experiment P5 was blocked from running. It partitions the delta into "mass-knob-addressable" vs
"residual mean offset" and tells Brief 85 which outcome it is in:

- **Most of the delta closes** → outcome **(b)**: calibrate the internal mass (§6.2).
- **A substantial mean residual remains at low mass** → outcome **(d)**: the residual is a separate
  free-float-regime ΣUA / sol-air / gains-split / integration offset; open a focused diagnostic for it
  (and consider (a) tolerance-widening for the irreducible convention component).

### §6.2 — Step 2 (the calibration decision, if Step 1 confirms (b))

The comparison is a **deliberately bare box**: EP models no internal mass; NZA bakes in a generic
250 kJ/(K·m²) of furniture/partition mass the box does not contain. The honest reconciliation is to make
the two models **agree on the internal-mass assumption**, not to tune NZA to pass. Options for Chris
(architect's call — I do not pre-pick):

1. **Derive NZA's internal mass from the construction stack** instead of a flat default — the in-code
   Brief 28b Part 5 candidate already noted at L1045. Most physically defensible; for a bare box this
   yields a small internal mass, aligning with EP. Generalises beyond Bridgewater-Box.
2. **Lower the NZA default toward its own documented best-match value** (the tuning comment cites 100 kJ
   for the summer-max match vs the live 250 kJ; §3.3) — smaller, faster, but still a flat default.
3. **Add an `InternalMass` object to the EP reference IDF** representing the same furniture/partition
   assumption NZA makes — makes EP match NZA rather than vice-versa. Defensible if the validation target
   is "a furnished building," less so for a clean envelope reference.

Any choice must be **physics-grounded, not fitted to the tolerance** (brief constraint). Re-run the
harness after, expecting the free-float delta and the heating/cooling gaps to narrow together (they are
one finding — Brief 83).

### §6.3 — The (a) branch (defensible-difference) stays legitimate

Because the difference is defensible on both sides, Brief 85 may instead **document it and widen the
free-float-related comparison tolerance** with cited reasoning — appropriate if Step 1 shows the
residual mean offset dominates (mass can't close it) or if Chris decides NZA's internal-mass convention
is correct-as-is for real (furnished) buildings and the bare-box reference is the artefact. This keeps
the engine unchanged.

### §6.4 — What Brief 85 must NOT do

Tune any parameter to make the comparison pass (calibration must be physics-grounded); change the
air-node solver architecture (the convention difference is defensible, not a bug); or treat the
free-float delta as independent of the heating/cooling/mech-vent gaps (Brief 83 proved they are one
finding — closing the float narrows all of them together, and per Brief 83 the heating/cooling gaps will
move when the float moves).

Commit: `Brief 84b P6: Brief 85 recommendation`.

---

## §7 — P7: Close summary + STATUS update + Brief 85 handoff

**Status: Brief 84b CLOSED 2026-06-08 — diagnostic-only characterisation.** All work on
`feat/energyplus-validation` (branch tip `359f079` at start). `main` never touched (`d8a6207`
throughout); branch verified before every commit. **No engine change, no IDF change, no tolerance
change.**

### §7.1 — What Brief 84b delivered

| Part | Deliverable | Commit |
|---|---|---|
| P1 | Brief + design note landing + evidence inventory | `1e4b087` |
| P2 | Free-float delta characterisation (`freefloat_diagnostic.py` + report) | `023de72` |
| P3 | NZA-Sim air-node solver source read | `06b278c` |
| P4 | EnergyPlus solver convention source read | `776183d` |
| P5 | Solver-convention localisation + ranked candidates (`internal_mass_probe.mjs`) | `9401910` |
| P6 | Brief 85 recommendation | `dfddb6d` |
| P7 | This close + STATUS + handoff | _(this commit)_ |

### §7.2 — Evidence chain (P2→P5)

- **P2 — the delta is conditional, loss-side.** Free-float (both engines unconditioned, 2949 h) delta
  **+1.10 °C** (97.5 % of hours NZA warmer). It **grows as outdoor falls** (r = −0.57) and with
  indoor−outdoor ΔT (r = +0.50), is **night-heavy** (1.41 night vs 0.66 midday), and is **lower under
  solar/occupancy** (r = −0.27; 0.82 occupied vs 1.34). Fingerprint of a thermal-storage / transient-
  response difference; **not** a gains-handling bug, **not** a flat offset (CV 0.61).
- **P3 — NZA.** Implicit-Euler air node, **single hourly step**. Zone capacitance 25.36 MJ/K is
  **98.6 % a tuned lumped "internal mass"** (`TUNE_INTERNAL_MASS_J_M2` = 250 kJ/(K·m²)), calibrated to
  EP's **summer max** (its own note cites 100 kJ as best, and records mean ~1.7 K / winter-min ~4 K
  cooler as a known open gap). Convection via `R_si` (insensitive here).
- **P4 — EnergyPlus.** CTF, **6 steps/hour**, default 3rd-order air node, TARP/DOE-2 convection,
  **zero `InternalMass`**, zone-air multiplier 1.0. So EP carries **0 MJ/K** internal mass vs NZA's
  25 MJ/K — the single large capacitance term with no EP counterpart.
- **P5 — localisation.** The decisive sweep is **blocked**: `calculateInstant` drops `opts.tuning`
  (L4961), so the internal-mass hook is dead via the production path (probe shows zero sensitivity) and
  `_calculateState2` isn't exported. Physics: capacitance is mean-preserving in periodic steady state,
  so the **night-heavy variation** is confidently the mass over-damping, but the **+1.06 °C mean** is
  only partly mass (finite-window, clamp-seeded relaxation) and partly a separate free-float ΣUA /
  sol-air / gains-split / integration offset — **not cleanly partitioned** within scope.

### §7.3 — Verdict + confidence

**The brief's hypothesis is SUPPORTED:** the free-float offset is a **structural solver-convention
difference, defensible on both sides, not a bug** in either engine. It is dominated by a thermal-storage
mismatch — NZA's 25 MJ/K tuned lumped internal mass (vs EP's 0) plus its coarse 1-hour 1st-order
integration (vs EP's 6/hr 3rd-order). **Confidence:** high on the *mechanism class* (thermal storage /
transient response) and on the *structural facts* (25 vs 0 MJ/K; 1×1st vs 6×3rd); **moderate and
explicitly unquantified** on the single-knob magnitude attribution, because the decisive experiment is
blocked by the dead tuning hook and the mean component is partly a separate, un-isolated offset. Outcome
sits between **(b) calibration** and **(d) coupled/ambiguous** (not a clean (a); not a (c) bug — with
the one exception below).

### §7.4 — Recommended Brief 85 scope

Staged, evidence-gated (full detail §6): **Step 0** wire the dropped `opts.tuning` (≈1–2 line bug fix,
prerequisite); **Step 1** run the now-live internal-mass sweep to partition the delta (selects (b) vs
(d)); **Step 2** if (b), make both models agree on the internal-mass assumption (derive from
constructions [most defensible] / lower the flat default / add EP `InternalMass`) — physics-grounded,
not fitted; **(a)** branch (document + widen free-float tolerance) stays legitimate if the residual mean
dominates. Brief 85 must not tune-to-pass, must not change solver architecture, and must treat the
float delta as **one finding** with the heating/cooling/mech-vent gaps (Brief 83).

### §7.5 — Open questions for Chris

1. **Internal-mass philosophy:** should NZA model generic furniture/partition mass by default (realistic
   for furnished buildings, the current 250 kJ), or derive it from the construction stack (matches a
   bare reference, generalises)? This decides Step 2's option.
2. **Validation-target philosophy:** is the Bridgewater-Box reference meant to be a *bare envelope*
   (then NZA's internal mass is the artefact) or a *furnished building* (then add EP `InternalMass`)?
3. **Tolerance vs engine change:** if Step 1 leaves an irreducible mean residual, prefer documenting a
   defensible difference + a widened free-float tolerance (a), or a deeper free-float-ΣUA diagnostic (d)?

### §7.6 — Brief discipline / safety

Diagnostic-only: no engine code, no IDF, no tolerance change. New artifacts are read-only diagnostics
(`freefloat_diagnostic.py`, `internal_mass_probe.mjs`) + their report; the existing per-hour CSVs were
sufficient (no new instrumentation). The dead `opts.tuning` forward was **flagged, not fixed** (Brief 85
Step 0). Premise-check honoured: the brief's framing held; the one new defect (dropped tuning) is a
separate minor bug, not the delta's cause. Only Brief-84b files staged each commit. `main` stayed
`d8a6207`; branch pushed to origin without merge.
