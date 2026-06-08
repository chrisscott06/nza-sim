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

_(to be written at P3)_

---

## §4 — P4: EnergyPlus solver convention source read

_(to be written at P4)_

---

## §5 — P5: Solver-convention localisation + ranked candidates

_(to be written at P5)_

---

## §6 — P6: Brief 85 recommendation

_(to be written at P6)_

---

## §7 — P7: Close summary + STATUS update + Brief 85 handoff

_(to be written at P7)_
