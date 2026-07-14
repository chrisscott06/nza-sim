# Audit — Bridgwater Baseline: Model-1 (As-Specified) close

**Brief:** `docs/briefs/archive/bridgwater-baseline-model1_COMPLETED.md`
**Date:** 2026-07-14 · **Engine SHA at close:** stamped in each export's metadata
**Project:** Bridgewater Hotel (`12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d`), GIA 4,215 m²
**Faithful engine run:** `calculateInstant(mode:'full')` on the pinned config with
backend-parsed construction layers (fixture `bw_model1_final.json`).

---

## Headline result

**Model-1 (as-specified) EUI = 119.2 kWh/m²/yr** · electricity 294.959 MWh · gas 207.599 MWh · total 502.558 MWh.

Inside the brief's hard stop-band (80–130). It sits ~4 kWh/m² **above** the soft
expectation corridor (90–115) — the brief flagged that band as "signals something
genuinely interesting"; §Finding 1 below is that interesting thing, and it is
reported, not tuned away (no parameter outside D1/D2 was touched).

### End-use table (faithful engine)

| End use | Fuel | MWh/yr | kWh/yr |
|---|---|---:|---:|
| Heating (VRF heat-recovery, SCOP_eff 4.31, incl. 43.1 MWh recovery offset) | Electricity | 14.454 | 14,454 |
| Cooling (VRF, SEER 3.5) | Electricity | 32.086 | 32,086 |
| DHW electricity (ASHP pre-heat + 1.05 MWh circ. pump) | Electricity | 19.165 | 19,165 |
| Ventilation fans (MVHR GF 17.476 + bedroom extract 7.737 + toilet extract 0.736) | Electricity | 25.949 | 25,949 |
| Lighting | Electricity | 55.578 | 55,578 |
| Small power / equipment | Electricity | 147.727 | 147,727 |
| Auxiliary (external lighting, `gains.auxiliary`) | Electricity | 0.000 | 0 — **see Finding 1** |
| **Electricity total** | | **294.959** | **294,959** |
| DHW gas (75% share, η 0.89) | Gas | 207.599 | 207,599 |
| **Gas total** | | **207.599** | **207,599** |
| **Grand total** | | **502.558** | **502,558** |

End uses reconcile to fuel totals exactly (sum of the six live electricity
lines = 294.959 = total; auxiliary residual = 0). EUI = 502,558 ÷ 4,215 = 119.2.

### Metered anchors (2025 triangulated) and gap

| Metric | Model | Metered | Δ (model − metered) | Δ% |
|---|---:|---:|---:|---:|
| Electricity | 294,959 | 572,400 | −277,441 | −48.5% |
| Gas | 207,599 | 207,700 | −101 | **−0.05%** |
| Total | 502,558 | 780,100 | −277,542 | −35.6% |
| EUI (kWh/m²·yr) | 119.2 | 185.1 | −65.9 | **−35.6%** |

The −35.6% total gap is the honest as-specified performance gap — the two-model
methodology's intended output. Model-2 (calibrated, future brief) closes it with
in-service de-rates + a named auxiliary residual.

---

## Part 2 — DHW gas-anchor

**Temperature-basis finding (read from `systemsEngine._computeDhw`).** The demand
`litres_per_person_per_day` is **tap-mix litres at the tap outlet temperature
(40 °C)**, not storage litres. The engine takes the hot fraction
`hot_fraction = (tap_outlet − cold) / (storage_setpoint − cold)` before applying
the water specific heat. Live temps: tap 40 °C, cold 10 °C, storage 60 °C →
`hot_fraction = 30/50 = 0.6`.

**Convergence.** Demand is linear in L/p/day, so the anchor was solved directly, not
guessed:
- Occupants = 138 rooms × 3 people/room × 0.971 = 401.99.
- Modelled DHW **gas** = 4.307 MWh per (L/p/day) at η 0.89 and the fixed 75/25 gas/ASHP split.
- Target 207.7 MWh ÷ 4.307 → **L = 48.2 L/p/day (tap-basis)**.
- Engine at L = 48.2 → gas **207.599 MWh** → Δ −0.05% vs 207.7 (well inside ±2%). ✓

**60 °C-equivalent:** V60 = 48.2 × 30/50 = **28.9 L/p/day**. Independent triangulation
reference ≈ 28.7 L/p/day @ 60 °C — the converged equivalent lands in that
neighbourhood. ✓ (L = 48.2 is inside the 15–60 sanity range; no structural alarm.)

---

## Finding 1 (MAJOR) — `gains.auxiliary` is inert in the instant engine

The 7 W/m² "auxiliary baseload" the brief describes as "pre-baked into Model-1
(~258 MWh/yr)" lives in `building_config.gains.auxiliary.profiles[0]`. **The instant
engine does not consume `gains.auxiliary` at all** — neither as an electrical
end-use nor as a thermal gain.

Proof (same fixture, only the auxiliary magnitude varied):

| `gains.auxiliary` magnitude | Electricity MWh | Gas MWh | EUI |
|---|---:|---:|---:|
| 0.3 W/m² (D1 value) | 294.959 | 207.599 | 119.2 |
| 7.0 W/m² (pre-D1 value) | 294.959 | 207.599 | 119.2 |
| 0.0 W/m² | 294.959 | 207.599 | 119.2 |

Identical to three decimals. Consequences:

1. **The D1 auxiliary correction (7 → 0.3 W/m²) moved zero modelled energy.** The
   data change is still correct and worth keeping — the entry is now labelled
   "External lighting" at the as-specified 0.3 W/m² — but it does not affect the EUI.
2. **The 258 MWh was never in the modelled EUI.** The pre-D1 baseline the brief calls
   a "hybrid producing near 185" actually modelled **EUI 118.6** (elec 323.443, gas
   176.488). The model was never at 185; 185.1 is the *meter*. The premise that a
   hidden aux was inflating the *model* toward 185 does not hold against the engine.
3. **The 7 W/m² is preserved as Model-2 raw material** (as the brief requires — it must
   not silently vanish). **But Model-2 must inject it through a *counted* path** — a
   Systems auxiliary load or a small-power line — because `gains.auxiliary` will be
   inert there too. Recorded: pre-D1 magnitude **7 W/m²** ≈ 258 MWh/yr if counted
   (7 × 4,215 × 8,760 h); as-specified external-lighting allowance **0.3 W/m²**.

This is reported per the brief's "audit before fix / report divergences" rule. No
engine change was made (out of scope). A follow-up task is flagged to decide whether
`gains.auxiliary` should be wired into the electricity balance or the UI category
retired.

## Finding 2 — Why EUI is 119.2, not the expected 90–115

Two D1/D2 effects nearly cancel (pre-D1 → post-D1):

| | Pre-D1 | Post-D1 | Δ |
|---|---:|---:|---:|
| Electricity MWh | 323.443 | 294.959 | −28.485 |
| Gas MWh | 176.488 | 207.599 | +31.111 |
| **EUI** | **118.6** | **119.2** | **+0.6** |
| occupancy_rate | 1.0 | 0.971 | |
| DHW L/p/day | 38 | 48.2 | |

- D1 efficiency corrections (SCOP 2.8→5.0, SEER 3.0→3.5, SFP 0.9→0.4 / 1.8→1.4,
  boiler η 0.85→0.89, ASHP COP 3.0→3.4) cut electricity by **−28.5 MWh**.
- The D2 DHW gas-anchor (38 → 48.2 L/p/day, to match the 207.7 MWh meter) *raised*
  gas by **+31.1 MWh**.

Net EUI barely moved (118.6 → 119.2). The brief's expectation that the result would
drop into 90–115 rested on the aux removal contributing; per Finding 1 it could not,
because the aux was never counted. 119.2 is the honest as-specified figure and is
inside the hard stop-band, so the brief was closed without adjustment.

---

## Verification checklist (brief §Verification)

1. **Gas anchor** — 207.599 MWh vs 207.7 target = −0.05% (≤ ±2%). ✅
2. **Exact-match** — every D1 value in the exported Inputs sheet equals the pinned
   inputs (SCOP 5.0, SEER 3.5, SFP 0.4/1.4, η 0.89, COP 3.4, EA 1.43 m², aux 0.3,
   occupancy 0.971). ✅
3. **Occupied rooms** — 138 × 0.971 = 134 (derived row). Peak occupants
   138 × 3 × 0.971 = 402. ✅
4. **Outputs integrity** — six live electricity end-uses sum to 294.959 = total
   (residual 0); EUI = 502,558 ÷ 4,215 = 119.2; Δ rows arithmetically correct. ✅
5. **EUI corridor** — 119.2 inside hard band 80–130 (≈4 above the soft 90–115;
   diagnosed in Findings 1–2, not tuned). ✅ (no STOP)
6. **SHA present** — engine git short SHA stamped in export metadata via
   `__APP_SHA__` (vite define). ✅
7. **Final EUI + end-use table** — reported above and in the final report. ✅

## Save-as-baseline

Corrected config pinned as the project baseline (`building_config.baseline_snapshot`,
schema `baseline/v1`) via the global baseline control's "Update baseline". Verified:
snapshot carries occupancy_rate 0.971, DHW 48.2 L/p/day, q50 4.64, and survives a full
reload (chip stays "✓ Baseline"). A loader round-trip bug was fixed en route — see
commit `af460b9` (`baseline_snapshot` was missing from the project-loader allow-list,
so pins persisted to the DB but were dropped on reload and would be wiped by the next
autosave). DB backed up pre-pin to
`C:\Users\ChrisScott\Backups\nza-sim-db\nza_sim_pre-model1-pin_2026-07-14.db`.

## Lessons / divergences from brief

- The brief's central premise (a hidden 7 W/m²/258 MWh auxiliary inflating the
  *model* toward 185) was falsified by the engine: the model was already ~119 pre-D1;
  185 is the meter. The performance gap is real and is the deliverable, but its size
  was already present, not created by removing the aux.
- Any future `gains.auxiliary` value is inert until the engine consumes that category.
  Model-2's auxiliary residual must be carried on a counted end-use.
