# Audit — Bridgwater Model-2 (In-Service Calibrated) close

**Brief:** `docs/briefs/archive/bridgwater-model2-calibrated_COMPLETED.md`
**Date:** 2026-07-15 · **Project:** Bridgewater Hotel (`12cf7cc4-…`), GIA 4,215 m²
**Faithful engine:** `calculateInstant(mode:'full')` with backend-parsed construction layers.
**Frozen fixture:** `docs/audit/fixtures/model2_base.json` (Model-1 starting config).
**Governing design note:** Notion "Two-model methodology" (inlined in-session; no conflicts found).

---

## Headline

Two named scenarios now exist on the project: **"Model 1 — as-specified"** (EUI 119.2) and
**"Bridgewater Hotel — calibrated (Model 2)"** (EUI **185.1 = metered**), plus the explicit
auxiliary residual that closes the electricity gap. The deliverable is the waterfall:

**Model 1 119.2 → evidenced in-service adjustments → 150.0 → auxiliary residual → 185.1 (metered).**

| Metric | Model 2 | Metered | Δ |
|---|---:|---:|---:|
| Electricity | 572,398 | 572,400 | −2 kWh (0.0%) |
| Gas | 207,700 | 207,700 | 0 (0.0%) |
| **EUI (kWh/m²·yr)** | **185.1** | 185.1 | 0.0 |

### Model-2 end-use table (faithful engine)

| End use | Fuel | MWh/yr |
|---|---|---:|
| Heating (VRF, SCOP 2.8) | Electricity | 30.897 |
| Cooling (VRF, SEER 3.0) | Electricity | 50.233 |
| DHW electricity (ASHP 40%, COP 2.8 + pump) | Electricity | 43.085 |
| Ventilation fans (SFP 1.8/0.8/0.8) | Electricity | 40.398 |
| Lighting (3.5 W/m²) | Electricity | 77.810 |
| Small power / equipment (147.7 base + 34.5 laundry + 147.75 residual) | Electricity | 329.975 |
| **Electricity total** | | **572.398** |
| DHW gas (60% share, η 0.85) | Gas | 207.700 |
| **Total** | | **780.098** |

---

## Waterfall (15 steps, canonical order — EUI after every step)

| # | Adjustment | Model 1 → Model 2 | EUI | ΔEUI |
|---|---|---|---:|---:|
| 0 | Model 1 baseline (as-specified) | — | 119.2 | — |
| 1 | U-values wall/roof/floor/glazing | 0.14/0.15/0.13/1.4 → 0.154/0.165/0.143/1.54 | 119.3 | +0.1 |
| 2 | Air permeability | 4.64 → 5.34 | 119.3 | +0.0 |
| 3 | Door-operation infiltration | — | 119.3 | **E1 skip** |
| 4 | Heating SCOP (VRF) | 5.0 → 2.8 | 121.8 | +2.5 |
| 5 | Cooling SEER (VRF) | 3.5 → 3.0 | 123.0 | +1.2 |
| 6 | SFP bedroom/mvhr/toilet | 0.4/1.4/0.4 → 0.8/1.8/0.8 | 126.2 | +3.2 |
| 7 | Fan duties bedroom/mvhr | 2208/1425 → 2292/1450 | 126.6 | +0.4 |
| 8 | Heat recovery (mvhr) | 80% → 70% | 127.0 | +0.4 |
| 9 | Lighting | 2.5 → 3.5 W/m² | 132.1 | +5.1 |
| 10 | Laundry (new `equipment_laundry`) | — → 34.5 MWh (0.9341 W/m²) | 140.4 | +8.3 |
| 11 | Setpoints htg/clg | 21/24 → 22/23 | 144.3 | +3.9 |
| 12 | ASHP DHW COP / gas η | 3.4/0.89 → 2.8/0.85 | 147.6 | +3.3 |
| 13 | DHW plant split gas:HP | 75/25 → 60/40 | 140.4 | −7.2 |
| 14 | **DHW re-anchor** (converge L/p/day) | 48.2 → 57.57 | 150.0 | +9.6 |
| 15 | **Auxiliary residual** | — → 147.75 MWh | **185.1** | +35.1 |

Deltas sum to +65.9 (119.2 → 185.1). Steps interact (order is canonical, not additive-independent);
the per-step Δ is the marginal effect in this order.

---

## Part 2 details

- **Step 1 (U-values)** is a real cancellation, not an inert input: +10% U raises heating demand
  +4.5 MWh but *lowers* cooling −3.3 MWh (a gains-dominated building sheds heat in the cooling season),
  net +0.1 EUI. Override plumbing verified (×1.0 object-override = library U exactly; ×2/×5 scale
  strongly). Input home: Brief-28k `construction_choices` object-form `u_value_override` — per-scenario,
  leaves Model-1 untouched.
- **Step 3 → E1:** no discrete input for a "door-operation daytime infiltration allowance" (operable
  openings model wind/stack physics, not a fixed allowance). Skipped, logged, carried in the residual.
- **Step 10 (laundry):** verified small_power +34.498 MWh vs the 34.5 target.

## Part 3 — DHW gas re-anchor (step 14)

Under the new 60/40 gas:HP split and gas η 0.85, DHW demand re-converged by bisection (split + η held
at evidenced values; demand converged, never hand-picked — design-note gas-anchoring rule):

- **Converged L/p/day = 57.57** (tap-40 °C basis; Model-1 was 48.2 — higher, ASHP now carrying 40%).
- **60 °C-equivalent V60 = 57.57 × 30/50 = 34.5 L/p/day** (Model-1 28.9; higher, as the brief predicts).
- Modelled gas **207.700 MWh** = 0.0% vs 207.7 (inside ±2%). L inside E3's 15–80 band.

## Part 4 — Auxiliary residual (step 15, D2)

`residual_kWh = 572,400 − 424,648 = 147,752 kWh`. Implemented as a named flat-profile equipment entry
**`auxiliary_residual_unattributed`** (4.001 W/m², continuous) on the **equipment class** — a
demonstrably-counted pathway (NOT the inert `gains.auxiliary`).

- **Sized: 147.75 MWh · 4.001 W/m² · 35.1 EUI points.** Inside the 80–200 stop-band and the expected
  120–160 (no E2 halt).
- **D2 consumption proof:** total electricity 424.648 → 572.400 MWh, Δ 147.752 = the residual.
- **`gain_fraction = 0` — recorded as an explicit ASSUMPTION, not a fact:** the residual is carried as
  **thermally neutral pending identification**. We do not know whether the unattributed load is in-space
  (heats the zone) or external/plant (doesn't); the neutral choice is defensible and makes the residual
  close the gap exactly (before/after Δ = the residual, no feedback). Verified: `gain_fraction=0` adds
  pure electricity with zero heat/cool feedback; `gain_fraction=1` would corrupt the balance
  (heat −49 / cool +89) and is correctly avoided.

## Part 4 — D3 inert-input trace audit

Every export row was traced to its engine-consumption point. Three carry inputs **not reflected in the
reported (full-mode) result** — now marked in the export (`assumptionsExport.js`):

| Export row (input) | Consumed? | Where / why |
|---|---|---|
| GIA, num_bedrooms | ✅ | EUI denominator; occupancy headcount |
| U-values (wall/roof/floor/glazing) | ✅ | `getConstructionItem` → conduction (verified step 1) |
| Air permeability q50 | ✅ | `deriveOperationalACH` (instantCalc.js:386) |
| Glazing g-value | ✅ | `getGValue` → solar gains (g 0.20 moves heat +21 / cool −58) |
| Permanent openings EA | ✅ | permanent-vent loss (removing them: heat −6 / cool +5) |
| People/room, sensible/person | ✅ | occupancy heat balance |
| Equipment, lighting | ✅ | small_power + zone gain (verified steps 9, 10) |
| DHW demand/temps/split | ✅ | DHW thermal + fuel split (verified steps 12–14) |
| Heating SCOP / cooling SEER / SFP / recovery(sensible) / fan flow | ✅ | verified steps 4–8 |
| **`gains.auxiliary` (Auxiliary baseload)** | ❌ **NOT CONSUMED** | wired to nothing; 0.0/0.3/7.0 W/m² identical (known) |
| **`occupancy.latent_w_per_person`** | ❌ **NOT CONSUMED** | static engine is sensible-only; 0/55/200 W identical (new) |
| **`building.thermal_bridges`** | ⚠ **E5** | `computeThermalBridges` yields **H_TB 170.23 W/K** but full-mode demand is insensitive (absent/×10/manual-500 all 62.3); computed but not applied — a Rule-14 parallel-path gap (State-1 Building page reflects it, the reported result doesn't). New; report-only. Follow-up brief flagged. |

Also inert (sub-notes, not standalone rows): `recovery_latent_pct` (sensible-only engine).

### Thermal-bridging residual caveat (re-quantified)

The E5 gap means some fabric loss that *is* attributable is currently absorbed into the "unattributed"
residual. The overstatement is **not** the ~13 MWh of thermal heating demand — the residual is
electricity-sized, so the relevant figure is the **net electrical effect** after (a) this building's
cooling-side cancellation and (b) ÷SCOP/SEER. At the Model-2 config, injecting H_TB = 170 W/K would add
+12.8 MWh heating demand and −8.8 MWh cooling demand → net electricity = 12.8/2.8 − 8.8/3.0 =
**≈ 1.6 MWh (1.1% of the 147.75 MWh residual)**. Negligible for the report; the residual is left at
147.75 MWh unchanged. The Rule-14 thermal-bridging fix is a separate follow-up brief (re-size the
residual after it lands).

---

## Verification (brief §Verification — all pass)

1. Gas 207.700 MWh = 0.0% vs 207.7 (≤ ±2%). ✅
2. Electricity 572,398 kWh (Δ −2, 0.0%) and EUI 185.1 (0.0). ✅
3. Residual 147.75 MWh ∈ [80,200] and [120,160]. ✅ (no E2)
4. Residual consumption proof: 424.648 → 572.400, Δ = residual. ✅
5. Waterfall complete (15 steps, EUI after each, deltas sum 119.2 → 185.1). ✅
6. Converged L/p/day 57.57 + 60 °C-equiv 34.5 (> Model-1 28.9, ASHP doing more). ✅
7. Both exports: 2 sheets, SHA-stamped, inert rows marked; **Model-1 export EUI 119.2 unchanged**. ✅
8. Occupied rooms 134 (138 × 0.971) / peak 402 in both (occupancy_rate 0.971 unchanged). ✅
9. Scenario round-trip: load Model-1 → every input reverts (incl. construction_choices back to plain
   strings), load Model-2 → calibrated; no value bleed. ✅
10. Dirty-state stamp: both clean exports read **State: saved**; the MODIFIED path (n differ) is
    verified by construction (`scenarioDirty` flips on edit — Part-0 ZZ-TEST test). ✅

## Scenarios / persistence

Minimal named-scenario mechanism (Part 0) stores scenarios in `building_config.scenarios[]` +
`active_scenario`, reusing the baseline-pin capture/restore path; carried through the loader allow-list
(no repeat of the Model-1 round-trip bug). Model-2 pinned as the baseline slot. Model-1 scenario is
byte-frozen throughout (read-only requirement). DB backed up pre-calibrate to
`…\Backups\nza-sim-db\nza_sim_pre-model2-calibrate_2026-07-15.db`.

## Lessons / divergences from brief

- **Part-1 granularity blur (accepted):** Part 1's scenario scaffold has no standalone commit — its
  reproducible record is folded into the Part-2 harness commit (the harness recreates the Model-1 start
  from a frozen fixture). Agreed with Chris.
- **E1 (step 3):** door-operation infiltration had no discrete input — skipped, carried in residual.
- **E5 (thermal bridging) is the material finding:** a live envelope term computed but absent from the
  reported result. Reported, not fixed (own brief). Residual overstatement ≈ 1.6 MWh (1.1%).
- **New inert input:** `occupancy.latent_w_per_person` (sensible-only engine).
- The auxiliary residual is thermally neutral **by assumption** (gain_fraction=0), pending identification
  of the load's nature — the honest choice for an unattributed gap, flagged as an assumption.
